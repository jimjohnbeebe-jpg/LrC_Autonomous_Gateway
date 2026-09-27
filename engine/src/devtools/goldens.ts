// Golden JPEGs (PHASES.md Phase 3: "Unit tests on golden JPEGs of the six fixtures"; ARCHITECTURE
// section 9). The Phase 3 check saves a 1600 px render of each fixture, as Lightroom exported it,
// to %TEMP%\LrC-AVG\P3\golden\. `npm run goldens` copies them to tests\golden\ and writes
// tests\golden\golden.json: each file's SHA-256 and the metrics the engine measures on it.
// tests\golden.test.ts then checks that the engine still measures exactly those values.
//
// Decision 3 (Jim, 2026-09-26) [stated: "go with recommendations"]: the JPEGs are renders of Jim's
// photos and the repo is public, so they stay on disk (.gitignore: tests/golden/*.jpg); only
// golden.json is committed. Without the JPEGs the tests say so and skip.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureImage, summarize, type MetricsSummary } from "../metrics/index.js";

export const GOLDEN_SCHEMA_ID = "lrc-avg/goldens/1";

export type GoldenEntry = { file: string; sha256: string; width: number; height: number; metrics: MetricsSummary };
export type GoldenFile = { schema: typeof GOLDEN_SCHEMA_ID; created: string; source: string; entries: GoldenEntry[] };

/** engine\tests\golden\ (this file is <engine>\{src,dist}\devtools\goldens.*). */
export function goldenDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "golden");
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Measure one golden JPEG as the engine would. */
export async function goldenEntry(file: string): Promise<GoldenEntry> {
  const data = readFileSync(file);
  const metrics = await measureImage(data);
  return { file: path.basename(file), sha256: sha256(data), width: metrics.width, height: metrics.height, metrics: summarize(metrics) };
}

/** Copy every JPEG in `from` to `to` and write `to`\golden.json describing them. */
export async function writeGoldens(from: string, to: string, now: Date = new Date()): Promise<GoldenFile> {
  mkdirSync(to, { recursive: true });
  const files = readdirSync(from).filter((f) => /\.jpe?g$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`no golden JPEGs in ${from}; run npm run phase3:check first`);
  const entries: GoldenEntry[] = [];
  for (const f of files) {
    copyFileSync(path.join(from, f), path.join(to, f));
    entries.push(await goldenEntry(path.join(to, f)));
  }
  const golden: GoldenFile = { schema: GOLDEN_SCHEMA_ID, created: now.toISOString(), source: "%TEMP%\\LrC-AVG\\P3\\golden (npm run phase3:check)", entries };
  writeFileSync(path.join(to, "golden.json"), `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  return golden;
}
