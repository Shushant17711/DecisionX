"""
DecisionX — Orchestrator

Core evaluation pipeline:
0. If uploaded documents (or, for the Panel Architect, the typed context) do
   not fit their share of the context budget, condense them once — a single
   shared LLM pass ("reading" stage) whose digests every agent reads
1. Classify the idea's domain
2. Assemble the expert panel — built-in personas first, bespoke ones invented by
   the Panel Architect when the roster cannot cover the request
3. Run every agent concurrently on Groq
4. Synthesize into a unified verdict

`evaluate_idea_stream` emits each stage as it completes so the UI can render the
panel within milliseconds and fill in cards as verdicts land, instead of showing
a spinner until the entire pipeline finishes. `evaluate_idea` drains that same
stream for callers that want one blocking result.

Robustness:
  * every persona runs in its own task and any exception becomes a failed
    persona result — one agent can never take down the run.
  * the whole run has a deadline (DECISIONX_RUN_TIMEOUT). Experts still running
    when the expert phase's share of it expires are cancelled and reported as
    timed out; synthesis then works from whatever finished, within the time left.
  * persona LLM calls share one process-wide semaphore
    (DECISIONX_MAX_CONCURRENT_AGENTS) across all concurrent evaluations.
  * when the consumer goes away (client disconnect → CancelledError, or the
    generator being closed → GeneratorExit) every pending task is cancelled.
"""

import asyncio
import logging
import time
from contextlib import aclosing
from typing import AsyncIterator

import config
from agents.charts import sanitize_chart
from agents.condense import condense, needs_condensation
from agents.context import (
    ContextBundle,
    annotate_manifest,
    architect_budget,
    persona_budget,
    render,
    synthesis_budget,
)
from agents.personas import (
    MAX_PANEL_SIZE,
    PERSONAS,
    classify_idea_domain,
    design_custom_personas,
    get_persona_prompt,
    select_personas,
)
from agents.synthesizer import synthesize_verdict
from agents.validation import failed_analysis, json_safe, normalize_persona_analysis
from concurrency import shared_semaphore
from observability import incr

from agents.llm_client import async_call_llm

log = logging.getLogger("decisionx.orchestrator")

PERSONA_TIMEOUT = 25.0

ARCHITECT_TIMEOUT = 14.0

MAX_PERSONA_CHARTS = 4


def _synthesis_reserve(run_timeout: float) -> float:
    """Seconds of the run deadline held back for synthesis."""
    return min(30.0, run_timeout * 0.25)


def agent_semaphore() -> asyncio.Semaphore:
    return shared_semaphore("agents", config.MAX_CONCURRENT_AGENTS)


def _chart_signature(chart: dict) -> tuple:
    """
    Identify charts that say the same thing. Two experts plotting the same
    range of the same quantity have drawn one chart twice, whatever they
    titled it.
    """
    values = [p["value"] for p in chart["data"]]
    return (chart["type"], round(min(values), 2), round(max(values), 2))


def _persona_meta(persona: dict) -> dict:
    return {
        "key": persona["key"],
        "name": persona["name"],
        "role": persona["role"],
        "icon": persona.get("icon", "spark"),
        "color": persona["color"],
        "custom": bool(persona.get("custom")),
    }


async def run_single_persona(
    persona: dict, idea: str, context: str, sem: asyncio.Semaphore | None = None
) -> dict:
    """Run one persona agent and return its analysis with presentation metadata."""
    system_prompt, user_prompt = get_persona_prompt(persona, idea, context)

    started = time.monotonic()
    async with (sem or agent_semaphore()):
        waited = time.monotonic() - started
        raw = await async_call_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            provider="groq",
            model="llama-3.1-8b-instant",
            max_tokens=950,
            temperature=0.7,
            timeout=PERSONA_TIMEOUT,
            expect_keys=("score", "verdict"),
        )

    analysis = normalize_persona_analysis(raw)
    chart = sanitize_chart(analysis.get("chart"))
    if chart:
        analysis["chart"] = chart
    else:
        analysis.pop("chart", None)

    if analysis.get("_failed"):
        incr("persona_failures")
        log.warning("persona %s failed (%s) after %.1fs (queued %.1fs)", persona["key"],
                    analysis.get("_reason", "error"), time.monotonic() - started, waited)
    else:
        log.info("persona %s scored %s in %.1fs (queued %.1fs)", persona["key"],
                 analysis["score"], time.monotonic() - started, waited)
    return {**_persona_meta(persona), "analysis": analysis}


async def _run_persona_safe(persona: dict, idea: str, context: str) -> dict:
    """run_single_persona, but any exception becomes a failed persona result."""
    try:
        return await run_single_persona(persona, idea, context)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001 — isolate every agent
        incr("persona_failures")
        incr("persona_exceptions")
        log.exception("persona %s raised %s", persona.get("key"), type(e).__name__)
        return {**_persona_meta(persona), "analysis": failed_analysis("This expert hit an internal error.", "exception")}


def _timed_out_result(persona: dict) -> dict:
    incr("persona_failures")
    incr("persona_timeouts")
    return {
        **_persona_meta(persona),
        "analysis": failed_analysis("This expert ran out of time before answering.", "deadline"),
    }


def _plan_panel(idea: str, max_agents: int) -> tuple[list[str], list[dict], dict, int]:
    """(domains, built-in core, critic, bespoke experts wanted) — no LLM calls."""
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
    return domains, core, critic, wanted


def needs_architect(idea: str, max_agents: int) -> bool:
    """Whether assemble_panel will call the Panel Architect for this request."""
    return _plan_panel(idea, max(1, min(MAX_PANEL_SIZE, max_agents)))[3] > 0


async def assemble_panel(
    idea: str, context: "ContextBundle | str", max_agents: int, architect_timeout: float = ARCHITECT_TIMEOUT
) -> tuple[list[str], list[dict]]:
    """
    Build the expert panel for this idea.

    Returns (detected_domains, personas). Bespoke personas are designed only when
    the built-in roster genuinely cannot answer the request — either it ran out of
    experts for the requested panel size, or the idea matched no known domain and
    deserves purpose-built specialists rather than generic backfill.
    """
    max_agents = max(1, min(MAX_PANEL_SIZE, max_agents))
    domains, core, critic, wanted = _plan_panel(idea, max_agents)

    if wanted:
        custom = await design_custom_personas(
            idea,
            render(context, architect_budget(), architect=True),
            count=wanted,
            existing=[p["name"] for p in core],
            timeout=architect_timeout,
        )
        if custom:
            core = core[: max(0, max_agents - 1 - len(custom))] + custom

    return domains, core[: max_agents - 1] + [critic]


async def evaluate_idea_stream(
    idea: str,
    context: "ContextBundle | str" = "",
    max_agents: int = 5,
    manifest: list[dict] | None = None,
) -> AsyncIterator[dict]:
    """
    Yield pipeline events as they happen. See module docstring.

    `manifest` (the attachment manifest for `context`'s documents) is
    re-annotated in place after condensation and re-emitted as an
    `attachments` event, so the UI shows what the experts will actually read.
    """
    started = time.monotonic()
    run_timeout = float(config.RUN_TIMEOUT)
    deadline = started + run_timeout
    experts_deadline = deadline - _synthesis_reserve(run_timeout)
    bundle = ContextBundle.coerce(context)

    include_typed = needs_architect(idea, max_agents)
    if needs_condensation(bundle, include_typed=include_typed):
        yield {"type": "stage", "stage": "reading"}
        await condense(bundle, idea, deadline, include_typed=include_typed)
        if manifest:
            annotate_manifest(manifest, bundle)
            yield {"type": "attachments", "attachments": json_safe(manifest)}

    yield {"type": "stage", "stage": "assembling"}

    architect_timeout = min(ARCHITECT_TIMEOUT, run_timeout * 0.2)
    domains, panel = await assemble_panel(idea, bundle, max_agents, architect_timeout)
    log.info("panel of %d (%d custom) for domains %s", len(panel),
             sum(1 for p in panel if p.get("custom")), domains[:3] or "none")

    yield {
        "type": "panel",
        "domains": domains[:3],
        "experts": [_persona_meta(p) for p in panel],
    }

    expert_context = render(bundle, persona_budget())
    tasks: dict[asyncio.Task, dict] = {
        asyncio.create_task(_run_persona_safe(p, idea, expert_context)): p for p in panel
    }
    pending: set[asyncio.Task] = set(tasks)

    persona_results: list[dict] = []
    seen_charts: set[tuple] = set()
    charts_kept = 0

    def keep_chart(result: dict) -> None:
        nonlocal charts_kept
        chart = result["analysis"].get("chart")
        if chart:
            signature = _chart_signature(chart)
            if charts_kept >= MAX_PERSONA_CHARTS or signature in seen_charts:
                del result["analysis"]["chart"]
            else:
                seen_charts.add(signature)
                charts_kept += 1

    try:
        while pending:
            remaining = experts_deadline - time.monotonic()
            if remaining <= 0:
                break
            done, pending = await asyncio.wait(pending, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                try:
                    result = task.result()
                except Exception:  # noqa: BLE001 — _run_persona_safe should already catch
                    result = {**_persona_meta(tasks[task]),
                              "analysis": failed_analysis("This expert hit an internal error.", "exception")}
                keep_chart(result)
                persona_results.append(result)
                yield {"type": "persona", "persona": json_safe(result)}

        if pending:
            log.warning("run deadline: %d expert(s) still running after %.1fs — cancelling",
                        len(pending), time.monotonic() - started)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            timed_out = [tasks[t] for t in pending]
            pending = set()
            for persona in timed_out:
                result = _timed_out_result(persona)
                persona_results.append(result)
                yield {"type": "persona", "persona": result}
    finally:
        # Runs on normal exit, CancelledError (client disconnect) and
        # GeneratorExit (consumer closed the stream early).
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    order = {p["key"]: i for i, p in enumerate(panel)}
    persona_results.sort(key=lambda r: order.get(r["key"], 999))

    yield {"type": "stage", "stage": "synthesizing"}

    synthesis = await synthesize_verdict(
        persona_results, idea, render(bundle, synthesis_budget()), deadline=deadline
    )

    elapsed = round(time.monotonic() - started, 1)
    failed = sum(1 for r in persona_results if r["analysis"].get("_failed"))
    log.info("%d agents (%d failed) + synthesis in %.1fs", len(panel), failed, elapsed)

    yield {
        "type": "done",
        "result": json_safe({
            "idea": idea,
            "detected_domains": domains[:3],
            "selected_experts": [
                {"name": p["name"], "icon": p.get("icon", "spark"), "role": p["role"], "color": p["color"]}
                for p in panel
            ],
            "personas": persona_results,
            "synthesis": synthesis,
            "elapsed_seconds": elapsed,
        }),
    }


async def evaluate_idea(
    idea: str, context: "ContextBundle | str" = "", max_agents: int = 5, manifest: list[dict] | None = None
) -> dict:
    """Blocking variant — drains the stream and returns the final result.

    aclosing() guarantees the stream's cleanup (cancelling pending experts) runs
    immediately if this coroutine is cancelled, not whenever the GC gets to it.
    """
    async with aclosing(evaluate_idea_stream(idea, context, max_agents, manifest)) as stream:
        async for event in stream:
            if event["type"] == "done":
                return event["result"]
    raise RuntimeError("Evaluation stream ended without a result")
