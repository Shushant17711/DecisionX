/**
 * Writes the committed sample exports under public/, so the CSV and HTML a judge
 * downloads from the app can also be read without running it.
 *
 *   npm run sample:export
 *
 * The builders in lib/report.ts are the single source of truth — this script
 * compiles them to a temporary CommonJS bundle and feeds them the same seed
 * records the app loads. Re-run it whenever the report format or the seed data
 * changes.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = mkdtempSync(join(tmpdir(), "decisionx-report-"));

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/report.ts",
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--target",
      "es2020",
      "--lib",
      "es2020,dom",
      "--skipLibCheck",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const { buildReportCsv, buildReportHtml } = await import(
    `file://${join(outDir, "report.js")}`
  ).then((m) => m.default ?? m);

  const entries = JSON.parse(
    readFileSync(join(root, "public", "demo-evaluation.json"), "utf8"),
  );
  const featured = entries.find((e) => e.id === "ev_sample_tiffin") ?? entries[0];

  const note =
    "Reviewed by the founding team on 8 August 2026. We accept the density argument and are freezing the second cluster for one quarter.";

  writeFileSync(join(root, "public", "sample-report.html"), buildReportHtml(featured, note), "utf8");
  writeFileSync(join(root, "public", "sample-report.csv"), buildReportCsv(featured, note), "utf8");

  console.log(`Wrote public/sample-report.html and public/sample-report.csv from ${featured.id}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
