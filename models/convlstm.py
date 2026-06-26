"""models/convlstm.py — ConvLSTM spatiotemporal forecaster (PyTorch) + adapter.

Architecture (CLAUDE.md §7, architecture.md §4):
    input  (B, k, Cin, H, W)   k=7 history days
      -> ConvLSTM x2 (hidden 64), BatchNorm + dropout
      -> Conv2D head -> (B, 3, H, W)   next day [rainfall, tmax, tmin]
Trained 1-day-ahead; longer horizons via autoregressive rollout in the twin.
Rainfall is modeled in log1p space with a wet-cell-weighted loss.

Input channels are built dynamically:
    [rainfall(log1p,norm), tmax(norm), tmin(norm)]            (always, the 3 dynamic vars)
    + [lst(norm)]                                             (if INSAT LST is in the cube)
    + [elevation(norm, static)]
    + [sin(doy), cos(doy)]
So Cin = 6 (no LST) or 7 (with INSAT LST fusion). The exact channel list is stored in
the checkpoint so the adapter rebuilds the right input at inference.

Two inference modes on ``ConvLSTMForecaster``:
  * ``forecast``           — deterministic rollout (the Forecaster interface).
  * ``forecast_ensemble``  — MC-dropout ensemble -> mean + std (uncertainty bands).
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

import config as cfg
from config import RAIN, TMAX, TMIN
from models.baselines import Forecaster

OUT_CHANNELS = 3  # always predict [rainfall, tmax, tmin]


# --------------------------------------------------------------------------- #
# Feature engineering / normalization (shared by train.py and the adapter).
# --------------------------------------------------------------------------- #
def doy_features(date) -> tuple[float, float]:
    d = int(pd.Timestamp(date).dayofyear)
    ang = 2 * np.pi * d / 365.25
    return float(np.sin(ang)), float(np.cos(ang))


def norm_var(arr: np.ndarray, stat: dict) -> np.ndarray:
    x = arr.astype("float32")
    if stat.get("transform") == "log1p":
        x = np.log1p(np.clip(x, 0, None))
    return (x - stat["mean"]) / (stat["std"] or 1.0)


def denorm_var(arr: np.ndarray, stat: dict) -> np.ndarray:
    x = arr * (stat["std"] or 1.0) + stat["mean"]
    if stat.get("transform") == "log1p":
        x = np.clip(np.expm1(x), 0, None)
    return x


def elevation_stats(elev: np.ndarray) -> dict:
    return {"mean": float(np.mean(elev)), "std": float(np.std(elev)) or 1.0, "transform": "identity"}


def in_channels(has_lst: bool) -> int:
    return 3 + (1 if has_lst else 0) + 1 + 2  # dyn + lst? + elev + (sin,cos)


def build_input(window_dyn: np.ndarray, dates, elev: np.ndarray, norm: dict,
                elev_stat: dict, lst_window: Optional[np.ndarray] = None) -> np.ndarray:
    """window_dyn: (k,3,H,W) raw [rain,tmax,tmin]; lst_window: (k,H,W) raw LST or None.

    Returns (k, Cin, H, W) normalized input stack.
    """
    k, _, H, W = window_dyn.shape
    has_lst = lst_window is not None
    C = in_channels(has_lst)
    out = np.zeros((k, C, H, W), dtype="float32")
    out[:, 0] = norm_var(window_dyn[:, RAIN], norm["rainfall"])
    out[:, 1] = norm_var(window_dyn[:, TMAX], norm["tmax"])
    out[:, 2] = norm_var(window_dyn[:, TMIN], norm["tmin"])
    idx = 3
    if has_lst:
        out[:, idx] = norm_var(lst_window, norm["lst"])
        idx += 1
    elev_n = norm_var(elev, elev_stat)
    for i, dt in enumerate(dates):
        out[i, idx] = elev_n
        s, c = doy_features(dt)
        out[i, idx + 1] = s
        out[i, idx + 2] = c
    return out


# --------------------------------------------------------------------------- #
# Model.
# --------------------------------------------------------------------------- #
def _torch():
    import torch
    return torch


def build_module(in_ch: int = 6, hidden: int = 64, n_layers: int = 2, dropout: float = 0.1,
                 out_ch: int = OUT_CHANNELS):
    """out_ch=3 -> [rainfall, tmax, tmin]; out_ch=4 -> two-head rainfall
    [P(rain) logit, rain amount (log1p,norm), tmax, tmin]."""
    import torch
    import torch.nn as nn

    class _ConvLSTMCell(nn.Module):
        def __init__(self, ic, hid, kernel=3):
            super().__init__()
            self.hid = hid
            self.conv = nn.Conv2d(ic + hid, 4 * hid, kernel, padding=kernel // 2)

        def forward(self, x, h, c):
            z = self.conv(torch.cat([x, h], dim=1))
            i, f, o, g = torch.chunk(z, 4, dim=1)
            i, f, o, g = torch.sigmoid(i), torch.sigmoid(f), torch.sigmoid(o), torch.tanh(g)
            c = f * c + i * g
            return o * torch.tanh(c), c

    class ConvLSTMNet(nn.Module):
        def __init__(self, ic=in_ch, hid=hidden, out_ch=out_ch, layers=n_layers):
            super().__init__()
            self.hid, self.layers = hid, layers
            self.cells = nn.ModuleList(
                [_ConvLSTMCell(ic if i == 0 else hid, hid) for i in range(layers)])
            self.bn = nn.BatchNorm2d(hid)
            self.drop = nn.Dropout2d(dropout)
            self.head = nn.Conv2d(hid, out_ch, 1)

        def forward(self, x):  # (B, k, Cin, H, W)
            B, k, _, H, W = x.shape
            h = [x.new_zeros(B, self.hid, H, W) for _ in range(self.layers)]
            c = [x.new_zeros(B, self.hid, H, W) for _ in range(self.layers)]
            for t in range(k):
                inp = x[:, t]
                for li, cell in enumerate(self.cells):
                    h[li], c[li] = cell(inp, h[li], c[li])
                    inp = h[li]
            return self.head(self.drop(self.bn(h[-1])))

    return ConvLSTMNet()


# --------------------------------------------------------------------------- #
# Forecaster adapter (drops into the twin).
# --------------------------------------------------------------------------- #
class ConvLSTMForecaster(Forecaster):
    name = "convlstm"

    def __init__(self, checkpoint_path=None, cube=None):
        torch = _torch()
        ckpt_path = checkpoint_path or (cfg.CKPT_DIR / "convlstm.pt")
        if not ckpt_path.exists():
            raise FileNotFoundError(f"no ConvLSTM checkpoint at {ckpt_path}; run `make train`")
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        self.norm = ckpt["norm"]
        self.elev_stat = ckpt["elev_stat"]
        self.elev = np.array(ckpt["elevation"], dtype="float32")
        self.has_lst = bool(ckpt.get("has_lst", False))
        self.two_head = bool(ckpt.get("two_head", False))
        arch = dict(ckpt.get("arch", {}))
        arch.setdefault("in_ch", in_channels(self.has_lst))
        self.model = build_module(**arch)
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()

        # LST exogenous lookup: real LST in the conditioning window, climatology beyond.
        self._lst_clim = None  # (367, H, W)
        self._lst_index = None
        if self.has_lst and cube is not None and "lst" in cube:
            lst = cube["lst"]
            self._lst_dates = pd.to_datetime(cube["time"].values)
            self._lst_arr = lst.values.astype("float32")
            ty0, ty1 = cfg.SPLIT["train"]
            tr = lst.sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
            clim = tr.groupby("time.dayofyear").mean("time")
            table = np.zeros((367,) + self._lst_arr.shape[1:], dtype="float32")
            for i, d in enumerate(clim["dayofyear"].values):
                table[int(d)] = clim.values[i]
            table[366] = table[365]
            self._lst_clim = table
            self._lst_index = {str(t)[:10]: i for i, t in enumerate(self._lst_dates)}

    def _lst_for(self, date) -> Optional[np.ndarray]:
        if not self.has_lst:
            return None
        key = str(pd.Timestamp(date).date())
        if self._lst_index is not None and key in self._lst_index:
            return self._lst_arr[self._lst_index[key]]
        return self._lst_clim[int(pd.Timestamp(date).dayofyear)]  # future/unknown -> climatology

    def _forward(self, history: np.ndarray, target_date) -> np.ndarray:
        torch = _torch()
        k = history.shape[0]
        target = pd.Timestamp(target_date)
        dates = [target - pd.Timedelta(days=(k - i)) for i in range(k)]
        lst_win = None
        if self.has_lst:
            lst_win = np.stack([self._lst_for(d) for d in dates]).astype("float32")
        x = build_input(history.astype("float32"), dates, self.elev, self.norm, self.elev_stat, lst_win)
        xt = torch.from_numpy(x[None])
        with torch.no_grad():
            out = self.model(xt)[0].numpy()
        H, W = out.shape[-2:]
        pred = np.empty((3, H, W), dtype="float32")
        if self.two_head:
            # [P(rain) logit, amount(log1p,norm), tmax, tmin] -> expected rainfall = P(rain)*amount
            p = 1.0 / (1.0 + np.exp(-out[0]))
            amount = denorm_var(out[1], self.norm["rainfall"])  # expm1 + clip>=0
            pred[RAIN] = p * amount
            pred[TMAX] = denorm_var(out[2], self.norm["tmax"])
            pred[TMIN] = denorm_var(out[3], self.norm["tmin"])
        else:
            pred[RAIN] = denorm_var(out[RAIN], self.norm["rainfall"])
            pred[TMAX] = denorm_var(out[TMAX], self.norm["tmax"])
            pred[TMIN] = denorm_var(out[TMIN], self.norm["tmin"])
        return pred.astype("float32")

    def predict_step(self, history: np.ndarray, target_date) -> np.ndarray:
        return self._forward(history, target_date)

    # ---- uncertainty: MC-dropout ensemble --------------------------------
    def _set_dropout(self, on: bool):
        import torch.nn as nn
        for m in self.model.modules():
            if isinstance(m, (nn.Dropout, nn.Dropout2d)):
                m.train(on)

    def forecast_ensemble(self, history: np.ndarray, start_date, horizon: int, n_samples: int = 30):
        """MC-dropout ensemble. Returns (mean, std) each a list[horizon] of (3,H,W)."""
        self._set_dropout(True)
        traj = []  # (N, horizon, 3, H, W)
        for _ in range(n_samples):
            hist = [f for f in history]
            preds = []
            for h in range(1, horizon + 1):
                target = pd.Timestamp(start_date) + pd.Timedelta(days=h)
                nxt = self._forward(np.asarray(hist[-cfg.K_INPUT:]), target)
                nxt[RAIN] = np.clip(nxt[RAIN], 0.0, None)
                preds.append(nxt)
                hist.append(nxt)
            traj.append(preds)
        self._set_dropout(False)
        arr = np.asarray(traj)  # (N, h, 3, H, W)
        return list(arr.mean(0)), list(arr.std(0))
