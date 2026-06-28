# 6 · Future Scope

> *Where ClimaTwin goes after the real-time work in [[Real-time Roadmap and the Best Model]].* These are
> ambitions stated as **concrete, testable steps** — each inherits the project's non-negotiables
> (India-first data, baselines before claims, temporal splits, honesty over hype).

<p align="center">
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/Northern_India_17_Jun_2013.jpg" height="230" alt="Northern India from space"/>
</p>
<p align="center"><sub>The end state: one config switch turns the Delhi-NCR pilot into a national twin. <em>Image: NASA, via Wikimedia Commons.</em></sub></p>

---

## The phase map

```mermaid
flowchart LR
    subgraph DONE["✅ Done (P0+P1)"]
        a["twin loop + assimilation"]
        b["two-head ConvLSTM"]
        c["analog + NNLS ensemble + conformal"]
        d["real DEM"]
        e["CorrDiff diffusion (rainfall)"]
        f["agentic brain + guide"]
        g["React dashboard + live WS"]
    end
    subgraph NOW["⏳ In flight"]
        h["multi-horizon rollout"]
        i["fine-tuned local LLM quality"]
    end
    subgraph NEXT["🔭 Future scope"]
        j["real INSAT-3D LST fusion"]
        k["all-India scale-out"]
        l["soil-moisture / drought (NICES)"]
        m["FNO / transformer head"]
        n["operational hardening"]
        o["decision-support products"]
    end
    DONE --> NOW --> NEXT
    style DONE fill:#138808,color:#fff
    style NEXT fill:#0b3d91,color:#fff
```

---

## 1 · All-India scale-out (the flagship deliverable)

The pilot region is **one line in `config.py`**. Changing the bbox rebuilds the cube → model → dashboard
with **no code edits** — this *is* the "scalable to national" claim, demonstrated rather than asserted.

**Future work:** tile India into overlapping 0.25° blocks, run the pipeline per tile, and stitch. The
honesty rule survives the jump: each tile keeps **train-only** statistics and a **temporal** split, so
national scale never becomes a leakage shortcut.

---

## 2 · New variables & products (NICES)

Extend beyond rainfall + temperature into **soil moisture** and **drought** indices via ISRO's **NICES**
(National Information System for Climate and Environment Studies) datasets.
**Why it fits:** the twin already computes an SPI-lite dryness index and a sowing-window onset — soil
moisture turns those *proxies* into *physical* agricultural decision signals.

---

## 3 · Generative ensembles for extremes

Today's diffusion model produces a sharp rainfall ensemble for **downscaling**. Future scope: use the same
generative machinery for **forecast** ensembles of extreme events (heatwaves, cloudbursts), scored on
**CRPS** and reliability — the natural extension of the [[Research Foundations|DGMR / CorrDiff lineage]].

---

## 4 · Stronger neural cores

- **FNO / transformer head** as an additional ensemble member (only if it earns its NNLS weight).
- A **fine-tuned local LLM** (QLoRA on Qwen2.5-3B-Instruct) that *rephrases* grounded text more fluently —
  the **grounding guard stays in front of it**, so it can never originate a number.

---

## 5 · Operational hardening

| Area | Future work |
|---|---|
| **Data** | live IMD + MOSDAC ingestion with retries, provenance stamping, and gap-filling |
| **Serving** | distilled model + horizontal scaling behind the existing cached API |
| **Monitoring** | online conformal recalibration + continuous `anomaly_scan` drift alerts |
| **Reliability** | the demo already runs **fully offline** — production keeps that as a guaranteed fallback |

---

## 6 · Decision-support products (impact, not just forecast)

The twin's value is its **decision layer**. Future scope packages it for users:

- **Agriculture** — sowing-window advisories per district, with confidence bands.
- **Public health** — heat-stress early warning tied to the Tmax-threshold map.
- **Urban planning** — the urban-polygon what-if tool as a real **urban-heat-island** planning aid.
- **Water** — SPI-lite dryness → drought watch as NICES soil moisture comes online.

Each is a thin product layer over tools the twin *already* exposes — the agentic brain can already answer
"when should I sow?" grounded in real numbers.

---

## What will **never** change

The roadmap is ambitious; the principles are fixed:

> **Build the loop. Use India's data. Validate against baselines. Quote real numbers with their
> uncertainty. Say where the simplifications are. Keep the demo offline and rehearsed.**

That discipline is what lets the scope grow without the credibility shrinking.

➡️ Back to **[[Home]]** · or revisit **[[Real-time Roadmap and the Best Model]]**.

---

<sub>Imagery: NASA via Wikimedia Commons, used for reference. Roadmap maps to `docs/implementation.md`.
ClimaTwin is an independent hackathon project and is not affiliated with ISRO, NASA, NVIDIA, DeepMind,
ECMWF, or Copernicus.</sub>
