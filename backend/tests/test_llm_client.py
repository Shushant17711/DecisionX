"""
Key rotation, retry and fallback behaviour of llm_client.async_call_llm, driven
by a fake OpenAI client — no network.
"""

import json
from types import SimpleNamespace

import openai
import pytest

import agents.llm_client as lc

try:  # openai>=2 vendors its HTTP layer as httpx2; 1.x uses httpx
    import httpx2 as _http
except ImportError:  # pragma: no cover
    import httpx as _http


def _error(cls, status: int, message: str = "error", headers: dict | None = None):
    request = _http.Request("POST", "https://example.invalid/v1/chat/completions")
    response = _http.Response(status, request=request, headers=headers or {})
    return cls(message, response=response, body=None)


def _ok(content: str, finish_reason: str = "stop"):
    message = SimpleNamespace(content=content)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])


class FakeClients:
    """Scripted responses. `script` items are either responses or exceptions."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def get(self, provider, api_key, timeout):
        clients = self

        class Completions:
            async def create(self, **kwargs):
                clients.calls.append({"key": api_key, **kwargs})
                item = clients.script.pop(0)
                if isinstance(item, Exception):
                    raise item
                return item

        return SimpleNamespace(chat=SimpleNamespace(completions=Completions()))


@pytest.fixture
def provider(monkeypatch):
    """A 'groq' provider with three fake keys and clean process state."""
    monkeypatch.setitem(lc.PROVIDERS["groq"], "keys", ["k0", "k1", "k2"])
    monkeypatch.setattr(lc, "_KEY_CURSORS", {name: 0 for name in lc.PROVIDERS})
    monkeypatch.setattr(lc, "_BAD_KEYS", set())
    monkeypatch.setattr(lc, "_MISSING_MODELS", set())
    monkeypatch.setattr(lc, "_JSON_MODE_SUPPORT", {})
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(lc, "_sleep", fake_sleep)

    def install(script):
        fake = FakeClients(script)
        monkeypatch.setattr(lc, "_get_client", fake.get)
        fake.sleeps = sleeps
        return fake

    return install


GOOD = _ok(json.dumps({"score": 7, "headline": "fine"}))


async def _call(**kw):
    return await lc.async_call_llm("sys", "user", provider="groq", timeout=30.0, **kw)


async def test_auth_error_disables_key_and_rotates(provider):
    fake = provider([_error(openai.AuthenticationError, 401), GOOD])
    assert (await _call())["score"] == 7
    assert [c["key"] for c in fake.calls] == ["k0", "k1"]
    assert ("groq", 0) in lc._BAD_KEYS
    assert fake.sleeps == []  # auth failures rotate without backoff

    # The bad key is skipped from now on.
    fake = provider([GOOD, GOOD, GOOD])
    for _ in range(3):
        await _call()
    assert "k0" not in [c["key"] for c in fake.calls]


async def test_all_keys_rejected_reports_auth(provider):
    provider([_error(openai.PermissionDeniedError, 403)] * 3)
    out = await _call()
    assert out["_failed"] and out["_reason"] == "auth"
    assert lc.available_providers().count("groq") == 0


async def test_rate_limit_honours_retry_after_and_rotates(provider):
    fake = provider([_error(openai.RateLimitError, 429, headers={"retry-after": "2"}), GOOD])
    assert (await _call())["score"] == 7
    assert fake.sleeps == [2.0]
    assert [c["key"] for c in fake.calls] == ["k0", "k1"]


async def test_retry_after_is_capped(provider):
    fake = provider([_error(openai.RateLimitError, 429, headers={"retry-after": "600"}), GOOD])
    await _call()
    assert fake.sleeps == [lc.RETRY_AFTER_CAP]


async def test_server_errors_back_off_with_jitter_then_give_up(provider):
    fake = provider([_error(openai.InternalServerError, 503)] * 5)
    out = await _call()
    assert out["_failed"] and out["_reason"] == "server"
    assert len(fake.calls) == lc.MAX_ATTEMPTS
    assert len(fake.sleeps) == lc.MAX_ATTEMPTS - 1
    assert all(0 < s <= lc.BACKOFF_CAP for s in fake.sleeps)


async def test_model_not_found_falls_back_to_other_model(provider):
    fake = provider([_error(openai.NotFoundError, 404, "model not found"), GOOD])
    assert (await _call(model="llama-3.1-8b-instant"))["score"] == 7
    assert [c["model"] for c in fake.calls] == ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
    assert ("groq", "llama-3.1-8b-instant") in lc._MISSING_MODELS


async def test_json_mode_disabled_only_for_json_mode_errors(provider):
    fake = provider([_error(openai.BadRequestError, 400, "response_format json_object is not supported"), GOOD])
    assert (await _call())["score"] == 7
    assert "response_format" in fake.calls[0] and "response_format" not in fake.calls[1]
    assert lc._JSON_MODE_SUPPORT[("groq", "llama-3.1-8b-instant")] is False


async def test_unrelated_bad_request_keeps_json_mode(provider):
    fake = provider([_error(openai.BadRequestError, 400, "unsupported value for temperature")])
    out = await _call()
    assert out["_failed"] and len(fake.calls) == 1
    assert ("groq", "llama-3.1-8b-instant") not in lc._JSON_MODE_SUPPORT


async def test_truncated_output_retries_once_with_more_tokens(provider):
    fake = provider([_ok('{"score": 7, "headl', "length"), GOOD])
    assert (await _call(max_tokens=500))["score"] == 7
    assert fake.calls[1]["max_tokens"] > 500


async def test_truncated_twice_is_marked_failed(provider):
    provider([_ok("{", "length"), _ok("{", "length")])
    out = await _call()
    assert out["_failed"] and out["_reason"] == "truncated"


async def test_unparseable_output_retries_without_json_mode(provider):
    fake = provider([_ok("not json at all"), _ok('Sure: {"score": 5}')])
    assert (await _call())["score"] == 5
    assert "response_format" not in fake.calls[1]


async def test_no_keys(provider, monkeypatch):
    monkeypatch.setitem(lc.PROVIDERS["groq"], "keys", [])
    out = await _call()
    assert out["_failed"] and out["_reason"] == "no_keys"
