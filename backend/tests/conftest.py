"""
Shared fixtures. Every test runs with the LLM layer replaced by an in-memory
double — no test in this directory (outside integration/) touches the network.
"""

import asyncio
import io
import zipfile

import pytest

import agents.llm_client as llm_client
import agents.orchestrator as orchestrator
import agents.personas as personas
import agents.synthesizer as synthesizer
import config
import observability

SYNTHESIS = {
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

PERSONA = {
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


class FakeUpload:
    """Minimal UploadFile double that records how much was read."""

    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self._buf = io.BytesIO(data)
        self.bytes_read = 0

    async def read(self, size: int = -1) -> bytes:
        chunk = self._buf.read(size)
        self.bytes_read += len(chunk)
        return chunk


class StubLLM:
    """Deterministic async_call_llm replacement. Override `persona` per test."""

    def __init__(self, architect_count: int = 40):
        self.architect_count = architect_count
        self.persona = lambda system_prompt, user_prompt: dict(PERSONA)
        self.synthesis = lambda: dict(SYNTHESIS)
        self.calls: list[dict] = []

    async def __call__(self, system_prompt, user_prompt, provider="groq", model=None, **kwargs):
        self.calls.append({"system": system_prompt, "user": user_prompt, "provider": provider, **kwargs})
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
                    for i in range(self.architect_count)
                ]
            }
        if "Chief Synthesizer" in system_prompt:
            return self.synthesis()
        result = self.persona(system_prompt, user_prompt)
        if asyncio.iscoroutine(result):
            result = await result
        return result


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    observability.reset_counters()
    monkeypatch.setattr(config, "RUN_TIMEOUT", 120.0)
    monkeypatch.setattr(config, "PARSE_TIMEOUT", 20.0)
    monkeypatch.setattr(config, "PARSER_ISOLATION", "subprocess")
    monkeypatch.setattr(config, "CONTEXT_BUDGET_CHARS", 6000)
    monkeypatch.setattr(config, "ALLOWED_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"])
    monkeypatch.setattr(config, "API_TOKEN", None)
    yield


@pytest.fixture
def stub_llm(monkeypatch):
    stub = StubLLM()
    for module in (orchestrator, personas, synthesizer, llm_client):
        monkeypatch.setattr(module, "async_call_llm", stub)
    monkeypatch.setattr(synthesizer, "available_providers", lambda: ["groq"])
    return stub


def make_xlsx(rows: list[list], sheets: int = 1) -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    for s in range(sheets):
        ws = wb.active if s == 0 else wb.create_sheet()
        ws.title = f"Sheet{s + 1}"
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_zip_bomb(member: str = "xl/worksheets/sheet1.xml", size: int = 80 * 1024 * 1024) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        with zf.open(member, "w", force_zip64=True) as f:
            chunk = b"\0" * (1024 * 1024)
            for _ in range(size // len(chunk)):
                f.write(chunk)
    return buf.getvalue()


def make_docx(paragraphs: list[str]) -> bytes:
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", xml)
    return buf.getvalue()
