"""Tests for the tippecanoe tile bake (pure arg construction + guards)."""
from pathlib import Path

import pytest

from src.showcase.bake_tiles import build_tippecanoe_args, TILES_NAME


def test_build_args_shape():
    args = build_tippecanoe_args(Path("in.geojson"), Path("out/lsoa-risk.pmtiles"))
    assert args[0] == "tippecanoe"
    assert "-o" in args and "out/lsoa-risk.pmtiles" in args
    assert "--layer=lsoa" in args
    assert "--minimum-zoom=4" in args and "--maximum-zoom=12" in args
    assert "--coalesce-densest-as-needed" in args
    assert "--force" in args
    assert args[-1] == "in.geojson"


def test_missing_input_fails_loud(tmp_path):
    from src.showcase.bake_tiles import run
    with pytest.raises(FileNotFoundError, match="areas.geojson"):
        run(src=tmp_path / "areas.geojson", dest=tmp_path / "t.pmtiles")
