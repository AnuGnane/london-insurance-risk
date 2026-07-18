"""Ingest small-area deprivation for Great Britain (England, Wales, Scotland).

Each nation publishes its own index on its own methodology and scale, so the
indices are NOT directly comparable across borders. The honest fix (AGENTS.md
rule 4) is to rank each area WITHIN its own nation and expose that as a
0–1 percentile (deprivation_pct, higher = more deprived) — that percentile is
the cross-nation-comparable feature the risk model consumes.

Sources:
  England  : MHCLG IoD2019 File 7 (score, rank, population mid-2015)   — direct CSV
  Wales    : WIMD 2019 Overall ranks (1–1,909)                          — Welsh Gov ArcGIS
             + Income and Community Safety domain ranks (imd_income_rank,
               imd_crime_rank; community safety used as the crime analogue)
             population: 2011 Census usual residents                    — NOMIS KS101EW
  Scotland : SIMD 2020v2 overall rank (1–6,976)                         — NHS Scotland open data
             + Income and Crime domain ranks (imd_income_rank,
               imd_crime_rank) from the Scottish Government
               "SIMD 2020v2 - ranks" workbook — the NHS CSV publishes
               only the overall rank, no domain columns
             population: Data Zone totpop2011 (2011 Census)             — gov.scot service

Grain  : small area (LSOA in E+W, Data Zone in Scotland)
Out    : data/interim/deprivation.parquet
         columns: area_code, nation, deprivation_score, deprivation_rank,
                  deprivation_pct, population
Vintage: England IoD2019 / Wales WIMD2019 / Scotland SIMD2020v2 (all on 2011 areas).
NI deferred (NIMDM 2017) — see implementation_plan.md.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from src.common.config import active_nations
from src.common.http import fetch_arcgis_attributes, get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

# --- England: MHCLG IoD2019 File 7 -----------------------------------------
IMD_FILE7_URL = (
    "https://assets.publishing.service.gov.uk/media/"
    "5dc407b440f0b6379a7acc8d/"
    "File_7_-_All_IoD2019_Scores__Ranks__Deciles_and_"
    "Population_Denominators_3.csv"
)
ENGLAND_COLUMNS = {
    "LSOA code (2011)": "area_code",
    "Index of Multiple Deprivation (IMD) Score": "deprivation_score",
    "Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)": "deprivation_rank",
    "Total population: mid 2015 (excluding prisoners)": "population",
    # Sub-domain scores and ranks (roadmap 2.3 — evidence-gate candidates).
    "Crime Score": "imd_crime_score",
    "Crime Rank (where 1 is most deprived)": "imd_crime_rank",
    "Income Score (rate)": "imd_income_score",
    "Income Rank (where 1 is most deprived)": "imd_income_rank",
}


# --- Wales: WIMD 2019 (Welsh Government "data_WG" ArcGIS org) ---------------
# Each WIMD domain is published as its own FeatureService, keyed on lsoa_code
# with a single `rank` field (1 = most deprived, 1..1,909). We fetch the overall
# ranks and left-merge the two domain services below.
_WIMD_BASE = (
    "https://services-eu1.arcgis.com/3Wk9d4HSvTixPOJc/arcgis/rest/services"
)
WIMD_OVERALL_URL = f"{_WIMD_BASE}/wimd2019_overall/FeatureServer/1/query"

# WIMD 2019 domain ranks (Welsh Gov ArcGIS). Wales has no pure "crime" domain;
# COMMUNITY SAFETY (police-recorded crime + ASB + fire) is the closest analogue
# and is used as Wales's imd_crime. Within-nation percentile ranking means only
# the ordering matters, so the definitional difference is acceptable — documented
# here and in DATA_PROVENANCE_AND_TRANSFORMS.md. Each service exposes its rank as
# a plain `rank` field, so we key the mapping by domain service name.
WALES_DOMAIN_FIELDS = {
    "wimd2019_income": "imd_income_rank",
    "wimd2019_community_safety": "imd_crime_rank",
}
# Domain service -> query endpoint (layer ids are service-specific, verified live).
WALES_DOMAIN_URLS = {
    "wimd2019_income": f"{_WIMD_BASE}/wimd2019_income/FeatureServer/8/query",
    "wimd2019_community_safety": (
        f"{_WIMD_BASE}/wimd2019_community_safety/FeatureServer/0/query"
    ),
}
# NOMIS KS101EW usual-resident population, restricted to LSOAs within Wales.
WALES_POP_URL = (
    "https://www.nomisweb.co.uk/api/v01/dataset/NM_144_1.data.csv"
    "?geography=2092957700TYPE298&measures=20100&RURAL_URBAN=0"
)

# --- Scotland: SIMD 2020v2 (NHS open data) + Data Zone population -----------
SIMD_CSV_URL = (
    "https://www.opendata.nhs.scot/dataset/78d41fa9-1a62-4f7b-9edb-3e8522a93378"
    "/resource/acade396-8430-4b34-895a-b3e757fa346e/download/simd2020v2_22062020.csv"
)
# Official SG "SIMD 2020v2 - ranks" workbook: overall + all seven domain ranks
# per Data Zone. Needed because the NHS CSV above carries NO domain columns
# (verified 2026-07: its only rank field is SIMD2020V2Rank).
SIMD_DOMAIN_XLSX_URL = (
    "https://www.gov.scot/binaries/content/documents/govscot/publications"
    "/statistics/2020/01"
    "/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks"
    "/documents/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks"
    "/scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks"
    "/govscot%3Adocument/SIMD%2B2020v2%2B-%2Branks.xlsx"
)
SIMD_DOMAIN_XLSX_SHEET = "SIMD 2020v2 ranks"
# Workbook domain-rank columns -> our names (column spellings verified against
# the live file; note the official asymmetry — only Income/Employment were
# revised in v2, so Crime keeps the plain SIMD2020_ prefix).
SCOTLAND_DOMAIN_FIELDS = {
    "SIMD2020v2_Income_Domain_Rank": "imd_income_rank",
    "SIMD2020_Crime_Domain_Rank": "imd_crime_rank",
}
SCOTLAND_DZ_URL = (
    "https://maps.gov.scot/server/rest/services"
    "/ScotGov/StatisticalUnits/MapServer/2/query"
)


def _cached_download(url: str, name: str) -> Path:
    """Download a file to data/raw/<name> once; return the cached path."""
    cache = raw(name)
    if cache.exists():
        log.info("Using cached %s", cache)
        return cache
    log.info("Downloading %s -> %s", url, cache)
    resp = get_with_retry(url, timeout=300)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(resp.content)
    return cache


def _cached_csv(url: str, name: str) -> pd.DataFrame:
    """Download a CSV to data/raw/<name> once, then read from cache."""
    return pd.read_csv(_cached_download(url, name), low_memory=False)


def parse_imd(df: pd.DataFrame) -> pd.DataFrame:
    """Select/rename England IoD2019 columns. Pure function for testability."""
    available = {c: v for c, v in ENGLAND_COLUMNS.items() if c in df.columns}
    missing = set(ENGLAND_COLUMNS) - set(available)
    if missing:
        log.warning("England IMD missing expected columns: %s", missing)
    return df[list(available.keys())].rename(columns=available)


def _england() -> pd.DataFrame:
    df = parse_imd(_cached_csv(IMD_FILE7_URL, "imd_file7.csv"))
    df["nation"] = "england"
    log.info("England: %d LSOAs (crime/income sub-domains: %s)",
             len(df), [c for c in df.columns if c.startswith("imd_")])
    return df


def merge_domain_ranks(
    ranks: pd.DataFrame,
    domains: dict[str, pd.DataFrame],
    field_map: dict[str, str],
    key_col: str = "lsoa_code",
) -> pd.DataFrame:
    """Left-merge domain-rank frames onto a nation's overall-rank frame.

    Pure function (analogous to England's parse_imd) so the merge semantics are
    testable without network I/O. `ranks` is keyed on area_code; each frame in
    `domains` carries (key_col, rank) for the source named by its key, renamed
    here via `field_map` (WALES_DOMAIN_FIELDS keyed on lsoa_code for the WIMD
    ArcGIS services, SCOTLAND_DOMAIN_FIELDS keyed on Data_Zone for the SIMD
    workbook columns).

    Fails LOUDLY on an empty/malformed domain frame OR a merge that attaches
    zero non-null values: a silently missing domain would leave every anchor
    row in that nation NaN on that feature, and calibrate drops NaN
    place-feature rows — quietly deleting the nation from the panel.

    Duplicate keys are dropped (first kept) with a warning rather than raised:
    ArcGIS pagination can occasionally overlap a page boundary, which yields
    identical repeated features — dropping those is safe, whereas a hard raise
    would make the pipeline flaky on a transient service quirk. Row count is
    asserted stable across each merge, so any non-identical duplicate that
    slipped through fan-out would still fail loudly.
    """
    df = ranks
    for source, dom in domains.items():
        our_col = field_map[source]
        if dom.empty or not {key_col, "rank"}.issubset(dom.columns):
            raise ValueError(
                f"Domain rank source {source!r} returned no usable rows/columns"
                " — candidate coverage would be incomplete"
            )
        dom = dom[[key_col, "rank"]].rename(
            columns={key_col: "area_code", "rank": our_col}
        )
        n_dupes = int(dom["area_code"].duplicated().sum())
        if n_dupes:
            log.warning(
                "Domain source %r: dropping %d duplicate key rows", source, n_dupes
            )
            dom = dom.drop_duplicates(subset="area_code")
        df = df.merge(dom, on="area_code", how="left")
        if len(df) != len(ranks):
            raise ValueError(
                f"Domain source {source!r} merge changed row count "
                f"({len(ranks)} -> {len(df)}) — non-unique keys fanned out"
            )
        if int(df[our_col].notna().sum()) == 0:
            raise ValueError(
                f"Domain source {source!r} matched no area codes — merge left"
                f" every {our_col} value null"
            )
    return df


def _wales() -> pd.DataFrame:
    ranks = pd.DataFrame(
        fetch_arcgis_attributes(
            WIMD_OVERALL_URL, out_fields="lsoa_code,rank", page_size=2000
        )
    ).rename(columns={"lsoa_code": "area_code", "rank": "deprivation_rank"})

    pop_raw = _cached_csv(WALES_POP_URL, "wales_population.csv")
    pop = pop_raw[pop_raw["CELL_NAME"] == "All usual residents"]
    pop = pop[["GEOGRAPHY_CODE", "OBS_VALUE"]].rename(
        columns={"GEOGRAPHY_CODE": "area_code", "OBS_VALUE": "population"}
    )

    df = ranks.merge(pop, on="area_code", how="left")

    # Income + community-safety domain ranks (roadmap 2.3 — evidence-gate
    # candidates). Fetch here; merge semantics live in merge_domain_ranks.
    domains = {
        service: pd.DataFrame(
            fetch_arcgis_attributes(url, out_fields="lsoa_code,rank", page_size=2000)
        )
        for service, url in WALES_DOMAIN_URLS.items()
    }
    df = merge_domain_ranks(df, domains, WALES_DOMAIN_FIELDS)

    df["deprivation_score"] = pd.NA  # WIMD publishes ranks, not a comparable score
    df["nation"] = "wales"
    missing = ", ".join(
        f"{int(df[col].isna().sum())} missing {col}"
        for col in WALES_DOMAIN_FIELDS.values()
    )
    log.info("Wales: %d LSOAs (%d missing population, %s)",
             len(df), int(df["population"].isna().sum()), missing)
    return df


def _scotland() -> pd.DataFrame:
    # Overall rank from the NHS CSV (unchanged source for deprivation_rank).
    simd = _cached_csv(SIMD_CSV_URL, "simd2020v2.csv")
    keep = {"DataZone": "area_code", "SIMD2020V2Rank": "deprivation_rank"}
    simd = simd[list(keep.keys())].rename(columns=keep)

    # Income + crime domain ranks (roadmap 2.3 — evidence-gate candidates) come
    # from the SG ranks workbook: the NHS CSV has no domain columns, so DZ-grain
    # domains must be sourced here (also fixes the crime council-grain limit).
    xlsx = pd.read_excel(
        _cached_download(SIMD_DOMAIN_XLSX_URL, "simd2020v2_ranks.xlsx"),
        sheet_name=SIMD_DOMAIN_XLSX_SHEET,
    )
    missing = [c for c in SCOTLAND_DOMAIN_FIELDS if c not in xlsx.columns]
    if missing:
        raise ValueError(
            f"SIMD ranks workbook is missing domain columns {missing}"
            " — Scotland candidate coverage would be incomplete"
        )
    domains = {
        col: xlsx[["Data_Zone", col]].rename(columns={col: "rank"})
        for col in SCOTLAND_DOMAIN_FIELDS
    }
    simd = merge_domain_ranks(simd, domains, SCOTLAND_DOMAIN_FIELDS,
                              key_col="Data_Zone")

    pop = pd.DataFrame(
        fetch_arcgis_attributes(
            SCOTLAND_DZ_URL, out_fields="datazone,totpop2011", page_size=1000
        )
    ).rename(columns={"datazone": "area_code", "totpop2011": "population"})

    df = simd.merge(pop, on="area_code", how="left")
    df["deprivation_score"] = pd.NA  # SIMD publishes ranks, not a comparable score
    df["nation"] = "scotland"
    missing_dom = ", ".join(
        f"{int(df[col].isna().sum())} missing {col}"
        for col in SCOTLAND_DOMAIN_FIELDS.values()
    )
    log.info("Scotland: %d Data Zones (%d missing population, %s)",
             len(df), int(df["population"].isna().sum()), missing_dom)
    return df


# Rank column -> its within-nation percentile column. Overall deprivation is
# always present; the sub-domain ranks (roadmap 2.3 candidates) only exist in
# nations whose source publishes them — all three, since Tasks 2–3.
_RANK_TO_PCT = {
    "deprivation_rank": "deprivation_pct",
    "imd_crime_rank": "imd_crime_pct",
    "imd_income_rank": "imd_income_pct",
}


def _within_nation_percentile(df: pd.DataFrame) -> pd.DataFrame:
    """Add 0–1 within-nation percentiles (higher = more deprived) for the
    overall rank and any sub-domain ranks present.

    Ranks are nation-specific (1 = most deprived). Converting to a within-nation
    percentile is what makes the three indices comparable across borders.
    """
    df = df.copy()
    for rank_col, pct_col in _RANK_TO_PCT.items():
        if rank_col in df.columns:
            n = df[rank_col].max()
            df[pct_col] = (n - df[rank_col]) / (n - 1)
    return df


_FETCHERS = {"england": _england, "wales": _wales, "scotland": _scotland}


def run() -> None:
    nations = active_nations()
    log.info("Building GB deprivation for nations=%s", nations)

    parts = [
        _within_nation_percentile(_FETCHERS[n]())
        for n in nations
        if n in _FETCHERS
    ]
    # Core columns always present; sub-domain columns only in nations that have them.
    core_cols = ["area_code", "nation", "deprivation_score", "deprivation_rank",
                 "deprivation_pct", "population"]
    sub_cols = ["imd_crime_rank", "imd_crime_score", "imd_crime_pct",
                "imd_income_rank", "imd_income_score", "imd_income_pct"]
    all_cols = core_cols + [c for c in sub_cols if any(c in p.columns for p in parts)]
    df = pd.concat([p.reindex(columns=all_cols) for p in parts], ignore_index=True)

    # Keep only areas in the current footprint (mirrors area_boundaries).
    bpath = interim("area_boundaries.parquet")
    if bpath.exists():
        areas = set(pd.read_parquet(bpath, columns=["area_code"])["area_code"])
        before = len(df)
        df = df[df["area_code"].isin(areas)].copy()
        log.info("Filtered %d → %d areas within footprint", before, len(df))

    dest = interim("deprivation.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d deprivation rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
