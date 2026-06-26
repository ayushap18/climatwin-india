"""backend/app.py — FastAPI service for ClimaTwin India.

Endpoints (CLAUDE.md §9, architecture.md §5):
  GET  /health                          liveness + data provenance
  GET  /meta                            bbox, grid, dates, vars, models, colorbar ranges
  GET  /state?date=                     observed twin state grid at a date (+ impacts)
  GET  /forecast?date=&horizon=&model=  roll-forward prediction fields (+ impacts, sowing)
  POST /whatif                          perturb + re-simulate -> scenario, diff, impacts
  GET  /validate                        cached baseline validation metrics

The demo runs fully offline from cached data/twin_cube.nc (CLAUDE.md §2.7). Common
cases (latest state, default 7-day forecast) are precomputed at startup and cached so
the dashboard never lags while scrubbing the time slider.
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import List, Optional

import numpy as np
import pandas as pd
import xarray as xr
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config as cfg
from config import RAIN
from models.baselines import get_forecaster
from twin.climate_twin import ClimateTwin

ROUND = 2  # decimals for transmitted grids


# --------------------------------------------------------------------------- #
# Shared, immutable app state (loaded once).
# --------------------------------------------------------------------------- #
class State:
    cube: xr.Dataset
    norm: dict
    rain_clim: dict
    forecasters: dict
    dates: List[str]
    lats: list
    lons: list
    ranges: dict
    data_source: str
    default_model: str


S = State()


def _build_twin(model: str) -> ClimateTwin:
    """Fresh twin per request (cheap) reusing the cached forecaster + rain climatology."""
    if model not in S.forecasters:
        raise HTTPException(400, f"unknown model {model!r}; choose from {list(S.forecasters)}")
    return ClimateTwin(S.cube, S.forecasters[model], S.norm, rain_clim=S.rain_clim)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not cfg.CUBE_PATH.exists():
        raise RuntimeError(
            f"{cfg.CUBE_PATH} not found. Run `make data` (python -m data.build_cube) first."
        )
    S.cube = xr.open_dataset(cfg.CUBE_PATH)
    S.norm = json.loads(cfg.NORM_STATS_PATH.read_text()) if cfg.NORM_STATS_PATH.exists() else {}
    S.data_source = S.cube.attrs.get("data_source", "unknown")
    S.lats = S.cube["lat"].values.round(4).tolist()
    S.lons = S.cube["lon"].values.round(4).tolist()
    S.dates = [str(t)[:10] for t in S.cube["time"].values]

    # forecasters (climatology fit once); reuse across requests
    S.forecasters = {
        "persistence": get_forecaster("persistence"),
        "climatology": get_forecaster("climatology", cube=S.cube),
    }
    # the trained ConvLSTM, if a checkpoint exists
    if (cfg.CKPT_DIR / "convlstm.pt").exists():
        try:
            S.forecasters["convlstm"] = get_forecaster("convlstm", cube=S.cube)
            print("[backend] ConvLSTM checkpoint loaded")
        except Exception as e:
            print(f"[backend] ConvLSTM not loaded ({type(e).__name__}: {e})")
    # rain climatology for SPI-lite (compute once via a throwaway twin)
    seed_twin = ClimateTwin(S.cube, S.forecasters["climatology"], S.norm)
    S.rain_clim = seed_twin._rain_clim

    # suggested colorbar ranges (per variable, robust percentiles over whole cube)
    S.ranges = {}
    for v in cfg.VARS:
        arr = S.cube[v].values
        lo, hi = np.nanpercentile(arr, [2, 98])
        S.ranges[v] = [round(float(lo), 2), round(float(hi), 2)]

    # prefer the trained model as the default behind /forecast when present
    S.default_model = "convlstm" if "convlstm" in S.forecasters else "climatology"

    # warm the caches for the latest date / default horizon
    latest = S.dates[-1]
    _state_payload(latest)
    _forecast_payload(latest, cfg.H_HORIZON, S.default_model)
    print(f"[backend] ready: source={S.data_source} dates {S.dates[0]}..{S.dates[-1]} "
          f"grid {len(S.lats)}x{len(S.lons)}")
    yield
    S.cube.close()


app = FastAPI(title="ClimaTwin India API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # PoC: open CORS for the Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Serialization helpers.
# --------------------------------------------------------------------------- #
def _grid(arr: np.ndarray) -> list:
    return np.round(np.nan_to_num(arr, nan=0.0).astype(float), ROUND).tolist()


def _fields(field: np.ndarray) -> dict:
    return {cfg.VARS[c]: _grid(field[c]) for c in range(len(cfg.VARS))}


def _validate_date(date: Optional[str]) -> str:
    if date is None:
        return S.dates[-1]
    d = str(pd.Timestamp(date).date())
    if d < S.dates[0] or d > S.dates[-1]:
        raise HTTPException(404, f"date {d} outside available range {S.dates[0]}..{S.dates[-1]}")
    return d


# --------------------------------------------------------------------------- #
# Cached payload builders (the slow-ish work lives here).
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=512)
def _state_payload(date: str) -> dict:
    tw = _build_twin("climatology")
    tw.initialize(date)
    field = tw.state
    impacts = tw.impacts(field, tw.current_date)
    return {
        "date": str(tw.current_date.date()),
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "fields": _fields(field),
        "impacts": impacts,
    }


@lru_cache(maxsize=512)
def _forecast_payload(date: str, horizon: int, model: str) -> dict:
    tw = _build_twin(model)
    tw.initialize(date)
    preds = tw.step(horizon=horizon)
    start = tw.current_date
    days = []
    for i, f in enumerate(preds, start=1):
        d = (start + pd.Timedelta(days=i))
        days.append({
            "lead_day": i,
            "date": str(d.date()),
            "fields": _fields(f),
            "impacts": tw.impacts(f, d),
        })
    return {
        "init_date": str(start.date()),
        "model": model,
        "horizon": horizon,
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "days": days,
        "sowing_window": tw.sowing_window(preds),
    }


@lru_cache(maxsize=256)
def _forecast_uncertainty_payload(date: str, horizon: int, samples: int) -> dict:
    """ConvLSTM MC-dropout forecast: per-day mean fields + per-variable std grids.

    History/window/init-date are built exactly like _forecast_payload (via the twin)
    so the conditioning window matches the deterministic path.
    """
    tw = _build_twin("convlstm")
    tw.initialize(date)
    start = tw.current_date
    mean_list, std_list = tw.model.forecast_ensemble(
        tw.history, start, horizon, n_samples=samples)
    days = []
    for i, (mean_f, std_f) in enumerate(zip(mean_list, std_list), start=1):
        mean_f = np.asarray(mean_f)
        mean_f[RAIN] = np.clip(mean_f[RAIN], 0.0, None)
        d = start + pd.Timedelta(days=i)
        days.append({
            "lead_day": i,
            "date": str(d.date()),
            "fields": _fields(mean_f),
            "std": _fields(np.asarray(std_f)),
            "impacts": tw.impacts(mean_f, d),  # impacts on the mean
        })
    return {
        "init_date": str(start.date()),
        "model": "convlstm",
        "horizon": horizon,
        "uncertainty": True,
        "n_samples": samples,
        "uncertainty_method": "MC-dropout",
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "days": days,
        "sowing_window": tw.sowing_window([np.asarray(m) for m in mean_list]),
    }


_DOWNSCALER = {}  # lazy singleton cache (keyed by checkpoint path)


def _get_downscaler():
    """Lazily load the SR-CNN Downscaler. Raises HTTPException(503) if no checkpoint."""
    ckpt = cfg.CKPT_DIR / "downscale.pt"
    if not ckpt.exists():
        raise HTTPException(
            503,
            f"downscaler unavailable: no checkpoint at {ckpt}. "
            f"Train it with `python -m models.downscale` (P1 feature).",
        )
    key = str(ckpt)
    if key not in _DOWNSCALER:
        from models.downscale import Downscaler
        _DOWNSCALER[key] = Downscaler(checkpoint_path=ckpt, cube=S.cube)
    return _DOWNSCALER[key]


def _polygon_to_mask(polygon: List[List[float]]) -> np.ndarray:
    """polygon: list of [lat, lon] vertices -> boolean (H, W) mask on the pilot grid."""
    from matplotlib.path import Path

    lats = np.array(S.lats)
    lons = np.array(S.lons)
    latg, long = np.meshgrid(lats, lons, indexing="ij")
    pts = np.column_stack([latg.ravel(), long.ravel()])
    poly = Path([(p[0], p[1]) for p in polygon])
    return poly.contains_points(pts).reshape(latg.shape)


# --------------------------------------------------------------------------- #
# Routes.
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {"status": "ok", "data_source": S.data_source,
            "dates": [S.dates[0], S.dates[-1]], "region": cfg.PILOT["name"]}


@app.get("/meta")
def meta():
    return {
        "region": cfg.PILOT["name"],
        "bbox": {"lon_min": cfg.PILOT["lon_min"], "lat_min": cfg.PILOT["lat_min"],
                 "lon_max": cfg.PILOT["lon_max"], "lat_max": cfg.PILOT["lat_max"]},
        "res_deg": cfg.PILOT["res_deg"],
        "grid": {"lat": S.lats, "lon": S.lons, "shape": [len(S.lats), len(S.lons)]},
        "variables": cfg.VARS,
        "units": cfg.UNITS,
        "colorbar_ranges": S.ranges,
        "dates": {"start": S.dates[0], "end": S.dates[-1], "count": len(S.dates)},
        "latest_date": S.dates[-1],
        "split": cfg.SPLIT,
        "models": list(S.forecasters.keys()),
        "default_model": S.default_model,
        "data_source": S.data_source,
        "data_source_note": S.cube.attrs.get("data_source_note", ""),
        "lst_source": S.cube.attrs.get("lst_source"),
        "has_lst": bool(getattr(S.forecasters.get("convlstm"), "has_lst", False)),
        "downscale_available": (cfg.CKPT_DIR / "downscale.pt").exists(),
        "max_horizon": 14,
        "thresholds": {
            "wet_day_mm": cfg.RAIN_WET_DAY_MM,
            "heat_stress_tmax_c": cfg.HEAT_STRESS_TMAX_C,
            "sowing_onset_mm": cfg.SOWING_ONSET_MM,
        },
    }


@app.get("/state")
def state(date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to latest")):
    return _state_payload(_validate_date(date))


@app.get("/forecast")
def forecast(
    date: Optional[str] = Query(None, description="init date YYYY-MM-DD; defaults to latest"),
    horizon: int = Query(cfg.H_HORIZON, ge=1, le=14),
    model: Optional[str] = Query(None, description="forecaster; defaults to best available"),
    uncertainty: bool = Query(False, description="ConvLSTM MC-dropout uncertainty bands"),
    samples: int = Query(30, ge=5, le=60, description="MC-dropout ensemble size"),
):
    d = _validate_date(date)
    resolved = model or S.default_model
    if uncertainty:
        if resolved == "convlstm" and "convlstm" in S.forecasters:
            return _forecast_uncertainty_payload(d, horizon, samples)
        # graceful fallback: deterministic forecast + a clear note (never crash)
        payload = dict(_forecast_payload(d, horizon, resolved))
        payload["uncertainty_note"] = (
            f"uncertainty bands require the 'convlstm' model (MC-dropout); "
            f"resolved model is {resolved!r}, so a deterministic forecast was returned."
        )
        return payload
    return _forecast_payload(d, horizon, resolved)


class WhatIfRequest(BaseModel):
    date: Optional[str] = Field(None, description="init date; defaults to latest")
    horizon: int = Field(cfg.H_HORIZON, ge=1, le=14)
    delta_temp: float = Field(0.0, ge=-5, le=8, description="uniform temperature shift (degC)")
    rain_factor: float = Field(1.0, ge=0.0, le=3.0, description="rainfall multiplier")
    urban_polygon: Optional[List[List[float]]] = Field(
        None, description="[[lat,lon],...] urban area for an LST/heat bump")
    urban_lst: float = Field(2.0, ge=0, le=6, description="urban heat bump (degC)")
    model: Optional[str] = Field(None, description="forecaster; defaults to best available")


@app.post("/whatif")
def whatif(req: WhatIfRequest):
    date = _validate_date(req.date)
    model = req.model or S.default_model
    tw = _build_twin(model)
    tw.initialize(date)
    mask = _polygon_to_mask(req.urban_polygon) if req.urban_polygon else None
    res = tw.whatif(
        delta_temp=req.delta_temp,
        rain_factor=req.rain_factor,
        urban_mask=mask,
        urban_lst=req.urban_lst,
        horizon=req.horizon,
    )
    start = tw.current_date
    days = []
    for i, (bl, sc, df) in enumerate(zip(res["baseline"], res["scenario"], res["diff"]), start=1):
        d = start + pd.Timedelta(days=i)
        days.append({
            "lead_day": i,
            "date": str(d.date()),
            "baseline": _fields(bl),
            "scenario": _fields(sc),
            "diff": _fields(df),
            "impacts_baseline": tw.impacts(bl, d),
            "impacts_scenario": tw.impacts(sc, d),
        })
    return {
        "init_date": str(start.date()),
        "model": model,
        "horizon": req.horizon,
        "scenario_params": {
            "delta_temp": req.delta_temp, "rain_factor": req.rain_factor,
            "urban_lst": req.urban_lst, "urban_cells": int(mask.sum()) if mask is not None else 0,
        },
        "data_source": S.data_source,
        "lat": S.lats, "lon": S.lons, "units": cfg.UNITS,
        "days": days,
        "sowing_baseline": tw.sowing_window(res["baseline"]),
        "sowing_scenario": tw.sowing_window(res["scenario"]),
    }


@app.get("/validate")
def validate():
    if not cfg.METRICS_PATH.exists():
        raise HTTPException(404, "validation_metrics.json not found. Run `make validate`.")
    return json.loads(cfg.METRICS_PATH.read_text())


@app.get("/downscale")
def downscale(
    date: Optional[str] = Query(None, description="date YYYY-MM-DD; defaults to latest"),
    var: str = Query("rainfall", description="variable to downscale (rainfall is the honest target)"),
):
    """SR-CNN downscaling demo: coarse (~1deg) -> 0.25deg vs bilinear baseline.

    Coarsens the true 0.25deg field at `date` to ~1deg, then compares bilinear
    upsampling against the SR-CNN reconstruction. 503 if no checkpoint (P1 feature).
    """
    if var not in cfg.VARS:
        raise HTTPException(400, f"unknown var {var!r}; choose from {cfg.VARS}")
    d = _validate_date(date)
    ds = _get_downscaler()  # raises 503 if no checkpoint
    from models.downscale import block_mean_coarsen, bilinear_to

    fine = S.cube[var].sel(time=pd.Timestamp(d), method="nearest").values.astype("float32")
    coarse = block_mean_coarsen(fine, ds.factor)
    bilinear = bilinear_to(coarse, fine.shape)
    srcnn = ds.downscale(coarse)
    bil_rmse, sr_rmse = ds.bilinear_rmse, ds.srcnn_rmse
    imp = (100.0 * (bil_rmse - sr_rmse) / bil_rmse
           if bil_rmse not in (None, 0) else None)
    return {
        "var": var,
        "date": d,
        "downscale_var": ds.var,
        "factor": ds.factor,
        "lat": S.lats,
        "lon": S.lons,
        "coarse": _grid(coarse),
        "bilinear": _grid(bilinear),
        "srcnn": _grid(srcnn),
        "bilinear_rmse": bil_rmse,
        "srcnn_rmse": sr_rmse,
        "improvement_pct": round(imp, 2) if imp is not None else None,
        "data_source": ds.data_source,
    }


@app.get("/")
def root():
    return {"service": "ClimaTwin India API", "docs": "/docs",
            "endpoints": ["/health", "/meta", "/state", "/forecast", "/whatif",
                          "/validate", "/downscale"]}
