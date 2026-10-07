"""
Process-wide semaphores that are safe across event loops.

asyncio.Semaphore binds to the first loop that contends on it, so a plain
module-level instance breaks the moment a second loop (tests, a reloader) uses
it. These are shared by every request on a loop and recreated per loop.
"""

import asyncio
import weakref

_SEMAPHORES: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict]" = weakref.WeakKeyDictionary()


def shared_semaphore(name: str, size: int) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    per_loop = _SEMAPHORES.setdefault(loop, {})
    entry = per_loop.get(name)
    if entry is None or entry[0] != size:
        entry = (size, asyncio.Semaphore(size))
        per_loop[name] = entry
    return entry[1]
