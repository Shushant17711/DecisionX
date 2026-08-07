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
import time

from agents.charts import CHART_SCHEMA_PROMPT, sanitize_charts
from agents.llm_client import async_call_llm, available_providers


# ── Provider chain: try each in order until one succeeds ──
_PROVIDER_CHAIN = [
    {"provider": "groq",        "model": "llama-3.3-70b-versatile",              "timeout": 25.0},
    {"provider": "nvidia",      "model": "meta/llama-3.3-70b-instruct",          "timeout": 25.0},
    {"provider": "openrouter",  "model": "nvidia/nemotron-3-ultra-550b-a55b:free", "timeout": 35.0},
]

# Hard ceiling on synthesis; fallback to local to unblock the page.
_SYNTHESIS_DEADLINE = 55.0


def _build_local_synthesis(persona_results: list[dict], idea: str, scores: list[float]) -> dict:
    """
    Last-resort synthesis built entirely from persona data (no LLM call).
    Guarantees non-empty SWOT / action-plan fields.
    """
    all_strengths: list[str] = []
    all_concerns: list[str] = []
    all_recommendations: list[str] = []
    headlines: list[str] = []

    for p in persona_results:
        a = p["analysis"]
        if a.get("_failed"):
            continue
        all_strengths.extend(a.get("strengths") or [])
        all_concerns.extend(a.get("concerns") or [])
        rec = a.get("recommendation", "")
        if rec:
            all_recommendations.append(f"{p['name']}: {rec}")
        hl = a.get("headline", "")
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


async def synthesize_verdict(persona_results: list[dict], idea: str, context: str = "") -> dict:
    """
    Merge all expert analyses into a unified boardroom verdict.
    Surfaces disagreements as the most valuable output.
    """

    persona_summaries = []
    scores = []
    for p in persona_results:
        a = p["analysis"]
        # Skip failed agents; placeholder score of 5 would skew the average.
        if a.get("_failed"):
            continue
        scores.append(a.get("score", 5))
        persona_summaries.append(
            f"**{p['name']} ({p['role']}):**\n"
            f"  Verdict: {a.get('verdict', 'N/A')} | Score: {a.get('score', 'N/A')}/10\n"
            f"  Headline: {a.get('headline', 'N/A')}\n"
            f"  Strengths: {json.dumps(a.get('strengths', []))}\n"
            f"  Concerns: {json.dumps(a.get('concerns', []))}\n"
            f"  Recommendation: {a.get('recommendation', 'N/A')}"
        )

    all_summaries = "\n\n".join(persona_summaries)

    system_prompt = (
        "You are the Chief Synthesizer of an AI expert panel. "
        "You received analyses from multiple experts evaluating an idea. "
        "Your job is to produce a unified, balanced verdict. "
        "PAY SPECIAL ATTENTION to where experts DISAGREE — these tensions are the most valuable insight. "
        "Be actionable and honest. Don't sugarcoat.\n\n"
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
        user_parts.append(f"\nAdditional context:\n{context[:2000]}")
    user_parts.append(f"\nExpert panel analyses:\n\n{all_summaries}")
    user_parts.append("\nSynthesize into a unified verdict. Highlight disagreements.")

    user_prompt = "\n".join(user_parts)

    # ── Try each provider in the chain until one produces valid synthesis ──
    result = None
    last_error = ""
    started = time.perf_counter()
    usable = available_providers()

    for attempt in _PROVIDER_CHAIN:
        if attempt["provider"] not in usable:
            continue
        if time.perf_counter() - started > _SYNTHESIS_DEADLINE:
            print("[Synthesizer] deadline reached — falling back to local synthesis")
            break
        try:
            print(f"[Synthesizer] Trying {attempt['provider']} / {attempt['model']} ...")
            candidate = await async_call_llm(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                provider=attempt["provider"],
                model=attempt["model"],
                max_tokens=1800,
                temperature=0.5,
                timeout=attempt["timeout"],
            )


            if "overall_score" not in candidate:
                raise ValueError(
                    candidate.get("headline", "LLM returned persona-shaped fallback, not synthesis")
                )


            has_content = any(
                len(candidate.get(field) or []) > 0
                for field in ("strengths", "weaknesses", "opportunities", "threats")
            )
            if not has_content:
                raise ValueError("Synthesis JSON present but SWOT arrays are all empty")

            result = candidate
            print(f"[Synthesizer] Success via {attempt['provider']} in {time.perf_counter() - started:.1f}s")
            break

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = str(exc)
            print(f"[Synthesizer] {attempt['provider']} failed: {last_error[:200]}")
            continue

    # ── If every provider failed, build a local synthesis from persona data ──
    if result is None:
        print(f"[Synthesizer] All providers failed. Building local synthesis from persona data.")
        result = _build_local_synthesis(persona_results, idea, scores)


    if scores:
        score_range = max(scores) - min(scores)
        consensus_pct = max(0, 100 - (score_range * 12))
    else:
        consensus_pct = 50

    result["consensus_percentage"] = consensus_pct

    # Model-authored charts are estimates and are validated before they survive.
    result["charts"] = sanitize_charts(result.get("charts"), limit=2)

    # Score spread chart is built from real data, not estimated by model.
    real_scores = [
        (p["name"], p["analysis"].get("score"))
        for p in persona_results
        if not p["analysis"].get("_failed") and isinstance(p["analysis"].get("score"), (int, float))
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
    result["agent_scores"] = {
        p["name"]: p["analysis"].get("score", 5)
        for p in persona_results
        if not p["analysis"].get("_failed")
    }
    result["failed_agents"] = [
        p["name"] for p in persona_results if p["analysis"].get("_failed")
    ]
    # Flag if nobody answered to avoid rendering a fake 5/10 verdict.
    result["panel_unreachable"] = bool(persona_results) and not scores

    return result
