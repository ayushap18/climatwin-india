"""models/diffusion_downscale.py — CorrDiff-style residual-diffusion downscaler (0.25°→0.05°).

The deterministic SR-CNN (models/downscale_indmet.py) recovers ~1.7× more texture than
bilinear but LOSES ~7% on RMSE — the well-known "double-penalty": a blurry prediction wins
pixel RMSE while a sharp one (placed slightly wrong) is punished twice. That is exactly why
the SOTA (NVIDIA Earth-2 CorrDiff, DGMR) is GENERATIVE and is scored on SPATIAL/SPECTRAL
skill (power spectra, FSS, CRPS), not RMSE.

This module trains a conditional **residual diffusion** model on real INDmet 0.05° truth:
    mean      = bilinear(coarsen(true, ×5))                  # smooth Stage-1 prediction
    residual  = norm(true) − norm(mean)                      # the high-freq detail to generate
    diffusion : a small conditional U-Net learns to denoise the residual, CONDITIONED on the
                bilinear field; sampling yields an ENSEMBLE of plausible sharp 0.05° fields.
Everything in log1p-normalised rainfall space; norm stats are TRAIN-years-only (no leakage);
temporal split is config.SPLIT. DDPM (Ho et al.) training with a cosine schedule; DDIM-style
ancestral sampling for the ensemble.

Validation (the honest, RMSE-free story): radially-averaged power spectrum (does the ensemble
match the truth's spectrum where bilinear sags?), CRPS (probabilistic accuracy), FSS at a wet
threshold — all vs bilinear. RMSE is reported too, honestly, even though it is not the point.

Built for Colab GPU (auto cuda>mps>cpu). Heavy: ~train on Colab, not the MacBook.

CLI:  python -m models.diffusion_downscale --epochs 120
"""
from __future__ import annotations

import argparse
import math
import time
from typing import Tuple

import numpy as np
import xarray as xr

import config as cfg
from models.convlstm import norm_var, denorm_var
from models.downscale import bilinear_to, block_mean_coarsen, _rmse

INDMET_CUBE = cfg.DATA_DIR / "indmet_cube_005.nc"
CKPT = cfg.CKPT_DIR / "diffusion_downscale.pt"
FACTOR = 5            # 0.25° → 0.05°
PAD = (48, 64)        # pad 40×60 → 48×64 so the U-Net's 3 downsamples are clean
TIMESTEPS = 1000


# --------------------------------------------------------------------------- #
# device
# --------------------------------------------------------------------------- #
def _device():
    import torch
    return ("cuda" if torch.cuda.is_available()
            else "mps" if torch.backends.mps.is_available() else "cpu")


# --------------------------------------------------------------------------- #
# DDPM cosine schedule
# --------------------------------------------------------------------------- #
def _schedule(T: int = TIMESTEPS):
    import torch
    # Nichol & Dhariwal cosine alpha-bar
    s = 0.008
    t = torch.linspace(0, T, T + 1)
    ab = torch.cos(((t / T) + s) / (1 + s) * math.pi / 2) ** 2
    ab = ab / ab[0]
    betas = (1 - ab[1:] / ab[:-1]).clamp(1e-5, 0.999)
    alphas = 1.0 - betas
    abar = torch.cumprod(alphas, 0)
    return betas, alphas, abar


# --------------------------------------------------------------------------- #
# conditional U-Net (compact)
# --------------------------------------------------------------------------- #
def build_unet(base: int = 48):
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    def time_emb(t, dim):
        half = dim // 2
        freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / half)
        a = t[:, None].float() * freqs[None]
        return torch.cat([torch.sin(a), torch.cos(a)], dim=-1)

    class Res(nn.Module):
        def __init__(self, ci, co, tdim):
            super().__init__()
            self.n1 = nn.GroupNorm(8, ci); self.c1 = nn.Conv2d(ci, co, 3, padding=1)
            self.temb = nn.Linear(tdim, co)
            self.n2 = nn.GroupNorm(8, co); self.c2 = nn.Conv2d(co, co, 3, padding=1)
            self.skip = nn.Conv2d(ci, co, 1) if ci != co else nn.Identity()

        def forward(self, x, t):
            h = self.c1(F.silu(self.n1(x)))
            h = h + self.temb(t)[:, :, None, None]
            h = self.c2(F.silu(self.n2(h)))
            return h + self.skip(x)

    class UNet(nn.Module):
        """Input: [noisy_residual(1), cond_bilinear(1)] → predicts noise(1)."""
        def __init__(self, c=base, tdim=base * 4):
            super().__init__()
            self.tdim = tdim
            self.tmlp = nn.Sequential(nn.Linear(c, tdim), nn.SiLU(), nn.Linear(tdim, tdim))
            self.inp = nn.Conv2d(2, c, 3, padding=1)
            self.d1 = Res(c, c, tdim); self.d2 = Res(c, c * 2, tdim)
            self.dn = nn.AvgPool2d(2)
            self.m = Res(c * 2, c * 2, tdim)
            self.u2 = Res(c * 4, c, tdim); self.u1 = Res(c * 2, c, tdim)
            self.up = nn.Upsample(scale_factor=2, mode="nearest")
            self.out = nn.Sequential(nn.GroupNorm(8, c), nn.SiLU(), nn.Conv2d(c, 1, 3, padding=1))

        def forward(self, x, cond, t):
            te = self.tmlp(time_emb(t, self.tmlp[0].in_features))
            h = self.inp(torch.cat([x, cond], dim=1))
            s1 = self.d1(h, te)
            s2 = self.d2(self.dn(s1), te)
            m = self.m(self.dn(s2), te)
            h = self.u2(torch.cat([self.up(m), s2], dim=1), te)
            h = self.u1(torch.cat([self.up(h), s1], dim=1), te)
            return self.out(h)

    return UNet()


# --------------------------------------------------------------------------- #
# data
# --------------------------------------------------------------------------- #
def _split(da: xr.DataArray, split: str) -> np.ndarray:
    y0, y1 = cfg.SPLIT[split]
    return np.nan_to_num(da.sel(time=slice(f"{y0}-01-01", f"{y1}-12-31")).values.astype("float32"), nan=0.0)


def _train_norm(fine_train: np.ndarray) -> dict:
    x = np.log1p(np.clip(fine_train, 0, None))
    return {"mean": float(x.mean()), "std": float(x.std()) or 1.0, "transform": "log1p"}


def _pairs(fields: np.ndarray, stat: dict):
    """Return cond (T,1,H,W) norm-bilinear, resid (T,1,H,W) norm-residual, bil_raw (T,H,W)."""
    T, H, W = fields.shape
    cond = np.zeros((T, 1, H, W), "float32")
    resid = np.zeros((T, 1, H, W), "float32")
    bil_raw = np.zeros((T, H, W), "float32")
    for t in range(T):
        b = bilinear_to(block_mean_coarsen(fields[t], FACTOR), (H, W))
        bil_raw[t] = b
        cond[t, 0] = norm_var(b, stat)
        resid[t, 0] = norm_var(fields[t], stat) - norm_var(b, stat)
    return cond, resid, bil_raw


def _pad(a):  # (.,1,40,60) -> (.,1,48,64) reflect
    import torch.nn.functional as F
    import torch
    ten = a if torch.is_tensor(a) else torch.from_numpy(a)
    ph, pw = PAD[0] - ten.shape[-2], PAD[1] - ten.shape[-1]
    return F.pad(ten, (0, pw, 0, ph), mode="reflect")


def _crop(a, hw=(40, 60)):
    return a[..., : hw[0], : hw[1]]


# --------------------------------------------------------------------------- #
# train
# --------------------------------------------------------------------------- #
def train(epochs: int = 120, base: int = 48, lr: float = 2e-4, batch: int = 32, seed: int = 0):
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    if not INDMET_CUBE.exists():
        raise FileNotFoundError(f"no INDmet cube at {INDMET_CUBE}; run `python -m data.ingest_indmet --vars rainfall`")
    torch.manual_seed(seed); np.random.seed(seed)
    dev = _device()
    ds = xr.open_dataset(INDMET_CUBE); da = ds["rainfall"]
    H, W = ds.sizes["lat"], ds.sizes["lon"]
    print(f"[diffusion] device={dev} grid={H}×{W} pad→{PAD} T={TIMESTEPS} (real 0.05° truth)")

    tr = _split(da, "train"); va = _split(da, "val")
    stat = _train_norm(tr)
    c_tr, r_tr, _ = _pairs(tr, stat)
    c_va, r_va, _ = _pairs(va, stat)

    betas, alphas, abar = (x.to(dev) for x in _schedule())
    model = build_unet(base).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loader = DataLoader(TensorDataset(_pad(c_tr), _pad(r_tr)), batch_size=batch, shuffle=True)

    def loss_on(cond, resid):  # epsilon-prediction DDPM loss
        b = cond.shape[0]
        t = torch.randint(0, TIMESTEPS, (b,), device=dev)
        noise = torch.randn_like(resid)
        ab = abar[t][:, None, None, None]
        noisy = ab.sqrt() * resid + (1 - ab).sqrt() * noise
        pred = model(noisy, cond, t)
        return ((pred - noise) ** 2).mean()

    best = float("inf"); best_state = None
    cva, rva = _pad(c_va).to(dev), _pad(r_va).to(dev)
    for ep in range(1, epochs + 1):
        model.train(); tl = 0.0
        for cond, resid in loader:
            cond, resid = cond.to(dev), resid.to(dev)
            opt.zero_grad(); l = loss_on(cond, resid); l.backward(); opt.step()
            tl += l.item() * len(cond)
        sched.step()
        model.eval()
        with torch.no_grad():
            vl = float(np.mean([loss_on(cva[i:i+batch], rva[i:i+batch]).item()
                                for i in range(0, len(cva), batch)]))
        tl /= len(c_tr); flag = ""
        if vl < best - 1e-5:
            best, best_state = vl, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            flag = " *"
        if ep % 10 == 0 or ep == 1 or flag:
            print(f"[diffusion] epoch {ep:3d} train={tl:.4f} val={vl:.4f}{flag}")
    if best_state:
        model.load_state_dict(best_state)

    cfg.CKPT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": best_state or model.state_dict(), "base": base, "factor": FACTOR,
                "pad": PAD, "timesteps": TIMESTEPS, "norm": {"rainfall": stat},
                "fine_shape": [H, W], "lat": ds["lat"].values.tolist(),
                "lon": ds["lon"].values.tolist(), "data_source": "indmet",
                "best_val_loss": best, "seed": seed}, CKPT)
    print(f"[diffusion] saved {CKPT}")
    # honest spatial/spectral validation on TEST
    evaluate(model_state=best_state, base=base, n_samples=8)
    return CKPT


# --------------------------------------------------------------------------- #
# sampling
# --------------------------------------------------------------------------- #
def sample_ensemble(model, cond, abar, alphas, betas, dev, n: int, steps: int = 50):
    """DDIM-style sampling → (n, B, 1, Hp, Wp) residual samples (padded)."""
    import torch
    B = cond.shape[0]
    out = []
    ts = torch.linspace(TIMESTEPS - 1, 0, steps, device=dev).long()
    with torch.no_grad():
        for _ in range(n):
            x = torch.randn(B, 1, *PAD, device=dev)
            for i, t in enumerate(ts):
                tb = t.repeat(B)
                eps = model(x, cond, tb)
                ab = abar[t]
                x0 = (x - (1 - ab).sqrt() * eps) / ab.sqrt()
                if i < len(ts) - 1:
                    ab_next = abar[ts[i + 1]]
                    x = ab_next.sqrt() * x0 + (1 - ab_next).sqrt() * eps
                else:
                    x = x0
            out.append(x)
    return torch.stack(out)


# --------------------------------------------------------------------------- #
# validation: power spectrum, CRPS, FSS — the honest spatial story
# --------------------------------------------------------------------------- #
def _rapsd(field: np.ndarray) -> np.ndarray:
    """Radially-averaged power spectral density of a 2-D field."""
    f = np.fft.fftshift(np.fft.fft2(field - field.mean()))
    p = np.abs(f) ** 2
    h, w = field.shape
    cy, cx = h // 2, w // 2
    y, x = np.ogrid[:h, :w]
    r = np.hypot(y - cy, x - cx).astype(int)
    nbin = min(cy, cx)
    return np.array([p[r == k].mean() for k in range(1, nbin)])


def _crps_ens(ens: np.ndarray, obs: np.ndarray) -> float:
    """CRPS of an ensemble (n,H,W) vs obs (H,W), averaged over cells (lower better)."""
    n = ens.shape[0]
    term1 = np.abs(ens - obs[None]).mean(0)
    term2 = np.abs(ens[:, None] - ens[None, :]).mean((0, 1)) * 0.5
    return float((term1 - term2).mean())


def _fss(pred: np.ndarray, obs: np.ndarray, thr: float, scale: int = 3) -> float:
    """Fractions Skill Score at a wet threshold + neighbourhood (1=perfect)."""
    from scipy.ndimage import uniform_filter
    pf = uniform_filter((pred >= thr).astype("float32"), scale)
    of = uniform_filter((obs >= thr).astype("float32"), scale)
    num = np.mean((pf - of) ** 2)
    den = np.mean(pf ** 2) + np.mean(of ** 2)
    return float(1 - num / den) if den > 0 else 1.0


def evaluate(ckpt=None, model_state=None, base: int = 48, n_samples: int = 8, n_days: int = 120):
    """Spatial/spectral skill of the diffusion ensemble vs bilinear on the TEST split."""
    import torch
    dev = _device()
    ds = xr.open_dataset(INDMET_CUBE); da = ds["rainfall"]
    H, W = ds.sizes["lat"], ds.sizes["lon"]
    if ckpt is None and model_state is None:
        if not CKPT.exists():
            raise FileNotFoundError(CKPT)
        ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    stat = (ckpt or {}).get("norm", {}).get("rainfall") if ckpt else _train_norm(_split(da, "train"))
    model = build_unet(base).to(dev)
    model.load_state_dict(ckpt["state_dict"] if ckpt else model_state); model.eval()
    betas, alphas, abar = (x.to(dev) for x in _schedule())

    te = _split(da, "test")
    idx = np.linspace(0, len(te) - 1, min(n_days, len(te))).astype(int)
    te = te[idx]
    cond, _, bil = _pairs(te, stat)
    condp = _pad(cond).to(dev)
    samp = sample_ensemble(model, condp, abar, alphas, betas, dev, n_samples)  # (n,B,1,Hp,Wp)
    samp = _crop(samp).cpu().numpy()[:, :, 0]                                    # (n,B,H,W) residual
    # reconstruct ensemble of fine fields = denorm(norm(bilinear) + residual)
    base_n = np.stack([norm_var(bil[t], stat) for t in range(len(te))])         # (B,H,W)
    ens = np.clip(denorm_var(base_n[None] + samp, stat), 0, None)               # (n,B,H,W)
    mean = ens.mean(0)

    # RMSE (honest, not the point), CRPS, FSS, spectrum ratio
    bil_rmse = _rmse(bil, te); mean_rmse = _rmse(mean, te)
    crps = float(np.mean([_crps_ens(ens[:, t], te[t]) for t in range(len(te))]))
    thr = cfg.RAIN_WET_DAY_MM
    fss_d = float(np.mean([_fss(mean[t], te[t], thr) for t in range(len(te))]))
    fss_b = float(np.mean([_fss(bil[t], te[t], thr) for t in range(len(te))]))
    # spectral: average RAPSD, compare high-wavenumber energy to truth (1.0 = perfect)
    sp_t = np.mean([_rapsd(te[t]) for t in range(len(te))], 0)
    sp_b = np.mean([_rapsd(bil[t]) for t in range(len(te))], 0)
    sp_d = np.mean([_rapsd(mean[t]) for t in range(len(te))], 0)
    hi = slice(len(sp_t) // 2, None)  # high-wavenumber band
    spec_b = float(sp_b[hi].mean() / sp_t[hi].mean())
    spec_d = float(sp_d[hi].mean() / sp_t[hi].mean())
    print("[diffusion] TEST spatial/spectral skill (the honest story):")
    print(f"  RMSE        bilinear={bil_rmse:.3f}  diffusion={mean_rmse:.3f}  (RMSE is NOT the point)")
    print(f"  CRPS↓       diffusion ensemble={crps:.3f}")
    print(f"  FSS↑@{thr}mm bilinear={fss_b:.3f}  diffusion={fss_d:.3f}")
    print(f"  hi-wavenumber power vs truth (→1 best)  bilinear={spec_b:.2f}  diffusion={spec_d:.2f}")
    return {"bilinear_rmse": bil_rmse, "diffusion_rmse": mean_rmse, "crps": crps,
            "fss_bilinear": fss_b, "fss_diffusion": fss_d,
            "spec_bilinear": spec_b, "spec_diffusion": spec_d}


def main():
    p = argparse.ArgumentParser(description="CorrDiff-style residual-diffusion downscaler (INDmet 0.05°)")
    p.add_argument("--epochs", type=int, default=120)
    p.add_argument("--base", type=int, default=48)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-only", action="store_true")
    a = p.parse_args()
    t0 = time.time()
    if a.eval_only:
        evaluate(base=a.base)
    else:
        train(epochs=a.epochs, base=a.base, lr=a.lr, batch=a.batch, seed=a.seed)
    print(f"[diffusion] done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
