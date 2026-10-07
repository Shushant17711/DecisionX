"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Icon } from "@/components/Icon";

/**
 * Route-level error boundary. Whatever a page throws while rendering — most
 * likely an evaluation record shaped in a way nothing anticipated — the reader
 * gets a way back instead of a blank screen.
 */
export default function RouteError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  /** Newer Next.js versions pass this in place of (or alongside) `reset`. */
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error("[DecisionX] Page failed to render:", error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="relative z-[1] grid min-h-dvh place-items-center px-6">
      <div
        role="alert"
        className="panel w-full max-w-[30rem] p-7"
        style={{ borderColor: "oklch(62% 0.17 27 / 0.4)" }}
      >
        <h1 className="flex items-center gap-2.5 text-[1.125rem]">
          <Icon name="alert" size={18} className="shrink-0 text-[oklch(72%_0.15_27)]" />
          Something went wrong on this page
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
          The page hit data it could not display. Your saved evaluations are untouched — try
          again, or head back to the start.
        </p>
        {error.digest && (
          <p className="tnum mt-3 text-[0.75rem] text-[var(--text-muted)]">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {retry && (
            <button
              type="button"
              onClick={() => retry()}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-[0.875rem]"
            >
              <Icon name="refresh" size={15} />
              Try again
            </button>
          )}
          <Link href="/" className="btn-quiet px-4 py-2 text-[0.875rem] no-underline">
            Back to start
          </Link>
        </div>
      </div>
    </div>
  );
}
