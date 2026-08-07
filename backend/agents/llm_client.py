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
  * `response_format` support is probed once per (provider, model) and cached, so
    only the first call to a model that rejects JSON mode pays the retry.
"""

import asyncio
import itertools
import json
import os
import re
import time
import traceback

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)

# Retry transient failures; permanent failures return immediately.
TRANSIENT_ERRORS = (APITimeoutError, RateLimitError, APIConnectionError, InternalServerError)

# Max attempts per call mitigates burst timeouts on large panels.
MAX_ATTEMPTS = 2


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
        pass  # Optional provider
    except Exception as e:
        print(f"Warning: Could not load keys from {filename}: {e}")
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

# Round-robin key cursors spread concurrent agents evenly across keys.
_KEY_CURSORS = {name: itertools.cycle(cfg["keys"] or [None]) for name, cfg in PROVIDERS.items()}

# (provider, key) -> AsyncOpenAI. Reused so the connection pool survives.
_CLIENTS: dict[tuple[str, str], AsyncOpenAI] = {}

# (provider, model) -> bool. False once a model has rejected response_format.
_JSON_MODE_SUPPORT: dict[tuple[str, str], bool] = {}

_JSON_MODE_REJECTIONS = (
    "response_format",
    "json_object",
    "unsupported",
    "not supported",
    "unknown parameter",
    "invalid parameter",
)


def available_providers() -> list[str]:
    """Providers that actually have at least one key loaded."""
    return [name for name, cfg in PROVIDERS.items() if cfg["keys"]]


def _next_key(provider: str) -> str | None:
    return next(_KEY_CURSORS[provider])


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


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from LLM output that may contain
    markdown fences, preamble, or trailing commentary.
    """
    if not text:
        raise json.JSONDecodeError("Empty LLM response", "", 0)

    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0]

    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{", text)
    if match:
        depth = 0
        start = match.start()
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break

    raise json.JSONDecodeError("No valid JSON object found in LLM output", text, 0)


async def async_call_llm(
    system_prompt: str,
    user_prompt: str,
    provider: str = "openrouter",
    model: str | None = None,
    max_tokens: int = 800,
    temperature: float = 0.7,
    timeout: float = 20.0,
) -> dict:
    """
    Call the LLM using a rotating API key for the specified provider.
    Returns the parsed JSON dictionary, or a fallback-shaped dict on failure.
    """
    if provider not in PROVIDERS:
        provider = "openrouter"

    config = PROVIDERS[provider]
    if not config["keys"]:
        return _fallback_response(
            f"No API keys found for {provider}. Add them to backend/{provider}api (one per line)."
        )

    use_model = model or config["default_model"]
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    started = time.perf_counter()

    # Split timeout across attempts to fit within caller deadline.
    attempt_timeout = timeout / MAX_ATTEMPTS if len(config["keys"]) > 1 else timeout
    last_error = "unknown error"

    for attempt in range(MAX_ATTEMPTS):
        # Use a fresh key per attempt to bypass rate limits.
        client = _get_client(provider, _next_key(provider), attempt_timeout)

        # Only offer JSON mode if this model has not already rejected it.
        json_modes = [True, False] if _JSON_MODE_SUPPORT.get((provider, use_model), True) else [False]

        for use_json_mode in json_modes:
            try:
                kwargs = dict(
                    model=use_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    timeout=attempt_timeout,
                )
                if use_json_mode:
                    kwargs["response_format"] = {"type": "json_object"}

                response = await client.chat.completions.create(**kwargs)
                parsed = _extract_json(response.choices[0].message.content)
                print(f"[LLM] {provider}/{use_model} ok in {time.perf_counter() - started:.1f}s")
                return parsed

            except json.JSONDecodeError:
                if use_json_mode:
                    continue  # Some models format better freeform than in JSON mode
                return _fallback_response(
                    f"[{provider}] Analysis completed but output format was unexpected."
                )

            except asyncio.CancelledError:
                raise

            except TRANSIENT_ERRORS as e:
                last_error = f"{type(e).__name__}: {str(e)[:110]}"
                print(
                    f"[LLM] {provider}/{use_model} transient failure "
                    f"({type(e).__name__}) at {time.perf_counter() - started:.1f}s — "
                    f"{'retrying on another key' if attempt + 1 < MAX_ATTEMPTS else 'giving up'}"
                )
                break  # Leave the json-mode loop; the outer loop retries on a new key

            except Exception as e:
                err_msg = str(e).lower()
                if use_json_mode and any(kw in err_msg for kw in _JSON_MODE_REJECTIONS):
                    _JSON_MODE_SUPPORT[(provider, use_model)] = False
                    print(f"[LLM] {provider}/{use_model} rejects response_format — disabling it")
                    continue
                # Permanent: bad key, unknown model, malformed request.
                print(
                    f"[LLM] {provider}/{use_model} failed after "
                    f"{time.perf_counter() - started:.1f}s: {str(e)[:160]}"
                )
                return _fallback_response(f"[{provider}] Agent error: {str(e)[:120]}")

    return _fallback_response(f"[{provider}] Agent error: {last_error}")


async def async_call_llm_text(
    system_prompt: str,
    user_prompt: str,
    provider: str,
    model: str | None = None,
    max_tokens: int = 400,
    temperature: float = 0.7,
    timeout: float = 20.0,
) -> str:
    """Same as async_call_llm but returns raw text. Returns "" on failure."""
    config = PROVIDERS.get(provider)
    if not config or not config["keys"]:
        return ""

    api_key = _next_key(provider)
    client = _get_client(provider, api_key, timeout)

    try:
        response = await client.chat.completions.create(
            model=model or config["default_model"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        )
        return response.choices[0].message.content or ""
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"[LLM] text call to {provider} failed: {str(e)[:160]}")
        return ""


async def close_clients() -> None:
    """Close pooled HTTP clients on shutdown."""
    for client in _CLIENTS.values():
        try:
            await client.close()
        except Exception:
            traceback.print_exc()
    _CLIENTS.clear()


def _fallback_response(headline: str) -> dict:
    return {
        "verdict": "Cautious",
        "score": 5,
        "headline": headline,
        "strengths": [],
        "concerns": ["Unable to complete analysis — please retry."],
        "recommendation": "Retry the evaluation.",
        "_failed": True,
    }
