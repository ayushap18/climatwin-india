"""models/validate_regime.py — honest validation for a FOCUSED regime cube.

The default `models/validate.py` is locked to the synthetic year-based temporal
split (config.SPLIT). A focused regime (e.g. the REAL INSAT-3D LST 2020 cube) uses
a MONTH-based split stored in its norm_stats `_split_dates`. This runner scores the
same metrics — RMSE / MAE / corr per variable on the TEST window, rainfall POD/FAR/CSI,
and a tmax per-cell error map — and writes `data/validation_metrics_<tag>.json` in the
SAME shape as `models/validation_metrics.json`, so the frontend Validation view and the
`/validate` endpoint can read it unchanged.

Honesty (CLAUDE.md §2.3, §7): no leakage — climatology is fit on the TRAIN months only;
the ConvLSTM honors its checkpoint `split_dates`. At 1-day lead, persistence is a very
strong baseline (especially for temperature on a smooth 0.25° field); whatever the real
numbers say is what gets reported, and `summary_rmse.best` shows the true winner.

Run:  python -m models.validate_regime
      -> writes data/validation_metrics_2020.json  (REAL Nov–Dec 2020 test metrics)
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from config import RAIN, TMAX
from models.baselines import ClimatologyForecaster, PersistenceForecaster
from models.validate import _categorical, _json_default  # reuse: identical math


def _test_samples_range(cube: xr.Dataset, test_range, horizon: int = 1):
    """Yield (history (k,C,H,W), truth (h,C,H,W), start_date) over an explicit date range.

    Mirrors models.validate._test_samples but takes an explicit (lo, hi) test window
    instead of config.SPLIT — needed for month-based regime splits. `k` days of lead-in
    are pulled before the first test target; targets strictly inside [lo, hi] are scored.
    """
    lo, hi = pd.Timestamp(test_range[0]), pd.Timestamp(test_range[1])
    lead = lo - pd.Timedelta(days=cfg.K_INPUT)
    sub = cube.sel(time=slice(lead, hi))
    arr = np.stack([sub[v].values for v in cfg.VARS], axis=1)  # (T, C, H, W)
    times = pd.to_datetime(sub["time"].values)
    k = cfg.K_INPUT
    for t in range(k, len(arr) - horizon + 1):
        if times[t] < lo:  # target day must fall inside the test window
            continue
        hist = arr[t - k:t]
        truth = arr[t:t + horizon]
        yield hist, truth, times[t - 1]


def evaluate_range(cube: xr.Dataset, forecaster, test_range, horizon: int = 1) -> dict:
    """Score one forecaster over an explicit test window — same metrics as validate.evaluate."""
    sq = {v: 0.0 for v in cfg.VARS}
    ab = {v: 0.0 for v in cfg.VARS}
    n = 0
    H, W = cube["lat"].size, cube["lon"].size
    err_sq_map = np.zeros((len(cfg.VARS), H, W))
    preds_rain, true_rain = [], []
    sum_p = {v: 0.0 for v in cfg.VARS}; sum_t = {v: 0.0 for v in cfg.VARS}
    sum_pt = {v: 0.0 for v in cfg.VARS}; sum_pp = {v: 0.0 for v in cfg.VARS}; sum_tt = {v: 0.0 for v in cfg.VARS}

    for hist, truth, start in _test_samples_range(cube, test_range, horizon):
        fc = forecaster.forecast(hist, start, horizon)
        pred = np.array(fc[-1], dtype="float32")
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
        cov = sum_pt[v] - sum_p[v] * sum_t[v] / n
        vp = sum_pp[v] - sum_p[v] ** 2 / n
        vt = sum_tt[v] - sum_t[v] ** 2 / n
        corr = cov / ((vp * vt) ** 0.5) if vp > 0 and vt > 0 else float("nan")
        metrics[v] = {"RMSE": round(rmse, 3), "MAE": round(mae, 3), "corr": round(corr, 3)}

    metrics["rainfall"]["categorical"] = _categorical(
        np.array(preds_rain), np.array(true_rain), cfg.RAIN_WET_DAY_MM
    )
    n_samples = max(n // (H * W), 1)
    metrics["error_map_tmax_rmse"] = np.sqrt(err_sq_map[TMAX] / n_samples).round(3).tolist()
    return metrics


def run(
    cube_path=cfg.DATA_DIR / "twin_cube_2020.nc",
    norm_path=cfg.DATA_DIR / "norm_stats_2020.json",
    ckpt_name="convlstm_2020.pt",
    tag="2020",
    horizons=(1,),
) -> dict:
    cube = xr.open_dataset(cube_path)
    norm = json.loads(norm_path.read_text())
    sd = norm["_split_dates"]                 # {"train": [...], "val": [...], "test": [...]}
    train_range = sd["train"]
    test_range = sd["test"]

    # Forecasters — climatology fit on TRAIN months only (no leakage); ConvLSTM honors
    # the checkpoint's own split_dates internally.
    forecasters = {
        "persistence": PersistenceForecaster(),
        "climatology": ClimatologyForecaster().fit(cube, train_range=train_range),
    }
    ckpt_path = cfg.CKPT_DIR / ckpt_name
    if ckpt_path.exists():
        try:
            from models.convlstm import ConvLSTMForecaster
            forecasters["convlstm"] = ConvLSTMForecaster(checkpoint_path=ckpt_path, cube=cube)
            print(f"[validate_regime] including ConvLSTM ({ckpt_name})")
        except Exception as e:  # noqa: BLE001 — report honestly, don't fake the model
            print(f"[validate_regime] ConvLSTM unavailable ({type(e).__name__}: {e})")
    else:
        print(f"[validate_regime] no checkpoint at {ckpt_path} — baselines only")

    names = list(forecasters.keys())
    out = {
        "data_source": cube.attrs.get("data_source", "unknown"),
        "lst_source": cube.attrs.get("lst_source"),
        "lst_coverage": float(cube.attrs.get("lst_coverage", float("nan"))),
        "regime": cube.attrs.get("regime", f"regime_{tag}"),
        "split": sd,             # month-based split (display)
        "split_dates": sd,       # canonical key for downstream readers
        "wet_day_threshold_mm": cfg.RAIN_WET_DAY_MM,
        "note": "",              # filled in below from the REAL numbers
        "lat": cube["lat"].values.tolist(),
        "lon": cube["lon"].values.tolist(),
        "horizons": {},
    }
    for h in horizons:
        out["horizons"][str(h)] = {
            name: evaluate_range(cube, fc, test_range, horizon=h) for name, fc in forecasters.items()
        }
        print(f"[validate_regime] horizon {h}d done")

    # skill summary: RMSE per forecaster per variable (lower is better) + true winner.
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

    # Honest note built from the ACTUAL winners (no pre-baked claims).
    h1 = summary[str(horizons[0])]
    best_by_var = {v: h1[v]["best"] for v in cfg.VARS}
    has_cl = "convlstm" in names
    n_test_days = sum(1 for _ in _test_samples_range(cube, test_range, horizons[0]))

    # Does the day-of-year climatology even have support for the test window? A month-based
    # split (train Jan–Sep / test Nov–Dec) leaves climatology with NO day-of-year overlap, so
    # its lookup collapses toward ~0 — that must be flagged, not read as a real baseline.
    tr_doy = set(pd.date_range(train_range[0], train_range[1]).dayofyear)
    te_doy = set(pd.date_range(test_range[0], test_range[1]).dayofyear)
    clim_degenerate = len(tr_doy & te_doy) == 0

    bits = [f"{v}: {best_by_var[v]} wins" for v in cfg.VARS]
    note = (
        f"REAL INSAT-3D LST regime ({tag}). Scored on the unseen TEST window "
        f"{test_range[0]}…{test_range[1]} ({n_test_days} days); "
        f"models trained/fit on TRAIN {train_range[0]}…{train_range[1]} only (no leakage). "
        f"Lead = {horizons[0]}d only — the {tag} ConvLSTM is a 1-day forecaster, so no 3/7-day "
        f"skill is reported for it. Per-variable lowest-RMSE: " + "; ".join(bits) + ". "
    )
    if clim_degenerate:
        note += (
            "CAVEAT: climatology is fit on a day-of-year table, but the TRAIN months "
            f"({train_range[0]}…{train_range[1]}) share NO day-of-year with the TEST months "
            f"({test_range[0]}…{test_range[1]}), so its lookup degrades to ~0 across the whole "
            "test window. Its huge temperature RMSE and its low rainfall RMSE are both artifacts "
            "of that (predicting ~0 happens to be near-right for a dry Delhi winter) — NOT skill. "
            "The meaningful comparison for this regime is ConvLSTM vs persistence. "
        )
    if has_cl:
        # Compare the trained model only against the honest baseline (persistence).
        worse = [v for v in cfg.VARS if h1[v]["convlstm_RMSE"] >= h1[v]["persistence_RMSE"]]
        better = [v for v in cfg.VARS if h1[v]["convlstm_RMSE"] < h1[v]["persistence_RMSE"]]
        if worse:
            note += (
                "Honestly, at 1-day lead persistence is a very strong baseline on smooth 0.25° "
                f"fields, so it beats the ConvLSTM on {', '.join(worse)} (RMSE: "
                + ", ".join(f"{v} persistence={h1[v]['persistence_RMSE']} vs convlstm={h1[v]['convlstm_RMSE']}" for v in worse)
                + "). The model is not hand-tuned to beat it. "
            )
        if better:
            note += f"The ConvLSTM does beat persistence on {', '.join(better)}. "
        note += "summary_rmse.best reflects the true lowest-RMSE model per variable."
    else:
        note += "Baselines only — no ConvLSTM checkpoint found for this regime."
    out["note"] = note

    metrics_path = cfg.DATA_DIR / f"validation_metrics_{tag}.json"
    metrics_path.write_text(json.dumps(out, indent=2, default=_json_default))
    print(f"[validate_regime] wrote {metrics_path}")
    return out


if __name__ == "__main__":
    res = run()
    names = res["models"]
    for h, s in res["summary_rmse"].items():
        print(f"\nHorizon {h}d RMSE (best in []):")
        for v, d in s.items():
            cols = "  ".join(f"{m}={d[f'{m}_RMSE']:<8}" for m in names)
            print(f"  {v:8s} {cols} -> [{d['best']}]")
    print("\nRainfall categorical (test window):")
    for m in names:
        c = res["horizons"]["1"][m]["rainfall"]["categorical"]
        print(f"  {m:12s} POD={c['POD']} FAR={c['FAR']} CSI={c['CSI']} "
              f"(hits={c['hits']} miss={c['misses']} fa={c['false_alarms']})")
