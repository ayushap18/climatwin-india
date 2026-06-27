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
- **FR-D2** Primary data is **national** (IMD gridded; INSAT/MOSDAC). Where INSAT-derived
  layers are synthetic in this PoC, they are **labelled "roadmap"**, never passed off as real.
- **FR-D3** Rainfall is modeled with a `log1p` transform; ocean/invalid cells masked to NaN.
- **FR-D4** Normalization stats and climatology are computed on **train years only**
  (`norm_stats.json`), then applied to val/test — no leakage.

### 3.2 Forecast
- **FR-F1** `GET /forecast?date=&horizon=&model=&uncertainty=&samples=` returns a forward
  forecast over the horizon for the three variables.
- **FR-F2** Default model is **`ensemble`**, with graceful fallback chain
  **ensemble → convlstm → climatology**.
- **FR-F3** `uncertainty` toggles **conformal 90% prediction bands** (coverage verified ≈0.90).
- **FR-F4** `GET /analog?date=&horizon=` returns an analog-day forecast (historical analogue).
- **FR-F5** Forecast skill must be reported **relative to baselines** (persistence + climatology).

### 3.3 Twin loop
- **FR-T1** `GET /twin/run?date=&horizon=&assimilate=&model=` runs the full loop:
  mirror → (optional) assimilate observations → simulate forward.
- **FR-T2** Assimilation is **simplified nudging** (`state = alpha*obs + (1-alpha)*state`),
  honestly labelled as such — not full variational/Kalman.
- **FR-T3** `WS /ws/twin` streams live twin state (configurable `interval_ms` 120–3000) for
  the animated mirror→assimilate→simulate view with a live sync %.

### 3.4 What-if
- **FR-W1** `POST /whatif` accepts `{date, horizon, delta_temp, rain_factor, urban_polygon,
  urban_lst, model}` and returns a perturbed scenario, a **diff vs baseline**, and impact deltas.
- **FR-W2** Supported perturbations and ranges:
  - `delta_temp` ∈ **[-5, 8] °C** (uniform temperature shift)
  - `rain_factor` ∈ **[0, 3]** (rainfall multiplier)
  - `urban_polygon` + `urban_lst` ∈ **[0, 6] °C** (urban heat-island LST bump on a drawn area)
- **FR-W3** Perturbation is applied **before** the forward run, never to the output post-hoc.

### 3.5 Downscale
- **FR-S1** `GET /highres?date=&var=` and `GET /downscale?var=` return a finer-grid view
  (down to **0.05° ≈ 5 km**) of the requested variable.
- **FR-S2** `GET /downscale/diffusion?var=&samples=` returns a diffusion-ensemble super-
  resolution with multiple samples.
- **FR-S3** Downscaling quality is reported against **bilinear** interpolation (see §3.6).

### 3.6 Validation
- **FR-V1** `GET /validate` returns the honest leaderboard: per-model metrics for the
  forecast horizon plus a per-cell error map.
- **FR-V2** Metrics include RMSE/MAE-style continuous skill **and** categorical rain skill
  (POD / FAR / CSI), each compared against persistence and climatology.
- **FR-V3** Splits are **temporal** (train/val/test by time), surfaced in the UI.

### 3.7 AI / agentic brain
- **FR-A1** `GET /ai?q=` and `GET /brain?q=&date=` answer **plain-English** questions by
  orchestrating the twin's own endpoints (forecast, state, impacts) and returning a grounded
  natural-language answer.
- **FR-A2** `GET /brain/anomaly` runs an anomaly scan flagging unusual days against
  **train-set percentile thresholds** (e.g. a heat day vs the train 98th-percentile Tmax).
- **FR-A3** `GET /guide?view=&variable=&model=&date=&q=` is an always-on, **context-aware
  guide** that explains the current view/variable/model to the user.
- **FR-A4** Supporting endpoints: `GET /health`, `GET /meta`, `GET /state?date=`.

---

## 4. Non-functional requirements

- **NFR-1 Offline demo.** The live demo must run **fully offline** from cached
  `twin_cube.nc` + saved checkpoints. **No live IMD/MOSDAC download** during the demo.
- **NFR-2 Honesty.** Skill is always shown vs baselines; temporal splits enforced;
  uncertainty bands are **conformal and coverage-verified**; a **provenance footer** labels
  every layer's data source (INSAT shown as "roadmap" when synthetic; elevation labelled
  real DEM). No fabricated metrics.
- **NFR-3 Config-driven region.** The pilot region lives in config; changing it rebuilds the
  cube with no code edits — this is the "scalable to national" property.
- **NFR-4 Latency / caching.** Common cases (today's state, default forecast) are precomputed
  and cached so the dashboard never lags during the demo. Responses are sized for the
  frontend (compact JSON / GeoJSON / PNG), not full float64 grids.
- **NFR-5 No browser storage.** No `localStorage`/`sessionStorage` in artifact-style
  components; UI state lives in React.
- **NFR-6 PoC footprint.** Laptop/Colab-runnable; no heavy distributed/cloud stack.

---

## 5. Feature inventory (6 views + console + extras)

Stack: **React + Vite + Tailwind + Leaflet + Framer Motion + Recharts**.

| # | View | What it does | Primary endpoints |
|---|------|--------------|-------------------|
| 1 | **Overview** | Mission hero, capabilities grid, live telemetry strip | `/health`, `/meta` |
| 2 | **Twin** | Animated **mirror → assimilate → simulate** with live sync %; reality \| twin \| drift heatmaps | `/twin/run`, `WS /ws/twin` |
| 3 | **Explore** | Leaflet **9×13 grid** + time slider (past → forecast) + per-cell sparklines + forecast panel | `/state`, `/forecast`, `/analog` |
| 4 | **WhatIf** | Scenario presets + ΔTemp / rainfall% / urban-LST sliders + drawable urban polygon → diff map + impact deltas | `POST /whatif` |
| 5 | **Validation** | Honest leaderboard matrix + per-cell error map + metrics table | `/validate` |
| 6 | **Downscale** | Drag-to-reveal **bilinear vs SR-CNN**, resolution ladder (coarse → model → real 0.05°), diffusion ensemble, texture/spectrum/histogram panels | `/highres`, `/downscale`, `/downscale/diffusion` |

**Global Command Console** — English-in → agentic brain. Endpoints: `/ai`, `/brain`,
`/brain/anomaly`, `/guide`.

**WhatIf scenario presets:** `+2 °C heatwave`, `monsoon ×1.5`, `drought ×0.5`,
`urban heat island`.

**Extras:** Cmd+K command palette, compare modal, PNG export, uncertainty toggle,
0.05° hi-res toggle, rain particles, heat-stress pulse, dark/light theme.

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

---

## 7. Demo script (4–6 minutes)

> Goal: tell the **assimilate → forecast → downscale → what-if → ask-the-brain** story in one
> continuous click-path. Runs **fully offline** from cache. Numbers below are the verified
> ones to point at on screen.

**0:00 — Overview (15s).**
Open on the **Overview** view. One line: *"This is a digital twin of India's climate over
Delhi-NCR — it mirrors the real atmosphere, simulates it forward, downscales it, and you can
talk to it in English."* Gesture at the live telemetry strip.

**0:15 — Twin loop (60s).**
Go to **Twin**. Press play. Narrate the three stages as they animate:
*mirror* the real state → *assimilate* observations (call it honestly a **simplified nudging
scheme**) → *simulate* forward. Point at the **live sync %** climbing, and flip between the
**reality / twin / drift** heatmaps. Key line: *"This is the loop — not just a predictor."*

**1:15 — Explore + forecast (60s).**
Go to **Explore**. Scrub the **time slider** from past observations into the forecast horizon.
Hover a cell to show its **sparkline**. Open the forecast panel and toggle **uncertainty on**:
*"These are conformal 90% bands — and we verified coverage ≈ 0.90, so the band means what it
says."*

**2:15 — Validation, the honesty moment (75s).**
Go to **Validation**. This is the credibility beat — slow down here.
- Point at the leaderboard: **1-day rainfall ensemble RMSE = 7.35**, beating
  **persistence 9.41** and **climatology 8.08**. *"We beat both baselines — that's the bar."*
- Rain detection: **POD 0.64 / CSI 0.37**.
- Note the **temporal split** and the per-cell **error map**.
Line: *"Every number here is against a baseline, on a time-based split. No leakage, no cherry-picking."*

**3:30 — Downscale (60s).**
Go to **Downscale**. Use the **drag-to-reveal** slider between **bilinear** and **SR-CNN**.
Walk the resolution ladder coarse → model → **real 0.05° (~5 km)**. Show the diffusion ensemble
and the texture/spectrum panel. Point at the number: **diffusion FSS 0.82 vs bilinear 0.68**.
Line: *"This is the third Earth-2 stage — honest super-resolution, not just upsampling."*

**4:30 — What-if (45s).**
Go to **WhatIf**. Click the **`+2 °C heatwave`** preset (or drag ΔTemp). Optionally draw an
**urban polygon** and add an urban-LST bump. Hit Run. Show the **diff map** and the
**impact deltas** — heat-stress fraction (cells > 40 °C) jumping, dryness index shifting.
Line: *"Decision-makers don't read grids — they read 'more heat-stress days, sowing window slips.'"*

**5:15 — Ask the brain (45s, the closer).**
Open the **Command Console** (Cmd+K). Type a plain-English question, e.g.
*"Is there a heat anomaly coming this week?"* — the agentic brain orchestrates the twin's own
endpoints and answers in English, and **`/brain/anomaly`** flags the day against the
**train 98th-percentile** threshold. Close: *"Built on India's data, validated honestly,
runs offline, and you can just ask it."*

> Buffer / fallback: if time runs short, drop the Downscale deep-dive to 20s. If anything is
> slow, note that everything is **cached** — the demo never touches a live download.

---

## 8. Out of scope / explicitly deferred

- **Scope is locked**: one pilot region (Delhi-NCR), two variables (rainfall + temperature as
  tmax/tmin), 1–14 day horizon. **No silent expansion** to all-India or many variables.
- **INSAT/MOSDAC live fusion** is **roadmap** — synthetic INSAT-derived layers are labelled as
  such in the provenance footer, not presented as operational real data.
- **Full data assimilation** (variational / Kalman) is out — the PoC uses simplified nudging.
- **Foreign reanalysis (ERA5 etc.)** is auxiliary only, never the backbone.
- **Live downloads during the demo** are out — demo runs entirely from cached
  `twin_cube.nc` + checkpoints.
- **Heavy infra** (full Earth-2 stack, distributed training, cloud SDKs) is out for the PoC.
- Deferred upgrades (per phasing): INSAT LST fusion, richer impact indicators, FNO head,
  soil-moisture/drought layers — only after the P0 slice is solid.
