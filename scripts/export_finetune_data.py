"""scripts/export_finetune_data.py — build fine-tuning datasets from ClimaTwin's OWN twin.

Generates instruction→response pairs grounded in the live twin, so you can fine-tune a small
local model that already "speaks ClimaTwin" for BOTH personas:
  * brain  — the grounded operator (plans + cited answers)   -> data/finetune_brain.jsonl
  * guide  — the friendly simplifier (plain-language help)    -> data/finetune_guide.jsonl

Each line is OpenAI-style chat JSON ({"messages":[{role,content}...]}), which most fine-tuning
stacks (Unsloth, Axolotl, MLX-LM, llama-factory) accept directly.

Requires the backend running (make serve). Run:  python scripts/export_finetune_data.py
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent.parent / "data"

BRAIN_SYS = ("You operate ClimaTwin India's digital twin (rainfall + temperature over Delhi-NCR). "
             "Answer only with numbers the twin computed, cite them [tool:field], refuse out-of-scope.")
GUIDE_SYS = ("You are ClimaTwin's friendly guide. Explain the screen simply (1–3 sentences a "
             "12-year-old understands); keep every real number; never invent facts.")

# Representative questions that exercise every intent (incl. honest refusals).
BRAIN_QS = [
    "is it a good time to sow if temperature rises 3C",
    "what's the 7 day forecast",
    "what if next week is 2C warmer",
    "how accurate is the model",
    "show the twin drift",
    "what is the state today",
    "what about Mumbai rainfall",          # refusal: region
    "give me a 30 day forecast",           # refusal: horizon
    "what's the air quality",              # refusal: variable
    "when will it rain enough to sow",
    "is there a heat risk this week",
]
GUIDE_VIEWS = ["overview", "explore", "twin", "whatif", "validation", "downscale"]
GUIDE_QS = ["what am I looking at", "what does this mean", "is a heatwave coming",
            "how do I see where it will rain", "what is a digital twin"]


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=120) as r:
        return json.loads(r.read())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    brain, guide = [], []

    for q in BRAIN_QS:
        try:
            r = _get(f"/brain?q={urllib.parse.quote(q)}")
            ans = r.get("answer", "")
            cav = r.get("caveat", "")
            content = (ans + (f"\n\n{cav}" if cav and not r.get("refused") else "")).strip()
            brain.append({"messages": [
                {"role": "system", "content": BRAIN_SYS},
                {"role": "user", "content": q},
                {"role": "assistant", "content": content},
            ]})
        except Exception as e:
            print(f"[export] brain '{q}' failed: {e}")

    for v in GUIDE_VIEWS:
        for q in (["what am I looking at"] + GUIDE_QS):
            try:
                r = _get(f"/guide?view={v}&variable=rainfall&q={urllib.parse.quote(q)}")
                content = (r.get("answer") or r.get("plain") or "").strip()
                guide.append({"messages": [
                    {"role": "system", "content": GUIDE_SYS},
                    {"role": "user", "content": f"[screen: {v}] {q}"},
                    {"role": "assistant", "content": content},
                ]})
            except Exception as e:
                print(f"[export] guide '{v}/{q}' failed: {e}")

    (OUT / "finetune_brain.jsonl").write_text("\n".join(json.dumps(x) for x in brain))
    (OUT / "finetune_guide.jsonl").write_text("\n".join(json.dumps(x) for x in guide))
    print(f"[export] wrote {len(brain)} brain + {len(guide)} guide examples to {OUT}/finetune_*.jsonl")
    print("[export] NOTE: this is a seed set. Expand it (more dates, more phrasings) before a real "
          "fine-tune — a few hundred diverse, grounded pairs is the practical minimum.")


if __name__ == "__main__":
    main()
