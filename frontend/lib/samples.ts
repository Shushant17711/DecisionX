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

import { getEntry, importEntries } from "./history";

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

    const added = importEntries(parsed);
    // A full history keeps the newest 50 records, and the samples are old — so
    // check the featured one actually survived before anything links to it.
    if (!getEntry(FEATURED_SAMPLE_ID)) {
      return {
        ok: false,
        reason: "History is full, so the sample records were not kept. Delete a few evaluations and try again.",
      };
    }
    return { ok: true, added };
  } catch {
    return { ok: false, reason: "Could not read the bundled sample records." };
  }
}
