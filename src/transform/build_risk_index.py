"""M3: turn the feature table into a composite 0-100 risk index.

In  : data/interim/lsoa_features.parquet
Out : data/processed/lsoa_risk.parquet          (full, enriched — read by the API)
      data/processed/lsoa_risk.geojson.gz        (slim, gzipped — served to the map)

What changed vs the original:
  - Bakes per-component display fields into the output so the *map* can show a
    full breakdown on click and recolour by a single driver:
      {c}_val, {c}_pct, {c}_contrib   for each component, plus `quintile`.
  - Bakes `calibrated_premium` per LSOA *if* reports/calibration.json exists
    (so re-running `make risk` after `make calibrate` shows the premium on click).
  - Carries `lsoa_name` from the boundaries (friendlier titles + rankings).
  - Writes a gzipped GeoJSON, which is what main.py serves.

Keep this weight-driven and config-only so calibration can swap in back-fit
weights and re-run without code changes.
"""
from __future__ import annotations

import gzip
import json
import logging

import geopandas as gpd
import numpy as np
import pandas as pd

from src.common.config import settings, ROOT
from src.common.io import LSOA_FEATURES, LSOA_RISK_PARQUET, interim, processed, write_parquet

log = logging.getLogger(__name__)


def normalise(s: pd.Series, method: str, groups: pd.Series | None = None) -> pd.Series:
    """Scale a feature to 0-100 by the chosen method.

    If ``groups`` is given, normalise WITHIN each group (used for vehicle crime,
    where England+Wales and Scotland come from different sources on
    incomparable scales — only the within-nation ordering is meaningful, exactly
    as for deprivation)."""
    if groups is not None:
        return s.groupby(groups).transform(lambda x: normalise(x, method))
    if method == "percentile":
        return s.rank(pct=True) * 100
    if method == "minmax":
        return (s - s.min()) / (s.max() - s.min()) * 100
    if method == "zscore":
        return (s - s.mean()) / s.std(ddof=0)
    raise ValueError(f"unknown normalisation: {method}")


# Features measured by nation-specific sources on incomparable scales → ranked
# within nation-group before use. Maps nation -> comparability group.
_CRIME_SOURCE_GROUP = {"england": "ew", "wales": "ew", "scotland": "scotland"}


def _crime_groups(features: pd.DataFrame) -> pd.Series | None:
    """Comparability groups for vehicle_crime, or None if no nation column."""
    if "nation" not in features.columns:
        return None
    return features["nation"].map(_CRIME_SOURCE_GROUP).fillna("other")


def composite(features: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Weighted mean of normalised feature columns → risk_index.

    Reweights per row over the features that are present, so an area missing a
    feature (e.g. Scotland has no vehicle_crime) is scored from its remaining
    features with their weights renormalised — rather than scoring NaN or
    silently treating the gap as zero. With all features present this is exactly
    the weighted average sum(norm*w)/sum(w).
    """
    method = settings["risk_index"]["normalisation"]
    cg = _crime_groups(features)
    norm = pd.DataFrame({
        col: normalise(features[col], method, cg if col == "vehicle_crime" else None)
        for col in weights
    })
    w = pd.Series(weights, dtype=float)
    weighted_sum = (norm * w).sum(axis=1)            # NaNs skipped by pandas
    weight_total = (norm.notna() * w).sum(axis=1)    # only present features count
    return weighted_sum / weight_total.replace(0, pd.NA)


def bucket(score: pd.Series, n_buckets: int) -> pd.Series:
    """Assign quintile bucket labels 1..n_buckets from a continuous score."""
    return pd.qcut(score, q=n_buckets, labels=range(1, n_buckets + 1)).astype(int)


def model_features() -> list[str]:
    """All feature base-names to bake per area: legacy risk-index weights plus the
    declared place + composition + diagnostic features (de-duplicated,
    order-preserving). Diagnostics (e.g. traffic, KSI rate) are shown on the map but
    are not premium drivers — see config features.diagnostics."""
    feats = settings.get("features", {})
    ordered = (list(settings["risk_index"]["weights"].keys())
               + feats.get("place", []) + feats.get("composition", [])
               + feats.get("diagnostics", []))
    seen: set[str] = set()
    return [f for f in ordered if not (f in seen or seen.add(f))]


def enrich_components(features: pd.DataFrame, weights: dict[str, float]) -> list[str]:
    """Add {c}_val and {c}_pct per feature (used by the premium model, the map's
    single-driver colour filters, and the click breakdown). Covers place AND
    composition features. £ contributions are added later from the calibration
    coefficients — see bake_premium_and_contributions."""
    cg = _crime_groups(features)
    comps = [c for c in model_features() if c in features.columns]
    for c in comps:
        # vehicle_crime is ranked within nation-group (E+W vs Scotland) — the two
        # come from different sources on incomparable scales (see normalise()).
        pct = normalise(features[c], "percentile", cg if c == "vehicle_crime" else None)
        features[f"{c}_val"] = features[c].round(2)
        features[f"{c}_pct"] = pct.round(1)
    return comps


MEDIAN_PCT = 50.0   # percentile of a "national-average" area for a given factor


def decompose_premium(pct: pd.DataFrame, coefs: dict, national_avg: float,
                      order: list[str], composition_cols: set[str],
                      median_pct: float = MEDIAN_PCT) -> dict:
    """Exact, ORDER-INVARIANT additive premium waterfall (LMDI). Pure.

    The model is log-linear: ln(premium/baseline) = Σ coefₖ·(pctₖ − median). The
    logarithmic-mean (LMDI) split gives each factor an exact £ share of the gap from
    baseline:  stepₖ = L · coefₖ·(pctₖ − median),  L = (full − baseline)/ln(full/baseline),
    so baseline + Σ stepₖ == full and stepₖ depends only on factor k (no ordering).
    Missing/NaN cells are held at the median (step £0). Steps are integer-reconciled
    so round(baseline) + Σ round(step) == round(full) exactly.

    Returns {baseline:int, premium_full:Int64, premium_place_only:Int64, steps:Int64[order]}.
    """
    place_cols = [c for c in order if c not in composition_cols]

    # Per-factor log-contribution (order-independent); columns sum to ln(full/baseline).
    log_cols = {}
    for col in order:
        if col in pct.columns:
            vals = pct[col].fillna(median_pct)
        else:
            vals = pd.Series(median_pct, index=pct.index)
        log_cols[col] = float(coefs[col]) * (vals - median_pct)
    log_df = pd.DataFrame(log_cols)[order]
    total_log = log_df.sum(axis=1)

    baseline = float(national_avg) * np.exp(
        float(coefs["const"]) + median_pct * sum(float(coefs[c]) for c in order)
    )
    full = baseline * np.exp(total_log)
    place_log = (log_df[place_cols].sum(axis=1) if place_cols
                 else pd.Series(0.0, index=pct.index))
    place_only = baseline * np.exp(place_log)

    # Logarithmic mean L(full, baseline) = (full−baseline)/ln(full/baseline); → baseline
    # as full → baseline (all factors at the median).
    tl = total_log.to_numpy()
    diff = (full - baseline).to_numpy()
    safe = np.where(np.abs(tl) < 1e-12, 1.0, tl)
    L = np.where(np.abs(tl) < 1e-12, baseline, diff / safe)
    raw = log_df.mul(pd.Series(L, index=pct.index), axis=0)        # £ steps; Σ == full − baseline

    # Integer reconciliation: the largest-|step| factor per row absorbs the rounding residual.
    baseline_int = round(baseline)
    full_int = full.round()                                        # rounded ONCE; reused below
    steps_int = raw.round()
    residual = (full_int - baseline_int - steps_int.sum(axis=1)).to_numpy()
    arr = steps_int.to_numpy(dtype=float).copy()                  # pandas 3.x: to_numpy is read-only
    pick = raw.abs().to_numpy().argmax(axis=1)
    arr[np.arange(len(arr)), pick] += residual
    steps_int = pd.DataFrame(arr, index=pct.index, columns=order)

    return {
        "baseline": int(baseline_int),
        "premium_full": full_int.astype("Int64"),
        "premium_place_only": place_only.round().astype("Int64"),
        "steps": steps_int.astype("Int64"),
    }


def bake_premium_and_contributions(features: pd.DataFrame, comps: list[str]) -> dict:
    """Bake the premium, the constant baseline, and per-driver LMDI step
    £-contributions (exact, order-invariant waterfall) from the calibration
    coefficients. baseline + Σ {driver}_contrib == calibrated_premium, to the pound."""
    calib_path = ROOT / "reports" / "calibration.json"
    calib = json.loads(calib_path.read_text()) if calib_path.exists() else {}
    coefs = calib.get("coefficients", {})
    national_avg = calib.get("national_avg_latest")
    if not coefs or national_avg is None:
        log.info("No calibration yet — skipping premium; risk_index falls back to composite.")
        for c in comps:
            features[f"{c}_contrib"] = 0.0
        return {}

    composition_cols = set(calib.get("composition_features", []))
    order = [c for c in coefs if c != "const"]          # place then composition (insertion order)
    missing = [c for c in order if c not in features.columns]
    if missing:
        log.warning("Calibration features missing — held at the national median (pct=50): %s", missing)

    pct = features.reindex(columns=order)                # missing cols -> NaN -> median inside
    res = decompose_premium(pct, coefs, float(national_avg), order, composition_cols)

    features["premium_baseline"] = res["baseline"]
    features["calibrated_premium"] = res["premium_full"]
    features["premium_place_only"] = res["premium_place_only"]

    steps = res["steps"]
    priced: set[str] = set()
    for col in order:
        base = col[:-4] if col.endswith("_pct") else col
        features[f"{base}_contrib"] = steps[col]
        priced.add(base)
    for c in comps:                                      # non-model features contribute £0
        if c not in priced:
            features[f"{c}_contrib"] = 0
    log.info("Baked premium (£%s–£%s, baseline £%s) + %d LMDI step contribs",
             int(features['calibrated_premium'].min()), int(features['calibrated_premium'].max()),
             res["baseline"], len(order))
    return coefs


def run() -> None:
    log.info("Building composite risk index")

    # 1. Load features
    feat_path = interim(LSOA_FEATURES)
    if not feat_path.exists():
        raise FileNotFoundError(f"Missing {feat_path} — run `make features` first.")
    features = pd.read_parquet(feat_path)
    log.info("Loaded %d LSOA features", len(features))

    # 2. Per-component percentiles (needed by the premium model + map filters)
    weights = settings["risk_index"]["weights"]
    comps = enrich_components(features, weights)

    # 3. Calibrated premium + per-driver £ contributions
    coefs = bake_premium_and_contributions(features, comps)

    # 4. risk_index. Reconciled model: risk_index IS the calibrated premium on a
    #    0–100 scale (its GB-wide percentile), so the map's colouring, the
    #    quintiles and the headline £ are one construct. Falls back to the expert
    #    composite only when calibration hasn't been run yet (first build).
    if coefs and "calibrated_premium" in features:
        features["risk_index"] = features["calibrated_premium"].rank(pct=True) * 100
        log.info("risk_index = percentile of calibrated_premium (premium-reconciled): "
                 "premium £%.0f–£%.0f",
                 features["calibrated_premium"].min(), features["calibrated_premium"].max())
    else:
        features["risk_index"] = composite(features, weights)
        log.info("risk_index = expert composite (no calibration yet): min=%.1f median=%.1f max=%.1f",
                 features["risk_index"].min(), features["risk_index"].quantile(0.5),
                 features["risk_index"].max())

    # 5. Quintile buckets (+ a `quintile` alias the frontend reads directly)
    n_buckets = settings["risk_index"]["buckets"]
    features["risk_bucket"] = bucket(features["risk_index"], n_buckets)
    features["quintile"] = features["risk_bucket"].astype(int)
    log.info("Bucket distribution:\n%s", features["risk_bucket"].value_counts().sort_index())

    # 6. Boundaries: needed for geometry, and a source of area names
    boundary_path = interim("area_boundaries.parquet")
    boundaries = None
    if boundary_path.exists():
        boundaries = gpd.read_parquet(boundary_path)
        name_col = next(
            (c for c in ["area_name", "lsoa11nm", "LSOA11NM", "lsoa21nm", "name"]
             if c in boundaries.columns),
            None,
        )
        if name_col:
            features = features.merge(
                boundaries[["area_code", name_col]].rename(columns={name_col: "lsoa_name"}),
                on="area_code",
                how="left",
            )

    # 7. Write the full, enriched tabular output (the API reads this)
    dest_parquet = processed(LSOA_RISK_PARQUET)
    write_parquet(features, dest_parquet)
    log.info("Wrote enriched risk parquet to %s", dest_parquet)

    # 8. Build a SLIM, gzipped GeoJSON for the map (only the props the UI uses)
    if boundaries is None:
        log.warning(
            "No boundary parquet — cannot produce GeoJSON. "
            "Run `python -m src.ingest.boundaries` first."
        )
        return

    geo = boundaries[["area_code", "geometry"]].copy()
    # Simplify in EPSG:27700 (metres) to shrink the payload, then reproject.
    geo["geometry"] = geo["geometry"].simplify(15)
    gdf = gpd.GeoDataFrame(geo.merge(features, on="area_code", how="inner"), geometry="geometry")
    gdf = gdf.to_crs("EPSG:4326")

    keep = ["area_code", "lsoa11cd", "risk_index", "quintile"]
    if "lsoa_name" in gdf.columns:
        keep.append("lsoa_name")
    if "calibrated_premium" in gdf.columns:
        keep.append("calibrated_premium")
    if "premium_place_only" in gdf.columns:
        keep.append("premium_place_only")
    for c in comps:
        keep += [f"{c}_val", f"{c}_pct", f"{c}_contrib"]

    slim = gdf[keep + ["geometry"]].copy()
    slim["risk_index"] = slim["risk_index"].round(2)

    dest_gz = processed("lsoa_risk.geojson.gz")
    with gzip.open(dest_gz, "wt", encoding="utf-8") as f:
        f.write(slim.to_json())
    log.info("Wrote gzipped GeoJSON (%d features) to %s", len(slim), dest_gz)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
