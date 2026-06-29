"""backend/brain.py — ClimaTwin's offline-first agentic *brain*.

A deterministic, multi-step orchestrator over the twin's OWN tools. It plans, executes,
critiques and explains — every figure in an answer comes from a real tool call and is
cited ``[tool:field]``. This is the headline differentiator: it *operates* the twin, it
never fabricates. It works fully WITHOUT any LLM (the planner / executor / critic /
grounding guard are plain Python); an optional Ollama layer only *rephrases* the already
grounded text and is forbidden from emitting any new number (a grounding guard enforces
this and downgrades to the deterministic draft on any violation).

Pipeline (CLAUDE.md §2, §8):
    PLANNER  -> ordered steps, each tagged with a twin stage + the tool/args it will call
    EXECUTOR -> calls the REAL tool, collects a citable fact dict (never invents numbers)
    CRITIC   -> deterministic checks (citations resolve? validate before any skill claim?
                scope ok?) and revises ONCE if a check fails
    EXPLAINER-> composes a 1-3 sentence decision answer with inline [tool:field] citations
                and an honest caveat; optional Ollama narration (grounded only)
    GUARD    -> asserts every number in the final answer exists in the fact dict

Reused from ``backend/ai_engine.py``: intent/slot parsing (``_date``, ``_horizon``,
``detect_intent``) and the Ollama provider plumbing (``_provider``, ``_ollama``).

Twin tools the brain drives (wired by ``backend/app.py`` into ``ctx['tools']``):
    state(date)               -> MIRROR
    forecast(date, horizon)   -> SIMULATE
    whatif(date, dTemp, rf)   -> PERTURB
    twin(date, horizon)       -> ASSIMILATE
    validate()                -> SKILL
"""
from __future__ import annotations

import os
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend import ai_engine
from backend.ai_engine import _date, _horizon, detect_intent

# --------------------------------------------------------------------------- #
# Stage vocabulary. The first five mirror the twin loop (and the frontend
# TwinCore ring); SKILL is the validation stage, IMPACT the decision layer,
# REFUSE the honest out-of-scope stop.
# --------------------------------------------------------------------------- #
STAGES = ("MIRROR", "ASSIMILATE", "SIMULATE", "PERTURB", "SKILL", "IMPACT", "REFUSE")

# Which tool each stage drives (None = a pure synthesis/derive step, no tool call).
_TOOL_STAGE = {
    "state": "MIRROR",
    "forecast": "SIMULATE",
    "whatif": "PERTURB",
    "twin": "ASSIMILATE",
    "validate": "SKILL",
}

# Words that constitute a *skill / accuracy* claim — any of these in an answer REQUIRES
# a prior validate() call (CLAUDE.md §2.3 / §8: no skill claim without a baseline).
_SKILL_WORDS = re.compile(
    r"\b(skill|accura\w*|rmse|pod|csi|far|reliab\w*|best model|beats?\s+baseline|"
    r"baseline|valid\w*|trust\w*|confiden\w*|outperform\w*|out[-\s]?perform\w*|"
    r"improv\w*|capab\w*|better\s+than|strong\w*|excel\w*|how\s+good)\b",
    re.I,
)

# Out-of-scope guards (scope lock: Delhi-NCR, rainfall/tmax/tmin, 1-7 day, 2000-2023).
# NOTE: Delhi-NCR overlaps parts of Haryana / UP / Rajasthan, so those are NOT refused;
# only clearly-distant states/cities are out of scope.
_OTHER_REGIONS = re.compile(
    r"\b(maharashtra|mumbai|pune|nagpur|chennai|tamil\s*nadu|kerala|kochi|bengaluru|"
    r"bangalore|karnataka|kolkata|west\s*bengal|hyderabad|telangana|gujarat|ahmedabad|"
    r"surat|goa|assam|guwahati|bihar|patna|odisha|bhubaneswar|chhattisgarh|jharkhand|"
    r"jaipur|jodhpur|udaipur|kota|ajmer|lucknow|kanpur|agra|varanasi|allahabad|prayagraj|"
    r"madhya\s*pradesh|indore|bhopal|punjab|amritsar|ludhiana|chandigarh|himachal|shimla|uttarakhand|"
    r"dehradun|jammu|kashmir|srinagar|ladakh|leh|sikkim|manipur|nagaland|mizoram|"
    r"tripura|meghalaya|arunachal|andaman|lakshadweep|puducherry|"
    r"all[-\s]?india|pan[-\s]?india|nationwide)\b",
    re.I,
)
_OTHER_VARS = re.compile(
    r"\b(humid\w*|wind\w*|pressure|air\s*quality|aqi|pm\s?2\.?5|pm\s?10|pollut\w*|smog|"
    r"snow\w*|cyclone|sea\s*level|solar\s*radiation|ozone|visibility)\b",
    re.I,
)


# --------------------------------------------------------------------------- #
# small numeric helpers (the grounding contract)
# --------------------------------------------------------------------------- #
def _num_forms(v: float) -> List[str]:
    """All plausible string renderings of a numeric fact, used to ground answer text."""
    forms = set()
    for x in (v, abs(v)):
        forms.add(f"{x}")
        forms.add(f"{x:g}")
        forms.add(f"{round(x, 1)}")
        forms.add(f"{round(x, 1):g}")
        forms.add(f"{round(x, 2)}")
        forms.add(f"{round(x, 2):g}")
        if float(x).is_integer():
            forms.add(f"{int(x)}")
    return [f for f in forms if f]


def _collect_numbers(obj: Any, out: set) -> None:
    """Recursively gather every numeric leaf in a fact tree into a set of string forms."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.update(_num_forms(float(obj)))
    elif isinstance(obj, str):
        # numeric strings (e.g. a horizon key "1") count as grounded numbers too
        try:
            out.update(_num_forms(float(obj)))
        except ValueError:
            pass
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _collect_numbers(v, out)


def _allowed_numbers(facts: dict, ctx: dict) -> set:
    """Every number the brain is permitted to state = numbers present in the facts,
    plus the real config thresholds/date-bounds (constants, not fabricated claims)."""
    allowed: set = set()
    _collect_numbers(facts, allowed)
    thr = ctx.get("thresholds", {})
    _collect_numbers(list(thr.values()), allowed)
    _collect_numbers(list(ctx.get("grid", {}).values()), allowed)  # config grid (rows/cols/res)
    start, end = ctx.get("dates", ("2000-01-01", "2023-12-31"))
    allowed.update({start[:4], end[:4]})
    return allowed


def _numbers_in(text: str) -> List[str]:
    """Numbers a reader would see in `text`, ignoring [tool:field] citations and ISO dates
    (whose hyphens would otherwise be mis-read as signs)."""
    t = re.sub(r"\[[^\]]*\]", " ", text)
    t = re.sub(r"\d{4}-\d{2}-\d{2}", " ", t)
    return re.findall(r"\d+(?:\.\d+)?", t)


def _is_grounded(text: str, allowed: set) -> bool:
    """GROUNDING GUARD: true iff every number in `text` exists in the fact dict."""
    return all(n in allowed for n in _numbers_in(text))


# --------------------------------------------------------------------------- #
# perturbation parsing (mirrors ai_engine.gather's what-if slot logic)
# --------------------------------------------------------------------------- #
def _perturbation(question: str) -> Tuple[float, float]:
    """Parse a (delta_temp, rain_factor) scenario from free text.

    Rainfall is resolved FIRST so a percentage (e.g. "50% more rain") is never mistaken
    for a temperature delta; temperature is then parsed from the %-stripped text and only
    when a warming/cooling cue is present.
    """
    s = question.lower()

    # --- rainfall factor ---
    rf = 1.0
    if re.search(r"\b(half|halve|halved)\b", s):
        rf = 0.5
    elif re.search(r"\b(double|twice|twofold)\b", s):
        rf = 2.0
    else:
        # "less/drop/down …%" or "…% less" → reduce BY that %; "more/extra …%" → increase BY it.
        mless = re.search(r"(?:less|fewer|lower|drop|down|reduce|fall|cut)\w*\D{0,14}?(\d+)\s*%"
                          r"|(\d+)\s*%\s*(?:less|fewer|lower|drop|down)", s)
        mmore = re.search(r"(?:more|extra|higher|increase|up|rise|boost)\w*\D{0,14}?(\d+)\s*%"
                          r"|(\d+)\s*%\s*(?:more|extra|higher|increase|up)", s)
        mrain = re.search(r"rain\w*\D{0,16}?(\d+)\s*%|(\d+)\s*%\D{0,12}?rain", s)
        if mless:
            rf = max(0.0, 1 - int(mless.group(1) or mless.group(2)) / 100)
        elif mmore:
            rf = 1 + int(mmore.group(1) or mmore.group(2)) / 100
        elif mrain:
            rf = int(mrain.group(1) or mrain.group(2)) / 100.0

    # --- temperature delta ---
    # strip % numbers, ISO dates and bare years so none is mistaken for a temp delta
    s_np = re.sub(r"\d+\s*%", " ", s)
    s_np = re.sub(r"\d{4}-\d{2}-\d{2}", " ", s_np)
    s_np = re.sub(r"\b(?:19|20|21)\d{2}\b", " ", s_np)
    has_temp = bool(re.search(r"warm|hot|cool|cold|temp|degree|°|heat", s_np))
    dt = 0.0
    if has_temp:
        nums = [float(n) for n in re.findall(r"[-+]?\d+(?:\.\d+)?", s_np)]
        val = nums[0] if nums else 2.0  # "warmer" with no number defaults to +2
        cooling = bool(re.search(r"cool|cold|drop|fall|lower|decreas|down", s_np)) and "rain" not in s_np
        dt = -val if cooling else val
    dt = max(-10.0, min(10.0, dt))  # sanity clamp: a delta beyond +/-10C is a parse error
    return dt, rf


# --------------------------------------------------------------------------- #
# scope guard
# --------------------------------------------------------------------------- #
def _scope_violation(question: str, ctx: dict) -> Optional[str]:
    """Return an honest reason string if the question is out of the locked scope, else None."""
    start, end = ctx.get("dates", ("2000-01-01", "2023-12-31"))
    region = ctx.get("region", "Delhi-NCR")
    m = ai_engine._DATE_RE.search(question)
    if m and not (start <= m.group(1) <= end):
        return f"the date {m.group(1)} is outside the available record {start}..{end}"
    for y in re.findall(r"\b(19\d{2}|20\d{2}|21\d{2})\b", question):
        if not (int(start[:4]) <= int(y) <= int(end[:4])):
            return f"the year {y} is outside the available record {start[:4]}..{end[:4]}"
    rm = _OTHER_REGIONS.search(question)
    # config-aware: don't refuse a place that is actually part of the configured pilot
    # (e.g. if PILOT becomes the Maharashtra box, "Maharashtra"/"Mumbai" must NOT be refused).
    if rm and rm.group(0).lower() not in region.lower():
        return f"'{rm.group(0)}' is outside the pilot region ({region})"
    vm = _OTHER_VARS.search(question)
    if vm:
        return f"'{vm.group(0)}' is not a modelled variable (only rainfall, tmax, tmin)"
    # horizon scope: the twin forecasts at most `max_horizon` days (1–7 is the validated
    # range; beyond is short extended rollout). An explicit ask past the cap is refused.
    cap = int(ctx.get("max_horizon", 14))
    hm = re.search(r"\b(\d+)\s*[-\s]?day", question, re.I)
    if hm and int(hm.group(1)) > cap:
        return f"a {hm.group(1)}-day horizon exceeds the {cap}-day forecast range (1–7 is the validated window)"
    return None


# --------------------------------------------------------------------------- #
# PLANNER
# --------------------------------------------------------------------------- #
def _step(stage: str, label: str, tool: Optional[str], args: Optional[dict] = None) -> dict:
    return {"stage": stage, "label": label, "tool": tool, "args": args or {},
            "status": "pending", "citation": None}


def _intent(question: str) -> str:
    """Brain intent = ai_engine intent + two brain-only modes: investigate & compound."""
    s = question.lower()
    if re.search(r"\b(anomaly|investigate|alert|unusual|why\b)", s):
        return "investigate"
    base = detect_intent(question)
    # COMPOUND: a sow/decision question that ALSO carries a scenario perturbation,
    # e.g. "is it a good time to sow if temperature rises 3C?" -> chain everything.
    asks_decision = bool(re.search(r"\bsow|plant|seed|should i|good time|safe to|advis|recommend\b", s))
    has_scenario = bool(re.search(
        r"what.?if|scenario|\bif\b.*(rise|increase|drop|fall|warmer|hotter|cooler|\+?\d)", s))
    if asks_decision and has_scenario:
        return "compound"
    return base


def plan(question: str, ctx: dict) -> dict:
    """PLANNER: map the question to an ORDERED list of stage-tagged tool steps.

    Hard rules honoured here:
      * any skill/accuracy claim inserts a validate() step first;
      * out-of-scope questions collapse to a single REFUSE step.
    """
    reason = _scope_violation(question, ctx)
    if reason:
        return {
            "intent": "refuse",
            "refused": True,
            "refuse_reason": reason,
            "steps": [_step("REFUSE", "out of scope — honest refusal", None,
                            {"reason": reason})],
        }

    intent = _intent(question)
    latest = ctx["latest_date"]
    date = _date(question, latest)
    h = max(1, min(_horizon(question), int(ctx.get("max_horizon", 14))))  # clamp into range
    dt, rf = _perturbation(question)
    steps: List[dict] = []

    if intent == "help":
        steps.append(_step("MIRROR", "describe capabilities", None))
    elif intent in ("forecast", "sowing"):
        steps.append(_step("SIMULATE", f"forecast {h}d from {date}", "forecast",
                           {"date": date, "horizon": h}))
    elif intent == "whatif":
        steps.append(_step("PERTURB", f"perturb ΔT {dt:+g}°C, rain ×{rf:g}", "whatif",
                           {"date": date, "dt": dt, "rf": rf}))
    elif intent == "validate":
        steps.append(_step("SKILL", "validate vs baselines", "validate"))
    elif intent == "twin":
        steps.append(_step("ASSIMILATE", f"twin drift {h}d (free vs assimilated)", "twin",
                           {"date": date, "horizon": h}))
    elif intent == "investigate":
        steps.append(_step("MIRROR", f"mirror state on {date}", "state", {"date": date}))
        steps.append(_step("SIMULATE", f"forecast {h}d ahead", "forecast",
                           {"date": date, "horizon": h}))
        steps.append(_step("IMPACT", "synthesise investigation", None))
    elif intent == "compound":
        # COMPOUND decision chain: state -> forecast -> whatif -> validate -> impacts.
        steps.append(_step("MIRROR", f"mirror state on {date}", "state", {"date": date}))
        steps.append(_step("SIMULATE", f"baseline {h}d sowing outlook", "forecast",
                           {"date": date, "horizon": h}))
        steps.append(_step("PERTURB", f"scenario ΔT {dt:+g}°C, rain ×{rf:g}", "whatif",
                           {"date": date, "dt": dt, "rf": rf}))
        steps.append(_step("SKILL", "validate skill vs baselines", "validate"))
        steps.append(_step("IMPACT", "synthesise sowing decision", None))
    else:  # state
        steps.append(_step("MIRROR", f"mirror state on {date}", "state", {"date": date}))

    # HARD RULE: if the answer will make a skill/accuracy claim, ensure validate() runs
    # first. (Belt-and-braces with the per-intent plans above; also covered by the critic.)
    if _SKILL_WORDS.search(question) and not any(s["tool"] == "validate" for s in steps):
        steps.insert(0, _step("SKILL", "validate vs baselines (skill claim)", "validate"))

    return {"intent": intent, "refused": False, "steps": steps,
            "args": {"date": date, "horizon": h, "dt": dt, "rf": rf}}


# --------------------------------------------------------------------------- #
# EXECUTOR
# --------------------------------------------------------------------------- #
def _exec_tool(tool: str, args: dict, tools: Dict[str, Callable]) -> dict:
    """Call the REAL tool and shape its output into a flat, citable fact dict.
    Derived scalars (totals/peaks/endpoints) are deterministic functions of real tool
    output — they are stored so they can be cited, never invented."""
    fn = tools[tool]
    if tool == "state":
        return dict(fn(args.get("date")))
    if tool == "forecast":
        f = fn(args.get("date"), args.get("horizon"))
        sw = f.get("sowing", {})
        return {
            "init": f["init"], "model": f["model"], "horizon": f["horizon"],
            "total_rain": round(sum(f["mean_rain"]), 1),
            "peak_tmax": round(max(f["max_tmax"]), 1),
            "sowing_ok": sw.get("sowing_ok"),
            "onset_lead_day": sw.get("onset_lead_day"),
            "accumulated_rain_mm": sw.get("accumulated_rain_mm"),
            "threshold_mm": sw.get("threshold_mm"),
        }
    if tool == "whatif":
        return dict(fn(args.get("date"), args.get("dt"), args.get("rf")))
    if tool == "validate":
        return dict(fn())
    if tool == "twin":
        t = fn(args.get("date"), args.get("horizon"))
        free, assim = t.get("free_sync") or [], t.get("assim_sync") or []
        drift = [d for d in (t.get("free_drift") or []) if d is not None]
        return {
            "anchor": t["anchor"], "model": t["model"],
            "free_sync_start": free[0] if free else None,
            "free_sync_end": free[-1] if free else None,
            "assim_sync_end": assim[-1] if assim else None,
            "drift_end": drift[-1] if drift else None,
        }
    raise KeyError(tool)


def execute(steps: List[dict], tools: Dict[str, Callable]) -> dict:
    """EXECUTOR: run each tool step in order, mutate `steps` with status + citation key,
    and return the collected fact dict keyed by tool name."""
    facts: dict = {}
    for st in steps:
        tool = st["tool"]
        if tool is None:  # synthesis/derive/refuse step — nothing to fetch
            st["status"] = "ok"
            continue
        try:
            facts[tool] = _exec_tool(tool, st["args"], tools)
            st["status"] = "ok"
            st["citation"] = tool
        except Exception as e:  # never crash the demo on a single tool fault
            st["status"] = "error"
            facts[tool] = {"error": f"{type(e).__name__}: {e}"}
    return facts


# --------------------------------------------------------------------------- #
# EXPLAINER — grounded drafts with inline [tool:field] citations
# --------------------------------------------------------------------------- #
def _f(v) -> str:
    return "—" if v is None else f"{v}"


def explain(intent: str, facts: dict, ctx: dict, args: dict) -> Tuple[str, List[str], str]:
    """Compose (answer, citations, caveat) deterministically from the fact dict."""
    region = ctx.get("region", "Delhi-NCR")
    cites: List[str] = []

    def cite(tool: str, field: str) -> str:
        cites.append(f"{tool}:{field}")
        return f"[{tool}:{field}]"

    if intent == "help":
        start, end = ctx["dates"]
        cap = ctx.get("max_horizon", 14)
        ans = (f"I'm the {region} climate twin — ask me in plain English. Try: "
               f"\"forecast for tomorrow\", \"is a heatwave coming?\", \"when should I sow?\", "
               f"\"what if temperature rises 2°C?\", or \"how accurate is the model?\". "
               f"I mirror a day's state, simulate 1–{cap} days, run what-if scenarios and check "
               f"skill vs baselines — always citing the real data ({start}..{end}).")
        return ans, cites, "I only state numbers I fetched from the twin's own tools."

    if intent == "state":
        s = facts["state"]
        ans = (f"On {s['date']}, {region}: peak Tmax {_f(s['max_tmax'])}°C {cite('state','max_tmax')}, "
               f"mean rainfall {_f(s['mean_rain'])} mm {cite('state','mean_rain')}, heat-stress over "
               f"{_f(s['heat_pct'])}% of cells {cite('state','heat_pct')}; dryness index "
               f"{_f(s['dryness'])} {cite('state','dryness')} "
               f"({'drier' if (s['dryness'] or 0) < 0 else 'wetter'} than the seasonal normal).")
        caveat = "Single-day snapshot from cached IMD gridded data; no satellite fusion in the cube yet."
        return ans, cites, caveat

    if intent in ("forecast", "sowing"):
        f = facts["forecast"]
        if f.get("sowing_ok"):
            sow = (f"sowing onset on lead day +{_f(f['onset_lead_day'])} {cite('forecast','onset_lead_day')} "
                   f"({_f(f['accumulated_rain_mm'])} mm accumulates {cite('forecast','accumulated_rain_mm')} "
                   f"vs a {_f(f['threshold_mm'])} mm threshold {cite('forecast','threshold_mm')})")
        else:
            sow = (f"no sowing onset — only {_f(f['accumulated_rain_mm'])} mm accumulates "
                   f"{cite('forecast','accumulated_rain_mm')} vs the {_f(f['threshold_mm'])} mm "
                   f"threshold {cite('forecast','threshold_mm')}")
        ans = (f"{_f(f['horizon'])}-day outlook from {f['init']} ({f['model']}): "
               f"~{_f(f['total_rain'])} mm total rainfall {cite('forecast','total_rain')}, peak Tmax "
               f"~{_f(f['peak_tmax'])}°C {cite('forecast','peak_tmax')}; {sow}.")
        g = ctx.get("grid", {})
        grid_txt = (f"{g['rows']}×{g['cols']} {g['res_deg']}° grid" if g else "coarse grid")
        caveat = (f"Short-range guidance on a {grid_txt}; rainfall is skewed so treat onset "
                  "timing as indicative, not exact.")
        return ans, cites, caveat

    if intent == "whatif":
        w = facts["whatif"]
        worse = (w["scen_heat"] or 0) > (w["base_heat"] or 0)
        ans = (f"Scenario on {w['date']} (ΔT {w['delta_temp']:+g}°C {cite('whatif','delta_temp')}, "
               f"rainfall ×{w['rain_factor']:g} {cite('whatif','rain_factor')}): peak Tmax "
               f"{_f(w['base_tmax'])}→{_f(w['scen_tmax'])}°C {cite('whatif','scen_tmax')}, heat-stress "
               f"{_f(w['base_heat'])}→{_f(w['scen_heat'])}% of cells {cite('whatif','scen_heat')}, sowing "
               f"onset {_f(w['base_sowing'])}→{_f(w['scen_sowing'])} {cite('whatif','scen_sowing')}. "
               f"{'A clear worsening of heat stress.' if worse else 'Limited change in heat stress.'}")
        caveat = ("A simplified uniform perturbation of the forward run (not a coupled climate "
                  "response) — useful for direction-of-change, not precise magnitudes.")
        return ans, cites, caveat

    if intent == "validate":
        v = facts["validate"]
        best = v.get("best", {})
        ans = (f"Skill at {_f(v['horizon'])}-day lead {cite('validate','horizon')}, relative to "
               f"persistence/climatology baselines: best model is {best.get('rainfall','—')} for "
               f"rainfall, {best.get('tmax','—')} for tmax, {best.get('tmin','—')} for tmin "
               f"{cite('validate','best')}. Rain detection POD {_f(v['pod'])} {cite('validate','pod')}, "
               f"CSI {_f(v['csi'])} {cite('validate','csi')}.")
        caveat = ("All skill is reported relative to baselines, not as absolute accuracy — honest by "
                  "design (CLAUDE.md §2.3).")
        return ans, cites, caveat

    if intent == "twin":
        t = facts["twin"]
        ans = (f"Twin from {t['anchor']} ({t['model']}): free-running, REALITY⟷TWIN sync decays "
               f"{_f(t['free_sync_start'])}%→{_f(t['free_sync_end'])}% {cite('twin','free_sync_end')} "
               f"as Tmax drift grows to {_f(t['drift_end'])}°C {cite('twin','drift_end')}. With "
               f"observation assimilation it holds {_f(t['assim_sync_end'])}% "
               f"{cite('twin','assim_sync_end')} — that re-syncing is what makes it a twin, not a forecast.")
        caveat = "Assimilation is a simplified alpha-nudge, not full variational/Kalman data assimilation."
        return ans, cites, caveat

    if intent == "investigate":
        s = facts["state"]
        f = facts["forecast"]
        ans = (f"Investigating {s['date']}, {region}: peak Tmax {_f(s['max_tmax'])}°C "
               f"{cite('state','max_tmax')}, mean rainfall {_f(s['mean_rain'])} mm "
               f"{cite('state','mean_rain')}, dryness index {_f(s['dryness'])} {cite('state','dryness')}. "
               f"The {_f(f['horizon'])}-day outlook adds ~{_f(f['total_rain'])} mm "
               f"{cite('forecast','total_rain')} with peak Tmax ~{_f(f['peak_tmax'])}°C "
               f"{cite('forecast','peak_tmax')} — "
               f"{'relief likely.' if (f['total_rain'] or 0) >= (f['threshold_mm'] or 0) else 'the dry/hot signal persists.'}")
        caveat = "Flagged against TRAIN-years-only climatology; a single-cell snapshot, not an attribution study."
        return ans, cites, caveat

    if intent == "compound":
        s = facts.get("state", {})
        f = facts["forecast"]
        w = facts["whatif"]
        v = facts["validate"]
        base_sow = ("sowing onset +" + _f(f["onset_lead_day"]) if f.get("sowing_ok") else "no sowing onset")
        decision = (
            "sowing stays viable but plan for added heat stress"
            if w.get("scen_sowing") is not None else
            "hold off — the warmer, scenario delays the sowing onset out of the window"
        )
        ans = (f"Baseline {_f(f['horizon'])}-day outlook from {f['init']}: {base_sow} "
               f"{cite('forecast','onset_lead_day')}, {_f(f['accumulated_rain_mm'])} mm accumulates "
               f"{cite('forecast','accumulated_rain_mm')} vs a {_f(f['threshold_mm'])} mm threshold "
               f"{cite('forecast','threshold_mm')}. Under ΔT {w['delta_temp']:+g}°C "
               f"{cite('whatif','delta_temp')}, heat-stress moves {_f(w['base_heat'])}→{_f(w['scen_heat'])}% "
               f"of cells {cite('whatif','scen_heat')} and sowing onset {_f(w['base_sowing'])}→"
               f"{_f(w['scen_sowing'])} {cite('whatif','scen_sowing')} — so {decision}. Skill is "
               f"baseline-relative (best rainfall model {v.get('best',{}).get('rainfall','—')}, POD "
               f"{_f(v['pod'])} {cite('validate','pod')}).")
        caveat = ("Scenario is a simplified uniform +ΔT perturbation; skill is reported vs "
                  "persistence/climatology baselines. Decision support, not a guarantee.")
        return ans, cites, caveat

    return "No grounded answer could be composed.", cites, "—"


# --------------------------------------------------------------------------- #
# CRITIC — deterministic checks, revise once
# --------------------------------------------------------------------------- #
def critic(answer: str, facts: dict, steps: List[dict], allowed: set) -> List[str]:
    """Return a list of issue codes; empty means the answer passes every check."""
    issues: List[str] = []
    # 1. every inline [tool:field] citation resolves to a present fact field
    for tool, field in re.findall(r"\[([a-z]+):([a-z_]+)\]", answer):
        node = facts.get(tool)
        if not isinstance(node, dict) or field not in node:
            issues.append(f"dangling-citation:{tool}:{field}")
    # 2. any skill/accuracy claim must be backed by a validate() call
    if _SKILL_WORDS.search(answer) and "validate" not in facts:
        issues.append("skill-claim-without-validate")
    # 3. grounding: no number outside the fact dict
    if not _is_grounded(answer, allowed):
        issues.append("ungrounded-number")
    return issues


# --------------------------------------------------------------------------- #
# optional Ollama narration (grounded rephrase only; never the demo's dependency)
# --------------------------------------------------------------------------- #
def _provider() -> str:
    """Brain narration provider: Ollama if OLLAMA_MODEL is set, else fully offline."""
    return "ollama" if os.getenv("OLLAMA_MODEL") else "grounded"


def _narrate(answer: str, caveat: str, facts: dict) -> str:
    prompt = (
        "Rephrase the following ClimaTwin decision answer to read naturally. STRICT RULES: "
        "reply in ENGLISH ONLY (no other scripts/characters); keep EVERY number EXACTLY as "
        "written; invent NO new numbers; copy each [tool:field] token VERBATIM and never write "
        "anything else inside square brackets; stay within 1-3 sentences; do not add a caveat.\n\n"
        f"ANSWER: {answer}\n"
        f"(context facts, do not introduce others: {facts})"
    )
    return ai_engine._ollama(prompt).strip()


# --------------------------------------------------------------------------- #
# anomaly_scan — the autonomous trigger
# --------------------------------------------------------------------------- #
def anomaly_scan(cube, window: Optional[Tuple[int, int]] = None,
                 split_dates: Optional[dict] = None) -> dict:
    """Deterministically flag a recent heat or dryness anomaly using TRAIN-YEARS-ONLY
    thresholds, and suggest an investigation question for the brain.

    No leakage (CLAUDE.md §2.5): thresholds are fit on the TRAIN split only, then the
    most-recent UNSEEN data (the test split by default) is scanned against them. Heat =
    the test-window day whose grid-peak Tmax most exceeds the train 98th-pct of daily
    peak Tmax. Dryness = a 30-day test accumulation below the train 5th-pct. The strongest
    exceedance wins; ties break toward heat.

    Regime-aware: a focused regime (e.g. the 2020-only insat_real cube) carries a
    DATE-based split in its norm_stats ``_split_dates`` ({"train":[s,e],"test":[s,e]}).
    Pass it as ``split_dates`` so both the train threshold and the recent (test) scan
    window land on real timesteps — the project's year-based ``cfg.SPLIT`` would select
    zero timesteps on a single-year cube and crash. With neither arg, falls back to
    ``cfg.SPLIT`` (the synthetic 2000–2023 regime).
    """
    import numpy as np
    import pandas as pd
    import config as cfg

    if split_dates and split_dates.get("train"):
        tr0, tr1 = split_dates["train"]
        rec_win = split_dates.get("test") or split_dates.get("val") or [tr0, tr1]
        rc0, rc1 = rec_win
        train = cube.sel(time=slice(tr0, tr1))
        rec = cube.sel(time=slice(rc0, rc1))
        baseline_period = f"train window {str(tr0)[:10]}..{str(tr1)[:10]}"
    else:
        ty0, ty1 = cfg.SPLIT["train"]
        wy0, wy1 = window or cfg.SPLIT.get("test", (ty1 + 1, int(str(cube["time"].values[-1])[:4])))
        train = cube.sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
        rec = cube.sel(time=slice(f"{wy0}-01-01", f"{wy1}-12-31"))
        baseline_period = f"train years {ty0}–{ty1}"
    if rec["time"].size == 0 or train["time"].size == 0:
        last = str(pd.Timestamp(cube["time"].values[-1]).date())
        return {
            "anomaly": False, "kind": None, "date": last,
            "message": "Insufficient train/test timesteps to scan for anomalies in this regime.",
            "suggested_question": None,
        }
    last_date = str(pd.Timestamp(rec["time"].values[-1]).date())

    # --- heat: train-years distribution of daily grid-PEAK tmax -------------------
    heat_thr = round(float(np.nanpercentile(train["tmax"].max(("lat", "lon")).values, 98)), 2)
    rp = rec["tmax"].max(("lat", "lon")).values
    i_hot = int(np.nanargmax(rp))
    hot_val = round(float(rp[i_hot]), 2)
    hot_date = str(pd.Timestamp(rec["time"].values[i_hot]).date())
    heat_exceed = hot_val - heat_thr

    # --- dryness: most extreme 30-day rainfall deficit vs train 5th-pct -----------
    win = 30
    train_acc = train["rainfall"].mean(("lat", "lon")).rolling(time=win).sum().values
    train_acc = train_acc[~np.isnan(train_acc)]
    dry_thr = round(float(np.nanpercentile(train_acc, 5)), 2)
    rec_acc_series = rec["rainfall"].mean(("lat", "lon")).rolling(time=win).sum()
    ra = rec_acc_series.values
    valid = ~np.isnan(ra)
    if valid.any():
        idx = np.where(valid)[0]
        i_dry = int(idx[np.nanargmin(ra[idx])])
        dry_val = round(float(ra[i_dry]), 2)
        dry_date = str(pd.Timestamp(rec["time"].values[i_dry]).date())
    else:
        dry_val, dry_date = dry_thr, last_date
    dry_exceed = dry_thr - dry_val  # positive = drier than the train 5th-pct

    # heat takes precedence (more demo-legible); dryness is the fallback signal
    if heat_exceed > 0:
        return {
            "anomaly": True, "kind": "heat", "date": hot_date,
            "value": hot_val, "threshold": heat_thr,
            "baseline": f"{baseline_period}, 98th-pct of daily peak Tmax",
            "message": (f"Heat anomaly on {hot_date}: peak Tmax {hot_val}°C exceeds the "
                        f"train-climatology 98th-pct of {heat_thr}°C."),
            "suggested_question": f"investigate the heat anomaly on {hot_date}",
        }
    if dry_exceed > 0:
        return {
            "anomaly": True, "kind": "dryness", "date": dry_date,
            "value": dry_val, "threshold": dry_thr,
            "baseline": f"{baseline_period}, 5th-pct of {win}-day rainfall accumulation",
            "message": (f"Dryness anomaly on {dry_date}: {win}-day rainfall {dry_val} mm is "
                        f"below the train-climatology 5th-pct of {dry_thr} mm."),
            "suggested_question": f"investigate the dryness anomaly on {dry_date}",
        }

    return {
        "anomaly": False, "kind": None, "date": last_date,
        "message": "No heat or dryness anomaly in the recent window vs train climatology.",
        "suggested_question": None,
    }


# --------------------------------------------------------------------------- #
# run — the public entrypoint
# --------------------------------------------------------------------------- #
def run(question: str, ctx: dict) -> dict:
    """Plan → execute → critique (revise once) → explain → guard. Returns a structured trace.

    Shape: {question, intent, plan:[{stage,label,tool,status,citation}], facts, answer,
            citations, caveat, refused, provider}.
    """
    p = plan(question, ctx)

    if p["refused"]:
        reason = p["refuse_reason"]
        ans = (f"That's outside ClimaTwin's locked scope: {reason}. The pilot covers "
               f"{ctx.get('region','Delhi-NCR')}, variables rainfall/tmax/tmin, a 1–{ctx.get('max_horizon',14)} day horizon "
               f"and {ctx['dates'][0]}..{ctx['dates'][1]}. I won't guess beyond it.")
        p["steps"][0]["status"] = "ok"
        return {
            "question": question, "intent": "refuse", "plan": _public_plan(p["steps"]),
            "facts": {}, "answer": ans, "citations": [],
            "caveat": "Honest refusal beats a confident guess (CLAUDE.md §2.8).",
            "refused": True, "provider": "grounded",
        }

    tools: Dict[str, Callable] = ctx["tools"]
    steps = p["steps"]
    facts = execute(steps, tools)

    # ROBUSTNESS: if any tool failed, stop honestly instead of composing from missing
    # facts (explain() assumes its facts are present). Never crash the demo, never guess.
    failed = [s for s in steps if s["status"] == "error"]
    if failed:
        bad = ", ".join(sorted({s["tool"] for s in failed if s["tool"]}))
        return {
            "question": question, "intent": p["intent"], "plan": _public_plan(steps),
            "facts": facts,
            "answer": (f"I planned the steps but the {bad} tool didn't return — so I won't "
                       f"state numbers I couldn't actually compute. Try a date in "
                       f"{ctx['dates'][0]}..{ctx['dates'][1]} with a 1–{ctx.get('max_horizon',14)} day horizon."),
            "citations": [],
            "caveat": "Honest stop: the brain never reports a result a tool didn't produce.",
            "refused": False, "provider": "grounded",
        }

    allowed = _allowed_numbers(facts, ctx)
    answer, citations, caveat = explain(p["intent"], facts, ctx, p.get("args", {}))

    # CRITIC — revise once if a deterministic check fails.
    issues = critic(answer, facts, steps, allowed)
    if issues:
        if "skill-claim-without-validate" in issues and "validate" not in facts:
            vstep = _step("SKILL", "validate vs baselines (critic-inserted)", "validate")
            steps.insert(0, vstep)
            facts["validate"] = _exec_tool("validate", {}, tools)
            vstep["status"], vstep["citation"] = "ok", "validate"
        allowed = _allowed_numbers(facts, ctx)
        answer, citations, caveat = explain(p["intent"], facts, ctx, p.get("args", {}))
        issues = critic(answer, facts, steps, allowed)

    # OPTIONAL narration (grounded rephrase only). Any number outside the facts → downgrade.
    provider = _provider()
    final = answer
    if provider == "ollama" and not issues:
        try:
            cand = _narrate(answer, caveat, facts)
            final = cand if (cand and _is_grounded(cand, allowed)) else answer
            if final is answer:
                provider = "grounded (guard)"
        except Exception as e:
            provider = f"grounded (LLM {type(e).__name__})"
            final = answer

    # GROUNDING GUARD — final assertion: never ship an ungrounded number. The 'help'
    # capabilities reply is static illustrative prose (example questions like "rises 2°C",
    # "1–14 days") with no tool-derived claims, so it is exempt; every answer that states
    # real numbers is still strictly guarded.
    if p["intent"] != "help" and not _is_grounded(final, allowed):
        final = answer if _is_grounded(answer, allowed) else \
            "Could not produce a fully grounded answer from the available tools."
        provider = "grounded (guard)"

    return {
        "question": question,
        "intent": p["intent"],
        "plan": _public_plan(steps),
        "facts": facts,
        "answer": final,
        "citations": citations,
        "caveat": caveat,
        "refused": False,
        "provider": provider,
    }


def _public_plan(steps: List[dict]) -> List[dict]:
    """The plan as the frontend trace consumes it (drop internal args)."""
    return [{"stage": s["stage"], "label": s["label"], "tool": s["tool"],
             "status": s["status"], "citation": s["citation"]} for s in steps]
