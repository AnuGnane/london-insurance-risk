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


settings = load_config()
