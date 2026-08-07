"""
DecisionX — File Parser (Generalized)

Extracts text from uploaded documents to provide as context to agents.
Supports: PDF, CSV, Excel, and plain-text formats (txt, md, json, yaml, tsv).
Not a financial parser — just extracts raw text for any document type.

Parsing is CPU-bound and synchronous (pdfplumber, pandas), so each file is run
in a worker thread and all files are parsed concurrently. On a multi-file upload
that turns N sequential parses into one.
"""

import asyncio
import io

import pandas as pd
import pdfplumber
from fastapi import UploadFile

# Character budgets prevent unbounded uploads from blowing model context windows.
PER_FILE_CHARS = 5000
TOTAL_CONTEXT_CHARS = 24000
MAX_FILE_BYTES = 10 * 1024 * 1024

TEXT_SUFFIXES = (".txt", ".md", ".json", ".yaml", ".yml", ".tsv", ".log", ".xml", ".html")
SUPPORTED_SUFFIXES = (".pdf", ".csv", ".xlsx", ".xls") + TEXT_SUFFIXES


async def extract_text_from_files(files: list[UploadFile]) -> tuple[str, list[dict]]:
    """
    Extract text from several uploads at once.

    Returns (context_block, manifest) where manifest describes each file for the
    UI — name, size, and whether its text made it into the context.
    """
    payloads = []
    for f in files:
        content = await f.read()
        payloads.append((f.filename or "unnamed", content))

    parsed = await asyncio.gather(
        *(asyncio.to_thread(_parse_one, name, content) for name, content in payloads)
    )

    blocks: list[str] = []
    manifest: list[dict] = []
    used = 0

    for (name, content), (text, error) in zip(payloads, parsed):
        entry = {"name": name, "bytes": len(content), "included": False}
        if error:
            entry["error"] = error
        elif text:
            remaining = TOTAL_CONTEXT_CHARS - used
            if remaining <= 200:
                entry["error"] = "Skipped — context budget exhausted"
            else:
                clipped = text[:remaining]
                blocks.append(f"--- Attached document: {name} ---\n{clipped}")
                used += len(clipped)
                entry["included"] = True
                entry["truncated"] = len(clipped) < len(text)
        else:
            entry["error"] = "No extractable text"
        manifest.append(entry)

    return "\n\n".join(blocks), manifest


async def extract_text_from_file(file: UploadFile) -> str:
    """Single-file convenience wrapper."""
    text, _ = await extract_text_from_files([file])
    return text


def _parse_one(filename: str, content: bytes) -> tuple[str, str | None]:
    """Parse one file's bytes. Returns (text, error). Runs in a worker thread."""
    if not content:
        return "", "File is empty"
    if len(content) > MAX_FILE_BYTES:
        return "", f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)}MB limit"

    name = filename.lower()
    try:
        if name.endswith(".pdf"):
            return _extract_pdf(content), None
        if name.endswith(".csv"):
            return _extract_table(pd.read_csv(io.StringIO(_decode(content))), "CSV"), None
        if name.endswith((".xlsx", ".xls")):
            return _extract_table(pd.read_excel(io.BytesIO(content)), "Spreadsheet"), None
        if name.endswith(TEXT_SUFFIXES):
            return _decode(content)[:PER_FILE_CHARS], None

        # Reject binaries rather than feeding mojibake to the panel.
        text = _decode(content)
        if text.count("�") > len(text) * 0.05:
            return "", "Unsupported file type — upload a PDF, CSV, spreadsheet, or text file"
        return text[:PER_FILE_CHARS], None

    except Exception as e:
        return "", f"Could not parse: {str(e)[:160]}"


def _decode(content: bytes) -> str:
    return content.decode("utf-8-sig", errors="replace")


def _extract_pdf(content: bytes) -> str:
    """Extract text from a PDF, stopping once the per-file budget is met."""
    text_parts: list[str] = []
    length = 0
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
                length += len(text)
                if length >= PER_FILE_CHARS:
                    break

    return "\n\n".join(text_parts)[:PER_FILE_CHARS]


def _extract_table(df: pd.DataFrame, label: str) -> str:
    """Convert a dataframe to a readable text summary."""
    parts = [
        f"{label} with {len(df)} rows and {len(df.columns)} columns.",
        f"Columns: {', '.join(str(c) for c in df.columns.tolist())}",
        "",
        "First 20 rows:",
        df.head(20).to_string(index=False),
    ]

    numeric = df.select_dtypes("number")
    if not numeric.empty:
        parts += ["", "Numeric summary:", numeric.describe().to_string()]

    return "\n".join(parts)[:PER_FILE_CHARS]
