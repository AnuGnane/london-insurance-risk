.PHONY: ingest features risk calibrate api test clean showcase-data

ingest:        ## M1: download + parse all sources -> data/interim/*.parquet
	python -m src.ingest.boundaries
	python -m src.ingest.onspd
	python -m src.ingest.police_crime
	python -m src.ingest.stats19
	python -m src.ingest.imd
	python -m src.ingest.scotland_crime
	python -m src.ingest.census_demographics
	python -m src.ingest.traffic
	python -m src.ingest.aadf
	python -m src.ingest.flood

features:      ## M2: build the LSOA feature table
	python -m src.transform.aggregate_to_lsoa

risk:          ## M3: compute composite risk index -> processed/lsoa_risk.{parquet,geojson}
	python -m src.transform.build_risk_index

calibrate:     ## M4: ingest WTW anchors + fit regression
	python -m src.calibrate.wtw_index
	python -m src.calibrate.calibrate

api:           ## M5: serve FastAPI (local dev only — not used by the static site)
	uvicorn src.api.main:app --reload --port 8000

showcase-data: ## Bake static assets for GitHub Pages -> frontend/public/data/
	python -m src.showcase.bake_static

test:
	pytest -q

clean:
	rm -rf data/interim/*.parquet data/processed/*
