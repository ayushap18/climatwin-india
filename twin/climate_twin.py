"""twin/climate_twin.py — the Digital Twin core.

This is the part that makes ClimaTwin a *twin*, not a predictor (CLAUDE.md §2.1, §8).
The five methods reviewers will probe:

  initialize  -> MIRROR    : set state from observed cube at a date
  assimilate  -> ASSIMILATE: nudge state toward a fresh observation
  step        -> SIMULATE  : roll the state forward h days (autoregressive)
  whatif      -> PERTURB   : apply a scenario, re-simulate, diff vs baseline
  impacts     -> DECIDE    : turn raw fields into decision signals

State is (C, H, W) in RAW units, channel order config.VARS = [rainfall, tmax, tmin].
The forecaster is any models.baselines.Forecaster (persistence/climatology now,
ConvLSTM later) — swapping it changes nothing here.
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from config import RAIN, TMAX, TMIN


class ClimateTwin:
    def __init__(self, cube: xr.Dataset, model, norm: Optional[dict] = None, rain_clim=None):
        self.cube = cube
        self.model = model
        self.norm = norm or {}
        self.state: Optional[np.ndarray] = None       # (C, H, W) current state
        self.history: List[np.ndarray] = []           # recent k states (model input)
        self.current_date: Optional[pd.Timestamp] = None
        self.lats = cube["lat"].values
        self.lons = cube["lon"].values
        self.elevation = (
            cube["elevation"].isel(time=0).values.astype("float32")
            if "elevation" in cube
            else None
        )
        # Training-year rainfall climatology for SPI-lite (train-only, no leakage).
        # Reuse a precomputed one if supplied (lets the API build twins per-request cheaply).
        self._rain_clim = rain_clim if rain_clim is not None else self._fit_rain_climatology()

    # ---------------------------------------------------------------- helpers
    def _obs_at(self, date) -> np.ndarray:
        sel = self.cube.sel(time=pd.Timestamp(date), method="nearest")
        return np.stack([sel[v].values for v in cfg.VARS]).astype("float32")

    def _obs_window(self, date, k: int = cfg.K_INPUT) -> List[np.ndarray]:
        end = pd.Timestamp(date)
        start = end - pd.Timedelta(days=k - 1)
        win = self.cube.sel(time=slice(start, end))
        arr = np.stack([win[v].values for v in cfg.VARS], axis=1)  # (k, C, H, W)
        return [a.astype("float32") for a in arr]

    def _fit_rain_climatology(self):
        ty0, ty1 = cfg.SPLIT["train"]
        train = self.cube["rainfall"].sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
        # per-day-of-year mean/std over training years, then grid-mean for a scalar index.
        g = train.groupby("time.dayofyear")
        mean = g.mean("time")  # (doy, lat, lon)
        std = g.std("time")
        return {
            "mean": mean.mean(("lat", "lon")).to_series(),  # indexed by dayofyear
            "std": std.mean(("lat", "lon")).to_series(),
        }

    # ----------------------------------------------------------- (1) MIRROR
    def initialize(self, date):
        """MIRROR: set the live state from the observed cube at `date`."""
        self.current_date = pd.Timestamp(self.cube.sel(time=pd.Timestamp(date), method="nearest")["time"].values)
        self.state = self._obs_at(self.current_date)
        self.history = self._obs_window(self.current_date)
        return self.state

    # -------------------------------------------------------- (2) ASSIMILATE
    def assimilate(self, obs: np.ndarray, alpha: float = cfg.ASSIMILATION_ALPHA):
        """ASSIMILATE: simplified nudging  state = alpha*obs + (1-alpha)*state."""
        if self.state is None:
            raise RuntimeError("call initialize() before assimilate()")
        self.state = (alpha * obs + (1 - alpha) * self.state).astype("float32")
        # keep history consistent with the nudged state
        self.history = self.history[1:] + [self.state]
        return self.state

    # ---------------------------------------------------------- (3) SIMULATE
    def step(self, horizon: int = 1, history: Optional[List[np.ndarray]] = None) -> List[np.ndarray]:
        """SIMULATE: roll forward `horizon` days autoregressively."""
        if self.state is None:
            raise RuntimeError("call initialize() before step()")
        hist = list(history if history is not None else self.history)
        preds = self.model.forecast(np.asarray(hist), self.current_date, horizon)
        # rainfall cannot be negative regardless of forecaster
        for p in preds:
            p[RAIN] = np.clip(p[RAIN], 0.0, None)
        return preds

    # ----------------------------------------------------------- (4) PERTURB
    def whatif(
        self,
        delta_temp: float = 0.0,
        rain_factor: float = 1.0,
        urban_mask: Optional[np.ndarray] = None,
        urban_lst: float = 2.0,
        horizon: int = cfg.H_HORIZON,
    ):
        """PERTURB: simulate baseline, then apply the scenario to the simulated trajectory.

        We perturb the *forcings of the forward run* (uniform dTemp, rainfall x factor,
        urban-polygon heat bump) rather than only the t=0 state. This is deliberate: it
        keeps the counterfactual well-defined and interpretable for ANY forecaster,
        including climatology (which ignores the initial state) and the future ConvLSTM.
        Returns daily baseline & scenario fields, their difference, and per-day impacts.
        """
        if self.state is None:
            raise RuntimeError("call initialize() before whatif()")

        baseline = self.step(horizon=horizon)
        scenario = []
        for f in baseline:
            s = f.copy()
            s[TMAX] = s[TMAX] + delta_temp
            s[TMIN] = s[TMIN] + delta_temp
            s[RAIN] = np.clip(s[RAIN] * rain_factor, 0.0, None)
            if urban_mask is not None:
                # No LST channel in the PoC cube -> urban heat bump lands on Tmax/Tmin.
                s[TMAX][urban_mask] += urban_lst
                s[TMIN][urban_mask] += urban_lst
            scenario.append(s)
        diff = [sc - bl for sc, bl in zip(scenario, baseline)]
        return {"baseline": baseline, "scenario": scenario, "diff": diff}

    # ----------------------------------------------------------- (5) DECIDE
    def impacts(self, field: np.ndarray, date: Optional[pd.Timestamp] = None) -> dict:
        """DECIDE: turn one (C, H, W) field into explainable decision signals."""
        rain = field[RAIN]
        tmax = field[TMAX]
        heat_map = tmax > cfg.HEAT_STRESS_TMAX_C
        return {
            "dryness_index": self._spi_lite(rain, date),
            "heat_stress_fraction": round(float(np.mean(heat_map)), 3),
            "heat_stress_map": heat_map.astype(int).tolist(),
            "mean_rainfall_mm": round(float(np.mean(rain)), 2),
            "max_tmax_c": round(float(np.max(tmax)), 2),
            "wet_cell_fraction": round(float(np.mean(rain >= cfg.RAIN_WET_DAY_MM)), 3),
        }

    def sowing_window(self, forecast_fields: List[np.ndarray]) -> dict:
        """Onset = first lead day where accumulated grid-mean rainfall crosses threshold."""
        acc = 0.0
        onset_day = None
        for i, f in enumerate(forecast_fields, start=1):
            acc += float(np.mean(f[RAIN]))
            if onset_day is None and acc >= cfg.SOWING_ONSET_MM:
                onset_day = i
        return {
            "sowing_ok": onset_day is not None,
            "onset_lead_day": onset_day,
            "accumulated_rain_mm": round(acc, 2),
            "threshold_mm": cfg.SOWING_ONSET_MM,
        }

    def _spi_lite(self, rain_field: np.ndarray, date) -> float:
        """Standardized rainfall anomaly vs training climatology. <0 drier than normal."""
        d = int(pd.Timestamp(date or self.current_date).dayofyear)
        mean = float(self._rain_clim["mean"].get(d, self._rain_clim["mean"].mean()))
        std = float(self._rain_clim["std"].get(d, self._rain_clim["std"].mean())) or 1.0
        return round((float(np.mean(rain_field)) - mean) / std, 3)

    # --------------------------------------------------------------- factory
    @classmethod
    def from_cube(cls, cube_path=None, model_name: str = "climatology", norm_path=None):
        """Convenience loader used by the backend."""
        import json

        from models.baselines import get_forecaster

        cube = xr.open_dataset(cube_path or cfg.CUBE_PATH)
        norm = {}
        np_path = norm_path or cfg.NORM_STATS_PATH
        if np_path.exists():
            norm = json.loads(np_path.read_text())
        model = get_forecaster(model_name, cube=cube)
        return cls(cube, model, norm)
