# Architecture — ClimaTwin India

How the system is wired, the twin core, the model/algorithm flow, the AI layer, and the API.
This is the canonical "how it works" reference; the slide-level summary is in
[`pptcontent.md`](pptcontent.md), the data side in [`datasets.md`](datasets.md).

---

## 1 · System architecture (the working)

```mermaid
flowchart TB
    subgraph ING["📡 INGESTION — data/"]
        direction LR
        I1["build_cube.py<br/>IMD via IMDLIB"]
        I2["ingest_indmet.py<br/>INDmet 0.05° (remotezip)"]
        I3["ingest_dem.py<br/>real elevation"]
        I4["ingest_insat.py<br/>INSAT LST (MOSDAC · roadmap)"]
    end

    subgraph ART["🧊 ARTIFACTS — data/"]
        direction LR
        A1["twin_cube.nc<br/>(time × lat × lon)"]
        A2["norm_stats.json<br/>train-only"]
        A3["indmet_cube_005.nc<br/>0.05° truth"]
        A4["elevation_grid.npy"]
    end

    subgraph MOD["🧠 MODELS — models/"]
        direction LR
        M1["baselines.py<br/>persistence · climatology"]
        M2["analog.py<br/>k-NN"]
        M3["convlstm.py + train.py<br/>two-head ConvLSTM"]
        M4["ensemble.py<br/>NNLS + conformal"]
        M5["downscale*.py<br/>SR-CNN"]
        M6["diffusion_downscale.py<br/>CorrDiff"]
        M7["validate.py<br/>leaderboard"]
    end

    subgraph TW["🔁 TWIN — twin/climate_twin.py"]
        direction LR
        TW1["initialize · assimilate · step"]
        TW2["whatif · impacts · run_twin"]
    end

    subgraph BE["⚙️ BACKEND — backend/ (FastAPI)"]
        direction LR
        B1["app.py<br/>REST + /ws/twin"]
        B2["brain.py<br/>agentic"]
        B3["guide.py<br/>explainer"]
    end

    subgraph FE["🖥️ FRONTEND — frontend/ (React)"]
        direction LR
        F1["6 views + Command Console"]
    end

    ING --> ART
    A1 --> MOD
    A2 --> MOD
    A3 --> M5
    A3 --> M6
    A4 --> A1
    MOD --> TW
    TW --> BE
    MOD --> BE
    BE -->|/api · /ws| FE

    style ART fill:#0b3d91,color:#fff
    style TW fill:#ff8a3d,color:#000
```

**Three Earth-2 stages, mapped to code:**

| Stage | Where | What |
|---|---|---|
| **Assimilate** | `twin/climate_twin.py::assimilate` | simplified nudging `state = α·obs + (1−α)·state` (α=0.6) |
| **Forecast** | `models/` (ensemble of 5) | persistence · climatology · analog · ConvLSTM · stacked ensemble |
| **Downscale** | `models/downscale*.py`, `diffusion_downscale.py` | SR-CNN + CorrDiff diffusion, 0.25° → 0.05° |

---

## 2 · The forecast algorithm

```mermaid
flowchart TD
    H["7-day history<br/>(B, k=7, C, H, W)<br/>C = rain, tmax, tmin (+ elev, DOY sin/cos, [LST])"] --> ML

    subgraph ML["forecast members"]
        direction TB
        P["persistence"]
        C["climatology<br/>(day-of-year mean, train-only)"]
        AN["analog k-NN<br/>(25 nearest train days, DOY-gated)"]
        CV["ConvLSTM (two-head)"]
    end

    subgraph CVH["ConvLSTM heads"]
        direction LR
        HEAD1["P(rain) — BCE"]
        HEAD2["log1p amount — wet-masked MSE"]
        HEAD3["tmax, tmin — MSE/L1"]
    end
    CV --> CVH

    P --> ENS["stacked ensemble<br/>per-var/per-horizon NNLS blend"]
    C --> ENS
    AN --> ENS
    CV --> ENS

    ENS --> CONF["split-conformal<br/>90% prediction interval"]
    CONF --> OUT["forecast (B, h, 3, H, W)<br/>+ uncertainty band"]

    ENS --> VAL["validate on TEST 2022–23<br/>RMSE/MAE/corr + POD/FAR/CSI"]

    style CV fill:#0b3d91,color:#fff
    style ENS fill:#ff8a3d,color:#000
```

**Leakage-safe by construction:**
- ConvLSTM trained on **train years (≤2018)**; normalization stats train-only.
- Ensemble NNLS weights fit on **val 2019–20**; conformal half-widths calibrated on the **disjoint
  val 2021**; everything scored on **untouched test 2022–23**.
- The ensemble is the **default served model** (`ensemble > convlstm > climatology` fallback).

**Multi-horizon variant** (`models/train_multihorizon.py`): rolls the ConvLSTM forward H days
*inside the loss* (future LST from train-year day-of-year climatology — no leakage) so 3–7 day
forecasts drift less. Same checkpoint format; the backend picks it up unchanged.

---

## 3 · The twin loop (sequence)

```mermaid
sequenceDiagram
    participant U as User / API
    participant T as ClimateTwin
    participant C as twin_cube.nc
    participant F as Forecaster

    U->>T: run_twin(date, horizon, assimilate)
    T->>C: initialize(date) [MIRROR]
    C-->>T: state = observed grid
    loop each lead day h
        T->>F: step() [SIMULATE]
        F-->>T: predicted field
        T->>C: observation at day h
        C-->>T: reality field
        T->>T: divergence = RMSE, sync_pct
        alt assimilate = true
            T->>T: state = a*obs + (1-a)*state [ASSIMILATE]
        else free-run
            T->>T: state = twin prediction
        end
    end
    T-->>U: per day - twin, reality, divergence, sync_pct
```

**Twin core methods** (`twin/climate_twin.py`):

| Method | Stage | Does |
|---|---|---|
| `initialize(date)` | MIRROR | state ← observed cube at date |
| `assimilate(obs, α)` | ASSIMILATE | `state = α·obs + (1−α)·state` |
| `step(horizon)` | SIMULATE | roll forward autoregressively (rainfall floored at 0) |
| `whatif(ΔT, rain×, urban_mask, urban_lst)` | PERTURB | apply scenario before the run → `{baseline, scenario, diff}` |
| `impacts(field, date)` | DECIDE | dryness/SPI-lite · heat-stress fraction · max tmax · wet-cell fraction |
| `sowing_window(forecast)` | DECIDE | first lead day accumulated grid-mean rain ≥ 20 mm |
| `run_twin(date, horizon, assimilate)` | LOOP | mirror → per-day simulate/compare/advance |

---

## 4 · The AI layer (agentic brain)

```mermaid
flowchart LR
    Q["question (English)"] --> PL["PLANNER<br/>ordered steps + stage tags"]
    PL --> EX["EXECUTOR<br/>calls REAL twin tools"]
    EX --> CR["CRITIC<br/>citations resolve?<br/>skill claim backed by validate()?"]
    CR --> EXP["EXPLAINER<br/>1–3 sentences, [tool:field] cited"]
    EXP --> GD{"GROUNDING GUARD<br/>every number traceable?"}
    GD -->|pass| ANS["cited answer + caveat"]
    GD -->|fail| DRAFT["fall back to deterministic draft"]
    DRAFT --> ANS

    EXP -. optional .-> LLM["Ollama (OLLAMA_MODEL)<br/>REPHRASE ONLY — no new numbers"]
    LLM --> GD

    style GD fill:#ff8a3d,color:#000
    style EX fill:#0b3d91,color:#fff
```

- **Offline-first:** planner/executor/critic/explainer are plain Python — the demo works with **no
  LLM installed**. An optional Ollama model only *rephrases* grounded text; the guard rejects any
  untraceable number.
- **Tools the brain drives:** `state` (MIRROR) · `forecast` (SIMULATE) · `whatif` (PERTURB) ·
  `twin` (ASSIMILATE) · `validate` (SKILL).
- **Scope lock:** refuses other regions (Mumbai/Chennai/…), other variables (humidity/wind/AQI),
  horizons > 14 days, dates outside 2000–2023 — honestly, instead of fabricating.
- **`anomaly_scan`** autonomously flags heat (grid-peak Tmax vs train 98th-pct) or dryness (30-day
  accumulation vs train 5th-pct) using **train-only** thresholds, and suggests a question to ask.
- **`guide.py`** is the non-expert counterpart: per-view plain-language help + a glossary, grounded
  in the same tools; uses `OLLAMA_GUIDE_MODEL` (falls back to `OLLAMA_MODEL`, then deterministic).

---

## 5 · API reference

| Method | Path | Key params | Returns |
|---|---|---|---|
| GET | `/health` | — | status, data source, dates, region |
| GET | `/meta` | — | grid coords, vars, colorbar ranges, models, default model, thresholds, availability flags |
| GET | `/state` | `date?` | observed state grid + impacts |
| GET | `/highres` | `date?`, `var` | INDmet 0.05° observed field |
| GET | `/forecast` | `date?`, `horizon` 1–14, `model?`, `uncertainty`, `samples` 5–60 | roll-forward fields + impacts (+ uncertainty/conformal bands) |
| GET | `/analog` | `date?`, `horizon` 1–14 | analog forecast + matched past IMD days |
| POST | `/whatif` | `date?`, `horizon`, `delta_temp` −5..8, `rain_factor` 0..3, `urban_polygon?`, `urban_lst` 0..6, `model?` | baseline, scenario, diff + impacts |
| GET | `/twin/run` | `date?`, `horizon`, `assimilate`, `model?` | reality vs twin + divergence + sync % |
| WS | `/ws/twin` | `date`, `horizon`, `assimilate`, `model`, `interval_ms` 120–3000 | live ticks: `init` / `tick` / `done` / `error` |
| GET | `/validate` | — | cached metrics + conformal calibration |
| GET | `/downscale` | `date?`, `var` | coarse vs bilinear vs SR-CNN + improvement % |
| GET | `/downscale/diffusion` | `date?`, `samples` 2–24, `var` | bilinear, mean, std, truth + FSS/CRPS/spectrum |
| GET | `/ai` | `q` | simple intent answer |
| GET | `/brain` | `q`, `date?` | plan + facts + cited answer + caveat |
| GET | `/brain/anomaly` | — | anomaly bool, kind, value, threshold, suggested question |
| GET | `/guide` | `view`, `variable`, `model?`, `date?`, `q?` | headline + plain explanation + tips |

**Caching:** payload builders are memoized with `@lru_cache`; the latest state and default 7-day
forecast are warm-started at boot so the demo never lags. Forecasters are built once at startup.

---

## 6 · Frontend ↔ backend

```mermaid
flowchart LR
    subgraph B["FastAPI :8000"]
        R["REST /*"]
        W["WS /ws/twin"]
    end
    subgraph V["Vite dev :5173"]
        P1["/api → :8000"]
        P2["/ws → :8000"]
    end
    V --> B
    subgraph UI["React views"]
        O["Overview"] --- TW["Twin"] --- E["Explore"]
        WI["WhatIf"] --- VA["Validation"] --- DS["Downscale"]
        CC["Command Console → /brain"]
    end
    P1 --> UI
    P2 --> TW
```

Stack: **React 18 · Vite · Tailwind · Leaflet/react-leaflet · Framer Motion · Recharts · visx ·
cobe** (globe) · **html-to-image** (PNG export). The dashboard reads everything through a typed,
memoized API client (`frontend/src/api/endpoints.ts`). The twin replay streams over the WebSocket
as offline-safe ticks. State lives in React (no localStorage in artifact components).

---

## 7 · Configuration is the scale story

Everything regionable lives in `config.py` — `PILOT` bbox, `SPLIT` years, `VARS`, `K_INPUT`,
`H_HORIZON`, thresholds, `ASSIMILATION_ALPHA`, and all artifact paths. Change the bbox and rerun
`make data` → the entire cube → model → dashboard rebuilds for a new region with **no code edits**.
That is the "scalable to national" deliverable in one file.
