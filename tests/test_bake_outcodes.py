"""Tests for the outcode → small-area fallback table (pure core, no data/)."""
import json

import pandas as pd
import pytest

from src.showcase.bake_outcodes import build_outcode_table, run

# Two outcodes. AB1: three postcodes around a mean, the middle one nearest, plus a
# row with no area. AB2: two postcodes equidistant from their mean (a tie).
FIXTURE = pd.DataFrame(
    {
        "pcd7": ["AB1 1AA", "AB1 1AB", "AB1 1AD", "AB1 1AE", "AB2 1AA", "AB2 1AB"],
        "postcode_district": ["AB1", "AB1", "AB1", "AB1", "AB2", "AB2"],
        "lsoa11cd": ["E01000003", "E01000001", "E01000002", None, "E01000005", "E01000004"],
        "lat": [51.00, 51.01, 51.02, 51.01, 52.00, 52.02],
        "long": [-1.00, -1.00, -1.00, -1.00, -2.00, -2.00],
    }
)


def test_nearest_postcode_to_the_mean_gives_the_area():
    assert build_outcode_table(FIXTURE)["AB1"] == "E01000001"


def test_a_tie_breaks_on_the_smaller_area_code():
    assert build_outcode_table(FIXTURE)["AB2"] == "E01000004"


def test_a_row_without_an_area_is_never_chosen():
    table = build_outcode_table(FIXTURE)
    assert all(isinstance(v, str) and v for v in table.values())
    assert set(table) == {"AB1", "AB2"}


def test_keys_are_sorted():
    shuffled = FIXTURE.sample(frac=1, random_state=0)
    assert list(build_outcode_table(shuffled)) == ["AB1", "AB2"]


def test_run_writes_json(tmp_path):
    src = tmp_path / "postcode_lookup.parquet"
    FIXTURE.to_parquet(src, index=False)
    dest = tmp_path / "outcodes.json"
    run(src=src, dest=dest)
    assert json.loads(dest.read_text()) == {"AB1": "E01000001", "AB2": "E01000004"}


def test_missing_input_fails_loud(tmp_path):
    with pytest.raises(FileNotFoundError, match="postcode_lookup"):
        run(src=tmp_path / "postcode_lookup.parquet", dest=tmp_path / "o.json")
