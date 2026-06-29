# ClimaTwin India — Documentation Index

The detailed docs behind the project. Start with the root [`../README.md`](../README.md) for the
overview and diagrams; this folder holds the deep references and the rubric → artifact mapping.

---

## Map

| Doc | What's inside |
|---|---|
| [`architecture.md`](architecture.md) | System architecture, the forecast algorithm, the twin loop (sequence), the AI brain, the full API, frontend↔backend wiring — with mermaid diagrams |
| [`datasets.md`](datasets.md) | Data sources, the data-finding approach (diagram), acquisition mechanics, the canonical cube, the dual-source regimes, split/leakage discipline |
| [`research.md`](research.md) | Why each decision was made, SOTA north stars (Earth-2 / DestinE / CorrDiff / DGMR), references |
| [`prd.md`](prd.md) | Requirements, feature inventory, impact signals, the timed demo script |
| [`implementation.md`](implementation.md) | Build order, command cheat-sheet, the golden rule, P0/P1/P2 phases, future work |
| [`pptcontent.md`](pptcontent.md) | Slide-by-slide deck content + Q&A prep |
| [`../CLAUDE.md`](../CLAUDE.md) | Operating guide for AI coding agents working on the repo |

---

## Rubric → artifact map (ISRO evaluation)

Every rubric row maps to a concrete, inspectable artifact. Before declaring a milestone done, check
the row has a real artifact behind it.

| Rubric row | Concrete artifact | Verified evidence |
|---|---|---|
| **Problem clarity** | `../README.md` §1–2, `research.md` §1–2 | Twin-not-predictor framing; Earth-2 three-stage shape (assimilate → forecast → downscale) over the Delhi-NCR pilot |
| **Data usage & preprocessing** | `data/build_cube.py`, `ingest_indmet.py`, `ingest_dem.py`; **real MOSDAC/INSAT-3D path** `data/mosdac_client.py` + `ingest_insat.py` + `build_cube_2020.py` → `twin_cube_2020.nc`; `datasets.md` | IMD gridded + INDmet 0.05° + real CartoDEM/Copernicus elevation + **real INSAT-3D LST** (native MOSDAC client, 366 real `3DIMG_*_L2B_LST` granules for 2020 decoded h5→0.25°, `lst_coverage 0.6414`) as a read-only 2020 regime; temporal/month splits; train-only normalization |
| **Model development** | `models/` (baselines, analog, convlstm, ensemble, diffusion); `architecture.md` §2 | Two-head ConvLSTM (LST conditioned on train-only day-of-year climatology); NNLS stacked ensemble; CorrDiff residual diffusion |
| **Prediction performance & validation** | `models/validate.py` → `validation_metrics.json`; Validation view | 1-day rainfall ensemble RMSE **7.35** vs persist 9.41 / clim 8.08; POD **0.64** / CSI **0.37**; conformal coverage **≈0.90** (all on temporal test 2022–23, baseline-relative) |
| **Digital twin concept** | `twin/climate_twin.py` (source-aware); Twin view; `/twin/run` + `/ws/twin` | initialize/assimilate/step/whatif/impacts/run_twin; live reality-vs-twin drift + sync %; one twin class operates either data regime |
| **Visualization & UI** | `frontend/` (6 views + Command Console); **3D terrain** `map3d/Terrain3D.tsx`; **MOSDAC offline basemap** `map/MosdacBasemap.tsx`; source switcher `controls/SourceSelect.tsx` | Real CartoDEM terrain relief (×1.6) with variable + real INSAT-3D LST drape and 3D/2D toggle; MOSDAC offline basemap (ADM1 + graticule); time slider; what-if diff presets; drag-to-reveal downscale; honest leaderboard |
| **Innovation** | **Dual-source regime registry** (`synthetic` vs read-only `insat_real` 2020) in `backend/app.py`; stacked ensemble + conformal; CorrDiff diffusion; offline-first agentic brain + guide; fine-tuned local LLM | Single validated model served over two source-aware data regimes (provenance switch, not a second model); FSS **0.82** vs bilinear 0.68 (rainfall); grounded, citation-checked AI |
| **Presentation** | `pptcontent.md`; `prd.md` demo script | 19-slide deck + timed 4–6 min click path with the numbers to point at |

---

## New visuals — the INSAT-3D / 3D-terrain regime

The headline new work: a dual-source regime where the `insat_real` (2020) data regime drapes **real
INSAT-3D Land Surface Temperature** over real CartoDEM terrain, with a MOSDAC offline basemap. These
are read-only observation layers — LST is never a forecast variable, and the multi-year synthetic
regime remains the validated default.

| | |
|---|---|
| ![Data-source switcher](../assets/pictures/12-source-switcher-insat.png) | **Data-source switcher** — synthetic (IMD · Synthetic LST, 2000–2023) vs INSAT-3D (IMD · INSAT-3D LST, real fused LST, 2020); both ACTIVE |
| ![Explore 3D terrain](../assets/pictures/13-explore-3d-terrain-insat.png) | **Explore 3D** — real CartoDEM terrain relief (×1.6) with Tmax draped, INSAT-3D regime, ConvLSTM, orbit/zoom |
| ![Real INSAT-3D LST in 3D](../assets/pictures/14-explore-3d-insat-lst.png) | **Real INSAT-3D LST** (18.9–50.8 °C, plasma) draped on the CartoDEM terrain — the satellite-data headline |
| ![MOSDAC offline basemap](../assets/pictures/15-explore-2d-mosdac-lst.png) | **Explore 2D** — MOSDAC OFFLINE basemap (ADM1 boundaries, graticule, coverage locator) with the Delhi-NCR grid |
| ![What-If on INSAT-3D regime](../assets/pictures/16-whatif-insat-mosdac.png) | **What-If on the INSAT-3D regime** — SCENARIO DIFF ΔTmax over the MOSDAC basemap, presets + sliders + impact bar |

---

## The non-negotiables (recap)

1. The twin loop exists in code (`twin/climate_twin.py`).
2. National data first (IMD / INDmet / real INSAT-3D LST via MOSDAC).
3. Baselines before claims (persistence + climatology beaten before any skill claim).
4. Temporal splits only — never random.
5. No leakage — every fitted stat is train-years-only.
6. Region is config-driven (`config.py`; pilot = Delhi-NCR).
7. The demo runs offline from cached cubes.
8. Honesty over hype — limitations stated. Real INSAT-3D LST is genuinely integrated, but only as a
   read-only single-year (2020) regime (366 real granules, `lst_coverage 0.6414`); the full
   multi-year cube still serves a `synthetic_demo` LST channel, and the 2020 climatology RMSE is a
   degenerate artifact (meaningful comparison there is ConvLSTM vs persistence). No fabricated metrics.

Full detail in [`../CLAUDE.md`](../CLAUDE.md).
