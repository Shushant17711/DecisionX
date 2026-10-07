"""
DecisionX — File Parser (Generalized)

Extracts text from uploaded documents to provide as context to agents.
Supports: PDF, CSV, XLSX, DOCX, and plain-text formats (txt, md, json, yaml, tsv).
Not a financial parser — just extracts raw text for any document type.

Hardening:
  * uploads are read in chunks and abandoned as soon as they pass the per-file
    limit; the whole request is also capped (see main.BodySizeLimit), and files
    past MAX_TOTAL_UPLOAD_BYTES are skipped.
  * format-level ceilings (zip-bomb checks, sheet/row/page caps) live in
    parsers/extractors.py.
  * each file is parsed in a child process (`python -m parsers.worker`) under a
    wall-clock timeout and a memory cap; on timeout the child is killed. This
    costs ~100-300 ms of interpreter start per file, which is negligible next to
    the LLM calls and buys a parse that can actually be stopped — a thread
    running pdfminer on a hostile PDF cannot be. Where subprocesses are not
    available (e.g. a Windows selector event loop) or DECISIONX_PARSER_ISOLATION
    is "thread", parsing falls back to a worker thread with the same timeout;
    the request still returns on time, but the thread runs on to completion.

All files are parsed concurrently (bounded), so N files cost about one parse.
"""

import asyncio
import json
import logging
import sys

import config
from agents.context import ContextBundle, Document, annotate_manifest, persona_budget, render
from concurrency import shared_semaphore
from observability import incr
from parsers.extractors import (
    MAX_FILE_BYTES,
    SUPPORTED_SUFFIXES,  # noqa: F401 — re-exported for callers
    TEXT_SUFFIXES,  # noqa: F401
    parse_bytes,
)

log = logging.getLogger("decisionx.parser")

MAX_TOTAL_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_PARALLEL_PARSES = 4
_READ_CHUNK = 256 * 1024


async def read_limited(upload, limit: int) -> tuple[bytes, bool]:
    """Read an upload in chunks. Returns (data, too_large); stops once past `limit`."""
    size = getattr(upload, "size", None)
    if isinstance(size, int) and size > limit:
        return b"", True
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(_READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            return b"", True
        chunks.append(chunk)
    return b"".join(chunks), False


# With condensation on, read far past the prompt budget: the condenser chunks
# (and, beyond its chunk cap, samples) whatever is extracted.
MAX_CONDENSE_EXTRACT_CHARS = 400_000


def _max_chars() -> int:
    if config.CONDENSE:
        return max(persona_budget(), MAX_CONDENSE_EXTRACT_CHARS)
    # A single file may use the whole expert budget when it is the only part.
    return persona_budget()


async def _parse_in_subprocess(name: str, content: bytes, max_chars: int) -> tuple[str, str | None, bool]:
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "parsers.worker", name, str(max_chars), str(config.PARSE_MEMORY_MB),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=config.BACKEND_DIR,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(content), timeout=config.PARSE_TIMEOUT)
    except BaseException:
        # Timeout, cancellation, anything: never leave the child running.
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    if proc.returncode != 0:
        log.warning("parse worker for %r exited %s: %s", name, proc.returncode,
                    stderr.decode(errors="replace")[-300:])
        return "", "Could not parse this file", False
    data = json.loads(stdout)
    return data["text"], data["error"], bool(data["truncated"])


async def _parse_one(name: str, content: bytes) -> tuple[str, str | None, bool]:
    max_chars = _max_chars()
    async with shared_semaphore("parse", MAX_PARALLEL_PARSES):
        try:
            if config.PARSER_ISOLATION != "thread":
                try:
                    return await _parse_in_subprocess(name, content, max_chars)
                except NotImplementedError:
                    log.info("subprocesses unavailable on this event loop — parsing in a thread")
            return await asyncio.wait_for(
                asyncio.to_thread(parse_bytes, name, content, max_chars),
                timeout=config.PARSE_TIMEOUT,
            )
        except (asyncio.TimeoutError, TimeoutError):
            incr("upload_parse_timeout")
            log.warning("parsing %r timed out after %.0fs", name, config.PARSE_TIMEOUT)
            return "", f"Parsing timed out after {config.PARSE_TIMEOUT:.0f}s", False
        except asyncio.CancelledError:
            raise
        except Exception:
            incr("upload_parse_error")
            log.exception("parsing %r failed", name)
            return "", "Could not parse this file", False


async def extract_documents(files) -> tuple[list[Document], list[dict]]:
    """
    Read and parse several uploads at once.

    Returns (documents, manifest). `documents` holds one entry per file that
    yielded text, in upload order; `manifest` describes every file. Run the
    result through agents.context.annotate_manifest to record how much of each
    document actually reached the prompts.
    """
    names: list[str] = []
    payloads: list[bytes | None] = []
    errors: list[str | None] = []
    total = 0

    for f in files:
        name = f.filename or "unnamed"
        names.append(name)
        if total > MAX_TOTAL_UPLOAD_BYTES:
            payloads.append(None)
            errors.append("Skipped — total upload size limit reached")
            continue
        content, too_large = await read_limited(f, MAX_FILE_BYTES)
        if too_large:
            incr("upload_rejected_too_large")
            payloads.append(None)
            errors.append(f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)}MB limit")
            continue
        total += len(content)
        if total > MAX_TOTAL_UPLOAD_BYTES:
            payloads.append(None)
            errors.append("Skipped — total upload size limit reached")
            continue
        payloads.append(content)
        errors.append(None)

    async def run(name: str, content: bytes | None):
        if content is None:
            return "", None, False
        return await _parse_one(name, content)

    parsed = await asyncio.gather(*(run(n, c) for n, c in zip(names, payloads)))

    documents: list[Document] = []
    manifest: list[dict] = []
    for name, content, pre_error, (text, error, truncated) in zip(names, payloads, errors, parsed):
        entry = {"name": name, "bytes": len(content) if content is not None else 0, "included": False}
        error = pre_error or error
        if error:
            entry["error"] = error
            incr("upload_file_errors")
        else:
            documents.append(Document(name=name, text=text))
            entry["extraction_truncated"] = truncated
        manifest.append(entry)
    return documents, manifest


async def extract_text_from_files(files) -> tuple[str, list[dict]]:
    """
    Compatibility wrapper: (context_block, manifest) for the documents alone,
    rendered with the expert budget and with the manifest annotated.
    """
    documents, manifest = await extract_documents(files)
    bundle = ContextBundle(documents=documents)
    return render(bundle, persona_budget()), annotate_manifest(manifest, bundle)


async def extract_text_from_file(file) -> str:
    """Single-file convenience wrapper."""
    text, _ = await extract_text_from_files([file])
    return text
