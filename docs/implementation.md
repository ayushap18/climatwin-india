# Implementation — Roadmap, Build Order & Rubric Mapping

This is the operational map for ClimaTwin India: the order things get built, the
commands to build them, the one rule you must never break, where each phase
stands today, and how every evaluation row maps to a concrete artifact.

Tone here is deliberately honest. Where something is synthetic, partial, or
blocked, it says so. No hype.

---

## 1. Build order & dependency chain

Each step depends on the prior one. You cannot meaningfully validate a model
before the cube exists; you cannot fit the ensemble before the ConvLSTM and the
analog method exist; you cannot serve the twin before validation is trustworthy.

```
config.py
   │
   ▼
data cube  (twin_cube.nc + norm_stats.json)
   │
   ▼
baselines  (persistence, climatology)
   │
   ▼
ConvLSTM   (two-head forecaster)
   │
   ▼
analog     (k-NN historical match)
   │
   ▼
ensemble   (NNLS blend + split-conformal bands)
   │
   ▼
downscalers (SR-CNN + CorrDiff diffusion)
   │
   ▼
validate   (validation_metrics.json — skill vs baselines)
   │
   ▼
twin       (initialize → assimilate → step → whatif → impacts)
   │
   ▼
backend    (FastAPI + WebSocket)
   │
   ▼
frontend   (React dashboard, 6 views)
   │
   ▼
AI layer   (agentic brain + always-on guide)
```

Why this order:

- **config.py first** — region, years, and the temporal split are the single
  source of truth. Everything downstream reads from it. Changing the region must
  rebuild the cube with no code edits.
- **cube before models** — there is nothing to train on otherwise, and
  normalization stats (train-years only) are written alongside the cube.
- **baselines before the neural net** — you cannot claim skill you haven't
  measured against persistence and climatology.
- **analog + ensemble after ConvLSTM** — the stacked ensemble blends ConvLSTM,
  analog, and baselines; it cannot be fit until its members exist.
- **validate before twin/backend** — the twin assimilates and steps a state we
  only trust because validation says so.
- **AI layer last** — the brain and guide narrate and interpret a system that
  must already be correct underneath them.

---

## 2. Commands cheat-sheet

Grouped by what you're trying to do.

### Setup

```bash
make install     # Python 3.13 venv + dependencies
```

### Data

```bash
make data        # python -m data.build_cube --source auto
                 #   → twin_cube.nc + norm_stats.json
python -m data.ingest_indmet --vars rainfall tmax tmin --years 2000 2023
                 #   INDmet 0.05° download via remotezip range requests
python -m data.ingest_dem      # real elevation (CartoDEM / Copernicus GLO-30)
python -m data.ingest_insat    # INSAT LST
```

### Train

```bash
make train       # python -m models.train → convlstm.pt
python -m models.train_multihorizon --horizon 3 --epochs 80
                 #   rollout training, reduces 3–7 day drift
python -m models.ensemble --fit
                 #   NNLS blend + conformal bands → ensemble_weights.json
make downscale   # SR-CNN super-resolution
```

### Validate

```bash
make validate    # python -m models.validate → validation_metrics.json
```

### Serve

```bash
make serve                       # uvicorn on :8000
cd frontend && npm install && npm run dev   # frontend on :5173
```

### GPU / Colab

```bash
python -m models.diffusion_downscale --var tmax --epochs 120     # Colab GPU
python -m models.diffusion_downscale --var tmin --epochs 120     # Colab GPU
python -m models.diffusion_downscale --var rainfall --epochs 120 # Colab GPU
```

---

## 3. THE GOLDEN RULE

> **After retraining the ConvLSTM, you MUST re-run `python -m models.ensemble
> --fit` AND `make validate`.**

The ensemble weights and the validation leaderboard are both derived *from* the
model. Retraining the ConvLSTM without refitting the ensemble leaves you blending
stale weights against fresh predictions; skipping revalidation means the metrics
you quote describe a model that no longer exists.

```
retrain ConvLSTM  ──▶  models.ensemble --fit  ──▶  make validate
   (convlstm.pt)        (ensemble_weights.json)    (validation_metrics.json)
```

If you change the model, all three artifacts move together. Never quote a number
from one that wasn't regenerated alongside the other two.

---

## 4. Phase plan — P0 / P1 / P2

Markers: ✅ done · ⏳ in flight · 🔭 future / blocked.

### P0 — must work (the thin vertical slice)

The minimum that makes this a digital twin and not a toy.

- ✅ Data cube (`twin_cube.nc` + `norm_stats.json`, train-years-only stats)
- ✅ Baselines (persistence + climatology)
- ✅ Two-head ConvLSTM forecaster (trained, on real elevation)
- ✅ Validation (`validation_metrics.json`, skill measured vs baselines)
- ✅ Twin loop (initialize → assimilate → step → whatif → impacts)
- ✅ Map + time slider (frontend)
- ✅ What-if perturbation

**P0 status: complete.** The end-to-end slice runs offline from the cached cube.

### P1 — upgrades, ordered by ROI

- ✅ Analog k-NN (historical-match member)
- ✅ Stacked ensemble + split-conformal bands (verified ~90% coverage)
- ✅ Real elevation (CartoDEM / Copernicus GLO-30)
- ✅ CorrDiff diffusion downscaler for **rainfall** (FSS 0.82 vs bilinear 0.68)
- ✅ Agentic brain + always-on guide (offline-first)
- ✅ Fine-tuned local LLM (QLoRA Qwen2.5-3B, optional)
- ✅ Full React dashboard (6 views) + real-time WebSocket twin replay
- ✅ Polished impact indicators
- ✅ Temperature hi-res diffusion **trained + evaluated** (honest negative result): on smooth
  temperature fields bilinear is already near-optimal (~0.12 °C RMSE vs diffusion ~0.28 °C) and the
  diffusion over-textures, so rainfall stays the served diffusion target — temperature is kept and
  labeled honestly for comparison
- ⏳ Multi-horizon rollout training (code ready, smoke-tested)
- ⏳ Fine-tuned LLM quality (re-export training data + retrain)
- 🔭 Real INSAT-3D LST fusion (MOSDAC data approval pending; currently a
  `synthetic_demo` placeholder — this is flagged honestly in the UI and docs)

### P2 — stretch (only with P0 + P1 solid)

- ✅ Uncertainty band (already delivered via conformal bands in P1)
- 🔭 FNO / transformer forecaster head
- 🔭 NICES soil-moisture / drought integration
- 🔭 Assimilation upgrade (EnKF-lite, replacing simple nudging)
- 🔭 All-India scale-out (config-driven — one line in `config.py`)

---

## 5. Rubric → artifact mapping

Every ISRO evaluation row maps to something concrete you can point at. If a row
ever lacks a real artifact, that's a gap to close before claiming the milestone.

| Rubric row | Concrete artifact |
|---|---|
| **Problem clarity** | Locked scope (one pilot region, two variables, 1–7 day horizon) defined in `config.py`; framing in `CLAUDE.md` and `docs/`. |
| **Data usage & preprocessing** | `data/build_cube.py` → `twin_cube.nc`; `ingest_indmet` (INDmet 0.05°), `ingest_dem` (real elevation), `ingest_insat` (LST); `norm_stats.json` computed train-years only; temporal split throughout. |
| **Model development** | Two-head ConvLSTM (`convlstm.pt`); analog k-NN; stacked ensemble (`ensemble_weights.json`); SR-CNN + CorrDiff diffusion downscalers; multi-horizon rollout training. |
| **Prediction performance & validation** | `make validate` → `validation_metrics.json`, skill measured against persistence + climatology baselines; rainfall diffusion FSS 0.82 vs bilinear 0.68; conformal bands at ~90% coverage. |
| **Digital twin concept** | `twin/climate_twin.py` — initialize / assimilate / step / whatif / impacts; real-time WebSocket twin replay. |
| **Visualization & UI** | React dashboard (6 views), map + time slider, what-if diff map + impact badges, validation tab. |
| **Innovation** | Agentic brain + always-on offline-first guide; fine-tuned local LLM (QLoRA Qwen2.5-3B); diffusion-based downscaling; conformal uncertainty. |
| **Presentation** | `docs/pptcontent.md` slide content; honest limitations stated (synthetic INSAT placeholder, short record, simplified assimilation). |

---

## 6. Future work & scale-out

Ordered roughly by value, with the honest blockers attached.

1. **Finish the in-flight items.** Multi-horizon rollout training (promote from
   smoke-tested to validated) and fine-tuned LLM quality (re-export data +
   retrain). (Temperature diffusion is already trained — bilinear won, kept
   honestly.) These are coded — they need
   compute and a validation pass, not new design. Remember the **golden rule**
   when rollout training lands: refit the ensemble and revalidate.

2. **Real INSAT-3D LST fusion.** Currently a `synthetic_demo` placeholder because
   MOSDAC data approval is pending. When access lands, `data.ingest_insat`
   becomes real and LST joins the cube as a genuine national-data input. Until
   then the placeholder is labelled as such — we do not present synthetic data as
   observed.

3. **FNO / transformer forecaster head.** A P2 model upgrade. Only worth it once
   the ConvLSTM + ensemble pipeline is fully validated, since it has to beat that
   bar to earn a place.

4. **NICES soil-moisture / drought.** Adds a decision-relevant variable for the
   impacts layer; depends on additional national data sources.

5. **Assimilation upgrade (EnKF-lite).** Replaces the simplified nudging scheme
   with an ensemble Kalman approach. Honest framing today is "simplified
   assimilation"; this is the path to making that claim stronger.

6. **All-India scale-out.** This is the deliberate payoff of keeping the region
   config-driven: scaling from the pilot box to national coverage is **one line
   in `config.py`** plus a cube rebuild — no code edits. It is engineered, not
   yet exercised at scale.

### Non-negotiable constraints (apply to all future work)

- Temporal splits only — never random-split a time series.
- Normalization, climatology, and conformal calibration on **train years only**.
- National data first; foreign / auxiliary data is never the backbone.
- The demo must run **offline** from the cached cube and saved checkpoints.
- Honesty over hype — state limitations; never dress up synthetic as observed.
- Region stays **config-driven** so scale-out remains a config change, not a
  rewrite.
