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
import asyncio
from typing import List, Optional

import numpy as np
import pandas as pd
import xarray as xr
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
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
    # analog (k-NN) ensemble — pure-IMD, no checkpoint, wins mid/long-range temperature
    try:
        S.forecasters["analog"] = get_forecaster("analog", cube=S.cube)
        print("[backend] analog ensemble ready")
    except Exception as e:
        print(f"[backend] analog not loaded ({type(e).__name__}: {e})")
    # the trained ConvLSTM, if a checkpoint exists
    if (cfg.CKPT_DIR / "convlstm.pt").exists():
        try:
            S.forecasters["convlstm"] = get_forecaster("convlstm", cube=S.cube)
            print("[backend] ConvLSTM checkpoint loaded")
        except Exception as e:
            print(f"[backend] ConvLSTM not loaded ({type(e).__name__}: {e})")
    # stacked ensemble (if fit) — blends all members; best overall + conformal bands
    if (cfg.MODELS_DIR / "ensemble_weights.json").exists():
        try:
            S.forecasters["ensemble"] = get_forecaster("ensemble", cube=S.cube)
            print("[backend] stacked ensemble ready")
        except Exception as e:
            print(f"[backend] ensemble not loaded ({type(e).__name__}: {e})")
    # rain climatology for SPI-lite (compute once via a throwaway twin)
    seed_twin = ClimateTwin(S.cube, S.forecasters["climatology"], S.norm)
    S.rain_clim = seed_twin._rain_clim

    # suggested colorbar ranges (per variable, robust percentiles over whole cube)
    S.ranges = {}
    for v in cfg.VARS:
        arr = S.cube[v].values
        lo, hi = np.nanpercentile(arr, [2, 98])
        S.ranges[v] = [round(float(lo), 2), round(float(hi), 2)]

    # optional INDmet 0.05° (~5 km) high-res OBSERVED layer (genuine finer data, not a model)
    S.indmet = None
    indmet_path = cfg.DATA_DIR / "indmet_cube_005.nc"
    if indmet_path.exists():
        try:
            hr = xr.open_dataset(indmet_path)
            S.indmet = hr
            S.indmet_lats = hr["lat"].values.round(4).tolist()
            S.indmet_lons = hr["lon"].values.round(4).tolist()
            S.indmet_dates = {str(t)[:10] for t in hr["time"].values}
            S.indmet_vars = [v for v in cfg.VARS if v in hr.data_vars]
            S.indmet_ranges = {}
            for v in S.indmet_vars:
                lo, hi = np.nanpercentile(hr[v].values, [2, 98])
                S.indmet_ranges[v] = [round(float(lo), 2), round(float(hi), 2)]
            print(f"[backend] INDmet 0.05° high-res layer loaded "
                  f"({len(S.indmet_lats)}×{len(S.indmet_lons)}, vars={S.indmet_vars})")
        except Exception as e:
            print(f"[backend] INDmet not loaded ({type(e).__name__}: {e})")
            S.indmet = None

    # prefer the best overall forecaster as the default: ensemble > convlstm > climatology
    S.default_model = (
        "ensemble" if "ensemble" in S.forecasters
        else "convlstm" if "convlstm" in S.forecasters
        else "climatology"
    )

    # warm the caches for the latest date / default horizon
    latest = S.dates[-1]
    _state_payload(latest)
    _forecast_payload(latest, cfg.H_HORIZON, S.default_model)
    print(f"[backend] ready: source={S.data_source} dates {S.dates[0]}..{S.dates[-1]} "
          f"grid {len(S.lats)}x{len(S.lons)}")
    yield
    S.cube.close()
    if getattr(S, "indmet", None) is not None:
        S.indmet.close()


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
    payload = {
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
    # analog is explainable: surface the matched past IMD days ("behaves like …")
    if model == "analog":
        payload["analogs"] = list(getattr(tw.model, "last_analogs", []))[:8]
    return payload


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


@lru_cache(maxsize=256)
def _analog_payload(date: str, horizon: int) -> dict:
    """Analog (k-NN) ensemble forecast + the matched train days that justify it.

    The ``analogs`` list is the model's explanation — "next week behaves like these
    past IMD days" — and the per-variable ``std`` grids are a free, flow-dependent
    uncertainty band from the spread of the k observed analog futures.
    """
    if "analog" not in S.forecasters:
        raise HTTPException(400, "analog forecaster unavailable")
    tw = _build_twin("analog")
    tw.initialize(date)
    start = tw.current_date
    mean_list, std_list = tw.model.forecast_ensemble(tw.history, start, horizon)
    analogs = list(tw.model.last_analogs)  # nearest-first matched train days
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
            "impacts": tw.impacts(mean_f, d),
        })
    return {
        "init_date": str(start.date()),
        "model": "analog",
        "horizon": horizon,
        "uncertainty": True,
        "uncertainty_method": "analog-ensemble-spread",
        "k": tw.model.k,
        "analogs": analogs[:8],
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "days": days,
        "sowing_window": tw.sowing_window([np.asarray(m) for m in mean_list]),
    }


@lru_cache(maxsize=256)
def _forecast_conformal_payload(date: str, horizon: int) -> dict:
    """Ensemble forecast + split-conformal 90% bands (calibrated, per-variable/horizon)."""
    tw = _build_twin("ensemble")
    tw.initialize(date)
    preds = tw.step(horizon=horizon)
    start = tw.current_date
    ens = S.forecasters["ensemble"]
    H, W = preds[0].shape[1], preds[0].shape[2]
    days = []
    for i, f in enumerate(preds, start=1):
        d = start + pd.Timedelta(days=i)
        # conformal half-width is per (variable, horizon) → a uniform band across the grid
        std = np.stack([np.full((H, W), ens.conformal_halfwidth(v, i), dtype="float32")
                        for v in cfg.VARS])
        days.append({
            "lead_day": i,
            "date": str(d.date()),
            "fields": _fields(f),
            "std": _fields(std),
            "impacts": tw.impacts(f, d),
        })
    return {
        "init_date": str(start.date()),
        "model": "ensemble",
        "horizon": horizon,
        "uncertainty": True,
        "uncertainty_method": "split-conformal-90",
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "days": days,
        "sowing_window": tw.sowing_window(preds),
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
        "highres_available": getattr(S, "indmet", None) is not None,
        "highres_res": 0.05 if getattr(S, "indmet", None) is not None else None,
        "highres_vars": getattr(S, "indmet_vars", []),
        "highres_shape": [len(S.indmet_lats), len(S.indmet_lons)] if getattr(S, "indmet", None) is not None else None,
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


@lru_cache(maxsize=256)
def _highres_payload(date: str, var: str) -> dict:
    """INDmet 0.05° observed field for one variable on one day (real ~5 km data)."""
    hr = S.indmet
    da = hr[var].sel(time=date)
    return {
        "date": date,
        "var": var,
        "data_source": "indmet",
        "res_deg": 0.05,
        "lat": S.indmet_lats,
        "lon": S.indmet_lons,
        "shape": [len(S.indmet_lats), len(S.indmet_lons)],
        "unit": cfg.UNITS.get(var, ""),
        "field": _grid(da.values),
        "range": S.indmet_ranges.get(var, [0, 1]),
        "note": (
            "INDmet 0.05° (~5 km) daily observations (Zenodo 10.5281/zenodo.15430548, "
            "CC-BY-4.0), blended IMD + CHIRPS + ERA5-Land — a genuine high-res layer "
            "(5× finer than the 0.25° model grid), not a downscaled model output."
        ),
    }


@app.get("/highres")
def highres(
    date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to latest"),
    var: str = Query("rainfall", description="variable for the 0.05° layer"),
):
    """Real 0.05° INDmet observed field (5× finer than the model grid). 404 if unavailable."""
    if getattr(S, "indmet", None) is None:
        raise HTTPException(404, "INDmet high-res layer not available; run `python -m data.ingest_indmet`")
    if var not in S.indmet_vars:
        raise HTTPException(400, f"var {var!r} not in INDmet layer; have {S.indmet_vars}")
    d = _validate_date(date)
    if d not in S.indmet_dates:
        raise HTTPException(404, f"date {d} not in INDmet layer")
    return _highres_payload(d, var)


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
        if resolved == "analog" and "analog" in S.forecasters:
            return _analog_payload(d, horizon)  # ensemble spread = uncertainty band
        if resolved == "ensemble" and "ensemble" in S.forecasters:
            return _forecast_conformal_payload(d, horizon)  # calibrated conformal bands
        # graceful fallback: deterministic forecast + a clear note (never crash)
        payload = dict(_forecast_payload(d, horizon, resolved))
        payload["uncertainty_note"] = (
            f"uncertainty bands require the 'convlstm' model (MC-dropout); "
            f"resolved model is {resolved!r}, so a deterministic forecast was returned."
        )
        return payload
    return _forecast_payload(d, horizon, resolved)


@app.get("/analog")
def analog(
    date: Optional[str] = Query(None, description="init date YYYY-MM-DD; defaults to latest"),
    horizon: int = Query(cfg.H_HORIZON, ge=1, le=14),
):
    """Analog-ensemble forecast with the matched past IMD days (explainable forecast)."""
    return _analog_payload(_validate_date(date), horizon)


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


def _rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a.astype(float) - b.astype(float)) ** 2)))


# sync gauge: tmax divergence of this many degC maps to 0% sync
SYNC_REF_TMAX_C = 6.0


def _twin_step_entry(tw: ClimateTwin, s: dict) -> dict:
    """One REALITY-vs-TWIN step → JSON entry (shared by the REST payload and the WS stream)."""
    from config import TMAX

    twin_f = s["twin"]
    obs_f = s["reality"]
    entry = {
        "lead_day": s["lead_day"],
        "date": str(s["date"].date()),
        "twin": _fields(twin_f),
        "impacts_twin": tw.impacts(twin_f, s["date"]),
    }
    if obs_f is not None:
        div = {cfg.VARS[c]: round(_rmse(twin_f[c], obs_f[c]), 3) for c in range(len(cfg.VARS))}
        sync = max(0.0, 1.0 - div[cfg.VARS[TMAX]] / SYNC_REF_TMAX_C)
        entry["reality"] = _fields(obs_f)
        entry["divergence"] = div
        entry["sync_pct"] = round(100.0 * sync, 1)
        entry["impacts_reality"] = tw.impacts(obs_f, s["date"])
    else:
        entry["reality"] = None
        entry["divergence"] = None
        entry["sync_pct"] = None
    return entry


@lru_cache(maxsize=128)
def _twin_run_payload(date: str, horizon: int, assimilate: bool, model: str) -> dict:
    """REALITY vs TWIN drift over the horizon, running the genuine ClimateTwin loop."""
    tw = _build_twin(model)
    steps = tw.run_twin(date, horizon=horizon, assimilate=assimilate)
    days = [_twin_step_entry(tw, s) for s in steps]
    return {
        "anchor_date": str(pd.Timestamp(date).date()),
        "model": model,
        "horizon": horizon,
        "assimilate": assimilate,
        "data_source": S.data_source,
        "lat": S.lats,
        "lon": S.lons,
        "units": cfg.UNITS,
        "sync_ref_tmax_c": SYNC_REF_TMAX_C,
        "days": days,
    }


@app.get("/twin/run")
def twin_run(
    date: Optional[str] = Query(None, description="anchor date (MIRROR); defaults to latest-horizon"),
    horizon: int = Query(cfg.H_HORIZON, ge=1, le=14),
    assimilate: bool = Query(False, description="nudge the twin toward each day's observation"),
    model: Optional[str] = Query(None, description="forecaster; defaults to best available"),
):
    """Run the digital-twin loop and return REALITY vs TWIN fields + divergence + sync."""
    # default the anchor far enough back that real observations exist for every lead day
    if date is None:
        anchor = pd.Timestamp(S.dates[-1]) - pd.Timedelta(days=horizon)
        date = str(anchor.date())
    d = _validate_date(date)
    return _twin_run_payload(d, horizon, assimilate, model or S.default_model)


@app.websocket("/ws/twin")
async def ws_twin(ws: WebSocket):
    """Simulated real-time twin: replays the cached record as a LIVE feed.

    Honesty (CLAUDE.md §2.7): this is NOT a live IMD/MOSDAC download — it streams the
    genuine ClimateTwin loop over the cached cube, one day at a time with a pacing delay,
    so the dashboard's clock, assimilation ticks and TwinCore flares animate as if live
    while the demo stays 100% offline. Query params: date, horizon, assimilate, model,
    interval_ms (pacing, 120..3000).
    """
    await ws.accept()
    try:
        q = ws.query_params
        horizon = max(1, min(14, int(q.get("horizon", cfg.H_HORIZON))))
        assimilate = q.get("assimilate", "true").lower() in ("1", "true", "yes")
        model = q.get("model") or S.default_model
        interval = max(0.12, min(3.0, float(q.get("interval_ms", 700)) / 1000.0))
        date = q.get("date")
        if date:
            date = _validate_date(date)
        else:
            anchor = pd.Timestamp(S.dates[-1]) - pd.Timedelta(days=horizon)
            date = str(anchor.date())
        if model not in S.forecasters:
            await ws.send_json({"type": "error", "message": f"unknown model {model!r}"})
            await ws.close()
            return

        tw = _build_twin(model)
        steps = tw.run_twin(date, horizon=horizon, assimilate=assimilate)
        await ws.send_json({
            "type": "init",
            "anchor_date": str(pd.Timestamp(date).date()),
            "region": cfg.PILOT["name"],
            "model": model,
            "assimilate": assimilate,
            "horizon": horizon,
            "total_steps": len(steps),
            "lat": S.lats, "lon": S.lons, "units": cfg.UNITS,
        })
        # stream each twin day as a live "tick", pacing with a small delay
        for s in steps:
            entry = _twin_step_entry(tw, s)
            entry["type"] = "tick"
            # flag which twin-loop stage this tick represents (drives the TwinCore flare)
            entry["stage"] = "ASSIMILATE" if (assimilate and entry["reality"] is not None) else "SIMULATE"
            await ws.send_json(entry)
            await asyncio.sleep(interval)
        await ws.send_json({"type": "done", "steps": len(steps)})
        await ws.close()
    except WebSocketDisconnect:
        return  # client navigated away mid-stream; nothing to clean up
    except Exception as e:  # never leave the socket hanging on an unexpected error
        try:
            await ws.send_json({"type": "error", "message": f"{type(e).__name__}: {e}"})
            await ws.close()
        except Exception:
            pass


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


# --------------------------------------------------------------------------- #
# AI assistant — tools over the existing builders + grounded/LLM engine.
# --------------------------------------------------------------------------- #
def _twin_demo_model() -> str:
    """A state-dependent model so the twin's assimilation story is visible."""
    if "convlstm" in S.forecasters:
        return "convlstm"
    if "persistence" in S.forecasters:
        return "persistence"
    return S.default_model


def _ai_tools() -> dict:
    def t_state(date):
        p = _state_payload(_validate_date(date))
        i = p["impacts"]
        return {"date": p["date"], "max_tmax": i["max_tmax_c"], "mean_rain": i["mean_rainfall_mm"],
                "heat_pct": round(i["heat_stress_fraction"] * 100), "dryness": i["dryness_index"]}

    def t_forecast(date, horizon):
        p = _forecast_payload(_validate_date(date), horizon, S.default_model)
        return {"init": p["init_date"], "model": p["model"], "horizon": p["horizon"],
                "mean_rain": [d["impacts"]["mean_rainfall_mm"] for d in p["days"]],
                "max_tmax": [d["impacts"]["max_tmax_c"] for d in p["days"]],
                "sowing": p["sowing_window"]}

    def t_whatif(date, dt, rf):
        d = _validate_date(date)
        tw = _build_twin(S.default_model)
        tw.initialize(d)
        res = tw.whatif(delta_temp=dt, rain_factor=rf, horizon=cfg.H_HORIZON)
        last = tw.current_date + pd.Timedelta(days=cfg.H_HORIZON)
        ib, isc = tw.impacts(res["baseline"][-1], last), tw.impacts(res["scenario"][-1], last)
        return {"date": d, "delta_temp": dt, "rain_factor": rf,
                "base_tmax": ib["max_tmax_c"], "scen_tmax": isc["max_tmax_c"],
                "base_heat": round(ib["heat_stress_fraction"] * 100),
                "scen_heat": round(isc["heat_stress_fraction"] * 100),
                "base_sowing": tw.sowing_window(res["baseline"])["onset_lead_day"],
                "scen_sowing": tw.sowing_window(res["scenario"])["onset_lead_day"]}

    def t_validate():
        if not cfg.METRICS_PATH.exists():
            return {"error": "validation_metrics.json not found"}
        v = json.loads(cfg.METRICS_PATH.read_text())
        h = list(v["summary_rmse"])[0]
        best = {var: v["summary_rmse"][h][var]["best"] for var in cfg.VARS}
        cat = v["horizons"][h][best["rainfall"]]["rainfall"].get("categorical", {})
        return {"horizon": h, "best": best, "pod": cat.get("POD"), "csi": cat.get("CSI")}

    def t_twin(date, horizon):
        m = _twin_demo_model()
        # anchor far enough back that real observations exist across the lead window
        anchor = pd.Timestamp(_validate_date(date))
        max_anchor = pd.Timestamp(S.dates[-1]) - pd.Timedelta(days=horizon)
        d = str(min(anchor, max_anchor).date())
        free = _twin_run_payload(d, horizon, False, m)
        assim = _twin_run_payload(d, horizon, True, m)
        return {"anchor": free["anchor_date"], "model": m,
                "free_sync": [x["sync_pct"] for x in free["days"]],
                "assim_sync": [x["sync_pct"] for x in assim["days"]],
                "free_drift": [x["divergence"]["tmax"] if x["divergence"] else None for x in free["days"]]}

    return {"state": t_state, "forecast": t_forecast, "whatif": t_whatif,
            "validate": t_validate, "twin": t_twin}


def _ai_ctx() -> dict:
    """The shared tool/context bundle handed to both the /ai engine and the /brain."""
    return {
        "tools": _ai_tools(),
        "latest_date": S.dates[-1],
        "dates": (S.dates[0], S.dates[-1]),
        "region": cfg.PILOT["name"],
        "max_horizon": 14,
        "thresholds": {
            "heat_stress_tmax_c": cfg.HEAT_STRESS_TMAX_C,
            "sowing_onset_mm": cfg.SOWING_ONSET_MM,
            "wet_day_mm": cfg.RAIN_WET_DAY_MM,
        },
        "models": list(S.forecasters),
    }


@app.get("/ai")
def ai(q: str = Query(..., min_length=1, description="natural-language question about the twin")):
    from backend import ai_engine
    return ai_engine.answer(q, _ai_ctx())


@app.get("/brain")
def brain(
    q: str = Query(..., min_length=1, description="natural-language decision question"),
    date: Optional[str] = Query(None, description="optional anchor date YYYY-MM-DD"),
):
    """The agentic brain: plan → execute real twin tools → critique → grounded answer.

    Returns the full structured trace (plan steps + citable facts + cited answer + caveat),
    so the dashboard can replay the multi-step reasoning. Fully offline; Ollama (if set via
    OLLAMA_MODEL) only rephrases the grounded text.
    """
    from backend import brain as brain_mod

    question = q if not date else f"{q} on {_validate_date(date)}"
    return brain_mod.run(question, _ai_ctx())


@app.get("/brain/anomaly")
def brain_anomaly():
    """Autonomous scan: flag a recent heat/dryness anomaly vs TRAIN-years climatology."""
    from backend import brain as brain_mod

    return brain_mod.anomaly_scan(S.cube)


@app.get("/")
def root():
    return {"service": "ClimaTwin India API", "docs": "/docs",
            "endpoints": ["/health", "/meta", "/state", "/forecast", "/whatif",
                          "/validate", "/downscale"]}
