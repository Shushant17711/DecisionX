"""
DecisionX Backend — Generalized Multi-Agent Idea Evaluation Platform

Two evaluation endpoints share one pipeline:
  POST /api/evaluate         — blocking, returns the full result
  POST /api/evaluate/stream  — NDJSON stream, one JSON event per line

The stream exists for perceived performance. The panel is known within
milliseconds and each expert's verdict lands as it finishes, so the results page
renders immediately instead of after the slowest agent plus synthesis.
"""

import asyncio
import json
import os
import traceback
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

load_dotenv()

from agents.llm_client import available_providers, close_clients
from agents.orchestrator import evaluate_idea, evaluate_idea_stream
from agents.personas import MAX_PANEL_SIZE
from parsers.file_parser import extract_text_from_files

MAX_UPLOAD_FILES = 8


@asynccontextmanager
async def lifespan(app: FastAPI):
    providers = available_providers()
    if providers:
        print(f"LLM providers ready: {', '.join(providers)}")
    else:
        print(
            "WARNING: no LLM API keys found. Add one key per line to "
            "backend/groqapi, backend/nvidiaapi, or backend/openrouterapi."
        )
    print("DecisionX API ready at http://localhost:8001")
    yield
    await close_clients()


app = FastAPI(
    title="DecisionX API",
    description="Generalized Multi-Agent Idea Evaluation Platform",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "DecisionX API",
        "providers": available_providers(),
        "max_panel_size": MAX_PANEL_SIZE,
    }


async def _build_context(context: str, files: list[UploadFile] | None) -> tuple[str, list[dict]]:
    """Merge typed context with text extracted from every uploaded document."""
    if not files:
        return context, []

    real_files = [f for f in files if f and f.filename][:MAX_UPLOAD_FILES]
    if not real_files:
        return context, []

    extracted, manifest = await extract_text_from_files(real_files)
    if not extracted:
        return context, manifest

    merged = f"{context}\n\n{extracted}" if context else extracted
    return merged, manifest


@app.post("/api/evaluate")
async def evaluate(
    idea: str = Form(...),
    context: str = Form(""),
    num_personas: int = Form(5),
    files: list[UploadFile] = File(default=[]),
):
    """Evaluate an idea through a dynamically assembled expert panel (blocking)."""
    try:
        full_context, manifest = await _build_context(context, files)
        panel_size = max(1, min(MAX_PANEL_SIZE, num_personas))
        result = await evaluate_idea(idea, full_context, max_agents=panel_size)
        result["attachments"] = manifest
        return JSONResponse(content=result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/evaluate/stream")
async def evaluate_stream(
    idea: str = Form(...),
    context: str = Form(""),
    num_personas: int = Form(5),
    files: list[UploadFile] = File(default=[]),
):
    """
    Same pipeline as /api/evaluate, delivered as newline-delimited JSON.
    Each line is one event: stage | panel | persona | done | error.
    """
    try:
        full_context, manifest = await _build_context(context, files)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Could not read attachments: {e}")

    panel_size = max(1, min(MAX_PANEL_SIZE, num_personas))

    async def event_stream():
        # Client disconnect only cancels agents; request body is already drained.
        try:
            if manifest:
                yield json.dumps({"type": "attachments", "attachments": manifest}) + "\n"

            async for event in evaluate_idea_stream(idea, full_context, panel_size):
                if event["type"] == "done":
                    event["result"]["attachments"] = manifest
                yield json.dumps(event) + "\n"

        except asyncio.CancelledError:
            raise
        except Exception as e:
            traceback.print_exc()
            yield json.dumps({"type": "error", "message": str(e)[:300]}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # stops nginx-style proxies buffering the stream
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
