# ClimaTwin India — Product Requirements (PRD)

> An AI-powered **digital twin of India's climate**, built on India's national datasets.
> Pilot: **Delhi-NCR**. Variables: **rainfall, tmax, tmin**. Horizon: **1–14 days**.
> This is a hackathon Proof-of-Concept for an ISRO problem statement. The tone of this
> document — and the product — is **honest over hyped**: every claim maps to an artifact,
> every metric is measured against a baseline, and limitations are stated plainly.

---

## 1. Vision & target users

### Vision
ClimaTwin is **not a forecast model** — it is a *digital twin*. A twin **mirrors a live
climate state, assimilates new observations, simulates forward, downscales to a finer grid,
and supports "what-if" perturbation**, then turns all of that into **decision-ready impacts**.
The forecaster is one component inside the loop, not the whole product. The entire system is
**operable in plain English** through an agentic "brain" console.

Core value chain:

```
mirror live state → assimilate observations → simulate forward
        → downscale to ~5 km → run what-if scenarios → decision-ready impacts
                          (all driveable in plain English)
```

### Target users
1. **Decision-makers** — agriculture / farm advisory (sowing windows, dryness) and urban-heat
   planning (heat-stress days, urban heat-island scenarios). They need plain-language answers
   and clear impact signals, not raw grids.
2. **Technical evaluators** — judges and reviewers who need to see honest validation: skill
   vs baselines, temporal splits, calibrated uncertainty, and provenance of every layer.

The product is deliberately designed so **both audiences are served by the same system**:
the brain console and impact badges speak to decision-makers; the Validation view and
provenance footer speak to evaluators.

---

## 2. Problem statement (ISRO PS framing)

India needs a **climate digital twin** — a living, observation-driven mirror of the
atmosphere over its territory that can be queried, simulated, perturbed, and downscaled,
built on **national data first** (IMD gridded + INSAT/ISRO), not foreign reanalysis as a
backbone. The reference shape is the same three-stage architecture as NVIDIA Earth-2 and the
EU's Destination Earth — **assimilate → forecast → downscale** — scaled honestly to
hackathon compute.

ClimaTwin answers that PS as a thin, **end-to-end vertical slice**: one pilot region
(Delhi-NCR), two physical quantities (rainfall + temperature, split as tmax/tmin),
short-term horizon (1–14 days), with the full twin loop present in code and a UI that makes
the twin concept tangible rather than abstract.

---

## 3. Functional requirements

### 3.1 Data
- **FR-D1** The canonical artifact is a cached `twin_cube.nc` with dims `(time, lat, lon)`,
  daily, on a common 0.25° grid over the Delhi-NCR bbox, vars `rainfall`, `tmax`, `tmin`,
  plus static `elevation` (real DEM).
- **FR-D2** Primary data is **national** (IMD gridded; INSAT-3D / MOSDAC). The default
  multi-year cube carries IMD rainfall + tmax/tmin and a **synthetic_demo LST** channel,
  honestly tagged as such. **Real INSAT-3D Land Surface Temperature is now genuinely
  integrated** — see FR-D6 — but only as a **read-only single-year (2020) regime**; the full
  multi-year cube has not yet had real LST fused into it (flagged out-of-distribution /
  roadmap). No synthetic layer is ever passed off as real.
- **FR-D3** Rainfall is modeled with a `log1p` transform; ocean/invalid cells masked to NaN.
- **FR-D4** Normalization stats and climatology are computed on **train years only**
  (`norm_stats.json`), then applied to val/test — no leakage.
- **FR-D5 (data-source switcher).** The system exposes **two selectable data regimes** through
  a single underlying validated model. Routing is by a `source` parameter on the API
  (default `synthetic`):
  - **`synthetic`** — the validated default: full ~2000–2023 IMD record + synthetic_demo LST.
    This is the regime every committed leaderboard metric is measured on.
  - **`insat_real`** — the **2020-only** regime carrying **real INSAT-3D LST** as an
    observation layer (loaded only when `data/twin_cube_2020.nc` is present).
  Switching is a **data-regime / provenance choice, not a second model** — the same ConvLSTM
  architecture serves both.
- **FR-D6 (real INSAT-3D LST, read-only 2020 regime).** A native MOSDAC client
  (`data/mosdac_client.py`) and a one-overpass-per-day downloader pull real INSAT-3D L2B LST
  granules; `data/ingest_insat.py` decodes the HDF5 granules (fill-value mask, scale/offset,
  Kelvin→°C, regrid to 0.25°). **366 real granules** (one per day of leap-year 2020, target
  ~0600 UTC) are fused into `data/twin_cube_2020.nc` with `lst_source="insat_real"` and a
  measured **`lst_coverage` of 0.6414** (the rest gap-filled, cloudy cells → daily spatial
  mean). LST is an **observation-only extra variable** — it is never forecast (`VARS` stays
  `[rainfall, tmax, tmin]` in both regimes). The 2020 regime is **read-only / PENDING** for
  forecasting until its dedicated ConvLSTM checkpoint (`convlstm_2020.pt`) is provided; until
  then forecast / what-if / twin requests on `insat_real` return an honest `pending` payload.

### 3.2 Forecast
- **FR-F1** `GET /forecast?date=&horizon=&model=&uncertainty=&samples=&source=` returns a
  forward forecast over the horizon for the three variables.
- **FR-F2** Default model is **`ensemble`** (synthetic regime), with graceful fallback chain
  **ensemble → convlstm → climatology**. On the `insat_real` regime the default is
  `convlstm` when its checkpoint exists, else the regime is read-only.
- **FR-F3** `uncertainty` toggles **conformal 90% prediction bands** (coverage verified ≈0.90).
  Uncertainty paths are served on the `synthetic` regime.
- **FR-F4** `GET /analog?date=&horizon=` returns an analog-day forecast (synthetic regime).
- **FR-F5** Forecast skill must be reported **relative to baselines** (persistence + climatology).
- **FR-F6 (Compare Models).** The Explore view can open a **Compare-Models** modal that fetches
  two forecasts (model A vs model B) for the **same date / variable / lead** and renders three
  side-by-side grids: **MODEL A | MODEL B | DIFF (A−B)**, with model pickers and a lead-day
  slider. The model list is taken from the active regime.

### 3.3 Twin loop
- **FR-T1** `GET /twin/run?date=&horizon=&assimilate=&model=&source=` runs the full loop:
  mirror → (optional) assimilate observations → simulate forward.
- **FR-T2** Assimilation is **simplified nudging** (`state = alpha*obs + (1-alpha)*state`,
  `alpha = 0.6`), honestly labelled as such — not full variational/Kalman.
- **FR-T3** `WS /ws/twin` streams live twin state (configurable `interval_ms` 120–3000) for
  the animated mirror→assimilate→simulate view with a live sync %.
- **FR-T4 (source-aware twin).** The twin core is **regime-aware**: one `ClimateTwin` class
  operates either regime with no code change, fitting its rain climatology over the regime's
  own train window (multi-year `cfg.SPLIT` for synthetic; a multi-year window for the 2020
  regime's SPI path so dryness anomalies stay meaningful — see §6).

### 3.4 What-if
- **FR-W1** `POST /whatif` accepts `{date, horizon, delta_temp, rain_factor, urban_polygon,
  urban_lst, model}` plus a `source` query, and returns a perturbed scenario, a **diff vs
  baseline**, and impact deltas.
- **FR-W2** Supported perturbations and ranges:
  - `delta_temp` ∈ **[-5, 8] °C** (uniform temperature shift)
  - `rain_factor` ∈ **[0, 3]** (rainfall multiplier)
  - `urban_polygon` + `urban_lst` ∈ **[0, 6] °C** (urban heat-island LST bump on a drawn area)
- **FR-W3** Perturbation is applied **before** the forward run, never to the output post-hoc.
- **FR-W4 (diff map).** The What-If view renders a **diverging diff heatmap** (Δ = scenario −
  baseline) for the selected variable, with a lead-day scrubber, a signed Δ legend, and impact
  deltas. On the `insat_real` regime the diff map is drawn over the **MOSDAC offline basemap**;
  read-only regimes surface the honest `pending` state. (LST falls back to `tmax` here, since
  LST is observation-only.)

### 3.5 Downscale
- **FR-S1** `GET /highres?date=&var=` and `GET /downscale?var=` return a finer-grid view
  (down to **0.05° ≈ 5 km**) of the requested variable.
- **FR-S2** `GET /downscale/diffusion?var=&samples=` returns a **diffusion-ensemble**
  super-resolution: bilinear → diffusion mean → uncertainty ±σ → real 0.05° truth, plus
  **individual stochastic realizations** (sample grids shown as SAMPLE 1 / SAMPLE 2 thumbnails).
- **FR-S3** Downscaling quality is reported against **bilinear** interpolation (see §3.6).
- **FR-S4** Shared analysis endpoints (`/downscale`, `/downscale/diffusion`, `/highres`) always
  operate on the **synthetic** INDmet 0.05° truth; a `source` param, where accepted, is used
  **only to validate the date range**, never to switch the underlying downscaling data.

### 3.6 Validation
- **FR-V1** `GET /validate?source=` returns the honest leaderboard: per-model metrics for the
  forecast horizon plus a per-cell error map.
- **FR-V2** Metrics include RMSE/MAE-style continuous skill **and** categorical rain skill
  (POD / FAR / CSI), each compared against persistence and climatology.
- **FR-V3** Splits are **temporal** (train/val/test by time), surfaced in the UI.

### 3.7 AI / agentic brain
- **FR-A1** `GET /ai?q=` and `GET /brain?q=&date=&source=` answer **plain-English** questions by
  orchestrating the twin's own endpoints (forecast, state, impacts) and returning a grounded
  natural-language answer. The brain is **source-aware** through injected context — its year
  bounds, dates, grid and model list auto-adapt to the active regime.
- **FR-A2** `GET /brain/anomaly?source=` runs an anomaly scan flagging unusual days against
  **train-set percentile thresholds** (regime-aware via the regime's split dates).
- **FR-A3** `GET /guide?view=&variable=&model=&date=&q=&source=` is an always-on, **context-aware
  guide** that explains the current view/variable/model to the user.
- **FR-A4** Supporting endpoints: `GET /health`, `GET /meta`, `GET /state?date=&source=`.

---

## 4. Non-functional requirements

- **NFR-1 Offline demo.** The live demo must run **fully offline** from cached
  `twin_cube.nc` + saved checkpoints. **No live IMD/MOSDAC download** during the demo. (The real
  INSAT-3D granules are pre-downloaded and pre-fused into `twin_cube_2020.nc`; the demo never
  touches MOSDAC live.)
- **NFR-2 Honesty.** Skill is always shown vs baselines; temporal splits enforced;
  uncertainty bands are **conformal and coverage-verified**; a **provenance footer / source
  switcher** labels every layer's data source — synthetic_demo LST is tagged as synthetic,
  real INSAT-3D LST is tagged real and scoped to 2020, and elevation is labelled real DEM.
  No fabricated metrics.
- **NFR-3 Config-driven region.** The pilot region lives in config; changing it rebuilds the
  cube with no code edits — this is the "scalable to national" property.
- **NFR-4 Latency / caching.** Common cases (today's state, default forecast) are precomputed
  and cached (source is part of the cache key) so the dashboard never lags during the demo.
  Responses are sized for the frontend (compact JSON / GeoJSON / PNG), not full float64 grids.
- **NFR-5 No browser storage.** No `localStorage`/`sessionStorage` in artifact-style
  components; UI state lives in React.
- **NFR-6 PoC footprint.** Laptop/Colab-runnable; no heavy distributed/cloud stack.

---

## 5. Feature inventory (6 views + console + extras)

Stack: **React + Vite + Tailwind + Leaflet + react-three-fiber + Framer Motion + Recharts**.

| # | View | What it does | Primary endpoints |
|---|------|--------------|-------------------|
| 1 | **Overview** | Mission hero, capabilities grid, live telemetry strip | `/health`, `/meta` |
| 2 | **Twin** | Animated **mirror → assimilate → simulate** with live sync %; reality \| twin \| drift heatmaps | `/twin/run`, `WS /ws/twin` |
| 3 | **Explore** | **9×13 grid** + time slider (past → forecast) + per-cell sparklines + forecast panel; **3D/2D toggle**, **Compare-Models** launcher, **INSAT-3D LST layer** | `/state`, `/forecast`, `/analog`, `/terrain` |
| 4 | **WhatIf** | Scenario presets + ΔTemp / rainfall% / urban-LST sliders + drawable urban polygon → **diff map** + impact deltas | `POST /whatif` |
| 5 | **Validation** | Honest leaderboard matrix + per-cell error map + metrics table | `/validate` |
| 6 | **Downscale** | Drag-to-reveal **bilinear vs SR-CNN**, resolution ladder (coarse → model → real 0.05°), **diffusion ensemble + individual realizations**, texture/spectrum/histogram panels | `/highres`, `/downscale`, `/downscale/diffusion` |

**Global Command Console** — English-in → agentic brain. Endpoints: `/ai`, `/brain`,
`/brain/anomaly`, `/guide`.

**Data-source switcher** (top-bar popover): pick between **synthetic** (IMD · Synthetic LST,
2000–2023) and **INSAT-3D** (IMD · real INSAT-3D LST, 2020). Shows each regime's LST
provenance tag, year window, and active/pending dot; switching re-routes every API call via
`?source=`.

**3D terrain view** (Explore, `insat_real` regime): a react-three-fiber canvas extrudes the
**real CartoDEM / Copernicus GLO-30 elevation** (vertical exaggeration ×1.6) and drapes the
selected variable — including the **real INSAT-3D LST** — over the relief, with orbit/zoom, a
procedural atmosphere/starfield backdrop, and a click marker. A **3D ↔ 2D toggle** switches to
the **MOSDAC offline basemap** (satellite-grey land, ADM1 boundaries, graticule, coverage
locator).

**WhatIf scenario presets:** `+2 °C heatwave`, `monsoon ×1.5`, `drought ×0.5`,
`urban heat island`.

**Extras:** Cmd+K command palette, Compare-Models modal, PNG export, uncertainty toggle,
0.05° hi-res toggle, rain particles, heat-stress pulse, dark/light theme.

---

## 5a. Visual gallery

> All screenshots live in `assets/pictures/`. Captions describe verified, on-screen behavior.

| ![Overview](../assets/pictures/01-overview-mission-control.png) | ![Twin](../assets/pictures/02-twin-free-run-drift.png) |
|---|---|
| **Overview / Mission Control** — globe, TWIN SYNC-PATH, live state tiles, 5-stage twin loop, capability cards | **Twin free-run drift** — sync gauge, drift-over-lead curve, Reality/Twin/Drift heatmaps, assimilate toggle |
| ![Explore](../assets/pictures/03-explore-map-tmax.png) | ![WhatIf](../assets/pictures/04-whatif-scenario-diff.png) |
| **Explore** — 9×13 Delhi-NCR Tmax grid over dark India map, cell popup, model select, timeline scrubber | **What-If scenario diff** — diverging Δ map, presets, ΔTemp/rainfall/urban sliders, impact deltas |
| ![Validation](../assets/pictures/05-validation-skill-leaderboard.png) | ![Downscale rainfall](../assets/pictures/06-downscale-rainfall-srcnn.png) |
| **Validation** — Tmax RMSE error map (2022–23 test), baseline-relative leaderboard, calibrated 90% coverage | **Downscale rainfall** — bilinear vs SR-CNN wipe (17.56%), resolution ladder, CorrDiff ensemble, DEM ablation, spectrum |
| ![Downscale tmin](../assets/pictures/07-downscale-tmin-diffusion.png) | ![Brain](../assets/pictures/08-command-console-brain.png) |
| **Downscale Tmin** — honest negative result: diffusion over-textures vs near-optimal bilinear | **Command Console** — grounded agentic brain answering "when to sow" with a 1-step SIMULATE plan + cited numbers |
| ![Compare Models](../assets/pictures/11-compare-models-modal.png) | ![Source switcher](../assets/pictures/12-source-switcher-insat.png) |
| **Compare Models modal** — Model A vs Model B + diff (A−B) map | **Data-source switcher** — synthetic (IMD · Synthetic LST, 2000–2023) vs INSAT-3D (IMD · real fused LST, 2020) |
| ![3D terrain](../assets/pictures/13-explore-3d-terrain-insat.png) | ![3D INSAT LST](../assets/pictures/14-explore-3d-insat-lst.png) |
| **Explore 3D** — real CartoDEM terrain relief (×1.6) with Tmax draped, INSAT-3D regime, orbit/zoom | **Explore 3D** — REAL INSAT-3D Land Surface Temperature (18.9–50.8 °C) draped on the CartoDEM terrain |
| ![2D MOSDAC LST](../assets/pictures/15-explore-2d-mosdac-lst.png) | ![WhatIf INSAT](../assets/pictures/16-whatif-insat-mosdac.png) |
| **Explore 2D** — MOSDAC OFFLINE basemap (ADM1 boundaries, graticule, locator) with the Delhi-NCR grid, INSAT-3D regime | **What-If on INSAT-3D** — SCENARIO DIFF ΔTmax over the MOSDAC basemap, presets + sliders + impact bar |

---

## 6. Impact / decision signals

Every forecast and what-if scenario surfaces the same explainable decision signals:

- **Dryness / SPI-lite index** — simplified standardized-precipitation-style dryness signal.
- **Heat-stress fraction** — fraction of cells with **Tmax > 40 °C**.
- **Sowing-window onset** — first day where **accumulated rainfall ≥ 20 mm**.
- **Mean rainfall** over the region/horizon.
- **Max tmax** over the region/horizon.

These are intentionally simple and explainable — a farm advisor or city planner can read them
without a meteorology background, and a what-if scenario reports the **delta** of each signal
versus the baseline.

> **Note on the 2020 regime's dryness signal.** In a single-year (2020) regime, a naive
> month-based split leaves the day-of-year climatology with no overlapping day-of-year between
> train and test, collapsing it toward ~0. The twin fixes its SPI / dryness path by fitting
> rain climatology over a **multi-year window** (the 2000–2018 train years) so every day-of-year
> has support and the standardized anomaly is meaningful.

---

## 7. Demo script (4–6 minutes)

> Goal: tell the **assimilate → forecast → downscale → what-if → ask-the-brain** story in one
> continuous click-path, then close on the **real INSAT-3D / 3D-terrain** beat. Runs **fully
> offline** from cache. Numbers below are the verified ones to point at on screen.

**0:00 — Overview (15s).**
Open on the **Overview** view. One line: *"This is a digital twin of India's climate over
Delhi-NCR — it mirrors the real atmosphere, simulates it forward, downscales it, and you can
talk to it in English."* Gesture at the live telemetry strip.

**0:15 — Twin loop (50s).**
Go to **Twin**. Press play. Narrate the three stages as they animate:
*mirror* the real state → *assimilate* observations (call it honestly a **simplified nudging
scheme**) → *simulate* forward. Point at the **live sync %** climbing, and flip between the
**reality / twin / drift** heatmaps. Key line: *"This is the loop — not just a predictor."*

**1:05 — Explore + forecast + compare (60s).**
Go to **Explore**. Scrub the **time slider** from past observations into the forecast horizon.
Hover a cell to show its **sparkline**. Open the forecast panel and toggle **uncertainty on**:
*"These are conformal 90% bands — and we verified coverage ≈ 0.90, so the band means what it
says."* Click **⊞ Compare Models** to drop the **Model A | Model B | DIFF (A−B)** modal:
*"Same date, same lead — see exactly where two models disagree."*

**2:05 — Validation, the honesty moment (70s).**
Go to **Validation**. This is the credibility beat — slow down here.
- Point at the leaderboard: **1-day rainfall ensemble RMSE = 7.35**, beating
  **persistence 9.41** and **climatology 8.08**. *"We beat both baselines — that's the bar."*
- Rain detection: **POD 0.64 / CSI 0.37**.
- Note the **temporal split** and the per-cell **error map**.
Line: *"Every number here is against a baseline, on a time-based split. No leakage, no cherry-picking."*

**3:15 — Downscale (55s).**
Go to **Downscale**. Use the **drag-to-reveal** slider between **bilinear** and **SR-CNN**.
Walk the resolution ladder coarse → model → **real 0.05° (~5 km)**. Show the **diffusion
ensemble** — point out the **individual stochastic realizations** alongside the mean and ±σ.
Point at the number: **diffusion FSS 0.82 vs bilinear 0.68**.
Line: *"This is the third Earth-2 stage — honest super-resolution, with an ensemble, not just upsampling."*

**4:10 — What-if (40s).**
Go to **WhatIf**. Click the **`+2 °C heatwave`** preset (or drag ΔTemp). Optionally draw an
**urban polygon** and add an urban-LST bump. Hit Run. Show the **diff map** (Δ = scenario −
baseline) and the **impact deltas** — heat-stress fraction (cells > 40 °C) jumping, dryness
index shifting. Line: *"Decision-makers don't read grids — they read 'more heat-stress days,
sowing window slips.'"*

**4:50 — Real satellite data + 3D (45s, the ISRO beat).**
Open the **data-source switcher** and flip to **INSAT-3D**. *"Same twin, now driven by real
ISRO satellite data — 366 real INSAT-3D LST granules for 2020, 64% real coverage."* In
**Explore**, switch to **3D**: the **real CartoDEM terrain** lifts the grid into relief and the
**real INSAT-3D Land Surface Temperature** drapes over it; orbit the camera. Toggle back to 2D
to show the **MOSDAC offline basemap**. Honest note: *"This regime is read-only — 2020 only,
LST is an observed layer we don't forecast — but it proves the real-satellite path end to end."*

**5:35 — Ask the brain (35s, the closer).**
Open the **Command Console** (Cmd+K). Type a plain-English question, e.g.
*"Is there a heat anomaly coming this week?"* — the agentic brain orchestrates the twin's own
endpoints and answers in English, and **`/brain/anomaly`** flags the day against the
**train 98th-percentile** threshold. Close: *"Built on India's data, validated honestly,
runs offline, and you can just ask it."*

> Buffer / fallback: if time runs short, drop the Downscale deep-dive to 20s, or fold the 3D
> beat into Explore. If anything is slow, note that everything is **cached** — the demo never
> touches a live download.

---

## 8. Out of scope / explicitly deferred

- **Scope is locked**: one pilot region (Delhi-NCR), two variables (rainfall + temperature as
  tmax/tmin), 1–14 day horizon. **No silent expansion** to all-India or many variables.
- **Real INSAT-3D LST is integrated but bounded.** It exists as a **read-only, single-year
  (2020) regime** (366 real granules, `lst_coverage` 0.6414), with LST as an **observation-only**
  layer that is never forecast. It is **read-only / PENDING** for forecasting until the
  `convlstm_2020.pt` checkpoint is provided. There is **no real-time INSAT** and **no multi-year
  real LST** — the full multi-year cube still serves a synthetic_demo LST channel, and fusing
  real LST into it is flagged out-of-distribution / roadmap.
- **Full data assimilation** (variational / Kalman) is out — the PoC uses simplified nudging.
- **Foreign reanalysis (ERA5 etc.)** is auxiliary only, never the backbone.
- **Live downloads during the demo** are out — demo runs entirely from cached
  `twin_cube.nc` + `twin_cube_2020.nc` + checkpoints.
- **Heavy infra** (full Earth-2 stack, distributed training, cloud SDKs) is out for the PoC.
- Deferred upgrades (per phasing): a forecasting checkpoint for the 2020 INSAT regime,
  multi-year real-LST fusion, richer impact indicators, FNO head, soil-moisture/drought layers
  — only after the P0 slice is solid.
