"""Guards that the SERVED map matches the CURRENT model coefficients — kills
train/serve skew and the percentile-precision gap. Skips if assets aren't built."""
import json
import math

import pytest

from src.common.config import ROOT

GEO = ROOT / "frontend" / "public" / "data" / "areas.geojson"
CALIB = ROOT / "reports" / "calibration.json"


def _load():
    if not GEO.exists() or not CALIB.exists():
        pytest.skip("served geojson / calibration.json not built (run `make calibrate`)")
    return json.loads(CALIB.read_text()), json.loads(GEO.read_text())["features"]


def _order(coefs):
    return [c for c in coefs if c != "const"]


def test_baseline_matches_coefficients():
    calib, feats = _load()
    coefs, na = calib["coefficients"], calib["national_avg_latest"]
    expected = na * math.exp(coefs["const"] + 50.0 * sum(coefs[c] for c in _order(coefs)))
    baselines = {f["properties"].get("premium_baseline") for f in feats} - {None}
    assert baselines, "no premium_baseline shipped"
    for b in baselines:
        assert abs(b - expected) <= 1, f"served baseline {b} != {expected:.2f} — train/serve skew"


def test_premium_reproducible_from_shipped_percentiles():
    calib, feats = _load()
    coefs, na = calib["coefficients"], calib["national_avg_latest"]
    order = _order(coefs)
    bad = []
    for f in feats:
        p = f["properties"]
        served = p.get("calibrated_premium")
        if served is None:
            continue
        z = coefs["const"] + sum(coefs[c] * (p.get(c) if p.get(c) is not None else 50.0) for c in order)
        if abs(na * math.exp(z) - served) > 1:
            bad.append(p.get("lsoa11cd"))
    assert not bad, f"{len(bad)} areas not reproducible within £1 (precision/skew), e.g. {bad[:5]}"


def test_waterfall_reconciles_exactly():
    calib, feats = _load()
    order = _order(calib["coefficients"])
    bases = [c[:-4] if c.endswith("_pct") else c for c in order]
    bad = []
    for f in feats:
        p = f["properties"]
        prem, base = p.get("calibrated_premium"), p.get("premium_baseline")
        if prem is None or base is None:
            continue
        s = sum((p.get(f"{b}_contrib") or 0) for b in bases)
        if base + s != prem:
            bad.append((p.get("lsoa11cd"), base + s, prem))
    assert not bad, f"{len(bad)} areas where baseline+Σcontrib != premium, e.g. {bad[:5]}"


def test_signs_and_extrema_are_sane():
    calib, feats = _load()
    coefs = calib["coefficients"]
    for c in ("vehicle_crime_pct", "deprivation_pct", "aadf_intensity_pct"):
        assert coefs[c] > 0, f"place driver {c} should raise premium"
    prems = [f["properties"]["calibrated_premium"] for f in feats
             if f["properties"].get("calibrated_premium") is not None]
    assert 100 <= min(prems) and max(prems) <= 3000, f"premium range {min(prems)}–{max(prems)} implausible"
