"""Ingest Scottish vehicle crime to close the data.police.uk coverage gap.

data.police.uk has NO Scottish data, so the GB model previously left Scotland's
vehicle_crime feature missing (NaN) and could not price Scottish areas. This
module fills it from the Scottish Government's "Recorded Crime in Scotland"
linked-data cube (statistics.gov.scot), which publishes "Theft of a motor
vehicle" + "Theft from a motor vehicle" — the closest analogue to the
data.police.uk "vehicle-crime" category.

Grain reality: Scotland publishes recorded crime only at LOCAL AUTHORITY level
(32 councils), not Data Zone. We therefore disaggregate each council's motor-
vehicle-crime count to its Data Zones **by population** (i.e. every Data Zone in
a council is assigned that council's per-capita rate). This is honest about what
exists: it adds between-council variation but no within-council variation. A
finer disaggregation (e.g. weighting by the SIMD crime domain) is a documented
follow-up — see MODEL_REVIEW.md.

Because Scottish "theft of/from a motor vehicle" is a narrower, differently-
recorded measure than the E+W "vehicle-crime" category, the absolute rates are
NOT comparable across the border. That is fine: the risk model ranks vehicle
crime WITHIN nation (E+W together, Scotland separate) before use, exactly as it
does for deprivation — only the within-nation ordering feeds the index/premium.

Source : https://statistics.gov.scot/data/recorded-crime  (OGL v3.0)
Grain  : council area -> disaggregated to Data Zone (2011) by population
Out    : data/interim/scotland_vehicle_crime.parquet
         columns: area_code, council, vehicle_crime_count, vehicle_crime
Vintage: latest government-year present in the cube.
"""
from __future__ import annotations

import io
import logging

import pandas as pd

from src.common.config import settings
from src.common.http import get_with_retry
from src.common.io import interim, write_parquet

log = logging.getLogger(__name__)

SPARQL_URL = settings["sources"]["scotland_crime_sparql"]

# The two "crime or offence" concepts that together approximate vehicle crime.
_VEHICLE_CRIME_CONCEPTS = (
    "crimes-group-3-theft-of-a-motor-vehicle",
    "crimes-group-3-theft-from-a-motor-vehicle",
)

# Vehicle-crime counts by council and government-year (S12 councils only; the
# S92 national total is excluded by the STRSTARTS filter). Latest year picked
# client-side so we don't hard-code a vintage.
_CRIME_BY_COUNCIL = """
PREFIX qb: <http://purl.org/linked-data/cube#>
PREFIX sdmx: <http://purl.org/linked-data/sdmx/2009/dimension#>
PREFIX dim: <http://statistics.gov.scot/def/dimension/>
PREFIX cof: <http://statistics.gov.scot/def/concept/crime-or-offence/>
PREFIX mp: <http://statistics.gov.scot/def/measure-properties/>
SELECT ?council ?period (SUM(?v) AS ?n) WHERE {
  ?o qb:dataSet <http://statistics.gov.scot/data/recorded-crime> ;
     dim:crimeOrOffence ?ct ;
     qb:measureType mp:count ;
     mp:count ?v ;
     sdmx:refArea ?councilUri ;
     sdmx:refPeriod ?periodUri .
  VALUES ?ct { %s }
  FILTER(STRSTARTS(STR(?councilUri), "http://statistics.gov.scot/id/statistical-geography/S12"))
  BIND(REPLACE(STR(?councilUri), ".*/", "") AS ?council)
  BIND(REPLACE(STR(?periodUri), ".*/", "") AS ?period)
} GROUP BY ?council ?period
""" % " ".join(f"cof:{c}" for c in _VEHICLE_CRIME_CONCEPTS)

# Data Zone (2011) -> council-area best-fit lookup.
_DZ_TO_COUNCIL = """
PREFIX foi: <http://publishmydata.com/def/ontology/foi/>
PREFIX bf: <http://statistics.gov.scot/def/hierarchy/best-fit#>
SELECT ?dz ?council WHERE {
  ?dzUri foi:memberOf <http://statistics.gov.scot/def/foi/collection/data-zones-2011> ;
         bf:council-area ?councilUri .
  BIND(REPLACE(STR(?dzUri), ".*/", "") AS ?dz)
  BIND(REPLACE(STR(?councilUri), ".*/", "") AS ?council)
}
"""


def _sparql_csv(query: str) -> pd.DataFrame:
    """Run a SPARQL query against statistics.gov.scot, return the CSV result."""
    resp = get_with_retry(
        SPARQL_URL, params={"query": query},
        headers={"Accept": "text/csv"}, timeout=120,
    )
    return pd.read_csv(io.StringIO(resp.text))


def _latest_year(crime: pd.DataFrame) -> pd.DataFrame:
    """Keep only the most recent government-year (period like '2023-2024')."""
    crime = crime.copy()
    crime["year_start"] = crime["period"].str.slice(0, 4).astype(int)
    latest = crime["year_start"].max()
    log.info("Latest Scottish crime year: %s", crime.loc[crime["year_start"] == latest, "period"].iloc[0])
    return crime[crime["year_start"] == latest]


def disaggregate(crime_by_council: pd.DataFrame, dz_council: pd.DataFrame,
                 dz_pop: pd.DataFrame) -> pd.DataFrame:
    """Spread each council's vehicle-crime count over its Data Zones by population.

    Pure function. Returns one row per Data Zone with the disaggregated count and
    the (council-uniform) per-1,000 annual rate. dz_pop carries area_code+population.
    """
    dz = dz_council.merge(dz_pop, left_on="dz", right_on="area_code", how="inner")
    council_pop = dz.groupby("council", as_index=False)["population"].sum().rename(
        columns={"population": "council_pop"}
    )
    dz = dz.merge(council_pop, on="council", how="left")
    dz = dz.merge(crime_by_council[["council", "n"]], on="council", how="left")
    dz["n"] = dz["n"].fillna(0.0)
    # Population share within the council; falls back to equal share if pop is 0.
    share = (dz["population"] / dz["council_pop"].where(dz["council_pop"] > 0)).fillna(0.0)
    dz["vehicle_crime_count"] = dz["n"] * share
    # Per-1,000 annual rate is council-uniform: count/council_pop*1000 (one year).
    dz["vehicle_crime"] = (
        dz["n"] / dz["council_pop"].clip(lower=1) * 1000
    )
    return dz[["area_code", "council", "vehicle_crime_count", "vehicle_crime"]]


def run() -> None:
    log.info("Ingesting Scottish vehicle crime from %s", SPARQL_URL)

    crime = _sparql_csv(_CRIME_BY_COUNCIL)
    crime = _latest_year(crime)
    log.info("Vehicle crime for %d councils (Scotland total = %d crimes)",
             crime["council"].nunique(), int(crime["n"].sum()))

    dz_council = _sparql_csv(_DZ_TO_COUNCIL)
    log.info("Mapped %d Data Zones to councils", len(dz_council))

    # Data Zone populations come from the deprivation ingest (totpop2011).
    dep = pd.read_parquet(interim("deprivation.parquet"))
    dz_pop = dep[dep["nation"] == "scotland"][["area_code", "population"]]

    out = disaggregate(crime, dz_council, dz_pop)
    missing = out["vehicle_crime"].isna().sum()
    log.info("Scotland vehicle crime: %d Data Zones, rate min=%.2f median=%.2f max=%.2f per 1k/yr",
             len(out), out["vehicle_crime"].min(), out["vehicle_crime"].median(),
             out["vehicle_crime"].max())
    if missing:
        log.warning("%d Data Zones have no crime rate (unmapped council?)", missing)

    write_parquet(out, interim("scotland_vehicle_crime.parquet"))
    log.info("Wrote %s", interim("scotland_vehicle_crime.parquet"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
