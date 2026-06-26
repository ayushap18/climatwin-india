"""models/downscale_indmet.py — GENUINE 5× downscaler trained on real INDmet 0.05° truth.

The original SR-CNN (models/downscale.py) had to coarsen the project's own 0.25° field and
learn to invert it — an honest "method demonstrator" because IMD has no finer-than-0.25°
truth to validate against. INDmet (0.05°, ~5 km) IS real high-resolution data, so this
module learns a REAL 5× super-resolution (0.25° → 0.05°) and validates the recovered fine
structure against independent high-res truth — no more "re-learning the interpolator" caveat.

Pipeline (per day, rainfall in log1p space):
    fine_raw (40×60, INDmet 0.05°)  --block-mean ×5-->  coarse (8×12, ~0.25°)
    coarse                          --bilinear up-->     bil_raw (40×60)   # coarse input
    model input  = norm(bil_raw)            (in_ch=1; no fake elevation at 0.05°)
    model output = bil_n + residual         (residual learning, norm space)
    target       = norm(fine_raw)
Temporal split (config.SPLIT); norm stats are TRAIN-years-only (computed here from INDmet
train years — no leakage). Reuses the SR-CNN + helpers from models/downscale.py.

CLI:  python -m models.downscale_indmet [--epochs 80]
"""
from __future__ import annotations

import argparse
import time

import numpy as np
import xarray as xr

import config as cfg
from models.convlstm import denorm_var, norm_var
from models.downscale import _device, _rmse, bilinear_to, block_mean_coarsen, build_module

INDMET_CUBE = cfg.DATA_DIR / "indmet_cube_005.nc"
CKPT = cfg.CKPT_DIR / "downscale_indmet.pt"
FACTOR = 5  # 0.25° → 0.05°


def _train_norm(fine_train: np.ndarray) -> dict:
    """log1p rainfall stats from TRAIN years only (no leakage)."""
    x = np.log1p(np.clip(np.nan_to_num(fine_train, nan=0.0), 0, None))
    return {"mean": float(x.mean()), "std": float(x.std()) or 1.0, "transform": "log1p"}


def _split(da: xr.DataArray, split: str) -> np.ndarray:
    y0, y1 = cfg.SPLIT[split]
    return np.nan_to_num(da.sel(time=slice(f"{y0}-01-01", f"{y1}-12-31")).values.astype("float32"), nan=0.0)


def _pairs(fields: np.ndarray, stat: dict, factor: int):
    """fields (T,H,W) raw → X (T,1,H,W) norm bilinear, Y (T,1,H,W) norm fine, bil_raw (T,H,W)."""
    T, H, W = fields.shape
    X = np.zeros((T, 1, H, W), dtype="float32")
    Y = np.zeros((T, 1, H, W), dtype="float32")
    bil_raw = np.zeros((T, H, W), dtype="float32")
    for t in range(T):
        b = bilinear_to(block_mean_coarsen(fields[t], factor), (H, W))
        bil_raw[t] = b
        X[t, 0] = norm_var(b, stat)
        Y[t, 0] = norm_var(fields[t], stat)
    return X, Y, bil_raw


def train(epochs: int = 80, hidden: int = 64, lr: float = 2e-3, batch: int = 32,
          seed: int = 0, factor: int = FACTOR, patience: int = 12):
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    if not INDMET_CUBE.exists():
        raise FileNotFoundError(
            f"no INDmet cube at {INDMET_CUBE}; run `python -m data.ingest_indmet --vars rainfall`")
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = _device()

    ds = xr.open_dataset(INDMET_CUBE)
    da = ds["rainfall"]
    H, W = ds.sizes["lat"], ds.sizes["lon"]
    print(f"[ds-indmet] device={device}  grid={H}×{W}  factor={factor}  "
          f"(real 0.05° truth, {ds.sizes['time']} days)")

    tr_fields = _split(da, "train")
    va_fields = _split(da, "val")
    stat = _train_norm(tr_fields)  # TRAIN-only
    Xtr, Ytr, _ = _pairs(tr_fields, stat, factor)
    Xva, Yva, _ = _pairs(va_fields, stat, factor)
    print(f"[ds-indmet] train days={len(Xtr)}  val days={len(Xva)}")

    tr = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(Ytr)), batch_size=batch, shuffle=True)
    va = DataLoader(TensorDataset(torch.from_numpy(Xva), torch.from_numpy(Yva)), batch_size=batch)

    arch = {"in_ch": 1, "hidden": hidden}
    model = build_module(**arch).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    lossf = torch.nn.MSELoss()

    best_val, best_state, bad = float("inf"), None, 0
    for ep in range(1, epochs + 1):
        model.train()
        tl = 0.0
        for xb, yb in tr:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = lossf(model(xb), yb)
            loss.backward()
            opt.step()
            tl += loss.item() * len(xb)
        sched.step()
        model.eval()
        vl = 0.0
        with torch.no_grad():
            for xb, yb in va:
                xb, yb = xb.to(device), yb.to(device)
                vl += lossf(model(xb), yb).item() * len(xb)
        tl /= len(Xtr); vl /= len(Xva)
        flag = ""
        if vl < best_val - 1e-6:
            best_val, bad = vl, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            flag = " *"
        else:
            bad += 1
        if ep % 10 == 0 or flag or ep == 1:
            print(f"[ds-indmet] epoch {ep:3d}  train={tl:.4f}  val={vl:.4f}{flag}")
        if bad >= patience:
            print(f"[ds-indmet] early stop at epoch {ep} (best val={best_val:.4f})")
            break

    if best_state is not None:
        model.load_state_dict(best_state)

    # ---- TEST skill vs bilinear, against REAL 0.05° truth ----
    te_fields = _split(da, "test")
    Xte, _, bil_te = _pairs(te_fields, stat, factor)
    with torch.no_grad():
        out_n = model(torch.from_numpy(Xte).to(device)).cpu().numpy()[:, 0]
    sr = np.clip(denorm_var(out_n, stat), 0.0, None)
    bil_rmse, sr_rmse = _rmse(bil_te, te_fields), _rmse(sr, te_fields)
    imp = 100.0 * (bil_rmse - sr_rmse) / bil_rmse if bil_rmse else float("nan")
    print(f"[ds-indmet] TEST  bilinear_rmse={bil_rmse:.4f}  srcnn_rmse={sr_rmse:.4f}  improvement={imp:.1f}%")

    cfg.CKPT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save({
        "state_dict": best_state or model.state_dict(),
        "var": "rainfall",
        "norm": {"rainfall": stat},
        "arch": arch,
        "factor": factor,
        "fine_shape": [H, W],
        "lat": ds["lat"].values.tolist(),
        "lon": ds["lon"].values.tolist(),
        "data_source": "indmet",
        "bilinear_rmse": bil_rmse,
        "srcnn_rmse": sr_rmse,
        "improvement_pct": imp,
        "best_val_loss": best_val,
        "seed": seed,
    }, CKPT)
    print(f"[ds-indmet] saved {CKPT}")
    return CKPT


def main():
    p = argparse.ArgumentParser(description="Train a real 0.25°→0.05° downscaler on INDmet truth")
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()
    t0 = time.time()
    train(epochs=args.epochs, hidden=args.hidden, lr=args.lr, batch=args.batch, seed=args.seed)
    print(f"[ds-indmet] done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
