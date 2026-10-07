"""
DecisionX Backend — Generalized Multi-Agent Idea Evaluation Platform

Two evaluation endpoints share one pipeline:
  POST /api/evaluate         — blocking, returns the full result
  POST /api/evaluate/stream  — NDJSON stream, one JSON event per line

The stream exists for perceived performance. The panel is known within
milliseconds and each expert's verdict lands as it finishes, so the results page
renders immediately instead of after the slowest agent plus synthesis.

Exposure: the server binds to 127.0.0.1 by default. /api/evaluate* refuses
requests whose Origin is not in DECISIONX_ALLOWED_ORIGINS, enforces an optional
shared token (DECISIONX_API_TOKEN → header X-DecisionX-Token), and caps the
request body before any of it is parsed. See config.py for every setting.
"""

import asyncio
import hmac
import json
import logging
from contextlib import aclosing, asynccontextmanager

import config  # loads backend/.env before anything reads the environment
from observability import incr, new_request_id, request_id_var, setup_logging, snapshot

setup_logging(config.LOG_LEVEL)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, StreamingResponse  # noqa: E402

from agents.context import MAX_TYPED_CHARS, ContextBundle, annotate_manifest  # noqa: E402
from agents.llm_client import available_providers, close_clients  # noqa: E402
from agents.orchestrator import evaluate_idea, evaluate_idea_stream  # noqa: E402
from agents.personas import MAX_PANEL_SIZE  # noqa: E402
from agents.validation import json_safe  # noqa: E402
from parsers.file_parser import MAX_TOTAL_UPLOAD_BYTES, extract_documents  # noqa: E402

log = logging.getLogger("decisionx.api")

MAX_UPLOAD_FILES = 8
MAX_IDEA_CHARS = 4000
MAX_CONTEXT_CHARS = MAX_TYPED_CHARS
# Whole multipart body: every upload plus the form fields and multipart overhead.
MAX_REQUEST_BYTES = MAX_TOTAL_UPLOAD_BYTES + 1024 * 1024

_GUARDED_PREFIX = "/api/evaluate"


@asynccontextmanager
async def lifespan(app: FastAPI):
    providers = available_providers()
    if providers:
        log.info("LLM providers ready: %s", ", ".join(providers))
    else:
        log.warning(
            "No LLM API keys found. Add one key per line to "
            "backend/groqapi, backend/nvidiaapi, or backend/openrouterapi."
        )
    if config.HOST not in ("127.0.0.1", "localhost", "::1") and not config.API_TOKEN:
        log.warning("Listening on %s without DECISIONX_API_TOKEN — anyone who can reach "
                    "this port can spend your LLM quota.", config.HOST)
    log.info("DecisionX API ready (allowed origins: %s)", ", ".join(config.ALLOWED_ORIGINS))
    yield
    await close_clients()


class RequestGuard:
    """
    Pure-ASGI gate for /api/evaluate*. Runs before the body is read, so a
    rejected request never gets its uploads spooled to disk.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or not scope["path"].startswith(_GUARDED_PREFIX)
            or scope["method"] == "OPTIONS"  # CORS preflight — CORSMiddleware answers it
        ):
            return await self.app(scope, receive, send)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        origin = headers.get("origin")
        if origin is not None and origin.rstrip("/") not in config.ALLOWED_ORIGINS:
            incr("rejected_origin")
            log.warning("rejected request from origin %r", origin[:100])
            return await _reject(scope, receive, send, 403, "Origin not allowed")

        if config.API_TOKEN:
            supplied = headers.get("x-decisionx-token", "")
            if not hmac.compare_digest(supplied.encode(), config.API_TOKEN.encode()):
                incr("rejected_token")
                return await _reject(scope, receive, send, 401, "Missing or invalid X-DecisionX-Token")

        limit_mb = MAX_REQUEST_BYTES // (1024 * 1024)
        try:
            declared = int(headers.get("content-length", "0"))
        except ValueError:
            declared = 0
        if declared > MAX_REQUEST_BYTES:
            incr("rejected_too_large")
            return await _reject(scope, receive, send, 413, f"Request exceeds the {limit_mb}MB upload limit")

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BYTES:
                    incr("rejected_too_large")
                    raise HTTPException(413, f"Request exceeds the {limit_mb}MB upload limit")
            return message

        return await self.app(scope, limited_receive, send)


async def _reject(scope, receive, send, status: int, detail: str) -> None:
    response = JSONResponse({"detail": detail}, status_code=status)
    await response(scope, receive, send)


app = FastAPI(
    title="DecisionX API",
    description="Generalized Multi-Agent Idea Evaluation Platform",
    version="2.0.0",
    lifespan=lifespan,
)

# Added first so CORS (added last) is outermost: rejections still carry CORS
# headers for allowed origins, so the frontend can read the error detail.
app.add_middleware(RequestGuard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "DecisionX API",
        "providers": available_providers(),
        "max_panel_size": MAX_PANEL_SIZE,
        "counters": snapshot(),
    }


def _validate(idea: str, context: str, num_personas: int, files: list[UploadFile] | None):
    """Return (idea, context, panel_size, real_files) or raise a 422 with a readable detail."""
    idea = (idea or "").strip()
    context = (context or "").strip()
    if not idea:
        raise HTTPException(422, "Describe the idea to evaluate.")
    if len(idea) > MAX_IDEA_CHARS:
        raise HTTPException(422, f"The idea is {len(idea)} characters; the limit is {MAX_IDEA_CHARS}.")
    if len(context) > MAX_CONTEXT_CHARS:
        raise HTTPException(
            422, f"The context is {len(context)} characters; the limit is {MAX_CONTEXT_CHARS}. "
                 "Attach longer material as a file instead."
        )
    if not 1 <= num_personas <= MAX_PANEL_SIZE:
        raise HTTPException(422, f"num_personas must be between 1 and {MAX_PANEL_SIZE}.")
    real_files = [f for f in (files or []) if f and f.filename]
    if len(real_files) > MAX_UPLOAD_FILES:
        raise HTTPException(422, f"At most {MAX_UPLOAD_FILES} files can be attached.")
    return idea, context, num_personas, real_files


async def _build_context(context: str, files: list[UploadFile]) -> tuple[ContextBundle, list[dict]]:
    """Typed context plus every uploaded document, and a manifest that says how
    much of each document actually reaches the expert prompts."""
    documents, manifest = await extract_documents(files) if files else ([], [])
    bundle = ContextBundle(typed=context, documents=documents)
    return bundle, annotate_manifest(manifest, bundle)


def _ndjson(event: dict) -> str:
    return json.dumps(json_safe(event), allow_nan=False) + "\n"


def _start_request() -> str:
    request_id = new_request_id()
    request_id_var.set(request_id)
    incr("evaluations_started")
    return request_id


@app.post("/api/evaluate")
async def evaluate(
    idea: str = Form(...),
    context: str = Form(""),
    num_personas: int = Form(5),
    files: list[UploadFile] = File(default=[]),
):
    """Evaluate an idea through a dynamically assembled expert panel (blocking)."""
    idea, context, panel_size, real_files = _validate(idea, context, num_personas, files)
    request_id = _start_request()
    headers = {"X-Request-ID": request_id}
    try:
        bundle, manifest = await _build_context(context, real_files)
        result = await asyncio.wait_for(
            evaluate_idea(idea, bundle, max_agents=panel_size, manifest=manifest),
            timeout=config.RUN_TIMEOUT + 30,
        )
        result["attachments"] = manifest
        incr("evaluations_completed")
        return JSONResponse(content=json_safe(result), headers=headers)
    except (asyncio.TimeoutError, TimeoutError):
        incr("evaluations_timed_out")
        log.error("evaluation exceeded the run deadline")
        raise HTTPException(504, f"Evaluation timed out (request {request_id}).", headers=headers)
    except asyncio.CancelledError:
        incr("client_disconnects")
        raise
    except HTTPException:
        raise
    except Exception:
        incr("evaluations_failed")
        log.exception("evaluation failed")
        raise HTTPException(500, f"Evaluation failed — see server logs (request {request_id}).", headers=headers)


@app.post("/api/evaluate/stream")
async def evaluate_stream(
    idea: str = Form(...),
    context: str = Form(""),
    num_personas: int = Form(5),
    files: list[UploadFile] = File(default=[]),
):
    """
    Same pipeline as /api/evaluate, delivered as newline-delimited JSON.
    Each line is one event: attachments | stage | panel | persona | done | error.
    `attachments` comes first and again after the optional `reading` stage
    (document condensation), so the second one reflects condensed digests.
    """
    idea, context, panel_size, real_files = _validate(idea, context, num_personas, files)
    request_id = _start_request()
    try:
        bundle, manifest = await _build_context(context, real_files)
    except Exception:
        incr("evaluations_failed")
        log.exception("could not read attachments")
        raise HTTPException(400, f"Could not read attachments (request {request_id}).")

    async def event_stream():
        request_id_var.set(request_id)
        finished = False
        try:
            if manifest:
                yield _ndjson({"type": "attachments", "attachments": manifest})

            async with aclosing(evaluate_idea_stream(idea, bundle, panel_size, manifest=manifest)) as stream:
                async for event in stream:
                    if event["type"] == "done":
                        event["result"]["attachments"] = manifest
                        finished = True
                    yield _ndjson(event)
            incr("evaluations_completed")

        except (asyncio.CancelledError, GeneratorExit):
            if not finished:
                incr("client_disconnects")
                log.info("client disconnected — evaluation cancelled")
            raise
        except Exception:
            incr("evaluations_failed")
            log.exception("evaluation stream failed")
            yield _ndjson({"type": "error", "message": f"Evaluation failed — see server logs (request {request_id})."})

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Request-ID": request_id,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)
