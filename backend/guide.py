"""backend/guide.py — the always-on, context-aware GUIDE.

Where the brain (backend/brain.py) OPERATES the twin for power users, the guide EXPLAINS the
screen in plain language for someone who has never seen a climate dashboard. It "watches" the
current screen context (which view, which variable, which date) the frontend sends, and returns
a short, jargon-free description of what the user is looking at — plus a simplified answer if
they ask something.

Offline-first: every explanation is a deterministic template grounded in the real screen values.
If a local LLM is configured (OLLAMA_GUIDE_MODEL, else OLLAMA_MODEL — point either at your own
fine-tuned model), it ONLY rephrases the grounded text into friendlier prose; it never invents
numbers. Falls back to the deterministic text on any LLM error, so the guide never breaks.
"""
from __future__ import annotations

import os
from typing import Optional

from backend import ai_engine

# Plain-language, per-view "what am I looking at?" — written for a curious non-expert.
VIEW_HELP = {
    "overview": (
        "the mission overview. It's the home screen of ClimaTwin — a 'digital twin' (a live "
        "computer model) of the climate over {region}. The spinning globe and the glowing ring "
        "show the model mirroring real weather and predicting the next few days."
    ),
    "explore": (
        "the live map of {region}. Each coloured square is a small area (about 28 km wide); the "
        "colour shows {variable_plain} for {date}. Drag the timeline at the bottom to watch it "
        "change day by day, or click a square to see its forecast. Pick any date with the ANCHOR "
        "picker at the top-right."
    ),
    "twin": (
        "the digital twin at work. 'REALITY' is what actually happened; 'TWIN' is the model's "
        "guess. Watch them drift apart as it predicts further ahead — then snap back together "
        "when it 'assimilates' (takes in) a new real observation. That self-correcting loop is "
        "what makes it a twin rather than a plain forecast."
    ),
    "whatif": (
        "the what-if simulator. Move the sliders (or tap a preset like '+2°C heatwave') to ask "
        "'what would happen if it were warmer or rainier?'. The map shows the difference from "
        "normal, and the badges tell you who crosses a danger line — like heat stress or a "
        "missed sowing window."
    ),
    "validation": (
        "the honesty scoreboard. It checks the AI's predictions against what really happened in "
        "2022–2023 (years it never trained on). Green means the smart model beats the simple "
        "'tomorrow = today' baseline; amber means a simple method is hard to beat there. It even "
        "shows that the 90% confidence bands really do cover about 90% of cases."
    ),
    "downscale": (
        "the zoom-in lab. The AI takes a blurry coarse map and sharpens it to 5 km detail using "
        "India's own high-resolution INDmet data. The diffusion model even generates an ENSEMBLE "
        "(several plausible sharp maps) so you can see where it's confident and where it's not."
    ),
}

VAR_PLAIN = {
    "rainfall": "rainfall (how much rain fell, in millimetres)",
    "tmax": "the daytime high temperature",
    "tmin": "the night-time low temperature",
}

# Simple definitions for jargon that appears on screen.
GLOSSARY = {
    "digital twin": "a live computer copy of the real climate that updates itself with new data.",
    "assimilate": "the model taking in a fresh real observation to correct itself.",
    "ensemble": "running several slightly different predictions to show a range, not one guess.",
    "conformal": "a way to put an honest confidence band around a prediction.",
    "downscale": "turning a blurry low-detail map into a sharp high-detail one.",
    "baseline": "a dead-simple prediction (like 'tomorrow = today') that a real model must beat.",
    "diffusion": "a generative AI that builds a detailed image step by step from noise.",
    "twin loop": "mirror reality → predict forward → check vs real → correct → repeat.",
}


def _provider() -> str:
    return "ollama" if (os.getenv("OLLAMA_GUIDE_MODEL") or os.getenv("OLLAMA_MODEL")) else "grounded"


def _ollama_guide(prompt: str) -> str:
    """Use the guide model if set, else the shared brain model."""
    gm = os.getenv("OLLAMA_GUIDE_MODEL")
    if gm:
        prev = os.environ.get("OLLAMA_MODEL")
        os.environ["OLLAMA_MODEL"] = gm
        try:
            return ai_engine._ollama(prompt)
        finally:
            if prev is None:
                os.environ.pop("OLLAMA_MODEL", None)
            else:
                os.environ["OLLAMA_MODEL"] = prev
    return ai_engine._ollama(prompt)


def _grounded_values(screen: dict, ctx: dict) -> str:
    """A short, real, plain sentence of current numbers for the screen's date (best-effort)."""
    try:
        date = screen.get("date") or ctx["latest_date"]
        s = ctx["tools"]["state"](date)
        return (f"Right now for {date}: hottest spot about {s['max_tmax']:.0f}°C, average rain "
                f"about {s['mean_rain']:.0f} mm.")
    except Exception:
        return ""


def guide(screen: dict, ctx: dict, question: Optional[str] = None) -> dict:
    """screen = {view, variable, model, date, region}. Returns a simple, grounded explanation."""
    view = (screen.get("view") or "overview").lower()
    region = ctx.get("region", "Delhi-NCR")
    variable = screen.get("variable", "rainfall")
    var_plain = VAR_PLAIN.get(variable, variable)
    date = screen.get("date") or ctx.get("latest_date", "")

    tmpl = VIEW_HELP.get(view, VIEW_HELP["overview"])
    here = "You're looking at " + tmpl.format(region=region, variable_plain=var_plain, date=date)
    facts = _grounded_values(screen, ctx)

    answer = None
    from_brain = False  # a brain answer is ALREADY narrated — don't re-narrate it
    if question and question.strip():
        ql = question.lower()
        # conceptual / "what is X" → answer simply from the glossary or the view help
        concept = None
        for term, defn in GLOSSARY.items():
            if term in ql:
                concept = f"{term.capitalize()} = {defn}"
                break
        if concept is None and any(
            p in ql for p in ("what is", "what does", "what's this", "explain", "what am i looking", "meaning of")
        ):
            concept = here
        if concept:
            answer = concept
        else:
            # a data question → ground it via the brain (real numbers from the twin)
            try:
                from backend import brain as brain_mod
                tr = brain_mod.run(question, ctx)
                answer = tr["answer"]
                from_brain = True
            except Exception:
                answer = None

    plain = (here + (" " + facts if facts else "")).strip()
    provider = _provider()
    # Spend an LLM call ONLY on an explicit, guide-owned answer (a glossary/concept reply).
    # Passive screen context stays instant; a brain-delegated answer is already narrated, so
    # re-narrating it just doubled the latency (~2× the LLM round-trip).
    if provider == "ollama" and question and question.strip() and not from_brain:
        try:
            from backend import brain as brain_mod
            target = answer or plain
            prompt = (
                "You are ClimaTwin's friendly guide for someone who knows nothing about climate "
                "science. Rewrite the text below in 1–3 short, warm sentences a 12-year-old would "
                "understand. Reply in ENGLISH ONLY (no other scripts/characters). Keep EVERY number "
                "exactly as given and copy any [tool:field] token verbatim; invent nothing.\n\n"
                f"TEXT: {target}"
            )
            simp = _ollama_guide(prompt).strip()
            # GROUNDING GUARD (same as the brain): the rephrase may not introduce any number
            # absent from the grounded source text or config — else keep the deterministic text.
            allowed = set(brain_mod._numbers_in(target)) | brain_mod._allowed_numbers({}, ctx)
            if simp and brain_mod._is_grounded(simp, allowed):
                if answer:
                    answer = simp
                else:
                    plain = simp
            elif simp:
                provider = "grounded (LLM rephrase rejected: ungrounded number)"
        except Exception as e:
            provider = f"grounded (LLM {type(e).__name__})"

    # contextual quick-tips per view
    tips = {
        "explore": ["Pick a wet day (try 2023-08-23) to see rain on the map", "Click a square for its forecast", "Toggle 0.05° HI-RES for 5 km detail"],
        "whatif": ["Tap a preset like +2°C HEATWAVE", "Watch the badges flip when a threshold is crossed"],
        "validation": ["Green = the AI beats the simple baseline", "The bands really cover ~90% of cases"],
        "downscale": ["Hit GENERATE ENSEMBLE to sample sharp 5 km maps", "Rainfall has the real diffusion model"],
        "twin": ["Press GO LIVE to watch it update in real time"],
        "overview": ["Press ⌘K anytime to jump around", "Open the bottom console to ask the AI brain"],
    }.get(view, [])

    return {
        "view": view,
        "headline": here.split(". ")[0] + ".",
        "plain": plain,
        "facts": facts,
        "answer": answer,
        "tips": tips,
        "provider": provider,
    }
