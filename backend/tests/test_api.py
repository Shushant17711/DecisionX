"""
HTTP surface: origin/token gate, body limit, input validation, error hygiene,
and the NDJSON stream contract — LLM stubbed (see conftest.stub_llm).
"""

import json

import pytest
from fastapi.testclient import TestClient

import config
import main

ORIGIN = {"Origin": "http://localhost:3000"}


@pytest.fixture
def client(stub_llm):
    with TestClient(main.app) as c:
        yield c


def _post(client, path="/api/evaluate", data=None, headers=None, files=None):
    return client.post(path, data=data or {"idea": "An AI tiffin app for students", "num_personas": "3"},
                       headers=headers if headers is not None else ORIGIN, files=files)


def test_health_exposes_counters(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and isinstance(body["counters"], dict)


def test_default_bind_is_loopback():
    assert config.HOST == "127.0.0.1" or "DECISIONX_HOST" in __import__("os").environ


# -- Origin / token ---------------------------------------------------------

def test_foreign_origin_rejected(client):
    r = _post(client, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert main.snapshot()["rejected_origin"] == 1


def test_allowed_origin_and_no_origin_accepted(client):
    assert _post(client).status_code == 200
    assert _post(client, headers={}).status_code == 200  # curl / server-to-server


def test_origin_list_is_configurable(client, monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_ORIGINS", ["https://app.example"])
    assert _post(client).status_code == 403
    assert _post(client, headers={"Origin": "https://app.example"}).status_code == 200


def test_token_enforced_only_when_set(client, monkeypatch):
    monkeypatch.setattr(config, "API_TOKEN", "s3cret")
    assert _post(client).status_code == 401
    assert _post(client, headers={**ORIGIN, "X-DecisionX-Token": "wrong"}).status_code == 401
    assert _post(client, headers={**ORIGIN, "X-DecisionX-Token": "s3cret"}).status_code == 200


def test_health_is_not_gated(client, monkeypatch):
    monkeypatch.setattr(config, "API_TOKEN", "s3cret")
    assert client.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 200


def test_oversized_body_rejected(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_REQUEST_BYTES", 1024)
    r = _post(client, files={"files": ("a.txt", b"x" * 4096, "text/plain")})
    assert r.status_code == 413


# -- Validation -------------------------------------------------------------

@pytest.mark.parametrize("data", [
    {"idea": "   "},
    {"idea": "x" * (main.MAX_IDEA_CHARS + 1)},
    {"idea": "ok", "context": "c" * (main.MAX_CONTEXT_CHARS + 1)},
    {"idea": "ok", "num_personas": "0"},
    {"idea": "ok", "num_personas": "999"},
    {"idea": "ok", "num_personas": "five"},
])
@pytest.mark.parametrize("path", ["/api/evaluate", "/api/evaluate/stream"])
def test_invalid_input_is_422(client, data, path):
    assert _post(client, path, data=data).status_code == 422


def test_too_many_files_is_422(client):
    files = [("files", (f"f{i}.txt", b"hi", "text/plain")) for i in range(main.MAX_UPLOAD_FILES + 1)]
    assert _post(client, files=files).status_code == 422


def test_500_does_not_leak_exception_text(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("secret internal path /etc/keys")

    monkeypatch.setattr(main, "evaluate_idea", boom)
    r = _post(client)
    assert r.status_code == 500
    assert "secret" not in r.text and "request" in r.json()["detail"]
    assert r.headers.get("X-Request-ID")


# -- Contract ---------------------------------------------------------------

def test_blocking_evaluate_shape(client):
    r = _post(client, files={"files": ("notes.txt", b"Runway is 9 months.", "text/plain")})
    assert r.status_code == 200
    body = r.json()
    assert {"idea", "personas", "synthesis", "selected_experts", "attachments"} <= body.keys()
    att = body["attachments"][0]
    assert att["name"] == "notes.txt" and att["included"] is True


def test_stream_contract(client, stub_llm):
    r = _post(client, "/api/evaluate/stream",
              files={"files": ("notes.txt", b"Runway is 9 months.", "text/plain")})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in r.text.splitlines() if line]
    types = [e["type"] for e in events]
    assert types[0] == "attachments" and types[1] == "stage" and types[2] == "panel"
    assert types.count("persona") == 3 and types[-1] == "done"
    assert events[-1]["result"]["attachments"][0]["included"] is True
    # Uploaded text reached the experts, delimited as untrusted.
    persona_prompts = [c["user"] for c in stub_llm.calls if "Critically evaluate" in c["user"]]
    assert persona_prompts and all("UNTRUSTED DOCUMENT" in p and "Runway" in p for p in persona_prompts)


def test_stream_failure_emits_generic_error_event(client, monkeypatch):
    async def broken(*a, **k):
        yield {"type": "stage", "stage": "assembling"}
        raise RuntimeError("secret detail")

    monkeypatch.setattr(main, "evaluate_idea_stream", broken)
    r = _post(client, "/api/evaluate/stream")
    last = json.loads(r.text.splitlines()[-1])
    assert last["type"] == "error" and "secret" not in last["message"]
