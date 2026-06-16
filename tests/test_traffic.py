"""Tests for Phase 3 traffic-exposure helpers."""
import pandas as pd

from src.ingest.traffic import (
    allocate_traffic_to_areas,
    area_authority_lookup,
    discover_download_url,
    normalise_local_authority_traffic,
)


def test_discover_download_url_finds_link_after_label():
    html = """
    <div>Other download <a href="https://example.test/other.csv">CSV</a></div>
    <h3>Local authority traffic by vehicle class</h3>
    <a href="https://storage.googleapis.com/dft/la-traffic.csv">CSV download</a>
    """
    assert discover_download_url(
        html, "Local authority traffic by vehicle class"
    ) == "https://storage.googleapis.com/dft/la-traffic.csv"


def test_normalise_local_authority_traffic_averages_selected_years():
    raw = pd.DataFrame(
        {
            "local_authority_id": ["E08000001", "E08000001", "E08000002"],
            "year": [2023, 2024, 2024],
            "all_motor_vehicles": [100.0, 140.0, 80.0],
        }
    )

    out = normalise_local_authority_traffic(raw, [2023, 2024])

    first = out[out["local_authority_code"] == "E08000001"].iloc[0]
    assert first["traffic_million_vehicle_miles"] == 120.0
    assert set(out.columns) == {
        "local_authority_code",
        "traffic_million_vehicle_miles",
    }


def test_area_authority_lookup_uses_modal_postcode_authority():
    postcodes = pd.DataFrame(
        {
            "area_code": ["E01000001", "E01000001", "E01000001", "E01000002"],
            "local_authority_code": ["E08000001", "E08000001", "E08000002", "E08000002"],
        }
    )

    out = area_authority_lookup(postcodes)

    assert out.set_index("area_code").loc["E01000001", "local_authority_code"] == "E08000001"
    assert len(out) == 2


def test_allocate_traffic_to_areas_by_population_share():
    la_traffic = pd.DataFrame(
        {
            "local_authority_code": ["E08000001"],
            "traffic_million_vehicle_miles": [300.0],
        }
    )
    area_authority = pd.DataFrame(
        {
            "area_code": ["E01000001", "E01000002"],
            "local_authority_code": ["E08000001", "E08000001"],
        }
    )
    population = pd.DataFrame(
        {"area_code": ["E01000001", "E01000002"], "population": [1000, 2000]}
    )

    out = allocate_traffic_to_areas(la_traffic, area_authority, population)

    rows = out.set_index("area_code")
    assert rows.loc["E01000001", "traffic_million_vehicle_miles"] == 100.0
    assert rows.loc["E01000002", "traffic_million_vehicle_miles"] == 200.0
    assert rows.loc["E01000001", "traffic_per_capita"] == 100000.0
