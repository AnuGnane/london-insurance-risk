import pandas as pd
import pytest

from src.ingest.imd import (
    SCOTLAND_DOMAIN_FIELDS,
    WALES_DOMAIN_FIELDS,
    merge_domain_ranks,
)


def _ranks(codes: list[str] | None = None) -> pd.DataFrame:
    codes = codes or ["W01000001", "W01000002", "W01000003"]
    return pd.DataFrame({"area_code": codes, "deprivation_rank": [1, 2, 3]})


def _domain(codes: list[str], ranks: list[int], key: str = "lsoa_code") -> pd.DataFrame:
    return pd.DataFrame({key: codes, "rank": ranks})


def test_wales_subdomain_columns_contract():
    """Wales rows must carry imd_income_rank and imd_crime_rank so GB-wide
    candidate coverage is complete (calibrate drops NaN place-feature rows)."""
    assert "imd_income_rank" in WALES_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in WALES_DOMAIN_FIELDS.values()


def test_scotland_income_domain_mapped():
    """Scotland rows must carry the same two sub-domain features as England and
    Wales — the SG ranks workbook is the source (the NHS CSV has no domains)."""
    assert "imd_income_rank" in SCOTLAND_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in SCOTLAND_DOMAIN_FIELDS.values()


def test_merge_domain_ranks_happy_path():
    codes = ["W01000001", "W01000002", "W01000003"]
    out = merge_domain_ranks(
        _ranks(),
        {
            "wimd2019_income": _domain(codes, [10, 20, 30]),
            "wimd2019_community_safety": _domain(codes, [7, 8, 9]),
        },
        WALES_DOMAIN_FIELDS,
    )
    assert len(out) == 3
    assert out["imd_income_rank"].tolist() == [10, 20, 30]
    assert out["imd_crime_rank"].tolist() == [7, 8, 9]


def test_merge_domain_ranks_scotland_key_col():
    """The Scotland path reuses the same pure helper, keyed on Data_Zone."""
    codes = ["S01006506", "S01006507", "S01006508"]
    out = merge_domain_ranks(
        _ranks(codes),
        {
            "SIMD2020v2_Income_Domain_Rank": _domain(
                codes, [10, 20, 30], key="Data_Zone"
            ),
            "SIMD2020_Crime_Domain_Rank": _domain(codes, [7, 8, 9], key="Data_Zone"),
        },
        SCOTLAND_DOMAIN_FIELDS,
        key_col="Data_Zone",
    )
    assert len(out) == 3
    assert out["imd_income_rank"].tolist() == [10, 20, 30]
    assert out["imd_crime_rank"].tolist() == [7, 8, 9]


def test_merge_domain_ranks_empty_frame_raises():
    with pytest.raises(ValueError, match="wimd2019_income"):
        merge_domain_ranks(
            _ranks(),
            {
                "wimd2019_income": pd.DataFrame(),
                "wimd2019_community_safety": _domain(["W01000001"], [1]),
            },
            WALES_DOMAIN_FIELDS,
        )


def test_merge_domain_ranks_missing_column_raises():
    bad = pd.DataFrame({"lsoa_code": ["W01000001"]})  # no rank column
    with pytest.raises(ValueError, match="wimd2019_community_safety"):
        merge_domain_ranks(
            _ranks(), {"wimd2019_community_safety": bad}, WALES_DOMAIN_FIELDS
        )


def test_merge_domain_ranks_zero_overlap_raises():
    """A domain frame whose keys match nothing must fail loudly, not merge NaNs."""
    stray = _domain(["S01099999", "S01099998", "S01099997"], [1, 2, 3])
    with pytest.raises(ValueError, match="wimd2019_income"):
        merge_domain_ranks(_ranks(), {"wimd2019_income": stray}, WALES_DOMAIN_FIELDS)


def test_merge_domain_ranks_duplicate_keys_do_not_fan_out():
    dup = _domain(
        ["W01000001", "W01000001", "W01000002", "W01000003"], [10, 10, 20, 30]
    )
    out = merge_domain_ranks(_ranks(), {"wimd2019_income": dup}, WALES_DOMAIN_FIELDS)
    assert len(out) == 3
    assert out["imd_income_rank"].tolist() == [10, 20, 30]
