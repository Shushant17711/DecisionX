"""
DecisionX — isolated parse worker

    python -m parsers.worker <filename> <max_chars> <memory_mb>  < file-bytes

Reads one file's bytes from stdin, writes {"text", "error", "truncated"} JSON to
stdout. Run as a child process by parsers.file_parser so a pathological file
can be killed on timeout and cannot exhaust the server's memory (the address
space is capped with RLIMIT_AS where the platform supports it).
"""

import json
import sys


def _limit_memory(megabytes: int) -> None:
    try:
        import resource

        limit = megabytes * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except Exception:  # noqa: BLE001 — not available on this platform
        pass


def main() -> int:
    filename, max_chars, memory_mb = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    _limit_memory(memory_mb)
    content = sys.stdin.buffer.read()

    from parsers.extractors import parse_bytes

    try:
        text, error, truncated = parse_bytes(filename, content, max_chars)
    except MemoryError:
        text, error, truncated = "", "File needs too much memory to read safely", False
    sys.stdout.write(json.dumps({"text": text, "error": error, "truncated": truncated}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
