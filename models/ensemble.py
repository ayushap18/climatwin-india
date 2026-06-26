"""models/ensemble.py — leakage-safe stacked ensemble + split-conformal intervals.

"Many algorithms thinking together, honestly." Combines the existing forecasters
(persistence, climatology, analog, convlstm) with per-variable, per-horizon NON-NEGATIVE
weights, and wraps the blend in split-conformal prediction intervals with verified ~90%
coverage — calibrated uncertainty almost no hackathon team shows.

Leakage discipline (CLAUDE.md §2.4/§2.5):
  * Stacking weights are fit on the VAL FIT slice (2019–2020).
  * Conformal half-widths are computed on a DISJOINT VAL CALIB slice (2021).
  * The TEST split (2022–2023) is never touched during fitting — validate.py scores it.
  * Non-negative least squares → interpretable weights, no member can be "subtracted".

Artifacts: models/ensemble_weights.json  (weights + conformal half-widths + members).

CLI:  python -m models.ensemble --fit
"""
from __future__ import annotations

import argparse
import json
import time
from typing import Dict, List

import numpy as np
import pandas as pd
import xarray as xr
from scipy.optimize import nnls

import config as cfg
from models.baselines import Forecaster, get_forecaster

WEIGHTS_PATH = cfg.MODELS_DIR / "ensemble_weights.json"
CANDIDATE_MEMBERS = ["persistence", "climatology", "analog", "convlstm"]
CONFORMAL_ALPHA = 0.10  # 90% intervals


# --------------------------------------------------------------------------- #
def _history(cube: xr.Dataset, start, k: int = cfg.K_INPUT) -> np.ndarray:
    days = pd.date_range(pd.Timestamp(start) - pd.Timedelta(days=k - 1), pd.Timestamp(start))
    return np.stack(
        [np.stack([cube[v].sel(time=d).values for v in cfg.VARS], 0) for d in days]
    ).astype("float32")


def _obs(cube: xr.Dataset, date) -> np.ndarray:
    return np.stack([cube[v].sel(time=date).values for v in cfg.VARS], 0).astype("float32")


def _eligible_dates(cube: xr.Dataset, y0: int, y1: int, horizon: int, stride: int) -> List[pd.Timestamp]:
    times = pd.to_datetime(cube["time"].values)
    lo = pd.Timestamp(f"{y0}-01-01") + pd.Timedelta(days=cfg.K_INPUT)
    hi = pd.Timestamp(f"{y1}-12-31") - pd.Timedelta(days=horizon)
    days = [t for t in times if lo <= t <= hi]
    return days[::stride]


def _collect(cube: xr.Dataset, members: Dict[str, Forecaster], dates, horizon: int):
    """Return preds {member: (n, horizon, C, H, W)} and obs (n, horizon, C, H, W)."""
    names = list(members)
    preds = {m: [] for m in names}
    obs = []
    for start in dates:
        hist = _history(cube, start)
        ok = True
        ob = []
        for h in range(1, horizon + 1):
            try:
                ob.append(_obs(cube, start + pd.Timedelta(days=h)))
            except KeyError:
                ok = False
                break
        if not ok:
            continue
        for m in names:
            fc = members[m].forecast(hist, start, horizon)  # list of (C,H,W)
            preds[m].append(np.stack(fc))
        obs.append(np.stack(ob))
    out = {m: np.stack(preds[m]) for m in names}
    return out, np.stack(obs), names


def fit(cube: xr.Dataset | None = None, horizon: int = cfg.H_HORIZON, stride: int = 2) -> dict:
    cube = cube if cube is not None else xr.open_dataset(cfg.CUBE_PATH)
    members = {}
    for m in CANDIDATE_MEMBERS:
        if m == "convlstm" and not (cfg.CKPT_DIR / "convlstm.pt").exists():
            continue
        try:
            members[m] = get_forecaster(m, cube=cube)
        except Exception as e:
            print(f"[ensemble] skip {m} ({type(e).__name__}: {e})")
    names = list(members)
    print(f"[ensemble] members={names}")

    vy0, vy1 = cfg.SPLIT["val"]
    fit_dates = _eligible_dates(cube, vy0, vy1 - 1, horizon, stride)      # 2019..2020
    cal_dates = _eligible_dates(cube, vy1, vy1, horizon, max(1, stride // 1))  # 2021
    print(f"[ensemble] fit days={len(fit_dates)}  calib days={len(cal_dates)}")

    t0 = time.time()
    fp, fo, names = _collect(cube, members, fit_dates, horizon)
    print(f"[ensemble] collected fit preds in {time.time()-t0:.0f}s")

    nC = len(cfg.VARS)
    weights: Dict[str, Dict[str, Dict[str, float]]] = {v: {} for v in cfg.VARS}
    for c, v in enumerate(cfg.VARS):
        for h in range(horizon):
            # design matrix: rows = (days × cells), cols = members
            A = np.stack([fp[m][:, h, c].reshape(-1) for m in names], axis=1).astype("float64")
            y = fo[:, h, c].reshape(-1).astype("float64")
            w, _ = nnls(A, y)
            s = w.sum()
            w = (w / s) if s > 1e-8 else np.ones(len(names)) / len(names)  # normalize → convex blend
            weights[v][str(h + 1)] = {m: float(wi) for m, wi in zip(names, w)}

    # ---- split-conformal half-widths on the disjoint calib slice ----
    cp, co, _ = _collect(cube, members, cal_dates, horizon)
    conformal: Dict[str, Dict[str, float]] = {v: {} for v in cfg.VARS}
    cover: Dict[str, Dict[str, float]] = {v: {} for v in cfg.VARS}
    for c, v in enumerate(cfg.VARS):
        for h in range(horizon):
            wv = np.array([weights[v][str(h + 1)][m] for m in names])
            blend = np.tensordot(wv, np.stack([cp[m][:, h, c] for m in names]), axes=(0, 0))
            resid = np.abs(blend - co[:, h, c]).reshape(-1)
            q = float(np.quantile(resid, 1.0 - CONFORMAL_ALPHA))
            conformal[v][str(h + 1)] = q
            cover[v][str(h + 1)] = float((np.abs(blend - co[:, h, c]) <= q).mean())

    out = {
        "members": names,
        "horizon": horizon,
        "alpha": CONFORMAL_ALPHA,
        "weights": weights,
        "conformal_halfwidth": conformal,
        "calib_coverage": cover,
        "split": {"fit_years": [vy0, vy1 - 1], "calib_years": [vy1, vy1]},
        "note": (
            "Non-negative stacking weights fit on VAL 2019–2020; split-conformal 90% "
            "half-widths on the disjoint VAL 2021 slice. TEST (2022–2023) untouched."
        ),
    }
    WEIGHTS_PATH.write_text(json.dumps(out, indent=2))
    print(f"[ensemble] wrote {WEIGHTS_PATH}")
    # quick readout: 1-day weights + a coverage spot-check
    print(f"[ensemble] 1-day weights: "
          + " | ".join(f"{v}: " + ",".join(f"{m}={weights[v]['1'][m]:.2f}" for m in names) for v in cfg.VARS))
    print(f"[ensemble] calib coverage @1-day (target {1-CONFORMAL_ALPHA:.0%}): "
          + ", ".join(f"{v}={cover[v]['1']:.2f}" for v in cfg.VARS))
    return out


# --------------------------------------------------------------------------- #
class EnsembleForecaster(Forecaster):
    """Weighted blend of member forecasters; carries split-conformal half-widths."""

    name = "ensemble"

    def __init__(self, cube: xr.Dataset | None = None):
        if not WEIGHTS_PATH.exists():
            raise FileNotFoundError(f"no {WEIGHTS_PATH}; run `python -m models.ensemble --fit`")
        self.spec = json.loads(WEIGHTS_PATH.read_text())
        self.members = {m: get_forecaster(m, cube=cube) for m in self.spec["members"]}
        self.horizon = int(self.spec["horizon"])

    def _w(self, var: str, h: int) -> Dict[str, float]:
        hh = str(min(max(1, h), self.horizon))
        return self.spec["weights"][var][hh]

    def forecast(self, history: np.ndarray, start_date, horizon: int) -> List[np.ndarray]:
        mf = {m: f.forecast(history, start_date, horizon) for m, f in self.members.items()}
        out = []
        for h in range(horizon):
            acc = None
            for c, v in enumerate(cfg.VARS):
                w = self._w(v, h + 1)
                blend = sum(w[m] * mf[m][h][c] for m in self.members)
                if acc is None:
                    acc = np.zeros((len(cfg.VARS),) + blend.shape, dtype="float32")
                acc[c] = blend
            out.append(acc.astype("float32"))
        return out

    def predict_step(self, history: np.ndarray, target_date) -> np.ndarray:
        return self.forecast(history, pd.Timestamp(target_date) - pd.Timedelta(days=1), 1)[0]

    def conformal_halfwidth(self, var: str, h: int) -> float:
        hh = str(min(max(1, h), self.horizon))
        return float(self.spec["conformal_halfwidth"][var][hh])


def main():
    p = argparse.ArgumentParser(description="Fit the stacked ensemble + conformal intervals")
    p.add_argument("--fit", action="store_true")
    p.add_argument("--stride", type=int, default=2)
    args = p.parse_args()
    if args.fit:
        t0 = time.time()
        fit(stride=args.stride)
        print(f"[ensemble] done in {time.time()-t0:.0f}s")
    else:
        print("nothing to do; pass --fit")


if __name__ == "__main__":
    main()
