"""
DecisionX — Runtime configuration

Every tunable lives here and is read from the environment once at import, after
`backend/.env` (if present) has been loaded. Provider API keys are NOT read from
the environment — they live in the key files described in `.env.example`.

Modules read these as `config.NAME` at call time rather than copying them at
import, so tests can monkeypatch a single attribute.
"""

import logging
import os

from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

# override=False: a real environment variable always beats the .env file.
load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=False)

_log = logging.getLogger("decisionx.config")


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_number(name: str, default, cast, lo, hi):
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = cast(raw.strip())
    except ValueError:
        _log.warning("Ignoring %s=%r — not a valid %s", name, raw, cast.__name__)
        return default
    if not lo <= value <= hi:
        _log.warning("Ignoring %s=%r — must be between %s and %s", name, raw, lo, hi)
        return default
    return value


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return list(default)
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


# ── Network exposure ────────────────────────────────────────────────────────
HOST = _env_str("DECISIONX_HOST", "127.0.0.1")
PORT = _env_number("DECISIONX_PORT", 8001, int, 1, 65535)

# Browsers send Origin on cross-site POSTs. A request that carries an Origin not
# on this list is refused before its body is read; requests without an Origin
# (curl, server-to-server) are allowed, which is what the optional token is for.
ALLOWED_ORIGINS = _env_list(
    "DECISIONX_ALLOWED_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]
)

# Optional shared secret. When set, /api/evaluate* requires header
# `X-DecisionX-Token: <value>`. Unset (the default) disables the check.
API_TOKEN = os.environ.get("DECISIONX_API_TOKEN", "").strip() or None

# ── Pipeline limits ─────────────────────────────────────────────────────────
MAX_CONCURRENT_AGENTS = _env_number("DECISIONX_MAX_CONCURRENT_AGENTS", 12, int, 1, 200)
RUN_TIMEOUT = _env_number("DECISIONX_RUN_TIMEOUT", 120.0, float, 10.0, 1800.0)

# Characters of typed context + documents each expert sees. The synthesizer gets
# half of this and the Panel Architect a quarter.
CONTEXT_BUDGET_CHARS = _env_number("DECISIONX_CONTEXT_BUDGET_CHARS", 6000, int, 500, 100_000)

# ── Upload parsing ──────────────────────────────────────────────────────────
PARSE_TIMEOUT = _env_number("DECISIONX_PARSE_TIMEOUT", 20.0, float, 1.0, 300.0)
# "subprocess" (default) parses each file in a child process that is killed on
# timeout. "thread" parses in-process — faster to start but cannot be killed.
PARSER_ISOLATION = _env_str("DECISIONX_PARSER_ISOLATION", "subprocess").lower()
PARSE_MEMORY_MB = _env_number("DECISIONX_PARSE_MEMORY_MB", 1024, int, 128, 16384)

LOG_LEVEL = _env_str("DECISIONX_LOG_LEVEL", "INFO").upper()
