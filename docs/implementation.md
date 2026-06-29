# Implementation — Roadmap, Build Order & Rubric Mapping

This is the operational map for ClimaTwin India: the order things get built, the
commands to build them, the one rule you must never break, where each phase
stands today, and how every evaluation row maps to a concrete artifact.

Tone here is deliberately honest. Where something is synthetic, partial, or
single-year, it says so. No hype.

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

- **config.py first** — region (Delhi-NCR), years, and the temporal split are the
  single source of truth. Everything downstream reads from it. Changing the region
  must rebuild the cube with no code edits.
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
                 #   → twin_cube.nc + norm_stats.json (synthetic_demo LST channel)
python -m data.ingest_indmet --vars rainfall tmax tmin --years 2000 2023
                 #   INDmet 0.05° download via remotezip range requests
python -m data.ingest_dem      # real elevation (CartoDEM / Copernicus GLO-30)

# Real INSAT-3D LST (read-only 2020 regime) — see §4 P1
python -m data.mosdac_client --daily --start 2020-01-01 --end 2020-12-31 --target 0600
                 #   one INSAT-3D LST overpass per day (~0600 UTC) via native MOSDAC client
python -m data.ingest_insat    # decode real L2B LST granules → 0.25° grid
python -m data.build_cube_2020 #   → twin_cube_2020.nc + norm_stats_2020.json (real LST fused)
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
python -m models.validate_regime   # single-year 2020 INSAT regime → validation_metrics_2020.json
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
- ✅ Downscale **individual ensemble realizations** surfaced in the UI (BILINEAR →
  DIFFUSION MEAN → ±σ uncertainty → REAL 0.05°, plus per-sample stochastic
  realizations + FSS/CRPS/spectrum metrics)
- ✅ Agentic brain + always-on guide (offline-first, now **source-aware** via the
  injected `ctx` — auto-adapts year bounds / models / dates per regime)
- ✅ Fine-tuned local LLM (QLoRA Qwen2.5-3B, optional)
- ✅ Full React dashboard (6 views) + real-time WebSocket twin replay
- ✅ Polished impact indicators
- ✅ **Real 3D terrain-relief map + 3D/2D toggle** — react-three-fiber canvas
  extruding real CartoDEM / Copernicus GLO-30 elevation (×1.6 exaggeration) with
  the selected variable draped + baked hillshade, orbit/zoom, 3D click marker,
  procedural atmosphere/starfield backdrop
- ✅ **Data-source switcher** (`synthetic` vs `insat_real`) — top-bar popover
  showing each regime's LST provenance, year-range window, and active/pending dot;
  routes the whole API via a single `source` param
- ✅ **Compare-Models modal** — Model A vs Model B vs diff (A−B) for the same
  date/var/lead, using the active regime's model list
- ✅ **What-If diff map** — diverging Δ heatmap (scenario − baseline) with lead-day
  scrub, impact deltas, urban-draw tool; renders over the MOSDAC offline basemap
  in the `insat_real` regime
- ✅ **Real INSAT-3D LST integrated as the read-only `insat_real` 2020 regime**
  (promoted from roadmap → done; see honesty box below)
- ✅ Temperature hi-res diffusion **trained + evaluated** (honest negative result): on smooth
  temperature fields bilinear is already near-optimal (~0.12 °C RMSE vs diffusion ~0.28 °C) and the
  diffusion over-textures, so rainfall stays the served diffusion target — temperature is kept and
  labeled honestly for comparison
- ⏳ Multi-horizon rollout training (code ready, smoke-tested)
- ⏳ Fine-tuned LLM quality (re-export training data + retrain)
- ⏳ `convlstm_2020.pt` for the `insat_real` regime — until the Colab checkpoint
  lands, that regime's forecast / whatif / twin paths return `pending` (read-only)

> **Honest scope of the real INSAT-3D integration.** This replaces the old
> "synthetic_demo placeholder awaiting MOSDAC approval" framing — real INSAT-3D
> Land Surface Temperature is genuinely integrated now, but only within a bounded
> scope:
> - It is a **read-only single-year (2020) regime** (`twin_cube_2020.nc`). The
>   native MOSDAC client + daily overpass downloader pulled **366 real
>   `3DIMG_*_L2B_LST_V01R00.h5` granules** (one per leap-year-2020 day, ~0600 UTC),
>   decoded and regridded to the 0.25° pilot grid and fused with real IMD
>   rainfall/tmax/tmin. Measured **`lst_coverage = 0.6414`** (the rest gap-filled
>   from cloudy/missing cells).
> - LST is an **observation-only layer**, never a forecast variable — `cfg.VARS`
>   stays `[rainfall, tmax, tmin]` in both regimes.
> - The **full multi-year `twin_cube.nc` still serves a `synthetic_demo` LST
>   channel** (and the committed full-range ConvLSTM was trained on it). Fusing
>   real LST into the full cube is flagged out-of-distribution / roadmap.
> - Not "real-time INSAT" and not multi-year real LST — single year, cached,
>   offline.
> - The `insat_real` regime is **read-only / PENDING** until `convlstm_2020.pt`
>   is provided from Colab; its forecast/whatif/twin endpoints honestly return a
>   `pending` payload until then.

### P2 — stretch (only with P0 + P1 solid)

- ✅ Uncertainty band (already delivered via conformal bands in P1)
- 🔭 FNO / transformer forecaster head
- 🔭 NICES soil-moisture / drought integration
- 🔭 Assimilation upgrade (EnKF-lite, replacing simple nudging)
- 🔭 All-India scale-out (config-driven — one line in `config.py`)

---

## 5. Visual tour — shipped features

All screenshots live in `assets/pictures/`. The first eleven are the core
dashboard; the last five (12–16) document the headline INSAT-3D / 3D-terrain work
that landed in P1.

### Core dashboard

![Overview / Mission Control](../assets/pictures/01-overview-mission-control.png)
*Overview / Mission Control: globe, TWIN SYNC-PATH (Reality → Twin Core → Impact), live state tiles, 5-stage twin loop, capability cards.*

![Twin free-run drift](../assets/pictures/02-twin-free-run-drift.png)
*Twin free-run drift: sync gauge, drift-over-lead curve, Reality/Twin/Drift Tmax heatmaps, assimilate toggle.*

![Explore — Tmax grid](../assets/pictures/03-explore-map-tmax.png)
*Explore: 9×13 Delhi-NCR Tmax grid over the dark India map, cell popup, model select, horizon + timeline scrubber.*

![What-If scenario diff](../assets/pictures/04-whatif-scenario-diff.png)
*What-If scenario diff: diverging Δ-rainfall map, presets, ΔTemp/rainfall/urban sliders, impact deltas.*

![Validation leaderboard](../assets/pictures/05-validation-skill-leaderboard.png)
*Validation: Tmax RMSE error map (2022–23 test), baseline-relative leaderboard, calibrated 90% coverage table.*

![Downscale rainfall](../assets/pictures/06-downscale-rainfall-srcnn.png)
*Downscale rainfall: bilinear vs SR-CNN wipe (17.56%), resolution ladder, CorrDiff ensemble, DEM ablation, spectrum.*

![Downscale Tmin diffusion](../assets/pictures/07-downscale-tmin-diffusion.png)
*Downscale Tmin: honest negative result — diffusion over-textures vs near-optimal bilinear.*

![Command Console brain](../assets/pictures/08-command-console-brain.png)
*Command Console: grounded agentic brain answering "when to sow" with a 1-step SIMULATE plan + cited numbers.*

![Guide assistant over Downscale](../assets/pictures/09-downscale-guide-assistant.png)
*Guide assistant panel open over the Downscale view.*

![Guide assistant panel](../assets/pictures/10-guide-assistant-panel.png)
*Close-up of the Guide assistant panel: jargon-free explainer + ask-me-anything box.*

![Compare Models modal](../assets/pictures/11-compare-models-modal.png)
*Compare Models modal: Model A vs Model B (climatology vs persistence) + diff (A−B), rainfall +1d.*

### INSAT-3D regime + 3D terrain (new in P1)

![Data-source switcher](../assets/pictures/12-source-switcher-insat.png)
*Data-source switcher popover: synthetic (IMD · Synthetic LST, 2000–2023) vs INSAT-3D (IMD · INSAT-3D LST, real fused LST, 2020) — both ACTIVE.*

![Explore 3D terrain — INSAT regime](../assets/pictures/13-explore-3d-terrain-insat.png)
*Explore 3D: real CartoDEM terrain relief (×1.6) with Tmax draped, INSAT-3D regime, ConvLSTM, orbit/zoom.*

![Explore 3D — real INSAT-3D LST](../assets/pictures/14-explore-3d-insat-lst.png)
*Explore 3D: REAL INSAT-3D Land Surface Temperature (18.9–50.8 °C, plasma colormap) draped on the CartoDEM terrain — the satellite-data headline.*

![Explore 2D — MOSDAC basemap](../assets/pictures/15-explore-2d-mosdac-lst.png)
*Explore 2D: MOSDAC OFFLINE basemap (ADM1 boundaries, graticule, coverage locator) with the Delhi-NCR grid, INSAT-3D regime.*

![What-If on the INSAT-3D regime](../assets/pictures/16-whatif-insat-mosdac.png)
*What-If on the INSAT-3D regime: SCENARIO DIFF ΔTmax over the MOSDAC basemap, presets + sliders + impact bar.*

---

## 6. Rubric → artifact mapping

Every ISRO evaluation row maps to something concrete you can point at. If a row
ever lacks a real artifact, that's a gap to close before claiming the milestone.

| Rubric row | Concrete artifact |
|---|---|
| **Problem clarity** | Locked scope (one pilot region — Delhi-NCR, two variables, 1–7 day horizon) defined in `config.py`; framing in `CLAUDE.md` and `docs/`. |
| **Data usage & preprocessing** | `data/build_cube.py` → `twin_cube.nc`; `ingest_indmet` (INDmet 0.05°), `ingest_dem` (real elevation); real INSAT-3D LST via `mosdac_client` + `ingest_insat` → `build_cube_2020.py` (`twin_cube_2020.nc`, 366 real granules, `lst_coverage 0.6414`); `norm_stats.json` computed train-years only; temporal split throughout. |
| **Model development** | Two-head ConvLSTM (`convlstm.pt`); analog k-NN; stacked ensemble (`ensemble_weights.json`); SR-CNN + CorrDiff diffusion downscalers; multi-horizon rollout training. |
| **Prediction performance & validation** | `make validate` → `validation_metrics.json`, skill measured against persistence + climatology baselines; rainfall diffusion FSS 0.82 vs bilinear 0.68; conformal bands at ~90% coverage; single-year 2020 regime scored separately in `validation_metrics_2020.json` (ConvLSTM vs persistence — see caveat below). |
| **Digital twin concept** | `twin/climate_twin.py` — initialize / assimilate / step / whatif / impacts; source-aware (`train_range` / `rain_clim`) so one twin class drives either regime; real-time WebSocket twin replay. |
| **Visualization & UI** | React dashboard (6 views), map + time slider, 3D CartoDEM terrain + 3D/2D toggle, data-source switcher, Compare-Models modal, what-if diff map + impact badges, validation tab, MOSDAC offline basemap. |
| **Innovation** | Real INSAT-3D LST fused into a read-only 2020 regime; agentic brain + always-on offline-first guide; fine-tuned local LLM (QLoRA Qwen2.5-3B); diffusion-based downscaling with ensemble realizations; conformal uncertainty. |
| **Presentation** | `docs/pptcontent.md` slide content; honest limitations stated (single-year/read-only real LST + synthetic LST in the full cube, short record, simplified assimilation). |

> **2020 regime caveat.** In `validation_metrics_2020.json`, the month-based
> single-year split (train Jan–Sep / test Nov–Dec) leaves train and test sharing
> **no overlapping day-of-year**, so the day-of-year climatology collapses toward
> ~0. Its RMSE numbers there are **artifacts, not skill** — present them only with
> this caveat. The meaningful comparison for that regime is **ConvLSTM vs
> persistence**. The dryness/SPI fix (fitting rain climatology over the multi-year
> `cfg.SPLIT["train"]` window via the twin's `train_range`/`rain_clim` mechanism)
> addresses the twin's SPI path so every day-of-year has support.

---

## 7. Future work & scale-out

Ordered roughly by value, with the honest blockers attached.

1. **Finish the in-flight items.** Multi-horizon rollout training (promote from
   smoke-tested to validated) and fine-tuned LLM quality (re-export data +
   retrain). (Temperature diffusion is already trained — bilinear won, kept
   honestly.) These are coded — they need compute and a validation pass, not new
   design. Remember the **golden rule** when rollout training lands: refit the
   ensemble and revalidate.

2. **Activate the `insat_real` regime's forecaster.** The read-only 2020 regime
   already serves real INSAT-3D LST, persistence, and climatology; it needs the
   `convlstm_2020.pt` checkpoint from Colab to lift the `pending` flag on its
   forecast/whatif/twin paths.

3. **Multi-year real INSAT-3D LST fusion into the full cube.** Today the full
   multi-year `twin_cube.nc` still serves a `synthetic_demo` LST channel; fusing
   real LST across all years is flagged out-of-distribution because the committed
   full-range ConvLSTM was trained on the synthetic channel. This is a download +
   retrain effort, not a redesign — the native MOSDAC client and decode path
   already exist.

4. **FNO / transformer forecaster head.** A P2 model upgrade. Only worth it once
   the ConvLSTM + ensemble pipeline is fully validated, since it has to beat that
   bar to earn a place.

5. **NICES soil-moisture / drought.** Adds a decision-relevant variable for the
   impacts layer; depends on additional national data sources.

6. **Assimilation upgrade (EnKF-lite).** Replaces the simplified nudging scheme
   with an ensemble Kalman approach. Honest framing today is "simplified
   assimilation"; this is the path to making that claim stronger.

7. **All-India scale-out.** This is the deliberate payoff of keeping the region
   config-driven: scaling from the pilot box to national coverage is **one line
   in `config.py`** plus a cube rebuild — no code edits. It is engineered, not
   yet exercised at scale.

### Non-negotiable constraints (apply to all future work)

- Temporal splits only — never random-split a time series.
- Normalization, climatology, and conformal calibration on **train years only**.
- National data first; foreign / auxiliary data is never the backbone.
- The demo must run **offline** from the cached cube and saved checkpoints.
- Honesty over hype — state limitations; never dress up synthetic as observed,
  and never overclaim the single-year read-only real-LST regime as more than it
  is.
- Region stays **config-driven** so scale-out remains a config change, not a
  rewrite.
