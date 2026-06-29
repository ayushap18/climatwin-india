# ClimaTwin India — Pitch Deck Content

> Slide-by-slide content for the ISRO hackathon pitch. Every number here is verified out-of-sample on the 2022–23 test set or traceable to a cited source. No invented metrics. Punchy, but honest — judges reward rigor.

---

## Slide 1 — ClimaTwin India

**An AI-powered Digital Twin of India's climate, built on India's own data.**

- Mirror → Assimilate → Forecast → Downscale → What-if → Impacts — a full twin loop, not a chart.
- Pilot: Delhi-NCR. Variables: rainfall, Tmax, Tmin. Horizon: 1–14 days. Record: 2000–2023.
- Now reads **real INSAT-3D satellite LST** (MOSDAC) — a second, read-only data regime, switchable live.
- North star: NVIDIA Earth-2 / EU Destination Earth — same three-stage shape, scaled to hackathon compute.
- Runs fully offline from a cached data cube; heavy training on free Colab GPU.

[Visual: India outline with the Delhi-NCR box highlighted, a live rainfall layer, and the six-stage loop arc.]
[Speaker note: One sentence — "We didn't build a predictor with a map; we built a digital twin of a piece of India's atmosphere, fed it ISRO's own satellite data, and validated it honestly."]

---

## Slide 2 — The Problem (ISRO Problem Statement)

**India needs a living, queryable model of its own climate — not a foreign black box.**

- Climate decisions (sowing, heat alerts, water) are made on coarse, foreign, or static forecasts.
- A forecast is a snapshot; what decision-makers need is a system they can poke: "what if it's 2 °C hotter? what if the monsoon is 30% weaker?"
- ISRO/IMD generate world-class national data (IMD grids, INSAT-3D) — but it's underused in interactive, AI-native tools.
- Atmanirbhar framing: the backbone must be India's data, India's region, India's control.

[Speaker note: Frame the gap as "we have the data and the satellites; we lack the twin."]

---

## Slide 3 — Why a Twin, Not a Predictor

**A predictor answers one question. A twin answers the questions you haven't asked yet.**

- A twin mirrors a live state, assimilates new observations, simulates forward, and supports perturbation.
- "CNN + chart" is a dead end — it can't do counterfactuals, can't ingest a new observation, can't reason about impacts.
- Our twin core (`twin/climate_twin.py`) implements `initialize`, `assimilate`, `step`, `whatif`, `impacts` as real, non-stubbed code.
- The same twin class operates either data regime (synthetic record or real-INSAT 2020) with no code change — it is source-aware.
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

- Backbone: Python / PyTorch / xarray / FastAPI; frontend: React + Vite + Tailwind + Leaflet + react-three-fiber + Recharts.
- Canonical artifact: a cached NetCDF cube `(time, lat, lon)` on a common 0.25° grid — the demo never depends on a live download.
- Region is one line in `config.py`: change it and the cube rebuilds — this *is* the path to all-India.
- A dual-source regime registry routes every API call by a `source` param (`synthetic` | `insat_real`) without forking the model.
- Full diagram: see the mermaid in `docs/architecture.md`.

[Visual: embed/redraw the mermaid flow from docs/architecture.md.]

---

## Slide 6 — India-First Data & How We Get It

**Indian datasets are the backbone; foreign data is optional auxiliary only.**

- IMD gridded rainfall + temperature via IMDLIB — the national observational record (2000–2023).
- INDmet 0.05° (Zenodo 15430548, CC-BY-4.0; blended IMD + CHIRPS + ERA5-Land) as high-resolution ground truth for downscaling.
- Elevation: CartoDEM / Copernicus GLO-30 — real terrain, block-averaged to the 0.25° grid.
- INSAT-3D LST (MOSDAC): **real ingestion now done** — a native MOSDAC client downloads the satellite granules and we fuse genuine Land Surface Temperature into a focused 2020 cube (details on the next slide).

[Speaker note: Indian data is the backbone, not an afterthought — IMD for the record, INSAT-3D for the satellite layer, CartoDEM for the terrain.]

---

## Slide 7 — Real INSAT-3D Satellite Data: The Twin in 3D

**We pulled real INSAT-3D Land Surface Temperature from ISRO's MOSDAC portal and rendered the twin in 3D over real terrain.**

- A native MOSDAC client (`data/mosdac_client.py`) speaks ISRO's `mdapi` HTTP contract directly — token auth, lockout-safe, streams the `.h5` granules.
- INSAT-3D LST is half-hourly; we pick one overpass per day (~0600 UTC ≈ local late-morning skin temperature). Result on disk: **366 real INSAT-3D LST granules**, one per day of leap-year 2020.
- Decoded (Kelvin→°C, fill-masked, regridded to 0.25°) and fused into a focused 2020 cube alongside real IMD rainfall/Tmax/Tmin — **LST coverage 0.6414** (the rest is cloud, gap-filled).
- 3D view extrudes the **real CartoDEM / Copernicus GLO-30 terrain (×1.6 exaggeration)** and drapes the variable — including the **real INSAT-3D LST layer** — over the relief, with an orbit camera and an atmosphere backdrop.
- A top-bar **source switcher** flips between the validated synthetic record (2000–2023) and the real-INSAT 2020 regime live, showing each regime's LST provenance.

[Visual: the 3D terrain with INSAT-3D LST draped — `assets/pictures/14-explore-3d-insat-lst.png`.]
[Speaker note: This is the satellite-data headline — genuine INSAT-3D LST, genuine CartoDEM terrain, in 3D. Be precise: it is read-only and single-year (2020), not real-time.]

---

## Slide 8 — The Forecast Engine

**A two-head ConvLSTM that respects how rainfall actually behaves, fused into a stacked ensemble.**

- Rainfall is zero-inflated and skewed → two heads: rain/no-rain detection + amount regression on `log1p`, not plain MSE.
- Temperature heads trained with L1/MSE.
- Ensemble = persistence + climatology + analog k-NN + ConvLSTM combined via non-negative least squares (NNLS) stacking, per variable and horizon — the default served model.
- Trained on a strict temporal split: train ≤2018 / val 2019–21 / test 2022–23. Normalization stats fit on train years only.
- LST conditioning uses a train-only day-of-year climatology — no leakage.

[Visual: two-head diagram + ensemble stacking schematic.]

---

## Slide 9 — Honest Validation (Leaderboard)

**We beat persistence and climatology — and we show exactly by how much.**

- 1-day rainfall RMSE (mm): ensemble **7.35** vs climatology 8.08 vs persistence 9.41.
- 1-day temperature RMSE: Tmax **1.51 °C**, Tmin **1.05 °C** (ensemble, best at H1).
- 1-day rain detection @2.5 mm: POD **0.64** / CSI **0.37** / FAR **0.53** vs persistence 0.45 / 0.29 / 0.55.
- 7-day rainfall: ConvLSTM 8.03 ≈ ensemble 8.04 — honest: skill flattens at longer horizons.

[Visual: bar chart, our model vs persistence vs climatology, with a spatial error map alongside — `assets/pictures/05-validation-skill-leaderboard.png`.]
[Speaker note: No skill claim without a baseline. The 7-day flattening is shown on purpose.]

---

## Slide 10 — Quantified Uncertainty

**Every forecast ships with a calibrated 90% interval — and the calibration is verified.**

- Split-conformal prediction wraps the ensemble in distribution-free 90% intervals: weights fit on val 2019–20, conformal calibrated on the disjoint val 2021, scored on untouched test 2022–23.
- Verified out-of-sample coverage ≈ **0.90** on the test set (calibration coverage 0.8999) — the intervals mean what they say.
- A point forecast hides risk; a calibrated band is what a decision-maker can actually act on.
- No Gaussian hand-waving — conformal guarantees are model-agnostic and checkable.

[Visual: time series with shaded 90% band; small coverage-vs-nominal calibration plot.]

---

## Slide 11 — Generative Downscaling to ~5 km

**A CorrDiff-style residual diffusion model adds realistic fine-scale structure — scored the right way.**

- Downscales the 0.25° forecast to 0.05° (~5 km) by learning the residual, CorrDiff-style, on real INDmet truth.
- Scored on FSS / CRPS / spectral power — not just RMSE — because RMSE rewards blurry maps.
- Rainfall FSS @2.5 mm: **0.82** vs bilinear 0.68. RMSE: **4.42** vs bilinear 5.34.
- High-wavenumber spectral power vs truth: **0.36** vs bilinear 0.16 — diffusion restores real texture, not blur.
- DEM-aware SR-CNN cuts rainfall downscaling RMSE by **17.6%** over bilinear; the elevation channel itself adds ~1.3%.

[Visual: side-by-side — coarse input | bilinear | diffusion | INDmet truth; plus a radial spectrum plot — `assets/pictures/06-downscale-rainfall-srcnn.png`.]
[Speaker note: This is why we use diffusion — sharper *and* spectrally honest, proven on metrics that punish smoothing.]

---

## Slide 12 — The Twin Loop & Assimilation

**The model state is corrected by observations — a real assimilation step, labeled honestly.**

- Assimilation = simplified nudging: `state = α·obs + (1−α)·state`, with α = 0.6.
- We call it what it is: a simplified scheme, **not** full Kalman/variational assimilation.
- This keeps the twin anchored to reality before each forward simulation.
- The loop is in code and runs live in the demo — initialize → assimilate → step — and is forecaster-agnostic (swap the model, the loop is unchanged).

[Visual: free-run drift panel — sync gauge, drift-over-lead curve, Reality/Twin/Drift heatmaps — `assets/pictures/02-twin-free-run-drift.png`.]
[Speaker note: Naming it "simplified nudging" out loud earns trust — overclaiming "data assimilation" loses it.]

---

## Slide 13 — What-If Scenarios & Impacts

**Perturb the state, re-run the twin, and read the consequences — not just the weather.**

- Scenarios: uniform ΔTemp (−2…+4 °C), rainfall ×factor (50–150%), urban-area LST bump.
- Each run returns a baseline, a diverging diff map, and impact badges.
- Impact signals: dryness / SPI-lite index, heat-stress flag (Tmax > 40 °C), sowing-window onset (accumulated rain ≥ 20 mm).
- Works on both regimes — on the INSAT-3D regime the diff renders over the MOSDAC offline basemap.
- This is the decision layer that turns a forecast into an answer.

[Visual: what-if panel — sliders → diff map → impact badges lighting up — `assets/pictures/04-whatif-scenario-diff.png`.]

---

## Slide 14 — The Agentic AI Brain & Guide

**An offline AI that operates the twin, cites every number, and explains itself in plain language.**

- The "brain" is an agent (PLANNER → EXECUTOR → CRITIC → EXPLAINER → grounding GUARD) that drives the twin (runs forecasts, what-ifs, validation) and **cites every number** it reports — no orphan claims.
- It is source-aware: it operates whichever regime is active and refuses out-of-scope asks (other regions/variables, horizon > 14, dates outside the regime's range).
- An always-on "guide" narrates what's on screen in plain language for non-experts.
- Optional fine-tuned local LLM: QLoRA Qwen2.5-3B — runs offline, rephrases only; the guard rejects any number not traceable to a tool result.

[Visual: command console where the brain answers "when to sow" with a 1-step SIMULATE plan + cited numbers — `assets/pictures/08-command-console-brain.png`.]
[Speaker note: The citation requirement is the anti-hallucination design, not an afterthought.]

---

## Slide 15 — Live Dashboard Tour

**Everything connects: 3D map, source switcher, time slider, what-if, validation, and the AI guide — offline.**

- Six views: Overview, Twin, Explore (2D + 3D), What-If, Validation, Downscale — plus the Command Console.
- Source switcher in the top bar flips between the synthetic record and the real-INSAT 2020 regime, each with its LST provenance tag.
- Leaflet/3D map with variable layers, colorbar, the Delhi-NCR boundary, a Compare-Models modal, and the observed INSAT-3D LST layer.
- Time slider scrubs past observations into the forecast horizon; what-if renders the diff map live; validation shows metrics + error map + a "how to read this" note — all from the cached cube, no network.

[Visual: dashboard screenshots with callouts — `assets/pictures/01-overview-mission-control.png`, `assets/pictures/03-explore-map-tmax.png`.]

---

## Slide 16 — Why This Beats a Typical Hackathon Entry

**Most entries stop at "model + map." We built the system around it.**

- Real twin loop with assimilation and what-if — not a CNN + chart.
- Two-head rainfall + stacked ensemble + verified conformal intervals — uncertainty that's actually calibrated.
- Generative 5 km downscaling scored on FSS/CRPS/spectrum, not just RMSE.
- Real INSAT-3D satellite LST ingested from MOSDAC and rendered in 3D over real CartoDEM terrain.
- Offline agentic AI brain that cites every number; India-first data; one-line scaling to all-India.

[Speaker note: The differentiator is rigor across the *whole* pipeline, not one flashy component.]

---

## Slide 17 — Honesty & Limitations

**We state what's simplified, what's pending, and what we haven't proven.**

- Assimilation is simplified nudging, not full data assimilation.
- Real INSAT-3D LST is genuinely integrated, but **only as a read-only single-year (2020) regime** (366 granules, LST coverage 0.6414); the full multi-year cube still serves a synthetic LST channel, and the 2020 forecaster is pending its Colab-trained checkpoint. Not real-time, not multi-year real LST.
- The 2020 regime's climatology RMSE numbers are degenerate artifacts (train/test share no day-of-year) — the meaningful comparison there is ConvLSTM vs persistence.
- Forecast skill flattens by day 7 — we show it rather than hide it.
- Pilot is one region (Delhi-NCR), not yet all-India; native temperature grid is coarse.

[Speaker note: This slide *builds* credibility — judges trust a team that names its own gaps. Lead with the INSAT scope honesty before a judge asks.]

---

## Slide 18 — Roadmap

**The architecture is already built to scale — here's the path.**

- Train and ship the 2020 ConvLSTM checkpoint so the real-INSAT regime forecasts (not just observes), then fuse real INSAT-3D LST into the multi-year cube.
- Flip the region config to expand the pilot toward all-India.
- Extend ensemble members and tune the diffusion downscaler on more INDmet coverage.
- Harden the local LLM fine-tune; add more impact indices (drought, flood-risk).

[Visual: roadmap timeline — Now (pilot validated + real INSAT-3D 2020) → Next (2020 forecaster, more region) → Scale (all-India).]

---

## Slide 19 — Closing Ask

**A validated, honest, India-first climate twin — already running on ISRO's satellite data.**

- We built the loop, used India's data, ingested real INSAT-3D LST, and beat the baselines — verifiably.
- Everything runs offline and is reproducible from a cached cube and saved checkpoints.
- The ask: broader INSAT/MOSDAC LST access (multi-year, more variables) and the green light to scale the region.
- ClimaTwin India: the discipline of Earth-2, on India's data, in India's hands.

[Speaker note: End on the ask — broader data access + scale — not on a feature list.]

---

## Slide 20 — Q&A Prep (Anticipated Tough Questions)

**Crisp, honest answers to the questions judges will actually ask.**

- **"Did you leak data?"** No. Temporal split only (train ≤2018 / val 2019–21 / test 2022–23); normalization stats and climatology fit on train years only, applied to val/test.
- **"Did you compare to baselines?"** Always. Every skill number is reported against persistence and climatology — e.g. 1-day rainfall RMSE 7.35 vs 8.08 vs 9.41.
- **"Is it really a twin?"** Yes — `initialize`, `assimilate`, `step`, `whatif`, `impacts` are real code, not stubs, and run live in the demo.
- **"Is the INSAT-3D data real?"** Yes — 366 real INSAT-3D LST granules from MOSDAC, fused into a 2020 cube (LST coverage 0.6414) and rendered in 3D. Honest scope: it's read-only and single-year; the full multi-year cube still uses a synthetic LST channel.
- **"Why diffusion, not just interpolation?"** Bilinear blurs: FSS 0.68 and spectral power 0.16 vs truth. Diffusion gives FSS 0.82, spectral power 0.36, and lower RMSE (4.42 vs 5.34).
- **"Is the LLM hallucinating numbers?"** It can't invent metrics — the brain must cite every number to an actual twin call, and conformal coverage (≈0.90) is independently verified.
- **"Why call it assimilation if it's just nudging?"** Because we label it exactly that: simplified nudging (α=0.6), not Kalman — honesty over hype.

[Speaker note: Rehearse these verbatim. The credibility win is answering before being pushed.]

---

## Appendix — Visual Gallery (screenshots for slides)

All images live in `assets/pictures/`.

**Core dashboard**

- `assets/pictures/01-overview-mission-control.png` — Overview / Mission Control: globe, TWIN SYNC-PATH, live state tiles, 5-stage twin loop, capability cards.
- `assets/pictures/02-twin-free-run-drift.png` — Twin free-run drift: sync gauge, drift-over-lead curve, Reality/Twin/Drift heatmaps, assimilate toggle.
- `assets/pictures/03-explore-map-tmax.png` — Explore: 9×13 Delhi-NCR Tmax grid over the dark India map, cell popup, model select, timeline scrubber.
- `assets/pictures/04-whatif-scenario-diff.png` — What-If scenario diff: diverging Δ map, presets, ΔTemp/rainfall/urban sliders, impact deltas.
- `assets/pictures/05-validation-skill-leaderboard.png` — Validation: Tmax RMSE error map (2022–23 test), baseline-relative leaderboard, calibrated 90% coverage.
- `assets/pictures/06-downscale-rainfall-srcnn.png` — Downscale rainfall: bilinear vs SR-CNN wipe (17.56%), resolution ladder, CorrDiff ensemble, DEM ablation, spectrum.
- `assets/pictures/07-downscale-tmin-diffusion.png` — Downscale Tmin: honest negative result — diffusion over-textures vs near-optimal bilinear.
- `assets/pictures/08-command-console-brain.png` — Command Console: grounded agentic brain answering "when to sow" with a 1-step SIMULATE plan + cited numbers.
- `assets/pictures/09-downscale-guide-assistant.png` — Guide assistant panel open over the Downscale view.
- `assets/pictures/10-guide-assistant-panel.png` — Close-up of the Guide assistant panel: jargon-free explainer + ask-me-anything box.
- `assets/pictures/11-compare-models-modal.png` — Compare Models modal: Model A vs Model B + diff (A−B) map.

**Real INSAT-3D / 3D terrain (headline new work)**

- `assets/pictures/12-source-switcher-insat.png` — Data-source switcher popover: synthetic (IMD · Synthetic LST, 2000–2023) vs INSAT-3D (IMD · INSAT-3D LST, real fused LST, 2020).
- `assets/pictures/13-explore-3d-terrain-insat.png` — Explore 3D: real CartoDEM terrain relief (×1.6) with Tmax draped, INSAT-3D regime, ConvLSTM, orbit/zoom.
- `assets/pictures/14-explore-3d-insat-lst.png` — Explore 3D: REAL INSAT-3D Land Surface Temperature (18.9–50.8 °C, plasma colormap) draped on the CartoDEM terrain — the satellite-data headline.
- `assets/pictures/15-explore-2d-mosdac-lst.png` — Explore 2D: MOSDAC OFFLINE basemap (ADM1 boundaries, graticule, coverage locator) with the Delhi-NCR grid, INSAT-3D regime.
- `assets/pictures/16-whatif-insat-mosdac.png` — What-If on the INSAT-3D regime: SCENARIO DIFF ΔTmax over the MOSDAC basemap, presets + sliders + impact bar.
