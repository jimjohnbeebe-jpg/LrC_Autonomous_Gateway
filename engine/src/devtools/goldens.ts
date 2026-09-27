// Golden JPEGs (PHASES.md Phase 3: "Unit tests on golden JPEGs of the six fixtures"; ARCHITECTURE
// section 9). The Phase 3 check saves a 1600 px render of each fixture, as Lightroom exported it,
// to %TEMP%\LrC-AVG\P3\golden\ and records each file's SHA-256 in its results. `npm run goldens`
// copies the files that run recorded (and only those, hash checked, so a render left from an earlier
// run is never taken; Greptile, PR #24) to the repo's tests\golden\, the folder CLAUDE.md names for
// them, and writes tests\golden\golden.json: each file's SHA-256 and the metrics the engine
// measures on it. engine\tests\golden.test.ts then checks that the engine still measures exactly those.
//
// Decision 3 (Jim, 2026-09-26) [stated: "go with recommendations"]: the JPEGs are renders of Jim's
// photos and the repo is public, so they stay on disk (.gitignore: tests/golden/*.jpg); only
// golden.json is committed. Without the JPEGs the tests say so and skip.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureImage, summarize, type MetricsSummary } from "../metrics/index.js";

export const GOLDEN_SCHEMA_ID = "lrc-avg/goldens/1";

export type GoldenEntry = { file: string; sha256: string; width: number; height: number; metrics: MetricsSummary };
export type GoldenFile = { schema: typeof GOLDEN_SCHEMA_ID; created: string; source: string; entries: GoldenEntry[] };
/** A golden JPEG a check run saved: its file name and the hash the run recorded. */
export type RecordedGolden = { file: string; sha256: string };

/** The repo's tests\golden\ (this file is <repo>\engine\{src,dist}\devtools\goldens.*). */
export function goldenDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "golden");
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

/** The golden JPEGs a p3_check_*.json recorded (fixtures[*].golden: saved_as and preview_hash). */
export function recordedGoldens(results: unknown): RecordedGolden[] {
  const fixtures = (results as { fixtures?: unknown }).fixtures;
  if (!Array.isArray(fixtures)) return [];
  const out: RecordedGolden[] = [];
  for (const f of fixtures) {
    const golden = (f as { golden?: { saved_as?: unknown; preview_hash?: unknown } }).golden;
    if (typeof golden?.saved_as === "string" && typeof golden.preview_hash === "string") {
      out.push({ file: path.basename(golden.saved_as.replace(/\\/g, "/")), sha256: golden.preview_hash });
    }
  }
  return out;
}

/** The newest p3_check_*.json in `dir`, or null. */
export function newestResults(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^p3_check_.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1] as string) : null;
}

/**
 * Copy the recorded golden JPEGs from `from` to `to`, refusing a file whose hash is not the one the
 * run recorded, and write `to`\golden.json describing them.
 */
export async function writeGoldens(from: string, to: string, recorded: readonly RecordedGolden[], now: Date = new Date()): Promise<GoldenFile> {
  if (recorded.length === 0) throw new Error("the check's results record no golden JPEG; run npm run phase3:check first");
  mkdirSync(to, { recursive: true });
  const entries: GoldenEntry[] = [];
  for (const r of [...recorded].sort((a, b) => a.file.localeCompare(b.file))) {
    const source = path.join(from, r.file);
    if (!existsSync(source)) throw new Error(`${r.file} is recorded by the check but missing from ${from}`);
    const hash = sha256(readFileSync(source));
    if (hash !== r.sha256) throw new Error(`${r.file} in ${from} is not the render the check recorded (sha256 ${hash.slice(0, 12)}…, recorded ${r.sha256.slice(0, 12)}…)`);
    copyFileSync(source, path.join(to, r.file));
    entries.push(await goldenEntry(path.join(to, r.file)));
  }
  const golden: GoldenFile = { schema: GOLDEN_SCHEMA_ID, created: now.toISOString(), source: "%TEMP%\\LrC-AVG\\P3\\golden (npm run phase3:check)", entries };
  writeFileSync(path.join(to, "golden.json"), `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  return golden;
}
