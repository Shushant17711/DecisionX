"""
DecisionX — Orchestrator

Core evaluation pipeline:
1. Classify the idea's domain
2. Assemble the expert panel — built-in personas first, bespoke ones invented by
   the Panel Architect when the roster cannot cover the request
3. Run every agent concurrently on Groq
4. Synthesize into a unified verdict

`evaluate_idea_stream` emits each stage as it completes so the UI can render the
panel within milliseconds and fill in cards as verdicts land, instead of showing
a spinner until the entire pipeline finishes. `evaluate_idea` drains that same
stream for callers that want one blocking result.
"""

import asyncio
import time
from typing import AsyncIterator

from agents.charts import sanitize_chart
from agents.personas import (
    MAX_PANEL_SIZE,
    PERSONAS,
    classify_idea_domain,
    design_custom_personas,
    get_persona_prompt,
    select_personas,
)
from agents.synthesizer import synthesize_verdict

from agents.llm_client import async_call_llm

MAX_CONCURRENT_AGENTS = 12

PERSONA_TIMEOUT = 25.0

MAX_PERSONA_CHARTS = 4


def _chart_signature(chart: dict) -> tuple:
    """
    Identify charts that say the same thing. Two experts plotting the same
    range of the same quantity have drawn one chart twice, whatever they
    titled it.
    """
    values = [p["value"] for p in chart["data"]]
    return (chart["type"], round(min(values), 2), round(max(values), 2))


async def run_single_persona(persona: dict, idea: str, context: str, sem: asyncio.Semaphore) -> dict:
    """Run one persona agent and return its analysis with presentation metadata."""
    system_prompt, user_prompt = get_persona_prompt(persona, idea, context)

    async with sem:
        analysis = await async_call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            provider="groq",
            model="llama-3.1-8b-instant",
            max_tokens=950,  
            temperature=0.7,
            timeout=PERSONA_TIMEOUT,
        )

    chart = sanitize_chart(analysis.get("chart")) if isinstance(analysis, dict) else None
    if isinstance(analysis, dict):
        if chart:
            analysis["chart"] = chart
        else:
            analysis.pop("chart", None)

    return {
        "key": persona["key"],
        "name": persona["name"],
        "role": persona["role"],
        "icon": persona.get("icon", "spark"),
        "color": persona["color"],
        "custom": bool(persona.get("custom")),
        "analysis": analysis,
    }


async def assemble_panel(idea: str, context: str, max_agents: int) -> tuple[list[str], list[dict]]:
    """
    Build the expert panel for this idea.

    Returns (detected_domains, personas). Bespoke personas are designed only when
    the built-in roster genuinely cannot answer the request — either it ran out of
    experts for the requested panel size, or the idea matched no known domain and
    deserves purpose-built specialists rather than generic backfill.
    """
    max_agents = max(1, min(MAX_PANEL_SIZE, max_agents))
    domains = classify_idea_domain(idea)

    builtin_keys = select_personas(domains, max_agents=max_agents)
    core = [{"key": k, **PERSONAS[k]} for k in builtin_keys[:-1]]
    critic = {"key": "critic", **PERSONAS["critic"]}

    shortfall = max_agents - len(builtin_keys)
    unclassified = not domains

    if shortfall > 0:
        wanted = shortfall
    elif unclassified and max_agents >= 3:
        wanted = min(2, len(core))
    else:
        wanted = 0

    if wanted:
        custom = await design_custom_personas(
            idea, context, count=wanted, existing=[p["name"] for p in core]
        )
        if custom:
            core = core[: max(0, max_agents - 1 - len(custom))] + custom

    return domains, core[: max_agents - 1] + [critic]


async def evaluate_idea_stream(
    idea: str, context: str = "", max_agents: int = 5
) -> AsyncIterator[dict]:
    """Yield pipeline events as they happen. See module docstring."""
    started = time.perf_counter()

    yield {"type": "stage", "stage": "assembling"}

    domains, panel = await assemble_panel(idea, context, max_agents)

    yield {
        "type": "panel",
        "domains": domains[:3],
        "experts": [
            {
                "key": p["key"],
                "name": p["name"],
                "role": p["role"],
                "icon": p.get("icon", "spark"),
                "color": p["color"],
                "custom": bool(p.get("custom")),
            }
            for p in panel
        ],
    }

    sem = asyncio.Semaphore(MAX_CONCURRENT_AGENTS)
    tasks = [asyncio.create_task(run_single_persona(p, idea, context, sem)) for p in panel]

    persona_results: list[dict] = []
    seen_charts: set[tuple] = set()
    charts_kept = 0

    try:
        for completed in asyncio.as_completed(tasks):
            result = await completed
            chart = result["analysis"].get("chart")
            if chart:
                signature = _chart_signature(chart)
                if charts_kept >= MAX_PERSONA_CHARTS or signature in seen_charts:
                    del result["analysis"]["chart"]
                else:
                    seen_charts.add(signature)
                    charts_kept += 1
            persona_results.append(result)
            yield {"type": "persona", "persona": result}
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        raise

    order = {p["key"]: i for i, p in enumerate(panel)}
    persona_results.sort(key=lambda r: order.get(r["key"], 999))

    yield {"type": "stage", "stage": "synthesizing"}

    synthesis = await synthesize_verdict(persona_results, idea, context)

    elapsed = round(time.perf_counter() - started, 1)
    print(f"[Orchestrator] {len(panel)} agents + synthesis in {elapsed}s")

    yield {
        "type": "done",
        "result": {
            "idea": idea,
            "detected_domains": domains[:3],
            "selected_experts": [
                {"name": p["name"], "icon": p.get("icon", "spark"), "role": p["role"], "color": p["color"]}
                for p in panel
            ],
            "personas": persona_results,
            "synthesis": synthesis,
            "elapsed_seconds": elapsed,
        },
    }


async def evaluate_idea(idea: str, context: str = "", max_agents: int = 5) -> dict:
    """Blocking variant — drains the stream and returns the final result."""
    async for event in evaluate_idea_stream(idea, context, max_agents):
        if event["type"] == "done":
            return event["result"]
    raise RuntimeError("Evaluation stream ended without a result")
