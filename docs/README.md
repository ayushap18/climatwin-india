# ClimaTwin India — Documentation Index

The detailed docs behind the project. Start with the root [`../README.md`](../README.md) for the
overview and diagrams; this folder holds the deep references and the rubric → artifact mapping.

---

## Map

| Doc | What's inside |
|---|---|
| [`architecture.md`](architecture.md) | System architecture, the forecast algorithm, the twin loop (sequence), the AI brain, the full API, frontend↔backend wiring — with mermaid diagrams |
| [`datasets.md`](datasets.md) | Data sources, the data-finding approach (diagram), acquisition mechanics, the canonical cube, split/leakage discipline |
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
| **Problem clarity** | `../README.md` §1–2, `research.md` §1–2 | Twin-not-predictor framing; Earth-2 three-stage shape |
| **Data usage & preprocessing** | `data/build_cube.py`, `ingest_indmet.py`, `ingest_dem.py`, `ingest_insat.py`; `datasets.md` | IMD + INDmet 0.05° + real elevation + INSAT path; temporal splits; train-only norm |
| **Model development** | `models/` (baselines, analog, convlstm, ensemble, diffusion); `architecture.md` §2 | Two-head ConvLSTM; NNLS stacked ensemble; CorrDiff diffusion |
| **Prediction performance & validation** | `models/validate.py` → `validation_metrics.json`; Validation view | 1-day rainfall ensemble RMSE **7.35** vs persist 9.41 / clim 8.08; POD **0.64** / CSI **0.37**; conformal coverage **≈0.90** |
| **Digital twin concept** | `twin/climate_twin.py`; Twin view; `/twin/run` + `/ws/twin` | initialize/assimilate/step/whatif/impacts/run_twin; live reality-vs-twin drift + sync % |
| **Visualization & UI** | `frontend/` (6 views + Command Console) | Leaflet grid, time slider, what-if presets, drag-to-reveal downscale, honest leaderboard |
| **Innovation** | Stacked ensemble + conformal; CorrDiff diffusion; offline-first agentic brain + guide; fine-tuned local LLM | FSS **0.82** vs bilinear 0.68; grounded, citation-checked AI |
| **Presentation** | `pptcontent.md`; `prd.md` demo script | 19-slide deck + timed 4–6 min click path with the numbers to point at |

---

## The non-negotiables (recap)

1. The twin loop exists in code (`twin/climate_twin.py`).
2. National data first (IMD/INDmet/INSAT).
3. Baselines before claims (persistence + climatology beaten before any skill claim).
4. Temporal splits only — never random.
5. No leakage — every fitted stat is train-years-only.
6. Region is config-driven (`config.py`).
7. The demo runs offline from a cached cube.
8. Honesty over hype — limitations stated, INSAT labeled "roadmap", no fabricated metrics.

Full detail in [`../CLAUDE.md`](../CLAUDE.md).
