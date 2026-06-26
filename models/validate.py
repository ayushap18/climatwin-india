"""models/validate.py — honest validation on the TEMPORAL TEST split.

Reports skill RELATIVE TO BASELINES (CLAUDE.md §2.3, §7):
  * continuous: RMSE / MAE / correlation for rainfall, tmax, tmin
  * categorical (rainfall): POD / FAR / CSI at the wet-day threshold
  * a spatial error map (per-cell RMSE) for one variable
Currently the "model under test" is the climatology baseline vs the persistence
baseline (the ConvLSTM is not trained yet) — stated explicitly so no skill is
over-claimed. When models/convlstm.py + a checkpoint exist, add it as another
forecaster in FORECASTERS and the same harness scores it.

Run:  python -m models.validate   -> writes models/validation_metrics.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from config import RAIN, TMAX
from models.baselines import ClimatologyForecaster, PersistenceForecaster


def _json_default(o):
    """Coerce numpy scalars/arrays so json.dumps never chokes on float32/int64."""
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not serializable: {type(o)}")


def _test_samples(cube: xr.Dataset, horizon: int = 1):
    """Yield (history (k,C,H,W), truth (h,C,H,W), start_date) over the test split."""
    ty0, ty1 = cfg.SPLIT["test"]
    # need k days of lead-in before the first test target
    lead = pd.Timestamp(f"{ty0}-01-01") - pd.Timedelta(days=cfg.K_INPUT)
    sub = cube.sel(time=slice(lead, f"{ty1}-12-31"))
    arr = np.stack([sub[v].values for v in cfg.VARS], axis=1)  # (T, C, H, W)
    times = pd.to_datetime(sub["time"].values)
    k = cfg.K_INPUT
    for t in range(k, len(arr) - horizon + 1):
        if times[t] < pd.Timestamp(f"{ty0}-01-01"):
            continue
        hist = arr[t - k:t]
        truth = arr[t:t + horizon]
        yield hist, truth, times[t - 1]


def _categorical(pred_rain: np.ndarray, true_rain: np.ndarray, thr: float):
    """POD/FAR/CSI for rain/no-rain at threshold thr."""
    p = pred_rain >= thr
    o = true_rain >= thr
    hits = int(np.sum(p & o))
    miss = int(np.sum(~p & o))
    fa = int(np.sum(p & ~o))
    pod = hits / (hits + miss) if (hits + miss) else float("nan")
    far = fa / (hits + fa) if (hits + fa) else float("nan")
    csi = hits / (hits + miss + fa) if (hits + miss + fa) else float("nan")
    return {"POD": round(pod, 3), "FAR": round(far, 3), "CSI": round(csi, 3),
            "hits": hits, "misses": miss, "false_alarms": fa}


def evaluate(cube: xr.Dataset, forecaster, horizon: int = 1) -> dict:
    """Score one forecaster at a given horizon over the test split (day `horizon` lead)."""
    sq = {v: 0.0 for v in cfg.VARS}
    ab = {v: 0.0 for v in cfg.VARS}
    n = 0
    H, W = cube["lat"].size, cube["lon"].size
    err_sq_map = np.zeros((len(cfg.VARS), H, W))
    preds_rain, true_rain = [], []
    # for correlation
    sum_p = {v: 0.0 for v in cfg.VARS}; sum_t = {v: 0.0 for v in cfg.VARS}
    sum_pt = {v: 0.0 for v in cfg.VARS}; sum_pp = {v: 0.0 for v in cfg.VARS}; sum_tt = {v: 0.0 for v in cfg.VARS}

    for hist, truth, start in _test_samples(cube, horizon):
        fc = forecaster.forecast(hist, start, horizon)
        pred = np.clip(fc[-1], None, None)
        pred[RAIN] = np.clip(pred[RAIN], 0.0, None)
        tgt = truth[-1]
        cells = pred[0].size
        for ci, v in enumerate(cfg.VARS):
            d = pred[ci] - tgt[ci]
            sq[v] += float(np.sum(d ** 2))
            ab[v] += float(np.sum(np.abs(d)))
            err_sq_map[ci] += d ** 2
            pv, tv = pred[ci].ravel(), tgt[ci].ravel()
            sum_p[v] += pv.sum(); sum_t[v] += tv.sum()
            sum_pt[v] += float(pv @ tv); sum_pp[v] += float(pv @ pv); sum_tt[v] += float(tv @ tv)
        preds_rain.append(pred[RAIN]); true_rain.append(tgt[RAIN])
        n += cells

    metrics = {}
    for v in cfg.VARS:
        rmse = (sq[v] / n) ** 0.5
        mae = ab[v] / n
        # Pearson correlation
        cov = sum_pt[v] - sum_p[v] * sum_t[v] / n
        vp = sum_pp[v] - sum_p[v] ** 2 / n
        vt = sum_tt[v] - sum_t[v] ** 2 / n
        corr = cov / ((vp * vt) ** 0.5) if vp > 0 and vt > 0 else float("nan")
        metrics[v] = {"RMSE": round(rmse, 3), "MAE": round(mae, 3), "corr": round(corr, 3)}

    metrics["rainfall"]["categorical"] = _categorical(
        np.array(preds_rain), np.array(true_rain), cfg.RAIN_WET_DAY_MM
    )
    # spatial error map (per-cell RMSE) for tmax — the easiest to read
    n_samples = max(n // (H * W), 1)
    metrics["error_map_tmax_rmse"] = np.sqrt(err_sq_map[TMAX] / n_samples).round(3).tolist()
    return metrics


def run(cube_path=None, horizons=(1, 3, 7)) -> dict:
    cube = xr.open_dataset(cube_path or cfg.CUBE_PATH)
    forecasters = {
        "persistence": PersistenceForecaster(),
        "climatology": ClimatologyForecaster().fit(cube),
    }
    # Analog (k-NN) ensemble — pure-IMD, no checkpoint needed; scored like everything else.
    try:
        from models.analog import AnalogForecaster
        forecasters["analog"] = AnalogForecaster(cube=cube)
        print("[validate] including analog ensemble")
    except Exception as e:
        print(f"[validate] analog unavailable ({type(e).__name__}: {e})")
    # Stacked ensemble (if its weights have been fit) — many algorithms, blended honestly.
    if (cfg.MODELS_DIR / "ensemble_weights.json").exists():
        try:
            from models.ensemble import EnsembleForecaster
            forecasters["ensemble"] = EnsembleForecaster(cube=cube)
            print("[validate] including stacked ensemble")
        except Exception as e:
            print(f"[validate] ensemble unavailable ({type(e).__name__}: {e})")
    # Include the trained ConvLSTM if a checkpoint exists (the model under test).
    if (cfg.CKPT_DIR / "convlstm.pt").exists():
        try:
            from models.convlstm import ConvLSTMForecaster
            forecasters["convlstm"] = ConvLSTMForecaster(cube=cube)
            print("[validate] including trained ConvLSTM")
        except Exception as e:
            print(f"[validate] ConvLSTM unavailable ({type(e).__name__}: {e})")
    has_convlstm = "convlstm" in forecasters
    note = (
        "ConvLSTM scored against persistence + climatology on the 2022–2023 temporal "
        "TEST split (no leakage; norm/climatology fit on train years only). Per-variable, "
        "per-horizon winners are in summary_rmse — honestly, climatology stays hard to beat "
        "for long-range temperature, so the win is reported only where it is real."
        if has_convlstm else
        "Baselines only — no ConvLSTM checkpoint found. Persistence and climatology are "
        "the bars to beat (CLAUDE.md §2.3). Train the model, then re-run to score it here."
    )
    out = {
        "data_source": cube.attrs.get("data_source", "unknown"),
        "split": cfg.SPLIT,
        "wet_day_threshold_mm": cfg.RAIN_WET_DAY_MM,
        "note": note,
        "lat": cube["lat"].values.tolist(),
        "lon": cube["lon"].values.tolist(),
        "horizons": {},
    }
    for h in horizons:
        out["horizons"][str(h)] = {name: evaluate(cube, fc, horizon=h) for name, fc in forecasters.items()}
        print(f"[validate] horizon {h}d done")
    # skill summary: RMSE per forecaster per variable (lower is better) + winner.
    names = list(forecasters.keys())
    summary = {}
    for h in horizons:
        hh = out["horizons"][str(h)]
        summary[str(h)] = {
            v: {
                **{f"{m}_RMSE": hh[m][v]["RMSE"] for m in names},
                "best": min(names, key=lambda m: hh[m][v]["RMSE"]),
            }
            for v in cfg.VARS
        }
    out["summary_rmse"] = summary
    out["models"] = names
    cfg.METRICS_PATH.write_text(json.dumps(out, indent=2, default=_json_default))
    print(f"[validate] wrote {cfg.METRICS_PATH}")
    return out


if __name__ == "__main__":
    res = run()
    names = res["models"]
    for h, s in res["summary_rmse"].items():
        print(f"\nHorizon {h}d RMSE (best in []):")
        for v, d in s.items():
            cols = "  ".join(f"{m}={d[f'{m}_RMSE']:<8}" for m in names)
            print(f"  {v:8s} {cols} -> [{d['best']}]")
