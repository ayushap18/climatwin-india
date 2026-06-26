"""backend/ai_engine.py — the ClimaTwin `/ai` assistant.

Grounded-first: parse the question, call the app's OWN tools to fetch real numbers, and
compose a decision-oriented answer. If an LLM provider is configured it only *rephrases*
that answer using the fetched data — so it can't hallucinate and behaves the same offline
(deterministic) or online (natural language).

Providers (auto-detected, in order):
  * Gemini  — set GEMINI_API_KEY (or GOOGLE_API_KEY); optional GEMINI_MODEL
  * Ollama  — set OLLAMA_MODEL (local); optional OLLAMA_HOST (default 127.0.0.1:11434)
  * grounded — always available, no key, fully offline (the default here)
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Callable, Dict

# --------------------------------------------------------------------------- #
# intent + slot parsing
# --------------------------------------------------------------------------- #
_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_NUM_RE = re.compile(r"[-+]?\d+(?:\.\d+)?")


def _date(q: str, latest: str) -> str:
    m = _DATE_RE.search(q)
    if m:
        return m.group(1)
    return latest  # "today / now / latest / current" all map to the latest observed day


def _horizon(q: str) -> int:
    m = re.search(r"next\s+(\d+)\s*day", q)
    if m:
        return max(1, min(14, int(m.group(1))))
    if "week" in q:
        return 7
    return 7


def detect_intent(q: str) -> str:
    s = q.lower()
    if re.search(r"what.?if|scenario|\bif\b.*(rise|increase|drop|fall|warmer|hotter|cooler|less rain|more rain)", s):
        return "whatif"
    if re.search(r"\btwin\b|drift|de.?sync|\bsync\b|assimilat", s):
        return "twin"
    if re.search(r"accura|skill|which model|best model|valid|\brmse\b|reliable|trust|how good", s):
        return "validate"
    if re.search(r"\bsow|plant|seed|kharif|monsoon onset", s):
        return "sowing"
    if re.search(r"forecast|predict|next\s+\d*\s*(day|week)|tomorrow|coming|upcoming|will it|outlook", s):
        return "forecast"
    if re.search(r"help|what can you|who are you|capabilit|^\s*(hi|hello|hey)\b", s):
        return "help"
    return "state"


# --------------------------------------------------------------------------- #
# gather: pick tools, fetch real data, draft a grounded answer
# --------------------------------------------------------------------------- #
def gather(question: str, ctx: dict) -> dict:
    tools: Dict[str, Callable] = ctx["tools"]
    latest = ctx["latest_date"]
    region = ctx["region"]
    intent = detect_intent(question)
    used, data, draft = [], {}, ""

    if intent == "help":
        draft = (
            f"I'm the ClimaTwin assistant for {region}. Ask me about conditions on a date, "
            f"the forecast and sowing window, heat-stress, what-if scenarios "
            f"(e.g. \"what if temperature rises 3°C?\"), model skill, or the twin's drift. "
            f"Data covers {ctx['dates'][0]}…{ctx['dates'][1]}."
        )
        return {"intent": intent, "used": used, "data": data, "draft": draft}

    date = _date(question, latest)

    if intent in ("forecast", "sowing"):
        h = _horizon(question)
        used.append("forecast")
        f = tools["forecast"](date, h)
        data = f
        sw = f["sowing"]
        rain_total = round(sum(f["mean_rain"]), 1)
        if intent == "sowing":
            if sw["sowing_ok"]:
                draft = (
                    f"Sowing window: onset on lead day +{sw['onset_lead_day']} "
                    f"({sw['accumulated_rain_mm']} mm accumulated vs a {sw['threshold_mm']} mm threshold) "
                    f"over the {h}-day outlook from {f['init']}. Conditions look favourable."
                )
            else:
                draft = (
                    f"No sowing onset in the next {h} days from {f['init']}: only "
                    f"{sw['accumulated_rain_mm']} mm accumulates vs the {sw['threshold_mm']} mm threshold. Hold off."
                )
        else:
            draft = (
                f"{h}-day forecast from {f['init']} ({f['model']}): ~{rain_total} mm total rainfall, "
                f"peak Tmax ~{max(f['max_tmax']):.1f}°C. "
                f"Sowing {'onset +' + str(sw['onset_lead_day']) + 'd' if sw['sowing_ok'] else 'not triggered'}."
            )

    elif intent == "whatif":
        dt = 0.0
        ms = re.search(r"(rise|increase|warmer|hotter|up)\D{0,12}?([-+]?\d+(?:\.\d+)?)", question.lower())
        if ms:
            dt = float(ms.group(2))
        ms2 = re.search(r"(drop|fall|cooler|down|less)\D{0,12}?([-+]?\d+(?:\.\d+)?)", question.lower())
        if ms2 and "rain" not in question.lower():
            dt = -float(ms2.group(2))
        if dt == 0.0:
            nums = _NUM_RE.findall(question)
            dt = float(nums[0]) if nums else 2.0
        rf = 1.0
        if re.search(r"half|halve", question.lower()):
            rf = 0.5
        elif re.search(r"double|twice", question.lower()):
            rf = 2.0
        else:
            mp = re.search(r"rain\w*\D{0,12}?(\d+)\s*%", question.lower())
            if mp:
                rf = int(mp.group(1)) / 100.0
        used.append("whatif")
        w = tools["whatif"](date, dt, rf)
        data = w
        draft = (
            f"Scenario on {date} (ΔT {dt:+.1f}°C, rainfall ×{rf:g}): "
            f"max Tmax {w['base_tmax']}→{w['scen_tmax']}°C, "
            f"heat-stress {w['base_heat']}→{w['scen_heat']}% of cells, "
            f"sowing onset {w['base_sowing'] or '—'}→{w['scen_sowing'] or 'none'}. "
            + ("A clear worsening of heat stress." if w["scen_heat"] > w["base_heat"] else "Limited impact on heat stress.")
        )

    elif intent == "validate":
        used.append("validate")
        v = tools["validate"]()
        data = v
        parts = [f"{vr}: {best}" for vr, best in v["best"].items()]
        draft = (
            f"Skill vs baselines at {v['horizon']}-day lead — best model per variable: "
            + "; ".join(parts)
            + f". Rain detection POD {v['pod']}, CSI {v['csi']}. "
            f"(All skill is reported relative to persistence/climatology baselines — honest by design.)"
        )

    elif intent == "twin":
        h = _horizon(question)
        used.append("twin")
        t = tools["twin"](date, h)
        data = t
        draft = (
            f"Running the twin from {t['anchor']} for {h} days ({t['model']}): free-running, sync decays "
            f"{t['free_sync'][0]}%→{t['free_sync'][-1]}% (Tmax drift grows to {t['free_drift'][-1]}°C). "
            f"With observation assimilation it holds {t['assim_sync'][-1]}% — that re-syncing is what makes it a twin, not a forecast."
        )

    else:  # state
        used.append("state")
        s = tools["state"](date)
        data = s
        draft = (
            f"On {s['date']}, {region}: max Tmax {s['max_tmax']}°C, mean rainfall {s['mean_rain']} mm, "
            f"heat-stress over {s['heat_pct']}% of cells, dryness index {s['dryness']} "
            f"({'drier' if s['dryness'] < 0 else 'wetter'} than the seasonal normal)."
        )

    return {"intent": intent, "used": used, "data": data, "draft": draft}


# --------------------------------------------------------------------------- #
# optional LLM rephrasing (grounded in the fetched data only)
# --------------------------------------------------------------------------- #
def _provider() -> str:
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return "gemini"
    if os.getenv("OLLAMA_MODEL"):
        return "ollama"
    return "grounded"


def _llm_prompt(question: str, g: dict, ctx: dict) -> str:
    return (
        "You are ClimaTwin's climate assistant for the " + ctx["region"] + " region of India "
        "(a digital twin over IMD/INSAT data; variables rainfall, tmax, tmin). "
        "Answer the user's question in 1–3 sentences, concrete and decision-oriented. "
        "Use ONLY the JSON facts below — do not invent numbers. If they don't cover the question, say so.\n\n"
        f"FACTS: {json.dumps(g['data'], default=str)}\n"
        f"A grounded draft you may improve: {g['draft']}\n\n"
        f"USER: {question}"
    )


def _gemini(prompt: str) -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.loads(r.read())
    return out["candidates"][0]["content"]["parts"][0]["text"].strip()


def _ollama(prompt: str) -> str:
    host = os.getenv("OLLAMA_HOST", "127.0.0.1:11434")
    model = os.getenv("OLLAMA_MODEL")
    url = f"http://{host}/api/generate"
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read())
    return out.get("response", "").strip()


def answer(question: str, ctx: dict) -> dict:
    g = gather(question, ctx)
    provider = _provider()
    text = g["draft"]
    if provider != "grounded" and g["draft"]:
        try:
            prompt = _llm_prompt(question, g, ctx)
            text = (_gemini(prompt) if provider == "gemini" else _ollama(prompt)) or g["draft"]
        except Exception as e:  # any LLM failure -> fall back to the grounded draft (never break)
            provider = f"grounded (LLM {type(e).__name__})"
            text = g["draft"]
    return {
        "question": question,
        "intent": g["intent"],
        "provider": provider,
        "used": g["used"],
        "answer": text,
        "data": g["data"],
    }
