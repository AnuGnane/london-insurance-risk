import pandas as pd
from fastapi.testclient import TestClient
from src.api.main import app, STATE

def test_health():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

def test_methodology():
    with TestClient(app) as client:
        response = client.get("/api/methodology")
        assert response.status_code == 200
        data = response.json()
        assert "weights" in data
        assert "calibration" in data

def test_rankings():
    with TestClient(app) as client:
        if STATE.get("rankings"):
            response = client.get("/api/rankings?n=5")
            assert response.status_code == 200
            data = response.json()
            assert len(data) <= 5
            assert "code" in data[0]
            assert "calibrated_premium" in data[0]

def test_risk():
    with TestClient(app) as client:
        if isinstance(STATE.get("postcodes"), pd.DataFrame) and not STATE["postcodes"].empty:
            pc = STATE["postcodes"].index[0]
            response = client.get(f"/api/risk?postcode={pc}")
            if response.status_code == 200:
                data = response.json()
                assert "risk_index" in data
                assert "quintile" in data
                assert "components" in data
                assert "calibrated_premium_estimate" in data
                # Phase 1: place/composition split exposed
                assert "premium_place_only" in data
                assert "composition_uplift" in data

def test_geojson():
    with TestClient(app) as client:
        if STATE.get("geojson_path") and STATE["geojson_path"].exists():
            response = client.get("/api/geojson")
            assert response.status_code == 200
            assert response.headers.get("Content-Encoding") == "gzip"
            assert response.headers.get("Content-Type") == "application/geo+json"
