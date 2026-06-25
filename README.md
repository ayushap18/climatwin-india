# ClimaTwin India — AI Digital Twin of India's Climate

ISRO problem-statement PoC. An end-to-end **digital twin** (not a forecast model) built
on India's national data: it mirrors a live gridded climate state, assimilates
observations, simulates forward with a trained neural model, downscales, and supports
**what-if** perturbation with decision-relevant impacts. Pilot region **Delhi-NCR**,
variables **rainfall + Tmax/Tmin**, short-term (1–14 day). See `CLAUDE.md` for the
locked design decisions, `files/` for full docs, `files/data_access.md` for the
verified ISRO/IMD acquisition playbook.

> Three-stage shape aligned with NVIDIA Earth-2 / EU DestinE: **assimilate → forecast → downscale**.

## Quickstart

```bash
make install          # py3.13 venv + deps (torch + tensorflow + geo/data stack)
source .venv/bin/activate

make data-lst         # real IMD cube + INSAT LST fusion  (make data = offline synthetic)
make train            # ConvLSTM forecaster -> models/checkpoints/convlstm.pt
make downscale        # SR-CNN downscaler   -> models/checkpoints/downscale.pt
make validate         # metrics (baselines + ConvLSTM) -> models/validation_metrics.json
make test             # end-to-end smoke test of every endpoint
make serve            # FastAPI on http://127.0.0.1:8000  (docs at /docs)
```

Heavy training on a laptop is slow — use **Google Colab GPU**:
```bash
make bundle           # -> climatwin_bundle.zip
# open notebooks/ClimaTwin_Colab.ipynb in Colab, upload the zip, Runtime > Run all,
# download climatwin_trained.zip, unzip into data/ + models/checkpoints/, then `make serve`.
```

> **Python 3.13** required: TensorFlow has no 3.14 wheels; 3.13 has wheels for *both*
> PyTorch and TensorFlow. Use `.venv/bin/python` for everything.

## Architecture

```
config.py ─► data/build_cube.py ──► twin_cube.nc ─► models/baselines.py ──┐
              ▲  └ data/ingest_insat.py (INSAT LST)        │               ├─► twin/climate_twin.py ─► backend/app.py
         (one region knob)                                 ├─ models/convlstm.py + train.py (ConvLSTM)   (FastAPI)
                                                           ├─ models/downscale.py (SR-CNN)
                                                           └─ models/validate.py
```

- **`config.py`** — single source of truth (region, grid, temporal split, paths).
  Change `PILOT` to rebuild everything for a new region with no code edits.
- **`data/build_cube.py`** — real IMD via `imdlib`, offline synthetic fallback, optional
  `--with-lst` INSAT fusion. Normalization stats on **train years only** (no leakage).
- **`data/ingest_insat.py`** — indigenous **INSAT-3D LST** layer: real MOSDAC `mdapi`
  HDF5 path **or** an offline `synthetic_demo` LST (honestly tagged) until credentials.
- **`models/baselines.py`** — persistence + climatology (the bars to beat).
- **`models/convlstm.py` + `train.py`** — ConvLSTM forecaster (PyTorch, CUDA/MPS). LST-aware
  input, log1p+wet-weighted rainfall loss, autoregressive rollout, **MC-dropout uncertainty**.
  Same `Forecaster` interface as the baselines → drops into the twin/backend unchanged.
- **`models/downscale.py`** — SR-CNN downscaler (1°→0.25°, residual-on-bilinear, elevation
  conditioned); evaluated on rainfall (true high-res ground truth) vs a bilinear baseline.
- **`twin/climate_twin.py`** — the twin loop: `initialize` (mirror) · `assimilate` (nudging)
  · `step` (forward sim) · `whatif` (perturb forcings) · `impacts` (dryness/heat/sowing).
- **`models/validate.py`** — RMSE/MAE/corr + POD/FAR/CSI on the **temporal test split**,
  skill relative to baselines, spatial error map.
- **`backend/app.py`** — FastAPI; precomputes & caches common cases.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | liveness + data provenance |
| GET | `/meta` | bbox, grid, dates, vars, models, `data_source`/`lst_source`, `has_lst`, `downscale_available`, thresholds |
| GET | `/state?date=` | observed twin state grid + impacts |
| GET | `/forecast?date=&horizon=&model=&uncertainty=&samples=` | roll-forward fields + impacts + sowing; `uncertainty=true` adds MC-dropout **std bands** (ConvLSTM) |
| POST | `/whatif` | perturb (ΔTemp / rain× / urban polygon) → scenario, diff, impacts |
| GET | `/downscale?date=&var=` | SR-CNN downscaling: coarse vs bilinear vs SR-CNN + improvement % |
| GET | `/validate` | cached validation metrics (baselines + ConvLSTM) |

```bash
curl "http://127.0.0.1:8000/forecast?model=convlstm&horizon=7&uncertainty=true&samples=30"
curl "http://127.0.0.1:8000/downscale?var=rainfall"
curl -X POST http://127.0.0.1:8000/whatif -H 'Content-Type: application/json' \
  -d '{"date":"2023-07-15","horizon":7,"delta_temp":3,"rain_factor":0.5,
       "urban_polygon":[[28.4,76.8],[28.4,77.6],[29.0,77.6],[29.0,76.8]],"urban_lst":2.5}'
```

## Validation (real IMD, temporal test split, baseline-relative)

A short 15-epoch local run (full training is the Colab notebook). RMSE, **best in bold**:

| Lead | rainfall | tmax | tmin |
|---|---|---|---|
| 1-day | **convlstm 7.33** (clim 8.08, persist 9.41) | **convlstm 1.56** (persist 1.59) | **convlstm 1.08** (persist 1.20) |
| 7-day | **convlstm 8.09** (clim 8.11) | clim 2.89 | clim 1.93 |

ConvLSTM **wins rainfall at every horizon and all three variables at 1-day**; climatology
still wins temperature at long lead (expected for a short run — the full GPU run closes it).
SR-CNN downscaler beats bilinear by **13.9%** on the rainfall test split.

## Honesty notes (CLAUDE.md §2.8)

- **Data provenance is surfaced in every response.** Default build is real **IMD** rainfall+temp
  (`data_source="imd"`); the INSAT **LST layer is `synthetic_demo`** (offline, plausible, tagged)
  until MOSDAC credentials are added — the real `mdapi` HDF5 ingestion path is built and ready.
- The **ConvLSTM is the default** behind `/forecast`; skill is always reported **relative to
  persistence/climatology baselines** — no skill claim without that comparison.
- Assimilation is a **simplified nudging** scheme (not variational/Kalman); the SR-CNN at
  0.25°/9×13 is an honest **method demonstrator** that scales with the region; elevation is a
  placeholder until CartoDEM. Limitations are stated, metrics are never fabricated.

## Next steps

Frontend (React + Vite + Leaflet): map + layer switch + time slider (past obs → forecast +
uncertainty band) + what-if panel (ΔTemp/rain sliders, draw-urban-area → diff map + impact
badges) + validation tab. Then: real MOSDAC INSAT granules, CartoDEM elevation, full Colab GPU
training. See `files/implementation.md`.
