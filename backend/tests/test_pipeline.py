"""
Pipeline tests with the LLM layer stubbed out (see conftest.stub_llm).

These cover the contracts the frontend depends on — event order and shape of the
NDJSON stream, panel sizing up to MAX_PANEL_SIZE, bespoke-persona backfill — and
the robustness guarantees: one failing expert never kills the run, the run
deadline is honoured, and pending experts are cancelled when the consumer leaves.
"""

import asyncio
import json
import math

import pytest

import agents.orchestrator as orchestrator
import agents.personas as personas
import agents.synthesizer as synthesizer
import config
import observability


async def _collect(idea="An AI tiffin app for students", context="", n=5):
    return [e async for e in orchestrator.evaluate_idea_stream(idea, context, n)]


async def test_stream_contract(stub_llm):
    events = await _collect()

    types = [e["type"] for e in events]
    assert types[0] == "stage" and events[0]["stage"] == "assembling", types
    assert types[1] == "panel", types
    assert types.count("persona") == 5, types
    assert types[-1] == "done", types
    assert "synthesizing" in [e.get("stage") for e in events], types

    panel = events[1]
    assert len(panel["experts"]) == 5
    for expert in panel["experts"]:
        assert expert["icon"] in personas.ICON_NAMES, expert
        assert expert["color"].startswith("#"), expert

    result = events[-1]["result"]
    assert len(result["personas"]) == 5
    assert result["personas"][-1]["key"] == "critic", "critic must close the panel"
    assert result["synthesis"]["overall_score"] == 7
    assert result["synthesis"]["consensus_percentage"] == 100
    assert isinstance(result["elapsed_seconds"], float)
    for e in events:
        json.dumps(e, allow_nan=False)


async def test_large_panel_uses_custom_personas(stub_llm):
    _, panel = await orchestrator.assemble_panel("An AI tiffin app for students", "", 30)
    assert len(panel) == 30
    keys = [p["key"] for p in panel]
    assert len(keys) == len(set(keys)), "duplicate personas in panel"
    assert keys[-1] == "critic"
    assert len([p for p in panel if p.get("custom")]) == 30 - len(personas.PERSONAS)


@pytest.mark.parametrize("requested,expected", [(0, 1), (1, 1), (5, 5), (999, personas.MAX_PANEL_SIZE)])
async def test_panel_size_is_clamped(stub_llm, requested, expected):
    _, panel = await orchestrator.assemble_panel("A carbon credit marketplace", "", requested)
    assert len(panel) == expected


async def test_unclassified_idea_gets_bespoke_experts(stub_llm):
    assert personas.classify_idea_domain("a poem about rain") == [], "'ai' must not match 'rain'"
    _, panel = await orchestrator.assemble_panel("A ritual for remembering names", "", 5)
    assert any(p.get("custom") for p in panel)


async def test_persona_chart_survives_pipeline(stub_llm):
    result = (await _collect("A tiffin app for students", "", 3))[-1]["result"]
    with_charts = [p for p in result["personas"] if "chart" in p["analysis"]]
    assert len(with_charts) == 1, "identical charts must dedupe"
    assert with_charts[0]["analysis"]["chart"]["type"] == "bar"
    sc = result["synthesis"]["score_chart"]
    assert sc["measured"] is True and len(sc["data"]) == 3


async def test_malformed_chart_is_dropped(stub_llm):
    stub_llm.persona = lambda s, u: {
        "verdict": "Cautious", "score": 6, "headline": "h", "strengths": [], "concerns": [],
        "recommendation": "r", "chart": {"type": "bar", "title": "Bad", "data": [{"label": "only", "value": 1}]},
    }
    stub_llm.synthesis = lambda: {
        "overall_score": 6, "verdict": "Caution", "strengths": ["s"], "weaknesses": [],
        "opportunities": [], "threats": [], "charts": [{"type": "donut", "title": "nope", "data": []}],
    }
    result = await orchestrator.evaluate_idea("An idea about markets", "", 3)
    assert all("chart" not in p["analysis"] for p in result["personas"])
    assert result["synthesis"]["charts"] == []


# ── Robustness ──────────────────────────────────────────────────────────────

async def test_persona_exception_does_not_kill_run(stub_llm):
    def flaky(system_prompt, user_prompt):
        if "VC / Angel Investor" in user_prompt:
            raise RuntimeError("boom")
        return {"verdict": "Bullish", "score": "8/10", "headline": "Good", "strengths": ["x"],
                "concerns": ["y"], "recommendation": "Go"}

    stub_llm.persona = flaky
    result = (await _collect("A SaaS startup for investors", "", 5))[-1]["result"]

    failed = [p for p in result["personas"] if p["analysis"].get("_failed")]
    ok = [p for p in result["personas"] if not p["analysis"].get("_failed")]
    assert len(result["personas"]) == 5
    assert len(failed) == 1 and failed[0]["key"] == "investor"
    assert all(p["analysis"]["score"] == 8 for p in ok)
    assert result["synthesis"]["failed_agents"] == [failed[0]["name"]]
    assert observability.snapshot()["persona_exceptions"] == 1


async def test_run_deadline_cancels_slow_experts_and_still_synthesizes(stub_llm, monkeypatch):
    monkeypatch.setattr(config, "RUN_TIMEOUT", 10.0)
    monkeypatch.setattr(orchestrator, "_synthesis_reserve", lambda t: 9.7)  # experts get 0.3s
    cancelled = []

    async def slow_critic(system_prompt, user_prompt):
        if "devil's advocate" in system_prompt.lower():
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise
        return {"verdict": "Bullish", "score": 8, "headline": "ok", "strengths": ["a"], "concerns": []}

    stub_llm.persona = slow_critic
    events = await _collect(n=3)
    result = events[-1]["result"]

    assert cancelled == [True]
    critic = next(p for p in result["personas"] if p["key"] == "critic")
    assert critic["analysis"]["_failed"] and critic["analysis"]["_reason"] == "deadline"
    assert [e["type"] for e in events].count("persona") == 3
    assert result["synthesis"]["overall_score"] == 7  # synthesized from what finished


def _hang_except_critic(started, cancelled):
    async def persona(system_prompt, user_prompt):
        if "devil's advocate" in system_prompt.lower():
            return {"verdict": "Bearish", "score": 3, "headline": "No", "strengths": [], "concerns": ["c"]}
        started.append(1)
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.append(1)
            raise
    return persona


async def test_closing_stream_cancels_pending_experts(stub_llm):
    """Consumer closes the generator while it is suspended at a yield (GeneratorExit)."""
    started, cancelled = [], []
    stub_llm.persona = _hang_except_critic(started, cancelled)
    stream = orchestrator.evaluate_idea_stream("An AI tiffin app", "", 4)
    async for event in stream:
        if event["type"] == "persona":
            break
    await asyncio.sleep(0.02)
    await stream.aclose()
    assert len(started) == 3 and len(cancelled) == 3


async def test_client_disconnect_cancels_pending_experts(stub_llm):
    """The consuming task is cancelled while the generator awaits experts (CancelledError)."""
    started, cancelled = [], []
    stub_llm.persona = _hang_except_critic(started, cancelled)
    stream = orchestrator.evaluate_idea_stream("An AI tiffin app", "", 4)
    while (await anext(stream))["type"] != "persona":
        pass
    with pytest.raises((asyncio.TimeoutError, TimeoutError)):
        await asyncio.wait_for(anext(stream), timeout=0.1)
    assert len(started) == 3 and len(cancelled) == 3


async def test_cancelling_blocking_evaluate_cancels_experts(stub_llm):
    cancelled = []

    async def hang(system_prompt, user_prompt):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.append(1)
            raise

    stub_llm.persona = hang
    task = asyncio.create_task(orchestrator.evaluate_idea("An AI tiffin app", "", 3))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(cancelled) == 3


async def test_nan_and_garbage_scores_never_reach_the_wire(stub_llm):
    scores = iter(["8/10", float("nan"), "7.5", "eight", 4])

    def varied(system_prompt, user_prompt):
        return {"verdict": "??", "score": next(scores), "headline": "h", "strengths": "one\ntwo",
                "concerns": None, "recommendation": 3}

    stub_llm.persona = varied
    stub_llm.synthesis = lambda: {**__import__("conftest").SYNTHESIS, "overall_score": float("inf")}
    result = (await _collect(n=5))[-1]["result"]
    json.dumps(result, allow_nan=False)

    by_score = sorted(p["analysis"]["score"] for p in result["personas"] if not p["analysis"].get("_failed"))
    assert by_score == [4, 8, 8]
    assert len(result["synthesis"]["failed_agents"]) == 2
    # Infinite synthesis score → invalid → local synthesis from the valid scores.
    assert result["synthesis"]["overall_score"] == round((8 + 8 + 4) / 3, 1)
    strengths = next(p for p in result["personas"] if not p["analysis"].get("_failed"))["analysis"]["strengths"]
    assert strengths == ["one", "two"]


async def test_failed_agents_excluded_from_score(stub_llm):
    results = [
        {"key": "a", "name": "A", "role": "Analyst", "analysis": {"score": 9, "strengths": [], "concerns": []}},
        {"key": "b", "name": "B", "role": "Analyst", "analysis": {"score": 5, "_failed": True}},
        {"key": "c", "name": "C", "role": "Analyst", "analysis": {"score": "n/a"}},
        {"key": "d", "name": "D", "role": "Analyst", "analysis": {"score": float("nan")}},
    ]
    out = await synthesizer.synthesize_verdict(results, "idea")
    assert out["agent_scores"] == {"A": 9}
    assert out["failed_agents"] == ["B", "C", "D"]
    assert not math.isnan(out["consensus_percentage"])


async def test_synthesis_respects_deadline(stub_llm):
    import time

    out = await synthesizer.synthesize_verdict(
        [{"key": "a", "name": "A", "role": "R", "analysis": {"score": 6, "strengths": ["s"], "concerns": ["c"]}}],
        "idea",
        deadline=time.monotonic() + 1.0,  # under the minimum call time
    )
    assert not [c for c in stub_llm.calls if "Chief Synthesizer" in c["system"]]
    assert out["overall_score"] == 6 and observability.snapshot()["synthesis_local_fallback"] == 1


async def test_synthesis_call_timeout_is_capped_by_deadline(stub_llm):
    import time

    await synthesizer.synthesize_verdict(
        [{"key": "a", "name": "A", "role": "R", "analysis": {"score": 6, "strengths": ["s"], "concerns": []}}],
        "idea",
        deadline=time.monotonic() + 8.0,
    )
    call = next(c for c in stub_llm.calls if "Chief Synthesizer" in c["system"])
    assert call["timeout"] <= 8.0
