"""Tests for the LMDI premium-waterfall decomposition (build_risk_index)."""
import pandas as pd

from src.transform.build_risk_index import decompose_premium

COEFS = {"const": -0.72, "a_pct": 0.004, "b_pct": 0.003, "c_pct": -0.002}
ORDER = ["a_pct", "b_pct", "c_pct"]           # a,b = place ; c = composition
PCT = pd.DataFrame({
    "a_pct": [10.0, 90.0, 50.0],
    "b_pct": [20.0, 80.0, 50.0],
    "c_pct": [95.0, 5.0, 50.0],
})


def test_reconciles_exactly():
    out = decompose_premium(PCT, COEFS, 558.55, ORDER, composition_cols={"c_pct"})
    recon = out["steps"].sum(axis=1).astype(int) + int(out["baseline"])
    assert (recon == out["premium_full"].astype(int)).all()


def test_all_median_row_equals_baseline():
    out = decompose_premium(PCT, COEFS, 558.55, ORDER, composition_cols={"c_pct"})
    assert int(out["premium_full"].iloc[2]) == int(out["baseline"])
    assert int(out["premium_place_only"].iloc[2]) == int(out["baseline"])
    # Row 0 has c_pct=95 (negative coef): full < place-only there.
    assert int(out["premium_full"].iloc[0]) < int(out["premium_place_only"].iloc[0])


def test_order_invariant():
    a = decompose_premium(PCT, COEFS, 558.55, ["a_pct", "b_pct", "c_pct"], {"c_pct"})
    b = decompose_premium(PCT, COEFS, 558.55, ["c_pct", "b_pct", "a_pct"], {"c_pct"})
    for col in ORDER:
        assert (a["steps"][col].astype(int) == b["steps"][col].astype(int)).all()


def test_missing_place_and_composition_columns_held_at_median():
    coefs = {"const": -0.72, "a_pct": 0.004, "d_pct": 0.005, "c_pct": -0.002}
    order = ["a_pct", "d_pct", "c_pct"]           # d = place, c = composition; both absent
    pct = pd.DataFrame({"a_pct": [10.0, 50.0]})   # only a_pct present
    out = decompose_premium(pct, coefs, 558.55, order, composition_cols={"c_pct"})
    assert (out["steps"]["d_pct"].astype(int) == 0).all()
    assert (out["steps"]["c_pct"].astype(int) == 0).all()


def test_feature_groups_flood_is_per_nation():
    from src.transform.build_risk_index import _feature_groups
    df = pd.DataFrame({"nation": ["england", "wales", "scotland", "england"]})
    groups = _feature_groups(df, "flood_risk")
    assert list(groups) == ["england", "wales", "scotland", "england"]
    # crime keeps its E+W-pooled grouping
    assert list(_feature_groups(df, "vehicle_crime")) == ["ew", "ew", "scotland", "ew"]
    # ungrouped features rank GB-wide
    assert _feature_groups(df, "deprivation") is None


def test_flood_pct_ranked_within_nation():
    from src.transform.build_risk_index import _feature_groups, normalise
    df = pd.DataFrame({
        "nation": ["england"] * 3 + ["scotland"] * 3,
        "flood_risk": [0.0, 0.1, 0.2, 0.0, 0.01, 0.02],
    })
    pct = normalise(df["flood_risk"], "percentile", _feature_groups(df, "flood_risk"))
    # Scotland's 0.02 max ranks as high within Scotland as England's 0.2 does
    # within England — absolute scales are never compared across nations.
    assert pct.iloc[2] == pct.iloc[5]
