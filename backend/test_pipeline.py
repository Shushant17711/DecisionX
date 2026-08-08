"""
Integration tests for the DecisionX pipeline with the LLM layer stubbed out.

Run: python -m pytest test_pipeline.py -q   (or: python test_pipeline.py)

These cover the contracts the frontend depends on — event order and shape of the
NDJSON stream, panel sizing up to MAX_PANEL_SIZE, bespoke-persona backfill, and
multi-file context extraction — without making a single provider call.
"""

import asyncio
import io
import json

import agents.llm_client as llm_client
import agents.orchestrator as orchestrator
import agents.personas as personas
import agents.synthesizer as synthesizer
from parsers.file_parser import extract_text_from_files


class FakeUpload:
    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self._data = data

    async def read(self) -> bytes:
        return self._data


def _stub_llm(architect_count: int = 40):
    """Replace async_call_llm everywhere with a deterministic in-memory double."""

    async def fake_call(system_prompt, user_prompt, provider="groq", model=None, **kwargs):
        await asyncio.sleep(0) 
        if "Panel Architect" in system_prompt:
            return {
                "personas": [
                    {
                        "name": f"The Specialist {i}",
                        "role": "Domain Specialist",
                        "icon": "beaker",
                        "expertise": "You evaluate the niche mechanics of this idea.",
                    }
                    for i in range(architect_count)
                ]
            }
        if "Chief Synthesizer" in system_prompt:
            return {
                "overall_score": 7,
                "verdict": "Caution",
                "executive_summary": "Promising but unproven.",
                "consensus_points": ["Real pain point"],
                "disagreements": [{"topic": "Cost", "sides": "A vs B", "resolution": "Test it"}],
                "strengths": ["Clear wedge"],
                "weaknesses": ["Thin margins"],
                "opportunities": ["Adjacent markets"],
                "threats": ["Incumbents"],
                "action_plan_7_days": ["Talk to 10 users"],
                "action_plan_30_days": ["Ship an MVP"],
                "final_recommendation": "Validate demand first.",
            }
        return {
            "verdict": "Cautious",
            "score": 6,
            "headline": "Reasonable, with caveats.",
            "strengths": ["s1"],
            "concerns": ["c1"],
            "recommendation": "Validate.",
            "chart": {
                "type": "bar",
                "title": "Monthly cost breakdown",
                "unit": "INR",
                "note": "Assumes 200 subscribers.",
                "data": [
                    {"label": "Kitchen", "value": 40000},
                    {"label": "Delivery", "value": "₹25,000"},
                ],
            },
        }

    for module in (orchestrator, personas, synthesizer):
        module.async_call_llm = fake_call
    llm_client.async_call_llm = fake_call
    synthesizer.available_providers = lambda: ["groq"]


async def test_stream_contract():
    events = []
    async for e in orchestrator.evaluate_idea_stream("An AI tiffin app for students", "", 5):
        events.append(e)

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
        json.loads(json.dumps(e))


async def test_large_panel_uses_custom_personas():
    domains, panel = await orchestrator.assemble_panel("An AI tiffin app for students", "", 30)
    assert len(panel) == 30, len(panel)
    keys = [p["key"] for p in panel]
    assert len(keys) == len(set(keys)), "duplicate personas in panel"
    assert keys[-1] == "critic"
    custom = [p for p in panel if p.get("custom")]
    assert len(custom) == 30 - len(personas.PERSONAS), len(custom)


async def test_panel_size_is_clamped():
    for requested, expected in ((0, 1), (1, 1), (5, 5), (999, personas.MAX_PANEL_SIZE)):
        _, panel = await orchestrator.assemble_panel("A carbon credit marketplace", "", requested)
        assert len(panel) == expected, f"{requested} -> {len(panel)}, wanted {expected}"


async def test_unclassified_idea_gets_bespoke_experts():
    assert personas.classify_idea_domain("a poem about rain") == [], "'ai' must not match 'rain'"
    _, panel = await orchestrator.assemble_panel("A ritual for remembering names", "", 5)
    assert any(p.get("custom") for p in panel), "unclassified idea should get bespoke experts"


async def test_failed_agents_excluded_from_score():
    results = [
        {"key": "a", "name": "A", "role": "Analyst", "analysis": {"score": 9, "strengths": [], "concerns": []}},
        {"key": "b", "name": "B", "role": "Analyst", "analysis": {"score": 5, "_failed": True, "strengths": [], "concerns": []}},
    ]
    out = await synthesizer.synthesize_verdict(results, "idea")
    assert out["agent_scores"] == {"A": 9}, out["agent_scores"]
    assert out["failed_agents"] == ["B"], out["failed_agents"]


async def test_multi_file_extraction():
    files = [
        FakeUpload("notes.txt", b"Runway is 9 months."),
        FakeUpload("data.csv", b"city,orders\nPune,412\nNashik,187\n"),
        FakeUpload("logo.png", b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4),
        FakeUpload("empty.txt", b""),
    ]
    context, manifest = await extract_text_from_files(files)

    assert "Runway is 9 months." in context
    assert "Pune" in context and "orders" in context
    assert manifest[0]["included"] and manifest[1]["included"]
    assert not manifest[2]["included"] and "Unsupported" in manifest[2]["error"]
    assert not manifest[3]["included"] and manifest[3]["error"] == "File is empty"


async def test_json_extraction_edge_cases():
    extract = llm_client._extract_json
    assert extract('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract('Here you go: {"a": 2} — hope that helps') == {"a": 2}
    assert extract('{"note": "a } brace in a string", "a": 3}')["a"] == 3
    assert extract('{"nested": {"deep": true}, "a": 4}')["a"] == 4


async def test_chart_sanitizer():
    from agents.charts import sanitize_chart, sanitize_charts

    good = sanitize_chart({
        "type": "bar",
        "title": "  Monthly   cost breakdown  ",
        "unit": "INR",
        "note": "Assumes 200 subscribers.",
        "data": [{"label": "Kitchen", "value": 40000}, {"label": "Delivery", "value": "₹25,000"}],
    })
    assert good and good["title"] == "Monthly cost breakdown", good
    assert good["data"][1]["value"] == 25000.0, "numeric strings must coerce"

    assert sanitize_chart(None) is None
    assert sanitize_chart({"type": "pie", "title": "x", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({"type": "bar", "title": "", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({"type": "bar", "title": "t", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({
        "type": "bar", "title": "t",
        "data": [{"label": "a", "value": 5}, {"label": "b", "value": 5}],
    }) is None
    assert sanitize_chart({
        "type": "split", "title": "t",
        "data": [{"label": "a", "value": -1}, {"label": "b", "value": 5}],
    }) is None
    assert sanitize_chart({
        "type": "bar", "title": "t",
        "data": [{"label": "a", "value": "n/a"}, {"label": "b", "value": 2}],
    }) is None

    dup = sanitize_chart({
        "type": "bar", "title": "t",
        "data": [{"label": "A", "value": 1}, {"label": "a", "value": 9}, {"label": "B", "value": 2}],
    })
    assert [p["label"] for p in dup["data"]] == ["A", "B"], dup

    many = sanitize_chart({
        "type": "line", "title": "t",
        "data": [{"label": f"M{i}", "value": i} for i in range(20)],
    })
    assert len(many["data"]) == 8, len(many["data"])

    assert sanitize_chart({
        "type": "bar", "title": "Cost breakdown", "unit": "INR",
        "data": [{"label": "CAC", "value": 40000}, {"label": "Conversion rate", "value": 0.5},
                 {"label": "Fee", "value": 12000}],
    }) is None
    assert sanitize_chart({
        "type": "line", "title": "Subscribers", "unit": "",
        "data": [{"label": "M1", "value": 3}, {"label": "M6", "value": 900},
                 {"label": "M12", "value": 12000}],
    }) is not None

    assert sanitize_charts("not a list") == []
    assert len(sanitize_charts([good, good, good], limit=2)) == 2


async def test_persona_chart_survives_pipeline():
    events = []
    async for e in orchestrator.evaluate_idea_stream("A tiffin app for students", "", 3):
        events.append(e)
    result = events[-1]["result"]

    with_charts = [p for p in result["personas"] if "chart" in p["analysis"]]
    assert len(with_charts) == 1, f"identical charts must dedupe, kept {len(with_charts)}"
    assert with_charts[0]["analysis"]["chart"]["type"] == "bar"
    sc = result["synthesis"]["score_chart"]
    assert sc["measured"] is True and len(sc["data"]) == 3, sc
    json.loads(json.dumps(result))


async def test_malformed_chart_is_dropped():
    import agents.llm_client as lc

    async def bad_chart(system_prompt, user_prompt, **kwargs):
        if "Chief Synthesizer" in system_prompt or "Panel Architect" in system_prompt:
            return {"overall_score": 6, "verdict": "Caution", "strengths": ["s"],
                    "weaknesses": [], "opportunities": [], "threats": [],
                    "charts": [{"type": "donut", "title": "nope", "data": []}]}
        return {"verdict": "Cautious", "score": 6, "headline": "h", "strengths": [],
                "concerns": [], "recommendation": "r",
                "chart": {"type": "bar", "title": "Bad", "data": [{"label": "only", "value": 1}]}}

    original = orchestrator.async_call_llm
    orchestrator.async_call_llm, synthesizer.async_call_llm, lc.async_call_llm = (bad_chart,) * 3
    try:
        result = await orchestrator.evaluate_idea("An idea about markets", "", 3)
    finally:
        orchestrator.async_call_llm = synthesizer.async_call_llm = lc.async_call_llm = original

    assert all("chart" not in p["analysis"] for p in result["personas"]), "malformed chart must be dropped"
    assert result["synthesis"]["charts"] == [], result["synthesis"]["charts"]


async def main():
    _stub_llm()
    print("DecisionX pipeline tests")
    for test in (
        test_stream_contract,
        test_large_panel_uses_custom_personas,
        test_panel_size_is_clamped,
        test_unclassified_idea_gets_bespoke_experts,
        test_failed_agents_excluded_from_score,
        test_multi_file_extraction,
        test_json_extraction_edge_cases,
        test_chart_sanitizer,
        test_persona_chart_survives_pipeline,
        test_malformed_chart_is_dropped,
    ):
        await test()
    print("all passed")


if __name__ == "__main__":
    asyncio.run(main())
