def test_wales_subdomain_columns_join():
    """Wales rows must carry imd_income_rank and imd_crime_rank so GB-wide
    candidate coverage is complete (calibrate drops NaN place-feature rows)."""
    from src.ingest.imd import WALES_DOMAIN_FIELDS
    assert "imd_income_rank" in WALES_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in WALES_DOMAIN_FIELDS.values()
