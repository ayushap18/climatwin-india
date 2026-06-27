"""scripts/export_finetune_data.py — build fine-tuning datasets from ClimaTwin's OWN twin.

Generates a few HUNDRED diverse, grounded instruction→response pairs (across many dates,
phrasings, views and refusal cases), so you can fine-tune a small local model that already
"speaks ClimaTwin" for BOTH personas:
  * brain  — the grounded operator (plans + cited answers)   -> data/finetune_brain.jsonl
  * guide  — the friendly simplifier (plain-language help)    -> data/finetune_guide.jsonl
  * combined (what you train on)                              -> data/finetune_all.jsonl

Each line is OpenAI-style chat JSON ({"messages":[{role,content}...]}), accepted directly by
Unsloth / Axolotl / MLX-LM / llama-factory.

Requires the backend running (make serve). Run:  python scripts/export_finetune_data.py
"""
from __future__ import annotations

import json
import random
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent.parent / "data"
rng = random.Random(7)  # reproducible

BRAIN_SYS = ("You operate ClimaTwin India's digital twin (rainfall + temperature over Delhi-NCR). "
             "Answer only with numbers the twin computed, cite them [tool:field], refuse out-of-scope.")
GUIDE_SYS = ("You are ClimaTwin's friendly guide. Explain the screen simply (1–3 sentences a "
             "12-year-old understands); keep every real number; never invent facts.")

# Dates spanning seasons (wet monsoon / dry winter / hot pre-monsoon / transition).
DATES = [
    "2023-08-23", "2023-07-09", "2022-08-15", "2021-07-20", "2022-06-25", "2023-09-11",
    "2023-01-15", "2023-12-31", "2023-02-10", "2020-12-20",
    "2022-05-20", "2023-05-12", "2023-06-01", "2021-05-25",
    "2023-03-21", "2023-10-05", "2022-11-08", "2023-04-18",
]
DT = [2, 3, 4]
H = [3, 5, 7]
MODELS = ["ensemble", "convlstm", "analog", "climatology"]

# in-scope question phrasings (varied wording → better generalisation)
INSCOPE = [
    "is it a good time to sow",
    "should I sow seeds now",
    "should I sow if it gets {dt}C warmer",
    "is it safe to plant if temperature rises {dt} degrees",
    "what's the {h} day forecast",
    "give me the next {h} days outlook",
    "will it rain enough to sow this week",
    "what if next week is {dt}C warmer",
    "what happens if it gets {dt} degrees hotter",
    "what if rainfall is halved",
    "what if the monsoon brings 50% more rain",
    "how accurate is the {model} model",
    "how good is the forecast vs a simple baseline",
    "is there a heat risk this week",
    "could there be a heatwave",
    "what is the climate state now",
    "summarise today's conditions",
    "show me the twin drift over the week",
    "how fast does the twin drift from reality",
]
# out-of-scope (must be REFUSED honestly) — date-independent
REFUSALS = (
    [f"what about {r} rainfall" for r in ["Mumbai", "Kerala", "Chennai", "Maharashtra", "Punjab", "Kashmir"]]
    + [f"what's the {v} forecast" for v in ["air quality", "humidity", "wind speed", "sea surface temperature"]]
    + [f"give me a {b} day forecast" for b in [14, 20, 30, 45]]
    + ["what was the rainfall in 1950", "predict the climate for 2099"]
)

GUIDE_VIEWS = ["overview", "explore", "twin", "whatif", "validation", "downscale"]
GUIDE_QS = [
    "what am I looking at", "what does this mean", "is a heatwave coming",
    "how do I see where it will rain", "what is a digital twin", "what is an ensemble",
    "what is a baseline", "explain this simply", "what can I do here",
]


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=120) as r:
        return json.loads(r.read())


def _fill(q: str) -> str:
    return q.format(dt=rng.choice(DT), h=rng.choice(H), model=rng.choice(MODELS))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    brain, guide = [], []

    # --- brain: many (date × varied question) pairs + the refusal set ---
    for date in DATES:
        for q in rng.sample(INSCOPE, k=8):          # 8 varied questions per date
            qf = _fill(q)
            try:
                r = _get(f"/brain?q={urllib.parse.quote(qf)}&date={date}")
                ans, cav = r.get("answer", ""), r.get("caveat", "")
                content = (ans + (f"\n\n{cav}" if cav and not r.get("refused") else "")).strip()
                if content:
                    brain.append({"messages": [
                        {"role": "system", "content": BRAIN_SYS},
                        {"role": "user", "content": qf},
                        {"role": "assistant", "content": content},
                    ]})
            except Exception as e:
                print(f"[export] brain '{qf}' failed: {e}")
    for q in REFUSALS:
        try:
            r = _get(f"/brain?q={urllib.parse.quote(q)}")
            brain.append({"messages": [
                {"role": "system", "content": BRAIN_SYS},
                {"role": "user", "content": q},
                {"role": "assistant", "content": r.get("answer", "").strip()},
            ]})
        except Exception as e:
            print(f"[export] refusal '{q}' failed: {e}")

    # --- guide: views × varied simple questions ---
    for v in GUIDE_VIEWS:
        for q in GUIDE_QS:
            try:
                r = _get(f"/guide?view={v}&variable=rainfall&q={urllib.parse.quote(q)}")
                content = (r.get("answer") or r.get("plain") or "").strip()
                if content:
                    guide.append({"messages": [
                        {"role": "system", "content": GUIDE_SYS},
                        {"role": "user", "content": f"[screen: {v}] {q}"},
                        {"role": "assistant", "content": content},
                    ]})
            except Exception as e:
                print(f"[export] guide '{v}/{q}' failed: {e}")

    (OUT / "finetune_brain.jsonl").write_text("\n".join(json.dumps(x) for x in brain))
    (OUT / "finetune_guide.jsonl").write_text("\n".join(json.dumps(x) for x in guide))
    (OUT / "finetune_all.jsonl").write_text("\n".join(json.dumps(x) for x in (brain + guide)))
    print(f"[export] wrote {len(brain)} brain + {len(guide)} guide = {len(brain)+len(guide)} pairs")
    print(f"[export]   data/finetune_brain.jsonl · finetune_guide.jsonl · finetune_all.jsonl")
    print("[export] train on finetune_all.jsonl. For an even stronger model, run this a few times "
          "or add more dates/phrasings above (more diverse pairs = better generalisation).")


if __name__ == "__main__":
    main()
