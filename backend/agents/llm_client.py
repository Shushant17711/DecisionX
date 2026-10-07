"""
DecisionX — Dynamic LLM Client

Handles loading multiple API keys for OpenRouter, Groq, and NVIDIA from files
and rotating between them per request to avoid rate limits.

Latency notes (these are the reason the client looks the way it does):
  * AsyncOpenAI clients are cached per (provider, key). Building a fresh client
    per call forced a new TLS handshake on every persona — with a 30-agent panel
    that dominated wall-clock time.
  * `max_retries=0`. The SDK defaults to 2 silent retries with exponential
    backoff, so one dead provider cost 3x its timeout before we even saw an error.
    Retrying is done here instead, where it can rotate keys.
  * `response_format` support is probed once per (provider, model) and cached, so
    only the first call to a model that rejects JSON mode pays the retry.

Failure handling, by error class:
  401 / 403             the key is dead — mark it bad for this process, rotate.
  429 / 5xx / timeout   transient — rotate key after a jittered exponential
                        backoff, honouring Retry-After (capped).
  404                   model not found — remember it, fall to the provider's
                        other configured model if there is one.
  400 about JSON mode   disable `response_format` for that model, retry.
  finish_reason=length  output truncated — retry once with a larger max_tokens.

Keys are never logged; logs and counters identify a key by its index.
"""

import asyncio
import email.utils
import json
import logging
import os
import random
import time

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

from agents.validation import failed_analysis
from observability import incr

log = logging.getLogger("decisionx.llm")

MAX_ATTEMPTS = 3
BACKOFF_BASE = 0.5
BACKOFF_CAP = 4.0
RETRY_AFTER_CAP = 8.0
MAX_TOKENS_CEILING = 4096
_MIN_ATTEMPT_SECONDS = 2.0
_sleep = asyncio.sleep  # indirection so tests can skip real backoff waits


def load_keys(filename: str) -> list[str]:
    """Load valid API keys from a given file."""
    keys = []
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(base_dir)
    filepath = os.path.join(backend_dir, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                key = line.strip()
                if key and not key.startswith("#"):
                    keys.append(key)
    except FileNotFoundError:
        pass
    except Exception as e:
        log.warning("Could not load keys from %s: %s", filename, type(e).__name__)
    return keys


OPENROUTER_KEYS = load_keys("openrouterapi")
GROQ_KEYS = load_keys("groqapi")
NVIDIA_KEYS = load_keys("nvidiaapi")

PROVIDERS = {
    "openrouter": {
        "keys": OPENROUTER_KEYS,
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "inclusionai/ling-3.0-tiny:free",
        "strong_model": "nvidia/nemotron-3-ultra-550b-a55b:free",
    },
    "groq": {
        "keys": GROQ_KEYS,
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.1-8b-instant",
        "strong_model": "llama-3.3-70b-versatile",
    },
    "nvidia": {
        "keys": NVIDIA_KEYS,
        "base_url": "https://integrate.api.nvidia.com/v1",
        "default_model": "meta/llama-3.3-70b-instruct",
        "strong_model": "meta/llama-3.3-70b-instruct",
    },
}

_KEY_CURSORS: dict[str, int] = {name: 0 for name in PROVIDERS}
_BAD_KEYS: set[tuple[str, int]] = set()
_MISSING_MODELS: set[tuple[str, str]] = set()
_CLIENTS: dict[tuple[str, str], AsyncOpenAI] = {}
_JSON_MODE_SUPPORT: dict[tuple[str, str], bool] = {}

# Only these phrases mean "this endpoint does not do JSON mode". Generic words
# like "unsupported" also appear in unrelated 400s and must not disable it.
_JSON_MODE_REJECTIONS = ("response_format", "json_object", "json mode", "json_mode")
# Groq: the model produced invalid JSON under JSON mode. Retry this call without
# it, but do not disable JSON mode for the model.
_JSON_MODE_GENERATION_FAILURE = ("json_validate_failed", "failed to generate json")


class _Truncated(Exception):
    pass


def available_providers() -> list[str]:
    """Providers that have at least one key that has not been rejected."""
    return [
        name for name, cfg in PROVIDERS.items()
        if any((name, i) not in _BAD_KEYS for i in range(len(cfg["keys"])))
    ]


def _next_key(provider: str) -> tuple[int, str] | None:
    """Round-robin over the provider's keys, skipping ones marked bad."""
    keys = PROVIDERS[provider]["keys"]
    for _ in range(len(keys)):
        index = _KEY_CURSORS[provider] % len(keys)
        _KEY_CURSORS[provider] = index + 1
        if (provider, index) not in _BAD_KEYS:
            return index, keys[index]
    return None


def _get_client(provider: str, api_key: str, timeout: float) -> AsyncOpenAI:
    """Return a pooled client for this provider/key pair."""
    cache_key = (provider, api_key)
    client = _CLIENTS.get(cache_key)
    if client is None:
        client = AsyncOpenAI(
            base_url=PROVIDERS[provider]["base_url"],
            api_key=api_key,
            timeout=timeout,
            max_retries=0,
        )
        _CLIENTS[cache_key] = client
    return client


# ── JSON extraction ─────────────────────────────────────────────────────────

_DECODER = json.JSONDecoder(strict=False)  # strict=False: raw newlines inside strings
_MAX_CANDIDATES = 200


def _as_dict(value) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
        return value[0]
    return None


def _fenced_blocks(text: str) -> list[str]:
    blocks = []
    parts = text.split("```")
    for i in range(1, len(parts), 2):
        block = parts[i]
        first_newline = block.find("\n")
        if first_newline != -1 and block[:first_newline].strip().isalpha():
            block = block[first_newline + 1:]  # drop the language tag: ```json
        blocks.append(block.strip())
    return blocks


def _extract_json(text: str, expect_keys: tuple[str, ...] = ()) -> dict:
    """
    Robustly extract a JSON object from LLM output that may contain markdown
    fences anywhere, preamble (including stray braces), or trailing commentary.

    Tries the whole text, then every fenced block, then a decode starting at
    every '{'. Only dicts count; a list holding exactly one dict is unwrapped.
    With `expect_keys`, the first object containing one of them wins over an
    earlier object that does not (e.g. an example in the preamble).
    """
    if not text or not text.strip():
        raise json.JSONDecodeError("Empty LLM response", text or "", 0)

    found: list[dict] = []

    def consider(value) -> dict | None:
        obj = _as_dict(value)
        if obj is None:
            return None
        if not expect_keys or any(k in obj for k in expect_keys):
            return obj
        found.append(obj)
        return None

    for chunk in [text.strip(), *_fenced_blocks(text)]:
        try:
            hit = consider(_DECODER.decode(chunk))
        except json.JSONDecodeError:
            continue
        if hit is not None:
            return hit

    position = text.find("{")
    tried = 0
    while position != -1 and tried < _MAX_CANDIDATES:
        tried += 1
        try:
            value, end = _DECODER.raw_decode(text, position)
        except json.JSONDecodeError:
            position = text.find("{", position + 1)
            continue
        hit = consider(value)
        if hit is not None:
            return hit
        position = text.find("{", end)  # skip past the object we just read

    if found:
        return found[0]
    raise json.JSONDecodeError("No valid JSON object found in LLM output", text, 0)


# ── Retry helpers ───────────────────────────────────────────────────────────

def _retry_after_seconds(error: Exception) -> float | None:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    try:
        ms = headers.get("retry-after-ms")
        if ms:
            return max(0.0, float(ms) / 1000.0)
        value = headers.get("retry-after")
        if not value:
            return None
        try:
            return max(0.0, float(value))
        except ValueError:
            parsed = email.utils.parsedate_to_datetime(value)
            return max(0.0, parsed.timestamp() - time.time())
    except Exception:
        return None


def _backoff_seconds(attempt: int, error: Exception) -> float:
    retry_after = _retry_after_seconds(error)
    if retry_after is not None:
        return min(RETRY_AFTER_CAP, retry_after)
    ceiling = min(BACKOFF_CAP, BACKOFF_BASE * (2 ** attempt))
    return random.uniform(ceiling / 2, ceiling)


def _classify(error: Exception) -> str:
    if isinstance(error, (AuthenticationError, PermissionDeniedError)):
        return "auth"
    if isinstance(error, RateLimitError):
        return "rate_limit"
    if isinstance(error, APITimeoutError):
        return "timeout"
    if isinstance(error, APIConnectionError):
        return "connection"
    if isinstance(error, NotFoundError):
        return "not_found"
    if isinstance(error, APIStatusError) and error.status_code >= 500:
        return "server"
    if isinstance(error, APIStatusError) and error.status_code == 408:
        return "timeout"
    return "other"


_FRIENDLY = {
    "auth": "rejected every API key",
    "rate_limit": "is rate-limiting every key",
    "timeout": "timed out",
    "connection": "could not be reached",
    "server": "returned a server error",
    "not_found": "does not serve the configured model",
    "truncated": "cut the answer off before it finished",
    "bad_output": "returned output in an unexpected format",
    "no_keys": "has no usable API keys",
    "other": "rejected the request",
}


def _failure(provider: str, reason: str) -> dict:
    incr(f"llm_failure_{reason}")
    return failed_analysis(f"[{provider}] The model {_FRIENDLY.get(reason, 'failed')}.", reason)


# ── Calls ───────────────────────────────────────────────────────────────────

async def _complete(
    provider: str,
    key_index: int,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    timeout: float,
    json_mode: bool,
) -> str:
    """One provider round-trip. Raises _Truncated when the output hit max_tokens."""
    client = _get_client(provider, api_key, timeout)
    kwargs = dict(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await client.chat.completions.create(**kwargs)
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) == "length":
        raise _Truncated()
    return choice.message.content or ""


async def async_call_llm(
    system_prompt: str,
    user_prompt: str,
    provider: str = "openrouter",
    model: str | None = None,
    max_tokens: int = 800,
    temperature: float = 0.7,
    timeout: float = 20.0,
    expect_keys: tuple[str, ...] = (),
) -> dict:
    """
    Call the LLM using a rotating API key for the specified provider.
    `timeout` is the budget for the whole call, retries and backoff included.

    Returns the parsed JSON dictionary, or a failed-analysis dict (`_failed`,
    `_reason`) on failure. Never raises except for cancellation.
    """
    if provider not in PROVIDERS:
        provider = "openrouter"
    config = PROVIDERS[provider]
    if not config["keys"]:
        return _failure(provider, "no_keys")

    models = [model or config["default_model"]]
    for alt in (config["default_model"], config["strong_model"]):
        if alt not in models:
            models.append(alt)
    models = [m for m in models if (provider, m) not in _MISSING_MODELS] or models[:1]
    model_index = 0

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    started = time.perf_counter()
    deadline = started + timeout
    tokens = max_tokens
    truncation_retried = False
    json_retry_without = False
    last_reason = "other"
    # Auth failures rotate immediately and do not consume a transient attempt.
    transient_attempts = 0
    max_rounds = MAX_ATTEMPTS + len(config["keys"]) + len(models) + 2

    for _ in range(max_rounds):
        remaining = deadline - time.perf_counter()
        if remaining < _MIN_ATTEMPT_SECONDS:
            last_reason = last_reason if last_reason != "other" else "timeout"
            break
        picked = _next_key(provider)
        if picked is None:
            last_reason = "auth"
            break
        key_index, api_key = picked
        use_model = models[model_index]
        json_mode = _JSON_MODE_SUPPORT.get((provider, use_model), True) and not json_retry_without
        attempts_left = max(1, MAX_ATTEMPTS - transient_attempts)
        attempt_timeout = remaining / attempts_left if len(config["keys"]) > 1 else remaining
        attempt_timeout = max(_MIN_ATTEMPT_SECONDS, attempt_timeout)
        where = f"{provider}/{use_model} key#{key_index}"

        try:
            content = await _complete(
                provider, key_index, api_key, use_model, messages,
                tokens, temperature, attempt_timeout, json_mode,
            )
            parsed = _extract_json(content, expect_keys)
            log.info("%s ok in %.1fs", where, time.perf_counter() - started)
            return parsed

        except asyncio.CancelledError:
            raise

        except _Truncated:
            incr("llm_truncated")
            if truncation_retried or tokens >= MAX_TOKENS_CEILING:
                log.warning("%s output truncated at max_tokens=%d — giving up", where, tokens)
                return _failure(provider, "truncated")
            truncation_retried = True
            tokens = min(MAX_TOKENS_CEILING, int(tokens * 1.6) + 64)
            log.info("%s output truncated — retrying with max_tokens=%d", where, tokens)
            continue

        except json.JSONDecodeError:
            if json_mode:
                json_retry_without = True
                continue
            log.warning("%s returned unparseable output after %.1fs", where, time.perf_counter() - started)
            return _failure(provider, "bad_output")

        except Exception as e:  # noqa: BLE001 — classified below, never re-raised
            reason = _classify(e)
            last_reason = reason
            elapsed = time.perf_counter() - started
            message = str(e).lower()

            if json_mode and isinstance(e, BadRequestError):
                if any(k in message for k in _JSON_MODE_REJECTIONS):
                    _JSON_MODE_SUPPORT[(provider, use_model)] = False
                    log.info("%s rejects response_format — disabling JSON mode for it", where)
                    continue
                if any(k in message for k in _JSON_MODE_GENERATION_FAILURE):
                    json_retry_without = True
                    continue

            if reason == "auth":
                _BAD_KEYS.add((provider, key_index))
                incr("llm_key_disabled")
                log.warning("%s rejected (HTTP %s) — key disabled for this process",
                            where, getattr(e, "status_code", "?"))
                continue

            if reason == "not_found":
                _MISSING_MODELS.add((provider, use_model))
                if model_index + 1 < len(models):
                    model_index += 1
                    log.warning("%s model not found — falling back to %s", where, models[model_index])
                    continue
                log.warning("%s model not found and no fallback model left", where)
                break

            if reason in ("rate_limit", "timeout", "connection", "server"):
                transient_attempts += 1
                incr(f"llm_transient_{reason}")
                if transient_attempts >= MAX_ATTEMPTS:
                    log.warning("%s %s at %.1fs — giving up", where, reason, elapsed)
                    break
                delay = min(_backoff_seconds(transient_attempts - 1, e),
                            max(0.0, deadline - time.perf_counter() - _MIN_ATTEMPT_SECONDS))
                log.info("%s %s at %.1fs — rotating key after %.1fs", where, reason, elapsed, delay)
                if delay > 0:
                    await _sleep(delay)
                continue

            log.warning("%s failed after %.1fs: %s (HTTP %s)", where, elapsed,
                        type(e).__name__, getattr(e, "status_code", "-"))
            break

    return _failure(provider, last_reason)


async def close_clients() -> None:
    """Close pooled HTTP clients on shutdown."""
    for client in _CLIENTS.values():
        try:
            await client.close()
        except Exception:
            log.exception("Error closing LLM client")
    _CLIENTS.clear()


def _fallback_response(headline: str) -> dict:
    """Kept for backwards compatibility — see validation.failed_analysis."""
    return failed_analysis(headline)
