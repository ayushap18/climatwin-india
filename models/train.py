"""models/train.py — train the ConvLSTM 1-day-ahead forecaster (PyTorch).

Rules upheld (CLAUDE.md §2, §7):
  * TEMPORAL split only (train/val/test by year from config.SPLIT) — no leakage.
  * Normalization stats from TRAIN years only (loaded from norm_stats.json).
  * Rainfall modeled in log1p space with a wet-cell-weighted MSE; temperature MSE.
  * AdamW + cosine LR, early stopping on val loss, fixed seed.
Saves models/checkpoints/convlstm.pt (state_dict + norm + elevation + arch).

Run:  python -m models.train [--epochs 60] [--hidden 64] [--seed 0]
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from config import RAIN, TMAX, TMIN
from models.convlstm import (
    build_input,
    build_module,
    elevation_stats,
    in_channels,
    norm_var,
)

SEED = 0


def _years_slice(ds, split):
    y0, y1 = cfg.SPLIT[split]
    # include K_INPUT lead-in days before the split start so windows are complete
    lead = pd.Timestamp(f"{y0}-01-01") - pd.Timedelta(days=cfg.K_INPUT)
    return ds.sel(time=slice(lead, f"{y1}-12-31")), pd.Timestamp(f"{y0}-01-01")


def make_dataset(ds: xr.Dataset, split: str, norm: dict, elev: np.ndarray, elev_stat: dict,
                 has_lst: bool = False):
    """Build (X, Y) for 1-day-ahead prediction over a split.

    X: (N, k, Cin, H, W) normalized inputs.  Y: (N, 3, H, W) normalized targets.
    """
    sub, first_target = _years_slice(ds, split)
    raw = np.stack([sub[v].values for v in cfg.VARS], axis=1).astype("float32")  # (T,3,H,W)
    raw_lst = sub["lst"].values.astype("float32") if has_lst else None
    times = pd.to_datetime(sub["time"].values)
    k = cfg.K_INPUT
    X, Y = [], []
    for t in range(k, len(raw)):  # predict day t from days t-k..t-1
        if times[t] < first_target:
            continue
        window = raw[t - k:t]                      # (k,3,H,W)
        wdates = times[t - k:t]
        lst_win = raw_lst[t - k:t] if has_lst else None
        X.append(build_input(window, wdates, elev, norm, elev_stat, lst_win))
        tgt = np.stack([
            norm_var(raw[t, RAIN], norm["rainfall"]),
            norm_var(raw[t, TMAX], norm["tmax"]),
            norm_var(raw[t, TMIN], norm["tmin"]),
        ])
        Y.append(tgt)
    return np.asarray(X, dtype="float32"), np.asarray(Y, dtype="float32"), raw


def weighted_loss(pred, target, torch, wet_weight: float = 3.0):
    """Wet-cell-weighted MSE on rainfall (log1p space) + MSE on tmax/tmin."""
    # rainfall: weight cells where the (normalized) target is above its mean (i.e. >0)
    r_pred, r_tgt = pred[:, RAIN], target[:, RAIN]
    w = 1.0 + (wet_weight - 1.0) * (r_tgt > 0).float()
    rain_loss = (w * (r_pred - r_tgt) ** 2).mean()
    temp_loss = ((pred[:, TMAX] - target[:, TMAX]) ** 2).mean() + \
                ((pred[:, TMIN] - target[:, TMIN]) ** 2).mean()
    return rain_loss + temp_loss


def train(epochs=60, hidden=64, n_layers=2, dropout=0.1, lr=2e-3, batch=32, seed=SEED, patience=10):
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    torch.manual_seed(seed)
    np.random.seed(seed)
    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"[train] device={device}")

    cfg.ensure_dirs()
    ds = xr.open_dataset(cfg.CUBE_PATH)
    norm = json.loads(cfg.NORM_STATS_PATH.read_text())
    elev = ds["elevation"].isel(time=0).values.astype("float32")
    elev_stat = elevation_stats(elev)
    has_lst = "lst" in ds and "lst" in norm
    print(f"[train] INSAT LST fusion: {'ON' if has_lst else 'off'}")

    Xtr, Ytr, _ = make_dataset(ds, "train", norm, elev, elev_stat, has_lst)
    Xva, Yva, _ = make_dataset(ds, "val", norm, elev, elev_stat, has_lst)
    print(f"[train] train windows={len(Xtr)}  val windows={len(Xva)}  shape={Xtr.shape[1:]}")

    tr = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(Ytr)),
                    batch_size=batch, shuffle=True)
    va = DataLoader(TensorDataset(torch.from_numpy(Xva), torch.from_numpy(Yva)),
                    batch_size=batch)

    arch = {"in_ch": in_channels(has_lst), "hidden": hidden, "n_layers": n_layers, "dropout": dropout}
    model = build_module(**arch).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    best_val = float("inf")
    best_state = None
    bad = 0
    for ep in range(1, epochs + 1):
        model.train()
        tl = 0.0
        for xb, yb in tr:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = weighted_loss(model(xb), yb, torch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tl += loss.item() * len(xb)
        sched.step()

        model.eval()
        vl = 0.0
        with torch.no_grad():
            for xb, yb in va:
                xb, yb = xb.to(device), yb.to(device)
                vl += weighted_loss(model(xb), yb, torch).item() * len(xb)
        tl /= len(Xtr); vl /= len(Xva)
        flag = ""
        if vl < best_val - 1e-4:
            best_val = vl
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
            flag = " *"
        else:
            bad += 1
        if ep % 5 == 0 or flag or ep == 1:
            print(f"[train] epoch {ep:3d}  train={tl:.4f}  val={vl:.4f}{flag}")
        if bad >= patience:
            print(f"[train] early stop at epoch {ep} (best val={best_val:.4f})")
            break

    cfg.CKPT_DIR.mkdir(parents=True, exist_ok=True)
    out = cfg.CKPT_DIR / "convlstm.pt"
    torch.save({
        "state_dict": best_state or model.state_dict(),
        "norm": norm,
        "elev_stat": elev_stat,
        "elevation": elev.tolist(),
        "arch": arch,
        "has_lst": has_lst,
        "best_val_loss": best_val,
        "data_source": ds.attrs.get("data_source", "unknown"),
        "k_input": cfg.K_INPUT,
        "trained_horizon": 1,
        "seed": seed,
    }, out)
    print(f"[train] saved {out}  best_val_loss={best_val:.4f}")
    return out


def main():
    p = argparse.ArgumentParser(description="Train ConvLSTM forecaster")
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--layers", type=int, default=2)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--seed", type=int, default=SEED)
    args = p.parse_args()
    t0 = time.time()
    train(epochs=args.epochs, hidden=args.hidden, n_layers=args.layers,
          lr=args.lr, batch=args.batch, seed=args.seed)
    print(f"[train] done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
