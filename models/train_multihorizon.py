"""models/train_multihorizon.py — train the ConvLSTM THROUGH an autoregressive rollout.

The 1-day-trained model (models/train.py) is rolled out blindly for 3–7 day forecasts, so its
own errors compound (drift). This trainer rolls the model forward H days *inside the loss* —
feeding each prediction back exactly as the twin does at inference (sliding window; future LST
from day-of-year climatology; future elevation/day-of-year are known) — and supervises every
lead day. The model learns to stay stable over the horizon, reducing drift.

Same model + checkpoint format as train.py (saved to convlstm.pt with trained_horizon=H), so the
twin/backend pick it up with no change; the existing autoregressive forecast() just drifts less.
After training, re-fit the ensemble + re-validate:
    python -m models.ensemble --fit && python -m models.validate

Rules upheld (CLAUDE.md §2/§7): temporal split, train-only norm, two-head rainfall loss, no
leakage (future LST uses TRAIN-years day-of-year climatology, never the true future field).

Run:  python -m models.train_multihorizon [--horizon 3] [--epochs 80]
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
from models.convlstm import build_input, build_module, doy_features, elevation_stats, in_channels, norm_var
from models.train import _years_slice, two_head_loss


def _lst_climatology(ds: xr.Dataset):
    """TRAIN-years day-of-year mean LST (367,H,W) — used for FUTURE days in the rollout (no leakage)."""
    y0, y1 = cfg.SPLIT["train"]
    grp = ds["lst"].sel(time=slice(f"{y0}-01-01", f"{y1}-12-31")).groupby("time.dayofyear").mean("time")
    H, W = grp.shape[1], grp.shape[2]
    table = np.zeros((367, H, W), dtype="float32")
    for i, d in enumerate(grp["dayofyear"].values):
        table[int(d)] = grp.values[i]
    table[366] = table[365]
    return table


def make_rollout_dataset(ds, split, norm, elev, elev_stat, has_lst, horizon, lst_clim):
    """X0 (N,k,Cin,H,W) initial input; STAT (N,H-1,Cstatic,H,W) static channels for the appended
    (future) days; Y (N,horizon,3,H,W) normalized targets for lead days 0..H-1."""
    sub, first_target = _years_slice(ds, split)
    raw = np.stack([sub[v].values for v in cfg.VARS], axis=1).astype("float32")  # (T,3,H,W)
    raw_lst = sub["lst"].values.astype("float32") if has_lst else None
    times = pd.to_datetime(sub["time"].values)
    k, T = cfg.K_INPUT, len(raw)
    H, W = raw.shape[2], raw.shape[3]
    elev_n = norm_var(elev, elev_stat)

    def static_for(date):
        chans = []
        if has_lst:
            chans.append(norm_var(lst_clim[int(pd.Timestamp(date).dayofyear)], norm["lst"]))
        chans.append(elev_n)
        s, c = doy_features(date)
        chans.append(np.full((H, W), s, "float32"))
        chans.append(np.full((H, W), c, "float32"))
        return np.stack(chans)

    X0, STAT, Y = [], [], []
    for t in range(k, T - horizon + 1):
        if times[t] < first_target:
            continue
        X0.append(build_input(raw[t - k:t], times[t - k:t], elev, norm, elev_stat,
                              raw_lst[t - k:t] if has_lst else None))
        ys, stats = [], []
        for h in range(horizon):
            d = t + h
            ys.append(np.stack([norm_var(raw[d, RAIN], norm["rainfall"]),
                                norm_var(raw[d, TMAX], norm["tmax"]),
                                norm_var(raw[d, TMIN], norm["tmin"])]))
            if h < horizon - 1:
                stats.append(static_for(times[d]))  # static of day t+h → appended to predict t+h+1
        Y.append(np.stack(ys))
        STAT.append(np.stack(stats))
    return (np.asarray(X0, "float32"), np.asarray(STAT, "float32"), np.asarray(Y, "float32"))


def train(horizon=3, epochs=80, hidden=64, n_layers=2, dropout=0.1, lr=2e-3, batch=32,
          seed=0, patience=10):
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    torch.manual_seed(seed)
    np.random.seed(seed)
    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    cfg.ensure_dirs()
    ds = xr.open_dataset(cfg.CUBE_PATH)
    norm = json.loads(cfg.NORM_STATS_PATH.read_text())
    elev = ds["elevation"].isel(time=0).values.astype("float32")
    elev_stat = elevation_stats(elev)
    has_lst = "lst" in ds and "lst" in norm
    lst_clim = _lst_climatology(ds) if has_lst else None

    Xtr, Str, Ytr = make_rollout_dataset(ds, "train", norm, elev, elev_stat, has_lst, horizon, lst_clim)
    Xva, Sva, Yva = make_rollout_dataset(ds, "val", norm, elev, elev_stat, has_lst, horizon, lst_clim)
    print(f"[mh] device={device} horizon={horizon} LST={'on' if has_lst else 'off'} "
          f"train={len(Xtr)} val={len(Xva)} in={tuple(Xtr.shape[2:])}")

    arch = {"in_ch": in_channels(has_lst), "hidden": hidden, "n_layers": n_layers,
            "dropout": dropout, "out_ch": 4}
    model = build_module(**arch).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    rs = norm["rainfall"]
    rmean, rstd = rs["mean"], (rs["std"] or 1.0)
    wet_thresh = (np.log1p(cfg.RAIN_WET_DAY_MM) - rmean) / rstd

    def recon_dyn(out):
        """out (B,4,H,W) → next-day normalized [rain,tmax,tmin] (B,3,H,W), differentiable."""
        p = torch.sigmoid(out[:, 0:1])
        amount_raw = torch.expm1((out[:, 1:2] * rstd + rmean).clamp(max=8.0)).clamp(min=0.0)
        rain_n = (torch.log1p(p * amount_raw) - rmean) / rstd
        return torch.cat([rain_n, out[:, 2:3], out[:, 3:4]], dim=1)

    def rollout_loss(x0, stat, y):
        x, total = x0, 0.0
        for h in range(horizon):
            out = model(x)
            total = total + two_head_loss(out, y[:, h], torch, wet_thresh)
            if h < horizon - 1:
                new_day = torch.cat([recon_dyn(out), stat[:, h]], dim=1)   # (B,Cin,H,W)
                x = torch.cat([x[:, 1:], new_day.unsqueeze(1)], dim=1)     # slide the window
        return total / horizon

    def loader(X, S, Y, shuffle):
        return DataLoader(TensorDataset(torch.from_numpy(X), torch.from_numpy(S), torch.from_numpy(Y)),
                          batch_size=batch, shuffle=shuffle)
    trdl, vadl = loader(Xtr, Str, Ytr, True), loader(Xva, Sva, Yva, False)

    best, best_state, bad = float("inf"), None, 0
    for ep in range(1, epochs + 1):
        model.train()
        tl = 0.0
        for xb, sb, yb in trdl:
            xb, sb, yb = xb.to(device), sb.to(device), yb.to(device)
            opt.zero_grad()
            loss = rollout_loss(xb, sb, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tl += loss.item() * len(xb)
        sched.step()
        model.eval()
        vl = 0.0
        with torch.no_grad():
            for xb, sb, yb in vadl:
                xb, sb, yb = xb.to(device), sb.to(device), yb.to(device)
                vl += rollout_loss(xb, sb, yb).item() * len(xb)
        tl /= len(Xtr); vl /= len(Xva); flag = ""
        if vl < best - 1e-4:
            best, bad = vl, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            flag = " *"
        else:
            bad += 1
        if ep % 5 == 0 or flag or ep == 1:
            print(f"[mh] epoch {ep:3d}  train={tl:.4f}  val={vl:.4f}{flag}")
        if bad >= patience:
            print(f"[mh] early stop at epoch {ep} (best val={best:.4f})")
            break

    out = cfg.CKPT_DIR / "convlstm.pt"
    torch.save({
        "state_dict": best_state or model.state_dict(), "norm": norm, "elev_stat": elev_stat,
        "elevation": elev.tolist(), "arch": arch, "has_lst": has_lst, "two_head": True,
        "best_val_loss": best, "data_source": ds.attrs.get("data_source", "unknown"),
        "k_input": cfg.K_INPUT, "trained_horizon": horizon, "seed": seed,
    }, out)
    print(f"[mh] saved {out} (trained_horizon={horizon}). Now: "
          f"`python -m models.ensemble --fit && python -m models.validate`")
    return out


def main():
    p = argparse.ArgumentParser(description="Multi-horizon (rollout) ConvLSTM training")
    p.add_argument("--horizon", type=int, default=3, help="rollout length to train through")
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--layers", type=int, default=2)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()
    t0 = time.time()
    train(horizon=a.horizon, epochs=a.epochs, hidden=a.hidden, n_layers=a.layers,
          lr=a.lr, batch=a.batch, seed=a.seed)
    print(f"[mh] done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
