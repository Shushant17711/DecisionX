"""
DecisionX — Synthesizer Agent

Takes all persona outputs and produces a unified verdict.
The most valuable insight is WHERE the experts disagree.

Provider priority: Groq → NVIDIA → OpenRouter (automatic fallback).
If all LLM calls fail, a local synthesis is built from persona data
so the user always sees meaningful SWOT / action-plan content.

The chain is ordered by measured latency, not by model size. Groq's 70B answers
in a couple of seconds; OpenRouter's free 550B tier routinely queues for a
minute, so it sits last and is skipped entirely once something upstream works.
Providers with no key file loaded are skipped rather than timed out against.
"""

import asyncio
import json
import logging
import time

from agents.charts import CHART_SCHEMA_PROMPT, sanitize_charts
from agents.context import UNTRUSTED_DOCS_RULE, synthesis_budget
from agents.llm_client import async_call_llm, available_providers
from agents.validation import coerce_score, coerce_str, coerce_str_list, json_safe, normalize_synthesis
from observability import incr

log = logging.getLogger("decisionx.synthesizer")


_PROVIDER_CHAIN = [
    {"provider": "groq",        "model": "llama-3.3-70b-versatile",              "timeout": 25.0},
    {"provider": "nvidia",      "model": "meta/llama-3.3-70b-instruct",          "timeout": 25.0},
    {"provider": "openrouter",  "model": "nvidia/nemotron-3-ultra-550b-a55b:free", "timeout": 35.0},
]

_SYNTHESIS_DEADLINE = 55.0
_MIN_CALL_SECONDS = 3.0


def _valid_score(analysis: dict) -> int | None:
    """The persona's score as an int 1..10, or None if failed / non-numeric."""
    if not isinstance(analysis, dict) or analysis.get("_failed"):
        return None
    return coerce_score(analysis.get("score"))


def _build_local_synthesis(persona_results: list[dict], idea: str, scores: list[float]) -> dict:
    all_strengths: list[str] = []
    all_concerns: list[str] = []
    all_recommendations: list[str] = []
    headlines: list[str] = []

    for p in persona_results:
        a = p["analysis"]
        if _valid_score(a) is None:
            continue
        all_strengths.extend(coerce_str_list(a.get("strengths")))
        all_concerns.extend(coerce_str_list(a.get("concerns")))
        rec = coerce_str(a.get("recommendation"))
        if rec:
            all_recommendations.append(f"{p['name']}: {rec}")
        hl = coerce_str(a.get("headline"))
        if hl:
            headlines.append(hl)

    avg = round(sum(scores) / len(scores), 1) if scores else 5
    verdict = "Go" if avg >= 7 else ("Caution" if avg >= 5 else "No-Go")


    def _unique(items: list[str], limit: int = 4) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for item in items:
            norm = item.strip().lower()
            if norm and norm not in seen:
                seen.add(norm)
                out.append(item.strip())
            if len(out) >= limit:
                break
        return out

    strengths = _unique(all_strengths, 3)
    concerns = _unique(all_concerns, 3)


    weaknesses = concerns[:2] if len(concerns) >= 2 else concerns
    threats = concerns[2:4] if len(concerns) > 2 else ["Market competition and timing risk."]


    opportunities = [
        f"Leverage: {s}" for s in strengths[:2]
    ] if strengths else ["Validate core value proposition with early users."]


    action_7 = _unique(all_recommendations, 3) or ["Review individual expert analyses above."]
    action_30 = [
        "Develop an MVP based on expert feedback.",
        "Run user-validation experiments.",
        "Revisit financial assumptions with real data.",
    ]

    summary_parts = headlines[:3]
    executive_summary = " ".join(summary_parts) if summary_parts else f"Average expert score: {avg}/10."

    return {
        "overall_score": avg,
        "verdict": verdict,
        "executive_summary": executive_summary,
        "consensus_points": [h for h in headlines[:3]],
        "disagreements": [],
        "strengths": strengths or ["Idea addresses a clear pain point."],
        "weaknesses": weaknesses or ["Execution risk and unclear monetisation."],
        "opportunities": opportunities,
        "threats": threats,
        "action_plan_7_days": action_7,
        "action_plan_30_days": action_30,
        "final_recommendation": " ".join(all_recommendations[:3]) if all_recommendations else (
            f"The panel gave an average score of {avg}/10 ({verdict}). "
            "Review each expert's analysis above and address the key concerns before proceeding."
        ),
    }


async def synthesize_verdict(
    persona_results: list[dict],
    idea: str,
    context: str = "",
    deadline: float | None = None,
) -> dict:
    """
    Produce the board-level verdict. `context` should already be rendered within
    agents.context.synthesis_budget(). `deadline` is a time.monotonic() instant;
    each provider call is given only the time left before it, and once too little
    remains the local synthesis is used instead of starting another call.
    """
    persona_summaries = []
    scores: list[int] = []
    for p in persona_results:
        a = p["analysis"]
        score = _valid_score(a)
        if score is None:
            continue
        scores.append(score)
        persona_summaries.append(
            f"**{p['name']} ({p['role']}):**\n"
            f"  Verdict: {coerce_str(a.get('verdict')) or 'N/A'} | Score: {score}/10\n"
            f"  Headline: {coerce_str(a.get('headline')) or 'N/A'}\n"
            f"  Strengths: {json.dumps(coerce_str_list(a.get('strengths')))}\n"
            f"  Concerns: {json.dumps(coerce_str_list(a.get('concerns')))}\n"
            f"  Recommendation: {coerce_str(a.get('recommendation')) or 'N/A'}"
        )

    all_summaries = "\n\n".join(persona_summaries)

    system_prompt = (
        "You are the Chief Synthesizer of an AI expert panel. "
        "You received analyses from multiple experts evaluating an idea. "
        "Your job is to produce a unified, balanced verdict. "
        "PAY SPECIAL ATTENTION to where experts DISAGREE — these tensions are the most valuable insight. "
        "Be actionable and honest. Don't sugarcoat.\n\n"
        + UNTRUSTED_DOCS_RULE + "\n\n"
        "Respond ONLY with valid JSON:\n"
        "{\n"
        '  "overall_score": <1-10>,\n'
        '  "verdict": "Go" | "Caution" | "No-Go",\n'
        '  "executive_summary": "<2-3 sentence synthesis>",\n'
        '  "consensus_points": ["<point where most experts agree>", ...],\n'
        '  "disagreements": [\n'
        '    {"topic": "<what they disagree on>", "sides": "<who says what>", "resolution": "<your take>"}\n'
        "  ],\n"
        '  "strengths": ["<top 3>"],\n'
        '  "weaknesses": ["<top 3>"],\n'
        '  "opportunities": ["<top 2>"],\n'
        '  "threats": ["<top 2>"],\n'
        '  "action_plan_7_days": ["<step 1>", "<step 2>", "<step 3>"],\n'
        '  "action_plan_30_days": ["<step 1>", "<step 2>", "<step 3>"],\n'
        '  "final_recommendation": "<one paragraph of honest, actionable advice>"\n'
        "}\n\n"
        + CHART_SCHEMA_PROMPT
        + '\nAt the board level, put any charts in a "charts" array of at most 2 '
        "objects with exactly the fields above. A chart is worth drawing only when it "
        "summarises something the whole panel weighed — the spread of expert "
        "scores, a cost or revenue breakdown several experts referenced, or a "
        "timeline. Omit 'charts' entirely if nothing qualifies."
    )

    user_parts = [f"Idea being evaluated:\n{idea}"]
    if context:
        user_parts.append(f"\nAdditional context:\n{context[: synthesis_budget() + 2000]}")
    user_parts.append(f"\nExpert panel analyses:\n\n{all_summaries}")
    user_parts.append("\nSynthesize into a unified verdict. Highlight disagreements.")

    user_prompt = "\n".join(user_parts)

    result = None
    started = time.monotonic()
    hard_deadline = started + _SYNTHESIS_DEADLINE
    if deadline is not None:
        hard_deadline = min(hard_deadline, deadline)
    usable = available_providers() if scores else []  # nothing to synthesize from

    for attempt in _PROVIDER_CHAIN:
        if attempt["provider"] not in usable:
            continue
        remaining = hard_deadline - time.monotonic()
        if remaining < _MIN_CALL_SECONDS:
            log.info("synthesis: %.1fs left — skipping remaining providers", max(0.0, remaining))
            break
        call_timeout = min(attempt["timeout"], remaining - 0.5)
        call_started = time.monotonic()
        try:
            candidate = await asyncio.wait_for(
                async_call_llm(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    provider=attempt["provider"],
                    model=attempt["model"],
                    max_tokens=1800,
                    temperature=0.5,
                    timeout=call_timeout,
                    expect_keys=("overall_score",),
                ),
                timeout=call_timeout + 0.5,
            )
            normalized = normalize_synthesis(candidate)
            if normalized is None:
                reason = candidate.get("_reason", "invalid_synthesis") if isinstance(candidate, dict) else "invalid_synthesis"
                raise ValueError(reason)
            result = normalized
            log.info("synthesis via %s/%s in %.1fs", attempt["provider"], attempt["model"],
                     time.monotonic() - call_started)
            break

        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — fall through to the next provider
            reason = "timeout" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else str(exc)[:60]
            incr("synthesis_provider_failure")
            log.warning("synthesis via %s failed after %.1fs: %s", attempt["provider"],
                        time.monotonic() - call_started, reason)
            continue

    if result is None:
        incr("synthesis_local_fallback")
        result = _build_local_synthesis(persona_results, idea, scores)

    if scores:
        score_range = max(scores) - min(scores)
        consensus_pct = max(0, 100 - (score_range * 12))
    else:
        consensus_pct = 50

    result["consensus_percentage"] = consensus_pct

    result["charts"] = sanitize_charts(result.get("charts"), limit=2)

    real_scores = [
        (p["name"], score)
        for p in persona_results
        if (score := _valid_score(p["analysis"])) is not None
    ]
    if len(real_scores) >= 3:
        result["score_chart"] = {
            "type": "bar",
            "title": "How each expert scored it",
            "unit": "/10",
            "note": "",
            "measured": True,
            "data": [
                {"label": name.removeprefix("The "), "value": float(score)}
                for name, score in real_scores
            ][:12],
        }
    result["agent_scores"] = {name: score for name, score in real_scores}
    result["failed_agents"] = [
        p["name"] for p in persona_results if _valid_score(p["analysis"]) is None
    ]
    result["panel_unreachable"] = bool(persona_results) and not scores

    return json_safe(result)
