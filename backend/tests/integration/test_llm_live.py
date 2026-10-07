"""
Live smoke test against the real providers. Makes real (billable) LLM calls,
so it is skipped unless DECISIONX_LIVE_TESTS=1:

    DECISIONX_LIVE_TESTS=1 python -m pytest tests/integration -q
"""

import asyncio
import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DECISIONX_LIVE_TESTS") != "1",
    reason="live LLM test; set DECISIONX_LIVE_TESTS=1 to run",
)


async def test_evaluate_idea_live():
    from agents.llm_client import available_providers
    from agents.orchestrator import evaluate_idea

    if not available_providers():
        pytest.skip("no provider key files configured")
    result = await asyncio.wait_for(
        evaluate_idea("A subscription service for college students", context="", max_agents=1),
        timeout=90.0,
    )
    assert {"personas", "synthesis", "elapsed_seconds"} <= result.keys()
    assert len(result["personas"]) == 1
