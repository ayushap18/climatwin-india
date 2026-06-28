<!-- ░░░ WIKI HOME ░░░ -->
<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0b3d91,50:1f6feb,100:ff8a3d&height=200&section=header&text=ClimaTwin%20India%20%C2%B7%20Wiki&fontSize=46&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Research%20%C2%B7%20Data%20%C2%B7%20Models%20%C2%B7%20Latency%20%C2%B7%20Real-time%20%C2%B7%20Future&descSize=15&descAlignY=60" alt="ClimaTwin India Wiki"/>
</p>

<p align="center">
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/Indian_Space_Research_Organisation_Logo.svg" height="68" alt="ISRO"/>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/NVIDIA_logo.svg" height="34" alt="NVIDIA Earth-2"/>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/Google_DeepMind_logo.png" height="40" alt="DeepMind"/>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/ECMWF_logo.svg" height="40" alt="ECMWF"/>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://commons.wikimedia.org/wiki/Special:FilePath/Copernicus_Logo_240.png" height="40" alt="Copernicus"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bharatiya_Antariksh_Hackathon-2026-ff8a3d?style=for-the-badge&logo=rocket&logoColor=white"/>
  <img src="https://img.shields.io/badge/Team-CodeCatalysts-1f6feb?style=for-the-badge&logo=atom&logoColor=white"/>
  <img src="https://img.shields.io/badge/ISRO-%C3%97_Hack2skill-0b3d91?style=for-the-badge"/>
</p>

---

Welcome to the **ClimaTwin India** engineering & research wiki. ClimaTwin is an **AI-powered digital twin
of India's climate** — it mirrors a live gridded climate state, **assimilates** observations,
**simulates** forward with a trained neural ensemble, **downscales** to ~5 km, runs **what-if** scenarios,
and is operable in plain English by a grounded, offline-first AI agent. Pilot region **Delhi-NCR**;
variables **rainfall + Tmax/Tmin**; horizon **1–14 days**.

It deliberately mirrors the architecture of **NVIDIA Earth-2** and **EU Destination Earth** — the same
`assimilate → forecast → downscale` shape — scaled honestly to hackathon compute.

> *This wiki records **reasoning, not aspiration**. Every numeric claim traces to this repo's own
> validation runs; every borrowed idea is attributed to the paper or system it came from.*

---

## 📖 Read the wiki in order

| # | Page | What you'll learn |
|---|---|---|
| 1 | **[[Research Foundations]]** | Every paper & system we built on, and *exactly what we took* from each (Earth-2, CorrDiff, GraphCast, DGMR, ConvLSTM, DDPM, conformal prediction). |
| 2 | **[[Data Sources and Provenance]]** | India-first data: IMD, INDmet, CHIRPS, ERA5-Land, CartoDEM/Copernicus, INSAT-3D/MOSDAC — how each is sourced, licensed, and preprocessed. |
| 3 | **[[Model Architecture and Approach]]** | Baselines → two-head ConvLSTM → analog k-NN → NNLS stacked ensemble → split-conformal bands → CorrDiff diffusion downscaler. Why each exists. |
| 4 | **[[Low Latency Engineering]]** | How the dashboard answers in **7–34 ms**: warm-start, `lru_cache`, offline-first, compact payloads, in-memory client cache, WebSocket streaming. |
| 5 | **[[Real-time Roadmap and the Best Model]]** | What it takes to make the forecaster *best-in-class for real-time*: streaming assimilation, multi-horizon rollout, INSAT fusion, FNO head, distillation, edge deploy. |
| 6 | **[[Future Scope]]** | Where ClimaTwin goes next: all-India scale-out, soil-moisture/drought (NICES), operational hardening, generative ensembles, policy decision support. |

➡️ Navigation also lives in the **[[_Sidebar|sidebar]]** on every page.

---

## 🛰️ The three-stage twin, at a glance

```mermaid
flowchart LR
    subgraph N["🌍 North stars (full scale)"]
        E2["NVIDIA Earth-2"]:::n
        DE["EU DestinE"]:::n
    end
    subgraph C["🧪 ClimaTwin (PoC scale, honest)"]
        A["ASSIMILATE<br/>α-nudging"]:::a
        F["FORECAST<br/>ConvLSTM + ensemble"]:::f
        D["DOWNSCALE<br/>CorrDiff diffusion"]:::d
    end
    N -.same shape.-> C
    A --> F --> D
    classDef n fill:#0b3d91,color:#fff
    classDef a fill:#ff8a3d,color:#000
    classDef f fill:#1f6feb,color:#fff
    classDef d fill:#138808,color:#fff
```

---

## 📊 Headline verified results (untouched 2022–23 test split)

| Claim | Number | Baseline it beats |
|---|---|---|
| 1-day rainfall RMSE (ensemble) | **7.35 mm** | persistence 9.41 · climatology 8.08 |
| 1-day Tmax / Tmin RMSE (ensemble) | **1.51 / 1.05 °C** | persistence 1.59 / — |
| Rain detection POD / CSI (1-day) | **0.64 / 0.37** | persistence 0.45 / 0.29 |
| Conformal 90% interval coverage | **≈0.90** | — (verified, not assumed) |
| Diffusion downscaler FSS@2.5 mm | **0.82** | bilinear 0.68 |
| Dashboard request latency | **7–34 ms** | (see [[Low Latency Engineering]]) |

---

## 🔗 Project links

- 📦 **Repository:** [`ayushap18/climatwin-india`](https://github.com/ayushap18/climatwin-india)
- 🖼️ **Screenshot gallery:** [`assets/images/`](https://github.com/ayushap18/climatwin-india/tree/main/assets/images)
- 🧠 **Backend README:** [`backend/`](https://github.com/ayushap18/climatwin-india/tree/main/backend)
- 🖥️ **Frontend README:** [`frontend/`](https://github.com/ayushap18/climatwin-india/tree/main/frontend)
- 📚 **In-repo research doc:** [`docs/research.md`](https://github.com/ayushap18/climatwin-india/blob/main/docs/research.md)

---

<sub>Logos: ISRO, NVIDIA, Google DeepMind, ECMWF, Copernicus — via Wikimedia Commons, used for
attribution/reference. Satellite imagery credited on each page. ClimaTwin is an independent
hackathon project and is not affiliated with or endorsed by these organisations.</sub>
