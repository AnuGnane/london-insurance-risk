# Map (Phase 5 — deferred until form factor is chosen)

Recommended: **MapLibre GL JS** (open source, no token).
- Load `/geojson` from the API as a source.
- Choropleth fill by `bucket` (quintile) with a sequential colour ramp.
- Postcode search box -> `/risk?postcode=` -> fly to LSOA + show component breakdown.

If the project later becomes an iOS app instead, the same API serves a MapKit
overlay; the data/risk layers don't change.
