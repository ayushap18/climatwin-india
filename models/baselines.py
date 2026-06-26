"""models/baselines.py — persistence + climatology forecasters.

Build these FIRST and beat them before any accuracy claim (CLAUDE.md §2.3).
They also serve as the twin's forecaster until the ConvLSTM checkpoint exists —
both implement the same ``Forecaster`` interface, so the ConvLSTM drops in later
with no twin/backend changes.

Forecasters operate in RAW physical units (mm / degC) on (C, H, W) arrays where the
channel order is config.VARS = [rainfall, tmax, tmin]. The twin keeps its state in
raw units so impact thresholds (Tmax > 40) apply directly.
"""
from __future__ import annotations

from typing import List

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg


class Forecaster:
    """Interface: predict the next day, and roll forward autoregressively."""

    name = "abstract"

    def predict_step(self, history: np.ndarray, target_date: pd.Timestamp) -> np.ndarray:
        """history: (k, C, H, W) recent days -> next-day field (C, H, W)."""
        raise NotImplementedError

    def forecast(self, history: np.ndarray, start_date: pd.Timestamp, horizon: int) -> List[np.ndarray]:
        """Roll forward `horizon` days. Returns list of (C, H, W), one per future day."""
        hist = [f for f in history]
        preds: List[np.ndarray] = []
        for h in range(1, horizon + 1):
            target = pd.Timestamp(start_date) + pd.Timedelta(days=h)
            nxt = self.predict_step(np.asarray(hist[-cfg.K_INPUT:]), target)
            preds.append(nxt)
            hist.append(nxt)
        return preds


class PersistenceForecaster(Forecaster):
    """Tomorrow = today. The hardest baseline to beat at 1-day lead."""

    name = "persistence"

    def predict_step(self, history: np.ndarray, target_date: pd.Timestamp) -> np.ndarray:
        return np.array(history[-1], dtype="float32")


class ClimatologyForecaster(Forecaster):
    """Day-of-year mean from the TRAIN years. Strong at long lead / seasonal signal."""

    name = "climatology"

    def __init__(self):
        self.doy_mean: np.ndarray | None = None  # (366, C, H, W)

    def fit(self, cube: xr.Dataset) -> "ClimatologyForecaster":
        ty0, ty1 = cfg.SPLIT["train"]
        train = cube.sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
        stacks = []
        for v in cfg.VARS:
            grp = train[v].groupby("time.dayofyear").mean("time")  # (doy, lat, lon)
            stacks.append(grp)
        # align on dayofyear, stack to (doy, C, H, W)
        merged = xr.concat(stacks, dim="channel")  # (channel, doy, lat, lon)
        arr = merged.transpose("dayofyear", "channel", "lat", "lon").values
        # dayofyear index runs 1..366; pad to a 367-length table for O(1) lookup.
        doys = merged["dayofyear"].values
        table = np.zeros((367,) + arr.shape[1:], dtype="float32")
        for i, d in enumerate(doys):
            table[int(d)] = arr[i]
        if doys.max() < 366:  # leap day fallback
            table[366] = table[365]
        self.doy_mean = table
        return self

    def predict_step(self, history: np.ndarray, target_date: pd.Timestamp) -> np.ndarray:
        if self.doy_mean is None:
            raise RuntimeError("ClimatologyForecaster.fit(cube) must be called first")
        d = int(pd.Timestamp(target_date).dayofyear)
        return np.array(self.doy_mean[d], dtype="float32")


# Convenience registry for the backend / twin.
def get_forecaster(name: str, cube: xr.Dataset | None = None) -> Forecaster:
    if name == "persistence":
        return PersistenceForecaster()
    if name == "climatology":
        if cube is None:
            raise ValueError("climatology requires the cube to fit")
        return ClimatologyForecaster().fit(cube)
    if name == "analog":
        from models.analog import AnalogForecaster  # lazy import
        return AnalogForecaster(cube=cube)
    if name == "ensemble":
        from models.ensemble import EnsembleForecaster  # lazy import
        return EnsembleForecaster(cube=cube)
    if name == "convlstm":
        from models.convlstm import ConvLSTMForecaster  # lazy: avoids torch import otherwise
        return ConvLSTMForecaster(cube=cube)
    raise ValueError(f"unknown forecaster: {name!r}")
