"""models/downscale.py — SR-CNN statistical downscaler (1deg -> 0.25deg).

CLAUDE.md §7 / architecture.md §4 "Downscaler (P1)".

HONEST METHOD DEMONSTRATOR (read this before claiming anything):
    The Delhi-NCR pilot grid is tiny at 0.25 deg (~9x13 cells), so there is very
    little spatial extent to "super-resolve". This module is therefore a *method
    demonstrator* of the Earth-2 / DestinE downscaling stage, not a production
    super-resolver. Its value is that it SCALES WITH THE REGION: change PILOT in
    config.py to a larger box and the same code learns a meaningful 4x SR map.

What is the honest SR target?
    Self-supervised SR pairs are built by coarsening a TRUE high-res field and
    learning to invert the coarsening. IMD provides genuine 0.25 deg *rainfall*
    ground truth, so RAINFALL is the honest default target. Temperature in the
    cube is interpolated up from ~1 deg station data and is therefore NOT real
    high-resolution detail — downscaling it would just be re-learning the
    interpolator, so it is not the default target (you can still pass var="tmax"
    for illustration, but we flag it as not genuinely high-res).

Pipeline (per day):
    fine_raw (H,W)  --block-mean factor 4 (handles non-divisible edges)-->  coarse (~1 deg)
    coarse          --bilinear upsample-->  bil_raw (H,W)        # the "coarse input"
    model input  = [ norm(bil_raw), norm(elevation) ]            # static elevation conditioning
    model output = bil_n + residual                              # residual learning on bilinear
    target       = norm(fine_raw)
Rainfall is modeled in log1p space (norm_stats.json) and outputs are clipped >= 0.

Splits are temporal (config.SPLIT); normalization stats are TRAIN-years only
(loaded from norm_stats.json, identical to the rest of the pipeline — no leakage).

API:
    train(var="rainfall", epochs=..., ...) -> saves models/checkpoints/downscale.pt
    Downscaler(checkpoint_path=None, cube=None)
        .downscale(coarse_2d) -> fine_2d        # 1 deg coarse field -> 0.25 deg
        .evaluate()           -> {bilinear_rmse, srcnn_rmse, improvement_pct}  (TEST split)

CLI:  python -m models.downscale [--var rainfall] [--epochs 80]
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import xarray as xr

import config as cfg
from models.convlstm import denorm_var, elevation_stats, norm_var

DEFAULT_FACTOR = 4  # 0.25 deg -> ~1 deg


# --------------------------------------------------------------------------- #
# Helpers.
# --------------------------------------------------------------------------- #
def _torch():
    import torch
    return torch


def _device() -> str:
    import torch
    return ("cuda" if torch.cuda.is_available()
            else "mps" if torch.backends.mps.is_available() else "cpu")


def block_mean_coarsen(field: np.ndarray, factor: int = DEFAULT_FACTOR) -> np.ndarray:
    """Block-mean downsample a (H,W) field to ~1/factor resolution.

    Handles non-divisible edges by averaging the (smaller) partial block.
    NaN-aware so masked ocean cells don't poison the average.
    """
    field = np.asarray(field, dtype="float32")
    H, W = field.shape
    ch = -(-H // factor)  # ceil
    cw = -(-W // factor)
    out = np.zeros((ch, cw), dtype="float32")
    for i in range(ch):
        for j in range(cw):
            block = field[i * factor:(i + 1) * factor, j * factor:(j + 1) * factor]
            if block.size == 0 or np.all(np.isnan(block)):
                out[i, j] = 0.0
            else:
                out[i, j] = float(np.nanmean(block))
    return out


def bilinear_to(coarse: np.ndarray, out_hw: tuple[int, int]) -> np.ndarray:
    """Bilinearly upsample a coarse (h,w) field to fine (H,W)."""
    import torch
    import torch.nn.functional as F

    t = torch.from_numpy(np.asarray(coarse, dtype="float32"))[None, None]
    up = F.interpolate(t, size=tuple(out_hw), mode="bilinear", align_corners=False)
    return up[0, 0].numpy().astype("float32")


def coarse_input(fine_raw: np.ndarray, factor: int = DEFAULT_FACTOR) -> np.ndarray:
    """Full coarsen->upsample roundtrip -> the bilinear baseline field at fine res."""
    out_hw = fine_raw.shape
    return bilinear_to(block_mean_coarsen(fine_raw, factor), out_hw)


def _rmse(a: np.ndarray, b: np.ndarray) -> float:
    m = ~(np.isnan(a) | np.isnan(b))
    if not m.any():
        return float("nan")
    return float(np.sqrt(np.mean((a[m] - b[m]) ** 2)))


# --------------------------------------------------------------------------- #
# Model: light residual SR-CNN.
# --------------------------------------------------------------------------- #
def build_module(in_ch: int = 2, hidden: int = 64):
    """Small 3-conv SR-CNN with residual learning on the bilinear input.

    Input  (B, in_ch, H, W) = [bilinear field (norm), elevation (norm)].
    Output (B, 1, H, W)     = bilinear channel + learned residual (norm space).
    """
    import torch.nn as nn

    class SRCNN(nn.Module):
        def __init__(self, ic=in_ch, hid=hidden):
            super().__init__()
            self.net = nn.Sequential(
                nn.Conv2d(ic, hid, 3, padding=1), nn.ReLU(inplace=True),
                nn.Conv2d(hid, hid, 3, padding=1), nn.ReLU(inplace=True),
                nn.Conv2d(hid, 1, 3, padding=1),
            )

        def forward(self, x):  # (B, in_ch, H, W)
            base = x[:, 0:1]            # the (normalized) bilinear field
            return base + self.net(x)  # residual learning

    return SRCNN()


# --------------------------------------------------------------------------- #
# Dataset construction.
# --------------------------------------------------------------------------- #
def _split_fields(ds: xr.Dataset, var: str, split: str) -> np.ndarray:
    y0, y1 = cfg.SPLIT[split]
    sub = ds[var].sel(time=slice(f"{y0}-01-01", f"{y1}-12-31"))
    return sub.values.astype("float32")  # (T, H, W)


def _make_pairs(fields: np.ndarray, elev_n: np.ndarray, stat: dict, factor: int, use_elev: bool = True):
    """fields: (T,H,W) raw. Returns X (T,C,H,W) with C=2 (bilinear+elevation) or C=1
    (bilinear only, for the no-DEM ablation), Y (T,1,H,W), bil_raw (T,H,W)."""
    T, H, W = fields.shape
    C = 2 if use_elev else 1
    X = np.zeros((T, C, H, W), dtype="float32")
    Y = np.zeros((T, 1, H, W), dtype="float32")
    bil_raw = np.zeros((T, H, W), dtype="float32")
    for t in range(T):
        b = coarse_input(fields[t], factor)
        bil_raw[t] = b
        X[t, 0] = norm_var(b, stat)
        if use_elev:
            X[t, 1] = elev_n
        Y[t, 0] = norm_var(fields[t], stat)
    return X, Y, bil_raw


def _load_context(cube=None):
    """Load (ds, norm, elev, elev_stat). Accepts an open Dataset or opens the cube."""
    ds = cube if cube is not None else xr.open_dataset(cfg.CUBE_PATH)
    norm = json.loads(cfg.NORM_STATS_PATH.read_text())
    elev = ds["elevation"].isel(time=0).values.astype("float32")
    elev_stat = elevation_stats(elev)
    return ds, norm, elev, elev_stat


# --------------------------------------------------------------------------- #
# Training.
# --------------------------------------------------------------------------- #
def train(var: str = "rainfall", epochs: int = 80, hidden: int = 64, lr: float = 2e-3,
          batch: int = 32, seed: int = 0, factor: int = DEFAULT_FACTOR, patience: int = 12,
          use_elev: bool = True, out_name: str = "downscale.pt"):
    """Train the SR-CNN. With use_elev=False the elevation (DEM) channel is dropped — the
    no-DEM arm of the ablation. Returns (bilinear_rmse, srcnn_rmse) on the TEST split."""
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    if var not in cfg.VARS:
        raise ValueError(f"var must be one of {cfg.VARS}, got {var!r}")
    if var != "rainfall":
        print(f"[downscale] WARNING: var={var!r} in the cube is interpolated from ~1 deg, "
              f"so this is NOT genuine high-res SR — rainfall is the honest target.")

    torch.manual_seed(seed)
    np.random.seed(seed)
    device = _device()
    print(f"[downscale] device={device}  var={var}  factor={factor}  DEM={'on' if use_elev else 'OFF'}")

    cfg.ensure_dirs()
    ds, norm, elev, elev_stat = _load_context()
    stat = norm[var]
    elev_n = norm_var(elev, elev_stat)

    tr_fields = _split_fields(ds, var, "train")
    va_fields = _split_fields(ds, var, "val")
    Xtr, Ytr, _ = _make_pairs(tr_fields, elev_n, stat, factor, use_elev)
    Xva, Yva, _ = _make_pairs(va_fields, elev_n, stat, factor, use_elev)
    print(f"[downscale] train days={len(Xtr)}  val days={len(Xva)}  grid={elev.shape}")

    tr = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(Ytr)),
                    batch_size=batch, shuffle=True)
    va = DataLoader(TensorDataset(torch.from_numpy(Xva), torch.from_numpy(Yva)),
                    batch_size=batch)

    arch = {"in_ch": 2 if use_elev else 1, "hidden": hidden}
    model = build_module(**arch).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    lossf = torch.nn.MSELoss()

    best_val = float("inf")
    best_state = None
    bad = 0
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
            best_val = vl
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
            flag = " *"
        else:
            bad += 1
        if ep % 10 == 0 or flag or ep == 1:
            print(f"[downscale] epoch {ep:3d}  train={tl:.4f}  val={vl:.4f}{flag}")
        if bad >= patience:
            print(f"[downscale] early stop at epoch {ep} (best val={best_val:.4f})")
            break

    if best_state is not None:
        model.load_state_dict(best_state)

    # ---- TEST-split skill vs bilinear baseline (physical units) ----------
    bil_rmse, sr_rmse = _eval_model(model, ds, var, elev_n, stat, factor, device, use_elev)
    imp = 100.0 * (bil_rmse - sr_rmse) / bil_rmse if bil_rmse else float("nan")
    print(f"[downscale] TEST  bilinear_rmse={bil_rmse:.4f}  srcnn_rmse={sr_rmse:.4f}  "
          f"improvement={imp:.1f}%")

    cfg.CKPT_DIR.mkdir(parents=True, exist_ok=True)
    out = cfg.CKPT_DIR / out_name
    torch.save({
        "state_dict": best_state or model.state_dict(),
        "var": var,
        "norm": {var: stat},
        "elev_stat": elev_stat,
        "elevation": elev.tolist(),
        "arch": arch,
        "factor": factor,
        "use_elev": use_elev,
        "data_source": ds.attrs.get("data_source", "unknown"),
        "bilinear_rmse": bil_rmse,
        "srcnn_rmse": sr_rmse,
        "best_val_loss": best_val,
        "seed": seed,
    }, out)
    print(f"[downscale] saved {out}")
    return bil_rmse, sr_rmse


def _eval_model(model, ds, var, elev_n, stat, factor, device, use_elev: bool = True):
    """Return (bilinear_rmse, srcnn_rmse) in physical units on the TEST split."""
    import torch

    fields = _split_fields(ds, var, "test")
    X, _, bil_raw = _make_pairs(fields, elev_n, stat, factor, use_elev)
    model.eval()
    with torch.no_grad():
        out_n = model(torch.from_numpy(X).to(device)).cpu().numpy()[:, 0]  # (T,H,W) norm
    sr = denorm_var(out_n, stat)
    if stat.get("transform") == "log1p":
        sr = np.clip(sr, 0.0, None)
    return _rmse(bil_raw, fields), _rmse(sr, fields)


# --------------------------------------------------------------------------- #
# Inference adapter.
# --------------------------------------------------------------------------- #
class Downscaler:
    """Loads a trained SR-CNN and downscales coarse fields to the 0.25 deg grid."""

    def __init__(self, checkpoint_path=None, cube=None):
        torch = _torch()
        ckpt_path = checkpoint_path or (cfg.CKPT_DIR / "downscale.pt")
        if not ckpt_path.exists():
            raise FileNotFoundError(
                f"no downscaler checkpoint at {ckpt_path}; run `python -m models.downscale`")
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        self.var = ckpt["var"]
        self.stat = ckpt["norm"][self.var]
        self.elev = np.array(ckpt["elevation"], dtype="float32")
        self.elev_stat = ckpt["elev_stat"]
        self.elev_n = norm_var(self.elev, self.elev_stat)
        self.factor = int(ckpt.get("factor", DEFAULT_FACTOR))
        self.bilinear_rmse = ckpt.get("bilinear_rmse")
        self.srcnn_rmse = ckpt.get("srcnn_rmse")
        self.data_source = ckpt.get("data_source", "unknown")
        self.model = build_module(**dict(ckpt.get("arch", {"in_ch": 2, "hidden": 64})))
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()
        self._cube = cube

    @property
    def fine_shape(self) -> tuple[int, int]:
        return self.elev.shape

    def downscale(self, coarse_2d: np.ndarray) -> np.ndarray:
        """Coarse (~1 deg) field -> 0.25 deg fine field on the pilot grid.

        ``coarse_2d`` may be at any coarse resolution; it is bilinearly upsampled
        to the pilot grid, then refined by the SR-CNN. Rainfall is clipped >= 0.
        """
        torch = _torch()
        bil_raw = bilinear_to(np.asarray(coarse_2d, dtype="float32"), self.fine_shape)
        x = np.stack([norm_var(bil_raw, self.stat), self.elev_n]).astype("float32")
        with torch.no_grad():
            out_n = self.model(torch.from_numpy(x[None]))[0, 0].numpy()
        fine = denorm_var(out_n, self.stat)
        if self.stat.get("transform") == "log1p":
            fine = np.clip(fine, 0.0, None)
        return fine.astype("float32")

    def evaluate(self) -> dict:
        """RMSE vs bilinear baseline on the TEST split (physical units)."""
        cube = self._cube if self._cube is not None else xr.open_dataset(cfg.CUBE_PATH)
        elev = cube["elevation"].isel(time=0).values.astype("float32")
        elev_n = norm_var(elev, elevation_stats(elev))
        bil, sr = _eval_model(self.model, cube, self.var, elev_n, self.stat, self.factor, "cpu")
        imp = 100.0 * (bil - sr) / bil if bil else float("nan")
        return {"bilinear_rmse": bil, "srcnn_rmse": sr, "improvement_pct": imp}


# --------------------------------------------------------------------------- #
# DEM ablation — does the OpenTopography elevation channel actually help?
# --------------------------------------------------------------------------- #
def ablation(var: str = "rainfall", epochs: int = 80, hidden: int = 64, lr: float = 2e-3,
             batch: int = 32, seed: int = 0, factor: int = DEFAULT_FACTOR) -> dict:
    """Train two SR-CNNs under IDENTICAL settings — one WITH the real DEM (elevation) channel,
    one WITHOUT — and compare TEST-split RMSE. Writes models/downscale_ablation.json. This is
    the honest 'does the OpenTopography elevation actually improve downscaling?' answer."""
    print("[ablation] === arm 1: WITH the real DEM (elevation channel) ===")
    bil_w, sr_with = train(var=var, epochs=epochs, hidden=hidden, lr=lr, batch=batch,
                           seed=seed, factor=factor, use_elev=True, out_name="downscale.pt")
    print("[ablation] === arm 2: WITHOUT the DEM (bilinear only) ===")
    bil_n, sr_no = train(var=var, epochs=epochs, hidden=hidden, lr=lr, batch=batch,
                         seed=seed, factor=factor, use_elev=False, out_name="downscale_noelev.pt")
    bil = (bil_w + bil_n) / 2.0  # bilinear is DEM-independent; average guards float drift
    imp_with = 100.0 * (bil - sr_with) / bil if bil else float("nan")
    imp_no = 100.0 * (bil - sr_no) / bil if bil else float("nan")
    dem_gain = 100.0 * (sr_no - sr_with) / sr_no if sr_no else float("nan")  # error cut by the DEM
    res = {
        "var": var, "bilinear_rmse": round(bil, 4),
        "srcnn_with_dem_rmse": round(sr_with, 4), "srcnn_no_dem_rmse": round(sr_no, 4),
        "improvement_with_dem_pct": round(imp_with, 1), "improvement_no_dem_pct": round(imp_no, 1),
        "dem_gain_pct": round(dem_gain, 1), "epochs": epochs, "seed": seed,
        "dem_source": "Copernicus GLO-30 (OpenTopography) / CartoDEM-class",
    }
    path = cfg.MODELS_DIR / "downscale_ablation.json"
    path.write_text(json.dumps(res, indent=2))
    print(f"[ablation] bilinear={bil:.4f}  with-DEM={sr_with:.4f} ({imp_with:.1f}%)  "
          f"no-DEM={sr_no:.4f} ({imp_no:.1f}%)  → DEM cuts SR error by {dem_gain:.1f}%")
    print(f"[ablation] wrote {path}")
    return res


# --------------------------------------------------------------------------- #
# CLI.
# --------------------------------------------------------------------------- #
def main():
    p = argparse.ArgumentParser(description="Train SR-CNN downscaler (1 deg -> 0.25 deg)")
    p.add_argument("--var", default="rainfall", choices=cfg.VARS)
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--factor", type=int, default=DEFAULT_FACTOR)
    p.add_argument("--ablation", action="store_true",
                   help="train with vs without the DEM and write downscale_ablation.json")
    args = p.parse_args()
    t0 = time.time()
    if args.ablation:
        ablation(var=args.var, epochs=args.epochs, hidden=args.hidden, lr=args.lr,
                 batch=args.batch, seed=args.seed, factor=args.factor)
    else:
        train(var=args.var, epochs=args.epochs, hidden=args.hidden, lr=args.lr,
              batch=args.batch, seed=args.seed, factor=args.factor)
    print(f"[downscale] done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
