"""
DecisionX — Logging and failure counters

Every log record carries the id of the evaluation it belongs to. The id lives
in a ContextVar, so tasks spawned for each persona inherit it automatically.

Counters are process-local and reset on restart; /api/health exposes them so a
dead key or a flaky provider shows up without trawling logs. Nothing here ever
records an API key — only the key's index in its provider's key file.
"""

import logging
import threading
import uuid
from collections import Counter
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("decisionx_request_id", default="-")

_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s"
_configured = False


def new_request_id() -> str:
    return uuid.uuid4().hex[:10]


def setup_logging(level: str = "INFO") -> None:
    """Idempotent. Adds `request_id` to every LogRecord, whoever emits it."""
    global _configured
    if _configured:
        return
    _configured = True

    base_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = base_factory(*args, **kwargs)
        record.request_id = request_id_var.get()
        return record

    logging.setLogRecordFactory(factory)

    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(_LOG_FORMAT))
        root.addHandler(handler)
    logging.getLogger("decisionx").setLevel(getattr(logging, level, logging.INFO))


# ── Failure counters ────────────────────────────────────────────────────────

_counters: Counter[str] = Counter()
_lock = threading.Lock()


def incr(name: str, amount: int = 1) -> None:
    with _lock:
        _counters[name] += amount


def snapshot() -> dict[str, int]:
    with _lock:
        return dict(sorted(_counters.items()))


def reset_counters() -> None:
    with _lock:
        _counters.clear()
