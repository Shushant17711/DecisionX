"""
DecisionX — LLM output validation

Models return "8/10", "7.5", a bare string where a list belongs, NaN, or an
object with half its fields missing. Everything an LLM produced passes through
here before anything downstream (synthesis maths, charts, JSON serialisation)
touches it, so the rest of the pipeline can rely on exact types:

  persona analysis → verdict/headline/recommendation: str, score: int 1..10,
                     strengths/concerns: list[str]; anything unrecoverable is
                     replaced by a failed analysis (`_failed: True`).
  synthesis        → normalised dict, or None when it is not a usable synthesis.
"""

import math
import re

PERSONA_VERDICTS = ("Bullish", "Cautious", "Bearish")
SYNTHESIS_VERDICTS = ("Go", "Caution", "No-Go")

MAX_TEXT = 600
MAX_LONG_TEXT = 2000
MAX_ITEM = 300
MAX_ITEMS = 8

_NUMBER = re.compile(r"[-+]?\d+(?:\.\d+)?")
_SCALE = re.compile(r"^\s*(?:/|out\s+of|of)\s*(\d+(?:\.\d+)?)", re.IGNORECASE)


def failed_analysis(headline: str, reason: str = "error") -> dict:
    """The analysis shape the UI renders for an expert that could not answer."""
    return {
        "verdict": "Cautious",
        "score": 5,
        "headline": headline,
        "strengths": [],
        "concerns": ["Unable to complete analysis — please retry."],
        "recommendation": "Retry the evaluation.",
        "_failed": True,
        "_reason": reason,
    }


# ── Primitive coercions ─────────────────────────────────────────────────────

def coerce_float(value) -> float | None:
    """Parse a number the way models write them: 7, 7.5, "7.5", "8/10", "4 out of 5".

    Scores written against another scale are mapped onto /10. Returns None when
    no finite number can be found.
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if not isinstance(value, str):
        return None

    match = _NUMBER.search(value)
    if not match:
        return None
    try:
        number = float(match.group())
    except ValueError:
        return None

    scale = _SCALE.match(value[match.end():])
    if scale:
        denominator = float(scale.group(1))
        if denominator <= 0:
            return None
        number = number * 10.0 / denominator
    return number if math.isfinite(number) else None


def coerce_score(value) -> int | None:
    """An integer 1..10, or None when the value is not a sane score."""
    number = coerce_float(value)
    if number is None or not 0 <= number <= 10:
        return None
    return min(10, max(1, math.floor(number + 0.5)))


def coerce_str(value, limit: int = MAX_TEXT) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return "" if isinstance(value, float) and not math.isfinite(value) else str(value)
    if isinstance(value, dict):
        # {"text": "..."} / {"point": "..."} — take the first string inside.
        value = next((v for v in value.values() if isinstance(v, str) and v.strip()), "")
    if isinstance(value, list):
        value = "; ".join(coerce_str(v, limit) for v in value if coerce_str(v, limit))
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit].strip()


def coerce_str_list(value, max_items: int = MAX_ITEMS, limit: int = MAX_ITEM) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        # A model that ignored the array spec usually wrote bullets or lines.
        pieces = [p.strip(" \t-•*·") for p in re.split(r"\n+|(?:^|\s)[•·]\s", value)]
        value = [p for p in pieces if p]
    if not isinstance(value, (list, tuple)):
        value = [value]
    out: list[str] = []
    for item in value:
        text = coerce_str(item, limit)
        if text:
            out.append(text)
        if len(out) >= max_items:
            break
    return out


def _normalise_choice(value, choices: tuple[str, ...]) -> str | None:
    text = coerce_str(value, 40).lower().replace("_", "-").replace(" ", "-")
    for choice in choices:
        if text == choice.lower():
            return choice
    if text in ("nogo", "no"):
        return "No-Go" if "No-Go" in choices else None
    return None


# ── Persona analysis ────────────────────────────────────────────────────────

def normalize_persona_analysis(raw) -> dict:
    """Coerce a persona's JSON into the exact shape the UI and synthesizer expect."""
    if not isinstance(raw, dict):
        return failed_analysis("Analysis came back in an unexpected format.", "bad_output")
    if raw.get("_failed"):
        failed = failed_analysis(coerce_str(raw.get("headline")) or "Agent failed.",
                                 coerce_str(raw.get("_reason"), 40) or "error")
        return failed

    score = coerce_score(raw.get("score"))
    if score is None:
        return failed_analysis("Analysis returned no usable score.", "bad_score")

    headline = coerce_str(raw.get("headline"))
    strengths = coerce_str_list(raw.get("strengths"))
    concerns = coerce_str_list(raw.get("concerns"))
    if not headline and not strengths and not concerns:
        return failed_analysis("Analysis came back empty.", "empty_output")

    verdict = _normalise_choice(raw.get("verdict"), PERSONA_VERDICTS)
    if verdict is None:
        verdict = "Bullish" if score >= 7 else ("Cautious" if score >= 5 else "Bearish")

    out = {
        "verdict": verdict,
        "score": score,
        "headline": headline or "No headline given.",
        "strengths": strengths,
        "concerns": concerns,
        "recommendation": coerce_str(raw.get("recommendation")),
    }
    if "chart" in raw:
        out["chart"] = raw["chart"]  # validated by charts.sanitize_chart downstream
    return out


# ── Synthesis ───────────────────────────────────────────────────────────────

def _normalise_disagreements(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:MAX_ITEMS]:
        if isinstance(item, str):
            item = {"topic": item}
        if not isinstance(item, dict):
            continue
        sides = item.get("sides")
        if isinstance(sides, dict):
            sides = {coerce_str(k, 80): coerce_str(v) for k, v in sides.items() if coerce_str(k, 80)}
        else:
            sides = coerce_str(sides)
        topic = coerce_str(item.get("topic"), MAX_ITEM)
        if not topic:
            continue
        out.append({"topic": topic, "sides": sides, "resolution": coerce_str(item.get("resolution"))})
    return out


def normalize_synthesis(raw) -> dict | None:
    """Return a clean synthesis dict, or None when `raw` is not a usable synthesis."""
    if not isinstance(raw, dict) or raw.get("_failed"):
        return None

    score = coerce_float(raw.get("overall_score"))
    if score is None or not 0 <= score <= 10:
        return None
    score = round(min(10.0, max(1.0, score)), 1)
    if score == int(score):
        score = int(score)

    result = {
        "overall_score": score,
        "verdict": _normalise_choice(raw.get("verdict"), SYNTHESIS_VERDICTS)
        or ("Go" if score >= 7 else ("Caution" if score >= 5 else "No-Go")),
        "executive_summary": coerce_str(raw.get("executive_summary"), MAX_LONG_TEXT),
        "consensus_points": coerce_str_list(raw.get("consensus_points")),
        "disagreements": _normalise_disagreements(raw.get("disagreements")),
        "strengths": coerce_str_list(raw.get("strengths")),
        "weaknesses": coerce_str_list(raw.get("weaknesses")),
        "opportunities": coerce_str_list(raw.get("opportunities")),
        "threats": coerce_str_list(raw.get("threats")),
        "action_plan_7_days": coerce_str_list(raw.get("action_plan_7_days")),
        "action_plan_30_days": coerce_str_list(raw.get("action_plan_30_days")),
        "final_recommendation": coerce_str(raw.get("final_recommendation"), MAX_LONG_TEXT),
        "charts": raw.get("charts"),  # validated by charts.sanitize_charts downstream
    }
    if not any(result[f] for f in ("strengths", "weaknesses", "opportunities", "threats")):
        return None
    return result


# ── JSON safety ─────────────────────────────────────────────────────────────

def json_safe(value):
    """Recursively replace NaN/±Infinity with None and stringify non-str keys.

    `json.loads` happily accepts the NaN / Infinity literals models emit, and
    `json.dumps` would write them back out as invalid JSON the browser rejects.
    """
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value
