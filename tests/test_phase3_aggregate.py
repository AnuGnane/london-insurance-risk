"""Tests for Phase 3 collision features."""
import pandas as pd

from src.transform.aggregate_to_lsoa import compute_ksi_collision_rate


def test_compute_ksi_collision_rate_uses_traffic_denominator():
    collisions = pd.DataFrame(
        {
            "area_code": ["E01000001", "E01000001", "E01000001", "E01000002"],
            "severity_label": ["fatal", "serious", "slight", "serious"],
        }
    )
    traffic = pd.DataFrame(
        {
            "area_code": ["E01000001", "E01000002"],
            "traffic_million_vehicle_miles": [50.0, 100.0],
        }
    )

    out = compute_ksi_collision_rate(collisions, traffic, [2023, 2024])

    rows = out.set_index("area_code")
    assert rows.loc["E01000001", "ksi_collision_count"] == 2
    assert rows.loc["E01000001", "ksi_collisions_per_billion_vehicle_miles"] == 20.0
    assert rows.loc["E01000002", "ksi_collisions_per_billion_vehicle_miles"] == 5.0
