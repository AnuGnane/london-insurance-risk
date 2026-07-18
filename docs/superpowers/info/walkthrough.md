# London Insurance Risk Map — M1 to M4 Walkthrough

I have successfully completed the first four milestones of the project. The data pipeline is now fully operational and capable of fetching raw data, aggregating it by LSOA, computing a risk index, and calibrating it against real-world insurance premium anchors.

## What was completed

### M1: Data Ingestion (`make ingest`)
- **Boundaries**: Fetched the official LSOA 2011 boundaries for the London region (4,881 polygons).
- **ONSPD Postcodes**: Downloaded the May 2026 ONS Postcode Directory (ONSPD) and extracted 335,901 London postcodes. (We used ONSPD instead of NSPL as the newest NSPL dropped `lsoa11cd`).
- **Police Crime**: Built an automated bulk-ZIP downloader to fetch 12 months (customisable via `config.yaml`) of street-level vehicle crime data from the Metropolitan and City of London forces, yielding 76,131 crime records.
- **STATS19**: Processed road collision data (2021–2024).
- **IMD 2019**: Downloaded the official deprivation and population denominator scores.

### M2: Feature Aggregator (`make features`)
Joined all datasets onto the 4,881 London LSOAs using `duckdb` and `geopandas`. The output is a clean feature table:
- **Vehicle Crime**: Rate per 1k population per year.
- **Road Casualties**: Severity-weighted (`slight×1 + serious×3 + fatal×8`) collision rate.
- **Deprivation**: Overall IMD score.
- **Population Density**: Persons per square kilometre.

### M3: Risk Index (`make risk`)
Normalised the features using a percentile approach and applied the expert weights defined in `config.yaml`.
- The output risk index spans from 1.8 to 95.2.
- The LSOAs were successfully grouped into 5 equal-sized quintile buckets (1–5) for map display.
- Produced `lsoa_risk.parquet` (tabular) and `lsoa_risk.geojson` (spatial) in `data/processed/`.

### M4: Calibration (`make calibrate`)
Aggregated the LSOA risk features up to the postcode-area level (e.g., `E`, `NW`, `SE`) and ran an OLS regression against the 21 seed WTW (Willis Towers Watson) insurance premium anchors.
- **Resulting R²**: 0.909 (indicating the index correlates strongly with real-world premiums).
- **Report**: Full coefficients and results saved in [reports/calibration.md](file:///Users/anugnana/Library/Projects/london-insurance-risk/reports/calibration.md).

---

## Next Steps: M5 (API & Map)

According to `PLAN.md`, we are now ready to build the API and interactive map. 
Before proceeding, I need you to confirm the **form factor** for M5. 

Would you like to:
1. Build a **FastAPI backend** with a **React/Leaflet frontend**?
2. Build a **Streamlit application** (faster to prototype, pure Python)?
3. Build a simple static HTML **Folium map**?
4. Something else?
