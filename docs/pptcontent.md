# ClimaTwin India — Pitch Deck Content

> Slide-by-slide content for the ISRO hackathon pitch. Every number here is verified out-of-sample on the 2022–23 test set or traceable to a cited source. No invented metrics. Punchy, but honest — judges reward rigor.

---

## Slide 1 — ClimaTwin India

**An AI-powered Digital Twin of India's climate, built on India's own data.**

- Mirror → Assimilate → Forecast → Downscale → What-if → Impacts — a full twin loop, not a chart.
- Pilot: Delhi-NCR. Variables: rainfall, Tmax, Tmin. Horizon: 1–14 days. Record: 2000–2023.
- North star: NVIDIA Earth-2 / EU Destination Earth — same three-stage shape, scaled to hackathon compute.
- Runs fully offline from a cached data cube; heavy training on free Colab GPU.

[Visual: India outline with the Delhi-NCR box highlighted, a live rainfall layer, and the six-stage loop arc.]
[Speaker note: One sentence — "We didn't build a predictor with a map; we built a digital twin of a piece of India's atmosphere, and we validated it honestly."]

---

## Slide 2 — The Problem (ISRO Problem Statement)

**India needs a living, queryable model of its own climate — not a foreign black box.**

- Climate decisions (sowing, heat alerts, water) are made on coarse, foreign, or static forecasts.
- A forecast is a snapshot; what decision-makers need is a system they can poke: "what if it's 2 °C hotter? what if the monsoon is 30% weaker?"
- ISRO/IMD generate world-class national data (IMD grids, INSAT) — but it's underused in interactive, AI-native tools.
- Atmanirbhar framing: the backbone must be India's data, India's region, India's control.

[Speaker note: Frame the gap as "we have the data and the satellites; we lack the twin."]

---

## Slide 3 — Why a Twin, Not a Predictor

**A predictor answers one question. A twin answers the questions you haven't asked yet.**

- A twin mirrors a live state, assimilates new observations, simulates forward, and supports perturbation.
- "CNN + chart" is a dead end — it can't do counterfactuals, can't ingest a new observation, can't reason about impacts.
- Our twin core (`twin/climate_twin.py`) implements `initialize`, `assimilate`, `step`, `whatif`, `impacts` as real, non-stubbed code.
- This is the difference between a demo and a system.

[Visual: split panel — left "predictor: input → number"; right "twin: state ⟲ assimilate ⟲ simulate ⟲ perturb → impacts".]

---

## Slide 4 — The Earth-2 Three-Stage Shape

**Assimilate → Forecast → Downscale — the same architecture as Earth-2 and Destination Earth.**

- Stage 1 — Assimilate: nudge the model state toward the latest observation.
- Stage 2 — Forecast: a learned spatiotemporal model rolls the state forward 1–14 days.
- Stage 3 — Downscale: a generative residual diffusion model sharpens to ~5 km.
- We adopt the *shape* the global leaders use, honestly scaled to what a laptop + Colab can run.

[Speaker note: We're not claiming Earth-2 scale — we're claiming Earth-2 *discipline* on a hackathon budget.]

---

## Slide 5 — System Architecture

**One config-driven pipeline: data cube → models → twin → API → dashboard.**

- Backbone: Python / PyTorch / xarray / FastAPI; frontend: React + Vite + Tailwind + Leaflet + Framer + Recharts.
- Canonical artifact: a cached NetCDF cube `(time, lat, lon)` on a common 0.25° grid — the demo never depends on a live download.
- Region is one line in `config.py`: change it and the cube rebuilds — this *is* the path to all-India.
- Full diagram: see the mermaid in `docs/architecture.md`.

[Visual: embed/redraw the mermaid flow from docs/architecture.md.]

---

## Slide 6 — India-First Data & How We Get It

**Indian datasets are the backbone; foreign data is optional auxiliary only.**

- IMD gridded rainfall + temperature via IMDLIB — the national observational record.
- INDmet 0.05° (Zenodo 15430548, CC-BY-4.0; blended IMD + CHIRPS + ERA5-Land) as high-resolution ground truth for downscaling.
- Elevation: CartoDEM / Copernicus GLO-30.
- INSAT-3D LST (MOSDAC): real ingestion path built; currently a synthetic placeholder labeled "roadmap" while data access approval is pending — stated openly.

[Speaker note: Call out the INSAT placeholder *before* a judge does. Honesty is the moat.]

---

## Slide 7 — The Forecast Engine

**A two-head ConvLSTM that respects how rainfall actually behaves, fused into a stacked ensemble.**

- Rainfall is zero-inflated and skewed → two heads: rain/no-rain detection + amount regression on `log1p`, not plain MSE.
- Temperature heads trained with L1/MSE.
- Ensemble = ConvLSTM + analog k-NN combined via non-negative least squares (NNLS) stacking.
- Trained on a strict temporal split: train ≤2018 / val 2019–21 / test 2022–23. Normalization stats fit on train years only.

[Visual: two-head diagram + ensemble stacking schematic.]

---

## Slide 8 — Honest Validation (Leaderboard)

**We beat persistence and climatology — and we show exactly by how much.**

- 1-day rainfall RMSE (mm): ensemble **7.35** vs climatology 8.08 vs persistence 9.41.
- 1-day temperature RMSE: Tmax **1.51 °C**, Tmin **1.05 °C**.
- 1-day rain detection @2.5 mm: POD **0.64** / CSI **0.37** / FAR **0.53** vs persistence 0.45 / 0.29 / 0.55.
- 7-day rainfall: ConvLSTM 8.03 ≈ ensemble 8.04 — honest: skill flattens at longer horizons.

[Visual: bar chart, our model vs persistence vs climatology, with a spatial error map alongside.]
[Speaker note: No skill claim without a baseline. The 7-day flattening is shown on purpose.]

---

## Slide 9 — Quantified Uncertainty

**Every forecast ships with a calibrated 90% interval — and the calibration is verified.**

- Split-conformal prediction wraps the ensemble in distribution-free 90% intervals.
- Verified out-of-sample coverage ≈ **0.90** on the test set — the intervals mean what they say.
- A point forecast hides risk; a calibrated band is what a decision-maker can actually act on.
- No Gaussian hand-waving — conformal guarantees are model-agnostic and checkable.

[Visual: time series with shaded 90% band; small coverage-vs-nominal calibration plot.]

---

## Slide 10 — Generative Downscaling to ~5 km

**A CorrDiff-style residual diffusion model adds realistic fine-scale structure — scored the right way.**

- Downscales the 0.25° forecast to 0.05° (~5 km) by learning the residual, CorrDiff-style.
- Scored on FSS / CRPS / spectral power — not just RMSE — because RMSE rewards blurry maps.
- Rainfall FSS @2.5 mm: **0.82** vs bilinear 0.68. RMSE: **4.42** vs bilinear 5.34.
- High-wavenumber spectral power vs truth: **0.36** vs bilinear 0.16 — diffusion restores real texture, not blur.

[Visual: side-by-side — coarse input | bilinear | diffusion | INDmet truth; plus a radial spectrum plot.]
[Speaker note: This is why we use diffusion — sharper *and* spectrally honest, proven on metrics that punish smoothing.]

---

## Slide 11 — The Twin Loop & Assimilation

**The model state is corrected by observations — a real assimilation step, labeled honestly.**

- Assimilation = simplified nudging: `state = α·obs + (1−α)·state`, with α = 0.6.
- We call it what it is: a simplified scheme, **not** full Kalman/variational assimilation.
- This keeps the twin anchored to reality before each forward simulation.
- The loop is in code and runs live in the demo — initialize → assimilate → step.

[Speaker note: Naming it "simplified nudging" out loud earns trust — overclaiming "data assimilation" loses it.]

---

## Slide 12 — What-If Scenarios & Impacts

**Perturb the state, re-run the twin, and read the consequences — not just the weather.**

- Scenarios: uniform ΔTemp (−2…+4 °C), rainfall ×factor (50–150%), urban-area LST bump.
- Each run returns a baseline, a diff map, and impact badges.
- Impact signals: dryness / SPI-lite index, heat-stress flag (Tmax > 40 °C), sowing-window onset (accumulated rain ≥ 20 mm).
- This is the decision layer that turns a forecast into an answer.

[Visual: what-if panel — sliders → diff map → impact badges lighting up.]

---

## Slide 13 — The Agentic AI Brain & Guide

**An offline AI that operates the twin, cites every number, and explains itself in plain language.**

- The "brain" is an agent that drives the twin (runs forecasts, what-ifs, validation) and **cites every number** it reports — no orphan claims.
- An always-on "guide" narrates what's on screen in plain language for non-experts.
- Optional fine-tuned local LLM: QLoRA Qwen2.5-3B — runs offline, no cloud dependency.
- Grounded in the twin's actual outputs, so it can't invent metrics — it quotes them.

[Visual: chat panel where the brain answers a query and footnotes each number to a twin call.]
[Speaker note: The citation requirement is the anti-hallucination design, not an afterthought.]

---

## Slide 14 — Live Dashboard Tour

**Everything connects: map, time slider, what-if, validation, and the AI guide — offline.**

- Leaflet map with variable layers, colorbar, and the Delhi-NCR boundary.
- Time slider scrubs past observations into the forecast horizon, with play/pause.
- What-if panel runs a scenario and renders the diff map + impact badges live.
- Validation tab shows metrics, an error map, and a "how to read this" note — runs from the cached cube, no network.

[Visual: dashboard screenshot with callouts for each panel.]

---

## Slide 15 — Why This Beats a Typical Hackathon Entry

**Most entries stop at "model + map." We built the system around it.**

- Real twin loop with assimilation and what-if — not a CNN + chart.
- Two-head rainfall + stacked ensemble + verified conformal intervals — uncertainty that's actually calibrated.
- Generative 5 km downscaling scored on FSS/CRPS/spectrum, not just RMSE.
- Offline agentic AI brain that cites every number; India-first data; one-line scaling to all-India.

[Speaker note: The differentiator is rigor across the *whole* pipeline, not one flashy component.]

---

## Slide 16 — Honesty & Limitations

**We state what's simplified, what's pending, and what we haven't proven.**

- Assimilation is simplified nudging, not full data assimilation.
- INSAT-3D LST is currently a synthetic placeholder (roadmap) pending MOSDAC access approval.
- Forecast skill flattens by day 7 — we show it rather than hide it.
- Short satellite record and coarse native temperature grid; pilot is one region, not yet all-India.

[Speaker note: This slide *builds* credibility — judges trust a team that names its own gaps.]

---

## Slide 17 — Roadmap

**The architecture is already built to scale — here's the path.**

- Swap the synthetic LST for real INSAT-3D once MOSDAC access lands (ingestion path already coded).
- Flip the region config to expand the pilot toward all-India.
- Extend ensemble members and tune the diffusion downscaler on more INDmet coverage.
- Harden the local LLM fine-tune; add more impact indices (drought, flood-risk).

[Visual: roadmap timeline — Now (pilot, validated) → Next (real LST, more region) → Scale (all-India).]

---

## Slide 18 — Closing Ask

**A validated, honest, India-first climate twin — ready to scale with ISRO's data.**

- We built the loop, used India's data, and beat the baselines — verifiably.
- Everything runs offline and is reproducible from a cached cube and saved checkpoints.
- The ask: access to real INSAT/MOSDAC LST and the green light to scale the region.
- ClimaTwin India: the discipline of Earth-2, on India's data, in India's hands.

[Speaker note: End on the ask — data access + scale — not on a feature list.]

---

## Slide 19 — Q&A Prep (Anticipated Tough Questions)

**Crisp, honest answers to the questions judges will actually ask.**

- **"Did you leak data?"** No. Temporal split only (train ≤2018 / val 2019–21 / test 2022–23); normalization stats and climatology fit on train years only, applied to val/test.
- **"Did you compare to baselines?"** Always. Every skill number is reported against persistence and climatology — e.g. 1-day rainfall RMSE 7.35 vs 8.08 vs 9.41.
- **"Is it really a twin?"** Yes — `initialize`, `assimilate`, `step`, `whatif`, `impacts` are real code, not stubs, and run live in the demo.
- **"Why diffusion, not just interpolation?"** Bilinear blurs: FSS 0.68 and spectral power 0.16 vs truth. Diffusion gives FSS 0.82, spectral power 0.36, and lower RMSE (4.42 vs 5.34).
- **"Is the LLM hallucinating numbers?"** It can't invent metrics — the brain must cite every number to an actual twin call, and conformal coverage (≈0.90) is independently verified.
- **"Why call it assimilation if it's just nudging?"** Because we label it exactly that: simplified nudging (α=0.6), not Kalman — honesty over hype.

[Speaker note: Rehearse these verbatim. The credibility win is answering before being pushed.]
