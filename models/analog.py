"""models/analog.py — analog (k-NN) ensemble forecaster.

A second, physically-grounded forecaster built ONLY on India's own IMD record: to
predict the next 1–7 days, find the k most similar past days in the TRAIN years and
average what actually happened after them. No GPU, no training — pure retrieval over
the national archive. It is the twin's "behaves like 14 Jul 2009" model.

Why it fits the twin (CLAUDE.md §1, §8):
  * Forecaster interface (predict_step / forecast) → drops into validate.py + the twin
    with no harness change, scored against persistence + climatology like everything else.
  * What-if is native: the twin perturbs the state BEFORE calling forecast(), so a +ΔT or
    rainfall×f query simply retrieves DIFFERENT analogs — the counterfactual is the
    observed future of warmer/drier past days, not invented numbers.
  * It returns a real ENSEMBLE (the k analog trajectories), so its spread is a free,
    flow-dependent uncertainty estimate.

Leakage discipline (CLAUDE.md §2.4/§2.5):
  * The analog library is the TRAIN years only.
  * Standardization uses the train-only norm_stats.json.
  * A query is never matched to a library day in the SAME year within ±15 days
    (a no-op for held-out test queries, correct in general).
"""
from __future__ import annotations

import json
from typing import List, Optional

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from models.baselines import Forecaster
from models.convlstm import norm_var


class AnalogForecaster(Forecaster):
    """k-NN analog ensemble over the train-year IMD archive."""

    name = "analog"

    def __init__(
        self,
        cube: Optional[xr.Dataset] = None,
        k: int = 25,
        doy_window: int = 31,
        max_horizon: int = cfg.H_HORIZON,
    ):
        self.k = int(k)
        self.doy_window = int(doy_window)  # seasonal gate: |Δday-of-year| ≤ this
        self.max_horizon = int(max_horizon)
        # populated by fit()
        self._raw: Optional[np.ndarray] = None     # (T, C, H, W) raw train fields
        self._keys: Optional[np.ndarray] = None     # (N, D) standardized, flattened keys
        self._cand: Optional[np.ndarray] = None     # (N,) library indices into _raw (have +H futures)
        self._doy: Optional[np.ndarray] = None      # (N,) day-of-year of each candidate
        self._year: Optional[np.ndarray] = None     # (N,) year of each candidate
        self._dates: Optional[np.ndarray] = None    # (N,) np.datetime64 of each candidate
        self._stats = None
        self.last_analogs: List[dict] = []          # explainability: most recent matches
        if cube is not None:
            self.fit(cube)

    # ------------------------------------------------------------------ #
    def _encode(self, field: np.ndarray) -> np.ndarray:
        """Raw (C,H,W) → standardized, flattened key vector (train-only stats)."""
        chans = []
        for ci, v in enumerate(cfg.VARS):
            chans.append(norm_var(field[ci], self._stats[v]))
        z = np.stack(chans, axis=0).astype("float32")
        return np.nan_to_num(z, nan=0.0).reshape(-1)

    def fit(self, cube: xr.Dataset) -> "AnalogForecaster":
        self._stats = json.loads(cfg.NORM_STATS_PATH.read_text())
        ty0, ty1 = cfg.SPLIT["train"]
        train = cube.sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
        times = pd.to_datetime(train["time"].values)
        raw = np.stack([train[v].values for v in cfg.VARS], axis=1).astype("float32")  # (T,C,H,W)
        raw = np.nan_to_num(raw, nan=0.0)
        T = raw.shape[0]
        # candidate days must have max_horizon observed futures available in the train block
        cand = np.arange(0, T - self.max_horizon, dtype=int)
        keys = np.stack([self._encode(raw[i]) for i in cand]).astype("float32")
        self._raw = raw
        self._cand = cand
        self._keys = keys
        self._doy = np.array([t.dayofyear for t in times[cand]], dtype=int)
        self._year = np.array([t.year for t in times[cand]], dtype=int)
        self._dates = times[cand].values.astype("datetime64[D]")
        return self

    # ------------------------------------------------------------------ #
    def _retrieve(self, query_field: np.ndarray, when: pd.Timestamp) -> np.ndarray:
        """Return the candidate-array positions of the k nearest analog days."""
        if self._keys is None:
            raise RuntimeError("AnalogForecaster.fit(cube) must be called first")
        q = self._encode(np.asarray(query_field, dtype="float32"))
        when = pd.Timestamp(when)
        qdoy, qyear = when.dayofyear, when.year
        # circular day-of-year distance, seasonal gate
        dd = np.abs(self._doy - qdoy)
        dd = np.minimum(dd, 366 - dd)
        gate = dd <= self.doy_window
        # leakage guard: never match the same year within ±15 days
        gate &= ~((self._year == qyear) & (dd <= 15))
        if gate.sum() < self.k:  # widen the seasonal gate if too few analogs
            gate = dd <= max(self.doy_window * 2, 62)
            gate &= ~((self._year == qyear) & (dd <= 15))
        pos = np.where(gate)[0]
        d2 = np.sum((self._keys[pos] - q) ** 2, axis=1)
        nearest = pos[np.argsort(d2)[: self.k]]
        # record explainability (analog dates + similarity)
        order = nearest[np.argsort(np.sum((self._keys[nearest] - q) ** 2, axis=1))]
        self.last_analogs = [
            {"date": str(self._dates[p]), "distance": float(np.sqrt(np.sum((self._keys[p] - q) ** 2)))}
            for p in order
        ]
        return nearest

    def forecast(self, history: np.ndarray, start_date: pd.Timestamp, horizon: int) -> List[np.ndarray]:
        """Direct analog trajectories (no autoregressive drift): for each horizon h,
        average the observed day-h futures of the k analog days."""
        horizon = int(horizon)
        analogs = self._retrieve(history[-1], start_date)
        idx = self._cand[analogs]  # indices into _raw
        preds: List[np.ndarray] = []
        for h in range(1, horizon + 1):
            fut = self._raw[np.minimum(idx + h, self._raw.shape[0] - 1)]  # (k,C,H,W)
            preds.append(fut.mean(axis=0).astype("float32"))
        return preds

    def forecast_ensemble(self, history: np.ndarray, start_date: pd.Timestamp, horizon: int):
        """Analog ensemble → (mean_list, std_list) per horizon — a free, flow-dependent
        uncertainty band from the spread of the k observed analog futures."""
        horizon = int(horizon)
        analogs = self._retrieve(history[-1], start_date)
        idx = self._cand[analogs]
        means, stds = [], []
        for h in range(1, horizon + 1):
            fut = self._raw[np.minimum(idx + h, self._raw.shape[0] - 1)]
            means.append(fut.mean(axis=0).astype("float32"))
            stds.append(fut.std(axis=0).astype("float32"))
        return means, stds

    def predict_step(self, history: np.ndarray, target_date: pd.Timestamp) -> np.ndarray:
        # next-day = horizon-1 analog mean, queried from the day before the target
        when = pd.Timestamp(target_date) - pd.Timedelta(days=1)
        return self.forecast(history, when, 1)[0]
