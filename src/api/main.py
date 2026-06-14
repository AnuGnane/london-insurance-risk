"""M5: FastAPI service (build after the front-end form factor is chosen).

Endpoints:
  GET /risk?postcode=EN1+4QR  -> {postcode, lsoa, risk_index, bucket, components}
  GET /geojson                -> the LSOA choropleth (lsoa_risk.geojson)

Loads data/processed artefacts at startup. postcode -> LSOA via postcode_lookup.
"""
from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="London Insurance Risk Map")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/risk")
def risk(postcode: str) -> dict:
    # TODO: resolve postcode -> LSOA, look up risk_index + components.
    raise NotImplementedError


@app.get("/geojson")
def geojson() -> dict:
    # TODO: stream data/processed/lsoa_risk.geojson.
    raise NotImplementedError
