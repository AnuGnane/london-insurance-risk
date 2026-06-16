from contextlib import asynccontextmanager
import json
import logging
import re

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.common.config import settings, ROOT
from src.common.io import processed, interim

log = logging.getLogger(__name__)

# In-memory datasets, populated at startup.
STATE: dict = {}

COMPONENT_COLS = ["vehicle_crime", "road_casualties", "deprivation", "population_density"]


def _load_data() -> None:
    log.info("Loading precomputed data into memory...")

    # Risk features (already enriched by build_risk_index with *_pct etc.)
    risk_path = processed("lsoa_risk.parquet")
    if risk_path.exists():
        risk = pd.read_parquet(risk_path)
        # Backfill percentiles only if the build step didn't bake them.
        for col in COMPONENT_COLS:
            if col in risk.columns and f"{col}_pct" not in risk.columns:
                risk[f"{col}_pct"] = risk[col].rank(pct=True) * 100
        STATE["risk"] = risk
    else:
        log.warning("lsoa_risk.parquet not found")
        STATE["risk"] = pd.DataFrame()

    # Postcode → LSOA lookup
    lookup_path = interim("postcode_lookup.parquet")
    if lookup_path.exists():
        pc_df = pd.read_parquet(lookup_path)
        pc_df["pcd_clean"] = pc_df["pcd7"].str.replace(" ", "", regex=False).str.upper()
        STATE["postcodes"] = pc_df.set_index("pcd_clean")
    else:
        log.warning("postcode_lookup.parquet not found")
        STATE["postcodes"] = pd.DataFrame()

    # WTW anchors (postcode-area grain)
    anchors_path = interim("wtw_anchors.csv")
    if anchors_path.exists():
        wtw = pd.read_csv(anchors_path)
        STATE["anchors"] = (
            wtw[wtw["grain"] == "postcode_area"]
            .set_index("postcode_area")["avg_premium_gbp"]
            .to_dict()
        )
    else:
        log.warning("wtw_anchors.csv not found")
        STATE["anchors"] = {}

    # Calibration coefficients
    calib_path = ROOT / "reports" / "calibration.json"
    if calib_path.exists():
        STATE["calibration"] = json.loads(calib_path.read_text())
    else:
        log.warning(
            "reports/calibration.json not found — premiums will be 0 and R² null. "
            "Have the calibrate step persist it (see project notes)."
        )
        STATE["calibration"] = {"coefficients": {}, "r_squared": None}

    log.info("Data loading complete.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_data()
    yield
    STATE.clear()


app = FastAPI(title="GB Insurance Risk Map API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # dev convenience; same-origin in the Docker build
    allow_credentials=False,    # no cookies/auth — wildcard origin needs this False
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_postcode(pc: str) -> str:
    return re.sub(r"\s+", "", str(pc)).upper()


def estimate_premium(row, coefs: dict) -> int | None:
    """Linear premium estimate from calibration coefficients. Works for a
    pandas Series or a dict row.

    Returns None if ANY model feature is missing for this row (e.g. Scotland has
    no vehicle_crime). Skipping the term silently would invent a too-low premium
    on an E+W-fit intercept; reporting "no estimate" is the honest behaviour and
    matches the baked calibrated_premium (NaN). Once a feature is ingested for
    that nation, the estimate appears automatically."""
    est = float(coefs.get("const", 0.0))
    for col, coef in coefs.items():
        if col == "const":
            continue
        val = row.get(col)
        if val is None or pd.isna(val):
            return None
        est += float(coef) * float(val)
    return round(est)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/geojson")
def get_geojson():
    """Serve the gzipped choropleth; fall back to plain if the .gz isn't built."""
    gz = processed("lsoa_risk.geojson.gz")
    if gz.exists():
        return FileResponse(
            gz,
            media_type="application/geo+json",
            headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=3600"},
        )
    plain = processed("lsoa_risk.geojson")
    if plain.exists():
        return FileResponse(
            plain,
            media_type="application/geo+json",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    raise HTTPException(status_code=404, detail="GeoJSON not found — run `make risk`.")


@app.get("/api/risk")
def get_risk(postcode: str = Query(..., min_length=2, max_length=10)):
    pc_clean = clean_postcode(postcode)
    if STATE["postcodes"].empty or pc_clean not in STATE["postcodes"].index:
        raise HTTPException(status_code=404, detail="Postcode not found or outside Great Britain")

    pc_data = STATE["postcodes"].loc[pc_clean]
    if isinstance(pc_data, pd.DataFrame):
        pc_data = pc_data.iloc[0]

    lsoa = pc_data["lsoa11cd"]
    m = re.match(r"^([A-Z]+)", pc_clean)
    postcode_area = m.group(1) if m else ""

    risk_df = STATE["risk"]
    rows = risk_df[risk_df["lsoa11cd"] == lsoa]
    if rows.empty:
        raise HTTPException(status_code=404, detail="LSOA not found in risk table")
    row = rows.iloc[0]

    coefs = STATE["calibration"].get("coefficients", {})
    weights = settings["risk_index"]["weights"]
    total_weight = sum(weights.values()) or 1.0
    method = settings["risk_index"]["normalisation"]

    def _num(x):
        """NaN -> None so the response is JSON-compliant (e.g. Scotland has no
        vehicle_crime, which the risk index reweights around)."""
        return float(x) if pd.notna(x) else None

    components = {}
    for col, w in weights.items():
        if col not in row:
            continue
        pct = _num(row[f"{col}_pct"]) if f"{col}_pct" in row else 0.0
        contrib = (pct * w) / total_weight if (method == "percentile" and pct is not None) else None
        components[col] = {
            "value": _num(row[col]),
            "percentile": pct,
            "contribution": contrib,
        }

    return {
        "postcode": pc_data.get("pcd8", pc_clean),
        "lsoa11cd": lsoa,
        "risk_index": float(row["risk_index"]),
        "quintile": int(row.get("quintile", row.get("risk_bucket", 0))),
        "components": components,
        "calibrated_premium_estimate": estimate_premium(row, coefs),
        "postcode_area": postcode_area,
        "wtw_anchor_premium": STATE["anchors"].get(postcode_area),
    }


@app.get("/api/rankings")
def get_rankings(
    n: int = Query(20, le=100),
    order: str = Query("desc", pattern="^(asc|desc)$"),
):
    df = STATE["risk"]
    if df.empty:
        return []

    has_name = "lsoa_name" in df.columns
    top = df.sort_values("risk_index", ascending=(order == "asc")).head(n)
    coefs = STATE["calibration"].get("coefficients", {})

    results = []
    for _, row in top.iterrows():
        results.append({
            "code": row["lsoa11cd"],
            "name": row["lsoa_name"] if has_name and pd.notna(row.get("lsoa_name")) else row["lsoa11cd"],
            "risk_index": float(row["risk_index"]),
            "quintile": int(row.get("quintile", row.get("risk_bucket", 0))),
            "calibrated_premium": estimate_premium(row, coefs),
        })
    return results


@app.get("/api/methodology")
def get_methodology():
    calib = STATE["calibration"]
    return {
        "weights": settings["risk_index"]["weights"],
        "normalisation": settings["risk_index"]["normalisation"],
        "calibration": {
            "r_squared": calib.get("r_squared"),
            "coefficients": calib.get("coefficients"),
            "backfit_weights": calib.get("backfit_weights"),
        },
    }


# Serve the built frontend (production Docker image). Must be mounted last.
frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists() and frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
