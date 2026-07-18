import pandas as pd
import pytest

from src.ingest.imd import WALES_DOMAIN_FIELDS, merge_wales_domains


def _ranks() -> pd.DataFrame:
    return pd.DataFrame(
        {"area_code": ["W01000001", "W01000002", "W01000003"],
         "deprivation_rank": [1, 2, 3]}
    )


def _domain(codes: list[str], ranks: list[int]) -> pd.DataFrame:
    return pd.DataFrame({"lsoa_code": codes, "rank": ranks})


def test_wales_subdomain_columns_contract():
    """Wales rows must carry imd_income_rank and imd_crime_rank so GB-wide
    candidate coverage is complete (calibrate drops NaN place-feature rows)."""
    assert "imd_income_rank" in WALES_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in WALES_DOMAIN_FIELDS.values()


def test_merge_wales_domains_happy_path():
    codes = ["W01000001", "W01000002", "W01000003"]
    out = merge_wales_domains(
        _ranks(),
        {
            "wimd2019_income": _domain(codes, [10, 20, 30]),
            "wimd2019_community_safety": _domain(codes, [7, 8, 9]),
        },
    )
    assert len(out) == 3
    assert out["imd_income_rank"].tolist() == [10, 20, 30]
    assert out["imd_crime_rank"].tolist() == [7, 8, 9]


def test_merge_wales_domains_empty_frame_raises():
    with pytest.raises(ValueError, match="wimd2019_income"):
        merge_wales_domains(
            _ranks(),
            {
                "wimd2019_income": pd.DataFrame(),
                "wimd2019_community_safety": _domain(["W01000001"], [1]),
            },
        )


def test_merge_wales_domains_missing_column_raises():
    bad = pd.DataFrame({"lsoa_code": ["W01000001"]})  # no rank column
    with pytest.raises(ValueError, match="wimd2019_community_safety"):
        merge_wales_domains(_ranks(), {"wimd2019_community_safety": bad})


def test_merge_wales_domains_duplicate_keys_do_not_fan_out():
    dup = _domain(
        ["W01000001", "W01000001", "W01000002", "W01000003"], [10, 10, 20, 30]
    )
    out = merge_wales_domains(_ranks(), {"wimd2019_income": dup})
    assert len(out) == 3
    assert out["imd_income_rank"].tolist() == [10, 20, 30]
