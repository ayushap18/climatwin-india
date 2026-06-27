# research.md — ClimaTwin India

> Why the decisions in this repo were made, what the state of the art looks like, and how we mirror it honestly at hackathon scale. This document records reasoning, not aspiration. Where a claim has a number behind it, the number comes from this repo's own validation runs; where a claim leans on prior work, the work is cited by name.

---

## 1. Problem framing: a twin, not a predictor

The ISRO problem statement asks for an *AI-powered digital twin of India's climate*. The single most consequential design decision in this project is to take that phrase literally.

A forecast model answers one question: "what will the weather be?" A digital twin answers a family of questions: "what is the climate state right now, how confident am I, what happens if I run it forward, and what changes if I perturb it?" The difference is not cosmetic. A twin:

- **Mirrors a live state.** It holds a current best estimate of the system, not just an output buffer.
- **Assimilates observations.** When new data arrives, the state is nudged toward it rather than recomputed from scratch.
- **Simulates forward.** The forecaster is one component inside the loop, not the whole product.
- **Supports counterfactuals.** "What if temperature rises 2 °C? What if monsoon rainfall halves? What if this district urbanizes?" are first-class operations.

If this project were reduced to "a predictor plus a chart," it would have built the wrong thing. The twin loop is therefore a non-negotiable in the codebase: `initialize → assimilate → step → whatif → impacts` exists as real code, and the forecaster plugs into it.

**Scope, deliberately narrow.** The pilot region is Delhi-NCR (lat 27.5–29.5, lon 75.5–78.5) on a 0.25° grid — a 9×13 cell box. Variables are rainfall, daily maximum temperature (tmax), and daily minimum temperature (tmin). The horizon is 1–14 days, default 7. The record is 2000–2023. This is a Proof-of-Concept; a narrow, fully-working vertical slice is worth more than a broad, half-working one. The region is config-driven so that "scalable to national" is demonstrated by changing a config value, not by claiming it.

**Temporal split, always.** Train is 2000–2018, validation 2019–2021, test 2022–2023. Time series are never random-split — that leaks future information into the past and is a credibility red flag in any climate work. Every normalization statistic, climatology, and fitted preprocessing step is computed on train years only.

---

## 2. North-star systems and how we mirror them honestly

The reference points for this project are **NVIDIA Earth-2** and the **EU Destination Earth (DestinE)** initiative. Both are full-scale digital twins of the Earth system, and both share the same three-stage shape:

```
assimilate  →  forecast  →  downscale
(ingest obs)   (step fwd)    (refine to local detail)
```

ClimaTwin adopts exactly this shape, scaled down to what a hackathon's compute can honestly support:

| Stage | Earth-2 / DestinE scale | ClimaTwin PoC scale |
|---|---|---|
| Assimilate | Operational data assimilation (variational / ensemble Kalman) | Simplified nudging: `state = α·obs + (1−α)·state`, honestly labeled |
| Forecast | Global neural weather models (FourCastNet, GraphCast lineage) | ConvLSTM + analog k-NN + stacked ensemble over a 9×13 box |
| Downscale | Generative super-resolution (CorrDiff) at km-scale | Residual diffusion model, 0.25° → 0.05°, on Indian truth data |

The point of naming these systems is not to claim parity. It is to inherit their *architecture of honesty*: they separate "what is the state," "how does it evolve," and "how do we add local detail," and they validate each stage on its own terms. We do the same, and we are explicit about every place where our version is a simplified stand-in.

---

## 3. Data strategy: India-first, by principle and by evidence

This is an Atmanirbhar-framed project for an Indian space agency. National datasets are the backbone, not an afterthought.

**Primary: IMD gridded data.** The India Meteorological Department's gridded rainfall and temperature products are the canonical observational record for Indian climate. We read them through **IMDLIB** rather than hand-parsing the binary `.grd` format. IMD is the source of truth for the twin's state and for baseline construction.

**High-resolution truth for downscaling: INDmet.** Downscaling needs a genuine fine-grid target to learn against, not an upsampled version of the same coarse data (which would teach the model nothing real). We use **INDmet**, a 0.05° (~5 km) blended product from the Water & Climate Lab at IIT Gandhinagar, which fuses IMD, CHIRPS, and ERA5-Land (Zenodo DOI 10.5281/zenodo.15430548, CC-BY-4.0). INDmet is the high-resolution ground truth the diffusion downscaler is trained and scored on. Using a real ~5 km product — rather than a synthetic high-res target — is what makes the downscaling claim meaningful.

**Static fields: real elevation.** Terrain is a genuine physical predictor, especially for temperature and orographic rainfall. Elevation comes from **CartoDEM / Copernicus GLO-30**, not a placeholder.

**Satellite: INSAT-3D Land Surface Temperature via MOSDAC.** INSAT-3D LST is the intended satellite input, accessed through ISRO's MOSDAC portal. The real ingestion path is built, but data approval is still pending, so the LST channel currently carries a **clearly-labeled `synthetic_demo` placeholder**. This is stated plainly rather than disguised: the wiring is real, the data is awaited, and the placeholder is named as such everywhere it appears.

The discipline throughout: national data is primary; foreign reanalysis (ERA5-Land, via INDmet's blend) is auxiliary and never the backbone; and anything synthetic is labeled.

---

## 4. Modeling choices and the reasoning behind them

### 4.1 Baselines before claims

No accuracy claim is made before it beats a baseline. Two baselines are implemented and must be beaten:

- **Persistence** — tomorrow equals today.
- **Climatology** — the day-of-year average from train years.

These are not strawmen. In short-horizon rainfall, persistence and climatology are genuinely hard to beat, and the test numbers below show by how little. Reporting skill relative to these baselines is the only honest way to state performance.

### 4.2 The core forecaster: ConvLSTM with a two-head rainfall design

The core spatiotemporal forecaster is a **ConvLSTM** (convolutional LSTM), the natural choice for gridded sequence-to-sequence prediction where both spatial structure and temporal evolution matter. Input tensors are `(B, k=7, C, H, W)` — seven days of history, several channels, over the 9×13 grid.

Rainfall and temperature are fundamentally different statistical objects, so they are modeled differently:

- **Temperature (tmax, tmin)** is roughly continuous and well-behaved → MSE / L1 loss.
- **Rainfall is zero-inflated and right-skewed.** Most days are dry; wet days span orders of magnitude. Plain MSE on raw rainfall is simply wrong — it is dominated by the many zeros and washes out the rare heavy events that matter most. So rainfall uses a **two-head design**:
  1. a **rain / no-rain classifier** (does it rain at all?), and
  2. a **`log1p` amount regressor** (how much, on a compressed scale that tames the skew).

This separation mirrors standard practice for precipitation and is what makes the categorical skill scores (POD/FAR/CSI) meaningful rather than incidental.

### 4.3 Other forecasters and why each exists

- **Analog k-NN.** Retrieves the 25 most-similar past days from the *train years*, gated by season (day-of-year window so a July day is matched to July-like days). It needs no GPU, produces direct multi-horizon forecasts, and — because it returns a *set* of analogs — gives an ensemble spread for free. It is a cheap, interpretable member that often holds its own against the neural model on rainfall.

- **Stacked ensemble.** The members above are blended per variable and per horizon using **non-negative least squares (NNLS)**. NNLS is chosen deliberately: non-negative weights keep the blend interpretable as a convex-ish combination of members and prevent a member from being given a nonsensical negative contribution. The weights are fit on validation data, never on test.

### 4.4 Why conformal prediction wraps the ensemble

A twin that says "7.3 mm" without saying "± how much" is over-claiming. We attach **split-conformal 90% prediction intervals** to the ensemble output. Split-conformal is distribution-free: it makes no Gaussian assumption, and given an exchangeable calibration set it guarantees the stated coverage. The data discipline is strict and three-way disjoint:

- members **fit** on val 2019–2020,
- conformal scores **calibrated** on the disjoint val 2021,
- everything **scored** on untouched test 2022–2023.

The verified result is that out-of-sample coverage lands at ≈0.90 — the intervals mean what they say.

### 4.5 Why downscaling is generative, not deterministic

This is the subtlest modeling decision in the project, and the one most worth explaining.

The instinct is to downscale with a deterministic super-resolution CNN (SR-CNN) trained to minimize pixel RMSE. We built that — and it exposes exactly the problem the field has documented. A deterministic regressor minimizes pixel error by **blurring**: when uncertain about the precise location of a rain cell, the loss-optimal move is to smear it, hedging across possible positions. This is the **double-penalty problem** — a sharp forecast placed slightly wrong is penalized twice (once for a miss, once for a false alarm), so the optimizer learns to avoid sharpness altogether. The result scores acceptable RMSE while looking nothing like real rainfall.

The state of the art therefore went **generative**. NVIDIA Earth-2's **CorrDiff** and DeepMind's **DGMR** (Deep Generative Model of Rainfall) produce sharp, physically-plausible fields and are scored not on pixel RMSE but on **spatial and spectral skill**: power spectra (does the field have the right amount of fine-scale structure?), **FSS** (Fractions Skill Score, neighborhood-based), and **CRPS** (a proper probabilistic score).

ClimaTwin follows this. Alongside the deterministic SR-CNN, it implements a **CorrDiff-style residual diffusion model**: a DDPM with a cosine noise schedule and DDIM sampling, super-resolving 0.25° → 0.05° against INDmet truth. It learns the *residual* — the fine detail the coarse field is missing — rather than the whole field, which is easier and more stable. The verified results show why this matters: the diffusion model reaches **FSS@2.5mm of 0.82 vs 0.68 for bilinear**, and recovers far more realistic fine-scale structure — **high-wavenumber spectral power of 0.36 vs truth, against bilinear's 0.16** (i.e. bilinear is far too smooth). Notably it also wins pixel RMSE here (4.42 vs 5.34), but the spatial and spectral scores are the ones that capture what generative downscaling is actually for.

---

## 5. The twin core and assimilation honesty

The twin (`twin/climate_twin.py`) implements five operations:

- **`initialize`** — mirror the current observed state into the twin.
- **`assimilate`** — nudge the state toward new observations: `state = α·obs + (1−α)·state`. This is **not** variational or ensemble-Kalman assimilation. It is a simplified nudging scheme, and it is labeled as exactly that everywhere. Attempting full data assimilation at PoC scale would be dishonest about what was actually built; nudging is a defensible, transparent stand-in that preserves the *shape* of the assimilate stage.
- **`step`** — run the forecaster forward to evolve the state.
- **`whatif`** — perturb the state or forcings *before* the forward run, and return the scenario alongside its difference from baseline. Supported perturbations: uniform ΔTemperature, rainfall × factor, and an urban-polygon LST bump (drawing an area and raising its land-surface temperature to mimic urbanization).
- **`impacts`** — derive simple, explainable decision signals: a dryness / SPI-lite index, a heat-stress flag (Tmax threshold), and a sowing-window onset estimate. These are intentionally interpretable rather than opaque indices.

The honesty principle: every place the PoC simplifies a stage that the north-star systems do for real, it says so.

---

## 6. The AI / agent layer

Two observations motivate this layer. First, a twin with rich internal state is useless to a non-expert if the only interface is a map and a slider. Second — and this is the failure mode to design against — a language model attached to scientific data will, left unconstrained, fabricate numbers. The entire AI layer is built so that the LLM can *narrate* but never *invent*.

- **Agentic "brain": planner → executor → critic → explainer → grounding guard.** The brain operates the twin's *own tools* (the same forecast, whatif, and impact functions the API exposes). The planner decides which tools to call, the executor calls them, the critic checks the result, the explainer turns it into prose, and the grounding guard enforces that **every number in the output traces back to a tool result**. It is offline-first so the demo never depends on a network call.

- **Always-on "guide."** A plain-language companion that explains whatever screen the user is on. Its job is comprehension, not analysis.

- **Optional fine-tuned local LLM.** A **QLoRA fine-tune of Qwen2.5-3B-Instruct**, small enough to run locally. Its role is strictly limited: it **rephrases grounded text** into clearer language and **never originates numbers**. The grounding guard sits between the model and the user precisely so that the LLM's fluency can never become a source of fabricated quantities.

The design rule, stated once and enforced architecturally: the model phrases, the tools compute, and the guard verifies the join.

---

## 7. Verified results (test split 2022–2023)

All numbers below are from this repo's validation on the untouched 2022–2023 test years. RMSE unless noted; lower is better except for detection scores.

**1-day RMSE — rainfall** (mm):

| Model | RMSE |
|---|---|
| **Ensemble** | **7.35** |
| Analog k-NN | 7.38 |
| ConvLSTM | 7.40 |
| Climatology | 8.08 |
| Persistence | 9.41 |

The ensemble wins, but the margin over the analog and ConvLSTM members is small and the *honest* story is that short-horizon rainfall is hard — climatology at 8.08 is not far behind. The members beat the baselines; they do not crush them, and we do not claim they do.

**1-day RMSE — temperature** (°C): tmax ensemble **1.51**, tmin ensemble **1.05**.

**7-day RMSE — rainfall** (mm): ConvLSTM **8.03** ≈ ensemble **8.04**, with climatology at **8.11**. At a 7-day horizon the skill over climatology has nearly vanished — this is expected for daily rainfall and is reported rather than hidden.

**Rain detection, 1-day @ 2.5 mm threshold:**

| Model | POD | CSI | FAR |
|---|---|---|---|
| **Ensemble** | **0.64** | **0.37** | **0.53** |
| Persistence | 0.45 | 0.29 | 0.55 |

The two-head design pays off in detection: the ensemble catches substantially more rain events (POD 0.64 vs 0.45) at better CSI.

**Uncertainty calibration:** split-conformal 90% intervals achieve out-of-sample coverage ≈ **0.90** — verified, not assumed.

**Diffusion downscaling (rainfall):** FSS@2.5mm **0.82** vs bilinear **0.68**; high-wavenumber spectral power **0.36** vs truth, against bilinear **0.16**; RMSE **4.42** vs bilinear **5.34**.

---

## 8. Key references

Cited by name; this project does not fabricate URLs, DOIs, or arXiv identifiers beyond the one verified dataset DOI given to it.

**Systems and north stars**
- **NVIDIA Earth-2** — Earth-system digital twin platform; the assimilate → forecast → downscale shape and the generative-downscaling stance this project follows.
- **NVIDIA CorrDiff** — correction/residual diffusion for km-scale generative downscaling; the direct template for our diffusion downscaler.
- **EU Destination Earth (DestinE)** — European digital twins of the Earth; second north-star system.

**Forecasting models**
- **DeepMind DGMR** — Deep Generative Model of Rainfall; precipitation nowcasting scored on spatial/probabilistic skill, motivating the generative approach.
- **DeepMind GraphCast** — neural global weather forecasting; lineage of the learned-forecaster idea the twin's step stage stands in for.
- **Shi et al. (2015), ConvLSTM** — Convolutional LSTM for precipitation nowcasting; the architecture of our core forecaster.

**Uncertainty**
- **Split-conformal / conformal prediction** — distribution-free prediction intervals with finite-sample coverage guarantees under exchangeability; the basis of our 90% intervals.

**Generative modeling**
- **Ho et al. (2020), DDPM** — Denoising Diffusion Probabilistic Models; the diffusion formulation (with cosine schedule and DDIM sampling) used by the downscaler.

**Datasets**
- **IMD gridded** (India Meteorological Department) — primary national rainfall/temperature record, read via **IMDLIB**.
- **INDmet** — 0.05° blended Indian meteorological product (IMD + CHIRPS + ERA5-Land), Water & Climate Lab, IIT Gandhinagar; Zenodo DOI **10.5281/zenodo.15430548**, CC-BY-4.0. High-resolution downscaling truth.
- **CHIRPS** — Climate Hazards Group InfraRed Precipitation with Stations; a component of the INDmet blend.
- **ERA5-Land** — ECMWF land reanalysis; a component of the INDmet blend (auxiliary, not backbone).
- **CartoDEM / Copernicus GLO-30** — elevation / digital terrain models.
- **INSAT-3D (LST) via MOSDAC** — ISRO geostationary satellite land-surface-temperature input; ingestion path built, data approval pending.

---

## 9. Honesty and limitations

This section exists because the project's credibility depends on stating what it cannot do as clearly as what it can.

- **Short-horizon rainfall skill is modest.** The ensemble beats persistence and climatology at 1 day, but the margin over climatology is small, and by 7 days the skill over climatology has effectively vanished. Daily rainfall is genuinely hard; we report this rather than cherry-pick a favorable horizon.
- **Assimilation is simplified.** It is nudging, not variational or Kalman assimilation. It preserves the shape of the stage, nothing more, and is labeled as such.
- **The satellite channel is not yet live.** INSAT-3D LST is a labeled `synthetic_demo` placeholder pending MOSDAC data approval. The ingestion code is real; the data is not yet flowing.
- **Coarse temperature, narrow scope.** One pilot region (Delhi-NCR, 9×13 cells), three variables, 1–14 day horizon. The "scalable to national" claim is demonstrated by config-driven region selection, not by having actually run nationally.
- **The LLM never originates numbers.** By design, the language layer only rephrases grounded, tool-derived text, and a grounding guard enforces this. Any fluent prose it produces is traceable to a computed quantity.
- **Generative downscaling is scored on the right metrics.** We lead with FSS and spectral power because pixel RMSE alone would reward blurring; we report RMSE too, but it is not the headline.

The short version: build the loop, use India's data, validate against baselines, quote real numbers with their uncertainty, and say where the simplifications are. That is the whole game.
