# ClimaTwin India 🌦️

**An AI-powered digital twin of India's climate — built on India's own data (IMD + ISRO/INSAT).**

Not a forecast model — a **digital twin**: it mirrors a live gridded climate state,
**assimilates** observations, **simulates** forward with a trained neural model,
**downscales**, and runs **"what-if"** scenarios with decision-ready impacts.
Pilot region **Delhi-NCR**, variables **rainfall + Tmax/Tmin**, 1–14 day horizon.
ISRO problem-statement PoC.

## Why it's different

- **A real twin, not a CNN + chart** — the full loop is in code: `initialize` (mirror) ·
  `assimilate` (nudging) · `step` (forward sim) · `whatif` (perturb) · `impacts` (decide).
- **Indigenous data, end-to-end** — real **IMD** gridded + **INSAT-3D LST via MOSDAC**
  (Atmanirbhar; no foreign backbone).
- **Mirrors NVIDIA Earth-2 / EU DestinE** — same three stages: **assimilate → forecast → downscale**.
- **Decision-ready + honest** — drought / heat-stress / sowing-window impacts, MC-dropout
  uncertainty bands, and skill always reported **relative to baselines**.
- **Scalable by construction** — the pilot region is one line in `config.py`.

## Quickstart

```bash
make install      # Python 3.13 venv + deps (torch + tensorflow + geo stack)
make data-lst     # real IMD cube + INSAT LST fusion  (or `make data` = offline synthetic)
make train        # ConvLSTM forecaster   (GPU: notebooks/ClimaTwin_Colab.ipynb)
make downscale    # SR-CNN 1°→0.25° downscaler
make validate     # metrics vs persistence + climatology baselines
make serve        # FastAPI on http://127.0.0.1:8000  (interactive docs at /docs)
```

> **Python 3.13** is required (TensorFlow has no 3.14 wheels). Heavy training runs on a free
> **Colab GPU** via `make bundle` → `notebooks/ClimaTwin_Colab.ipynb`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /meta` | grid, dates, models, data provenance, thresholds |
| `GET /state?date=` | observed twin state + impacts |
| `GET /forecast?model=&horizon=&uncertainty=` | roll-forward fields (+ MC-dropout std bands) |
| `POST /whatif` | perturb ΔTemp / rainfall× / urban polygon → diff map + impacts |
| `GET /downscale?var=` | coarse vs bilinear vs SR-CNN + improvement % |
| `GET /validate` | baseline-relative metrics (RMSE/MAE/corr, POD/FAR/CSI) |

## Results (real IMD, temporal test split, baseline-relative)

GPU-trained, RMSE — **best in bold**:

| Lead | rainfall | tmax | tmin |
|---|---|---|---|
| 1-day | **convlstm 7.27** (clim 8.08, persist 9.41) | persist 1.59 ≈ convlstm 1.60 | **convlstm 1.18** |
| 3-day | **convlstm 8.01** | persist 2.74 | clim 1.95 |

ConvLSTM **beats both baselines on rainfall (1d, 3d) and Tmin (1d)**; long-lead temperature goes
to climatology (expected). SR-CNN downscaler beats bilinear by **14.4%** on rainfall.

## Stack

Python · PyTorch · xarray/netCDF4 · imdlib · h5py · scikit-learn · FastAPI ·
(frontend: React + Vite + Leaflet — in progress). Data: **IMD**, **MOSDAC/INSAT** (ISRO).

## Status

✅ Data pipeline · baselines · ConvLSTM (+INSAT-LST fusion, uncertainty) · SR-CNN · twin loop ·
validation · FastAPI — all working offline on real IMD data.
🔜 React dashboard (map + time slider + what-if) · real MOSDAC INSAT granules · deck & demo.

## Honesty notes

Skill is always vs persistence/climatology baselines; splits are **temporal** (no leakage); the
demo runs **offline** from a cached cube. The INSAT LST layer is currently a clearly-tagged
`synthetic_demo` placeholder (the real MOSDAC ingestion path is built and ready); elevation is a
placeholder pending CartoDEM.

---

*Build the loop. Use India's data. Validate honestly. — ClimaTwin India*
