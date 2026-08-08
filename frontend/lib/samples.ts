/**
 * Worked sample records.
 *
 * Three finished evaluations shipped as static JSON: a complete brief with a
 * Caution verdict, a Go verdict whose panel includes hospital and authority
 * seats, and a No-Go whose panel contains an unreachable expert. Together they
 * give the role and status filters — and the report export — something real to
 * work on before the backend has ever been called.
 *
 * Fetched on demand rather than bundled, so the JSON never costs the first paint.
 */

import { importEntries, type HistoryEntry } from "./history";

export const SAMPLE_URL = "/demo-evaluation.json";

/** The record the "worked example" affordances point at. */
export const FEATURED_SAMPLE_ID = "ev_sample_tiffin";

export type SeedResult = { ok: true; added: number } | { ok: false; reason: string };

export async function seedSamples(): Promise<SeedResult> {
  try {
    const res = await fetch(SAMPLE_URL, { cache: "force-cache" });
    if (!res.ok) return { ok: false, reason: `Sample records unavailable (${res.status}).` };

    const parsed = (await res.json()) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, reason: "Sample records are malformed." };
    }

    return { ok: true, added: importEntries(parsed as HistoryEntry[]) };
  } catch {
    return { ok: false, reason: "Could not read the bundled sample records." };
  }
}
