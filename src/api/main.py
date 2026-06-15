from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import pandas as pd
import json
import logging
from pathlib import Path
from pydantic import BaseModel
import re

from src.common.config import settings, ROOT
from src.common.io import processed, interim

log = logging.getLogger(__name__)

app = FastAPI(title="London Insurance Risk Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev. Prod should restrict this.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory datasets
STATE = {}

@app.on_event("startup")
def load_data():
    log.info("Loading precomputed data into memory...")
    
    # Risk features
    risk_path = processed("lsoa_risk.parquet")
    if risk_path.exists():
        STATE["risk"] = pd.read_parquet(risk_path)
        # Compute percentiles for components upfront
        cols = ["vehicle_crime", "road_casualties", "deprivation", "population_density"]
        for col in cols:
            if col in STATE["risk"].columns:
                STATE["risk"][f"{col}_pct"] = STATE["risk"][col].rank(pct=True) * 100
        
        # Precompute rankings for /api/rankings
        STATE["rankings"] = STATE["risk"].sort_values("risk_index", ascending=False).to_dict(orient="records")
    else:
        log.warning("lsoa_risk.parquet not found")
        STATE["risk"] = pd.DataFrame()

    # Postcode lookup
    lookup_path = interim("postcode_lookup.parquet")
    if lookup_path.exists():
        pc_df = pd.read_parquet(lookup_path)
        # Remove spaces and uppercase to make lookup robust
        pc_df["pcd_clean"] = pc_df["pcd7"].str.replace(" ", "").str.upper()
        STATE["postcodes"] = pc_df.set_index("pcd_clean")
    else:
        log.warning("postcode_lookup.parquet not found")
        STATE["postcodes"] = pd.DataFrame()

    # WTW anchors
    anchors_path = interim("wtw_anchors.csv")
    if anchors_path.exists():
        wtw = pd.read_csv(anchors_path)
        # Only keep postcode_area grain
        STATE["anchors"] = wtw[wtw["grain"] == "postcode_area"].set_index("postcode_area")["avg_premium_gbp"].to_dict()
    else:
        log.warning("wtw_anchors.csv not found")
        STATE["anchors"] = {}

    # Calibration coefficients
    calib_path = ROOT / "reports" / "calibration.json"
    if calib_path.exists():
        STATE["calibration"] = json.loads(calib_path.read_text())
    else:
        log.warning("calibration.json not found")
        STATE["calibration"] = {"coefficients": {}}

    # GeoJSON Path
    STATE["geojson_path"] = processed("lsoa_risk.geojson.gz")
    
    log.info("Data loading complete.")

def clean_postcode(pc: str) -> str:
    return re.sub(r"\s+", "", str(pc)).upper()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/geojson")
def get_geojson():
    if not STATE["geojson_path"].exists():
        raise HTTPException(status_code=404, detail="GeoJSON not found")
    
    return FileResponse(
        STATE["geojson_path"],
        media_type="application/geo+json",
        headers={"Content-Encoding": "gzip"},
        filename="lsoa_risk.geojson"
    )

@app.get("/api/risk")
def get_risk(postcode: str = Query(..., min_length=2, max_length=10)):
    pc_clean = clean_postcode(postcode)
    
    if pc_clean not in STATE["postcodes"].index:
        raise HTTPException(status_code=404, detail="Postcode not found or outside London")
    
    pc_data = STATE["postcodes"].loc[pc_clean]
    if isinstance(pc_data, pd.DataFrame):
        pc_data = pc_data.iloc[0]
        
    lsoa = pc_data["lsoa11cd"]
    # Get postcode area (the letters before the numbers, e.g. SW from SW1A)
    match = re.match(r"^([A-Z]+)", pc_clean)
    postcode_area = match.group(1) if match else ""

    risk_df = STATE["risk"]
    row = risk_df[risk_df["lsoa11cd"] == lsoa]
    if row.empty:
        raise HTTPException(status_code=404, detail="LSOA not found in risk table")
    
    row = row.iloc[0]
    
    # Calculate premium estimate
    coefs = STATE["calibration"].get("coefficients", {})
    est = coefs.get("const", 0)
    for col in ["vehicle_crime", "road_casualties", "deprivation", "population_density"]:
        if col in coefs and col in row:
            est += coefs[col] * row[col]

    # Calculate weighted contributions
    weights = settings["risk_index"]["weights"]
    total_weight = sum(weights.values())
    
    components = {}
    for col, w in weights.items():
        if col in row:
            val = float(row[col])
            pct = float(row[f"{col}_pct"]) if f"{col}_pct" in row else 0
            # To calculate exact contribution to the index:
            # normalise(val) * w / total_weight. We use pct for normalise if percentile.
            norm_method = settings["risk_index"]["normalisation"]
            if norm_method == "percentile":
                contrib = (pct * w) / total_weight
            else:
                contrib = 0 # simplified fallback
                
            components[col] = {
                "value": val,
                "percentile": pct,
                "contribution": contrib
            }

    return {
        "postcode": pc_data.get("pcd8", pc_clean),
        "lsoa11cd": lsoa,
        "risk_index": float(row["risk_index"]),
        "quintile": int(row["risk_bucket"]),
        "components": components,
        "calibrated_premium_estimate": round(est),
        "postcode_area": postcode_area,
        "wtw_anchor_premium": STATE["anchors"].get(postcode_area)
    }

@app.get("/api/rankings")
def get_rankings(n: int = Query(20, le=100)):
    rankings = STATE["rankings"][:n]
    
    results = []
    for row in rankings:
        # Calculate premium estimate
        coefs = STATE["calibration"].get("coefficients", {})
        est = coefs.get("const", 0)
        for col in ["vehicle_crime", "road_casualties", "deprivation", "population_density"]:
            if col in coefs and col in row:
                est += coefs[col] * row[col]
                
        results.append({
            "code": row["lsoa11cd"],
            "name": row.get("lsoa11nm", row["lsoa11cd"]),
            "risk_index": float(row["risk_index"]),
            "quintile": int(row["risk_bucket"]),
            "calibrated_premium": round(est)
        })
        
    return results

@app.get("/api/methodology")
def get_methodology():
    return {
        "weights": settings["risk_index"]["weights"],
        "normalisation": settings["risk_index"]["normalisation"],
        "calibration": {
            "r_squared": STATE["calibration"].get("r_squared"),
            "coefficients": STATE["calibration"].get("coefficients"),
            "backfit_weights": STATE["calibration"].get("backfit_weights")
        }
    }

# Serve frontend static files if they exist (for production Docker image)
frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists() and frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
