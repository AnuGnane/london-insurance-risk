"""Load config/config.yaml into a typed settings object.

Source of truth for years, weights, region code, paths and normalisation.
Modules should import `settings` from here rather than hard-coding values.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "config" / "config.yaml"


@lru_cache
def load_config() -> dict:
    """Read and cache config.yaml as a plain dict."""
    with CONFIG_PATH.open() as f:
        return yaml.safe_load(f)


def path(key: str) -> Path:
    """Resolve a configured data path (raw|interim|processed) to an absolute Path."""
    cfg = load_config()
    return ROOT / cfg["paths"][key]


def geography() -> dict:
    """Shortcut to the geography block."""
    return load_config()["geography"]


# Footprint presets that imply a fixed nation set, overriding the explicit
# `nations` list. Anything else ("gb", "uk", custom) falls back to that list.
_FOOTPRINT_NATIONS = {
    "london": ["england"],
    "england": ["england"],
    "england_wales": ["england", "wales"],
}


def active_nations() -> list[str]:
    """Nations in scope for the current footprint.

    "london"/"england"/"england_wales" imply a fixed subset; "gb"/"uk"/custom
    use the explicit `geography.nations` list (NI deferred — see config.yaml).
    """
    geo = geography()
    fp = geo.get("footprint", "gb")
    if fp in _FOOTPRINT_NATIONS:
        return list(_FOOTPRINT_NATIONS[fp])
    return list(geo.get("nations", ["england", "wales", "scotland"]))


def is_london_footprint() -> bool:
    """True only for the legacy London-only path (filters + london_lsoa_list.csv)."""
    return geography().get("footprint") == "london"


settings = load_config()
