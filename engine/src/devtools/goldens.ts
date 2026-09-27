// Golden JPEGs (PHASES.md Phase 3: "Unit tests on golden JPEGs of the six fixtures"; ARCHITECTURE
// section 9). Each run of the Phase 3 check saves a 1600 px render of each fixture, as Lightroom
// exported it, in its own folder %TEMP%\LrC-AVG\P3\golden_<time>\, and records each file and its
// SHA-256 in its results. `npm run goldens` takes the newest run that captured all six fixtures, so a
// partial or failed run never replaces a complete set, and a new run never deletes an earlier one's
// (Greptile, PR #24). It copies those files, hash checked, to the repo's tests\golden\ (the folder
// CLAUDE.md names for them) and writes tests\golden\golden.json: each file's SHA-256 and the metrics
// the engine measures on it. engine\tests\golden.test.ts then checks that the engine still measures
// exactly those.
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
/** A golden JPEG a check run saved: its path relative to the check's output folder, and the hash it recorded. */
export type RecordedGolden = { saved_as: string; sha256: string };

/** The repo's tests\golden\ (this file is <repo>\engine\{src,dist}\devtools\goldens.*). */
export function goldenDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "golden");
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The golden file name of a fixture: its base name with .jpg. */
export function goldenName(fixture: string): string {
  return `${path.parse(fixture).name}.jpg`;
}

const baseName = (savedAs: string): string => path.basename(savedAs.replace(/\\/g, "/"));

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
    if (typeof golden?.saved_as === "string" && typeof golden.preview_hash === "string") out.push({ saved_as: golden.saved_as, sha256: golden.preview_hash });
  }
  return out;
}

/** Whether the recorded goldens cover every fixture, one file each. */
export function coversAll(recorded: readonly RecordedGolden[], fixtures: readonly string[]): boolean {
  const names = new Set(recorded.map((r) => baseName(r.saved_as)));
  return names.size === recorded.length && fixtures.every((f) => names.has(goldenName(f)));
}

/** Whether every recorded file is still in `dir` with the recorded hash. */
function available(dir: string, recorded: readonly RecordedGolden[]): boolean {
  return recorded.every((r) => {
    const file = path.join(dir, r.saved_as.replace(/\\/g, "/"));
    return existsSync(file) && sha256(readFileSync(file)) === r.sha256;
  });
}

/**
 * The newest p3_check_*.json in `dir` whose run captured all `fixtures` and whose files are all still
 * there, unchanged, with its recorded goldens; null when no run qualifies. A partial run, or one whose
 * files were removed since, is passed over for an older usable one (Greptile, PR #24).
 */
export function newestCompleteRun(dir: string, fixtures: readonly string[]): { results: string; recorded: RecordedGolden[] } | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^p3_check_.*\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    let recorded: RecordedGolden[];
    try {
      recorded = recordedGoldens(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    } catch {
      continue; // an unreadable results file is passed over too
    }
    if (coversAll(recorded, fixtures) && available(dir, recorded)) return { results: path.join(dir, f), recorded };
  }
  return null;
}

/**
 * Copy the recorded golden JPEGs (paths relative to `from`) to `to`, refusing a file whose hash is
 * not the one the run recorded, and write `to`\golden.json describing them.
 */
export async function writeGoldens(from: string, to: string, recorded: readonly RecordedGolden[], now: Date = new Date()): Promise<GoldenFile> {
  if (recorded.length === 0) throw new Error("the check's results record no golden JPEG; run npm run phase3:check first");
  const entries: GoldenEntry[] = [];
  const checked: Array<{ source: string; name: string }> = [];
  for (const r of [...recorded].sort((a, b) => baseName(a.saved_as).localeCompare(baseName(b.saved_as)))) {
    const source = path.join(from, r.saved_as.replace(/\\/g, "/"));
    const name = baseName(r.saved_as);
    if (!existsSync(source)) throw new Error(`${r.saved_as} is recorded by the check but missing from ${from}`);
    const hash = sha256(readFileSync(source));
    if (hash !== r.sha256) throw new Error(`${r.saved_as} is not the render the check recorded (sha256 ${hash.slice(0, 12)}…, recorded ${r.sha256.slice(0, 12)}…)`);
    checked.push({ source, name });
  }
  // Every file is checked before any is copied, so a bad set leaves tests\golden\ as it was.
  mkdirSync(to, { recursive: true });
  for (const c of checked) {
    copyFileSync(c.source, path.join(to, c.name));
    entries.push(await goldenEntry(path.join(to, c.name)));
  }
  const golden: GoldenFile = { schema: GOLDEN_SCHEMA_ID, created: now.toISOString(), source: "%TEMP%\\LrC-AVG\\P3\\golden_<time> (npm run phase3:check)", entries };
  writeFileSync(path.join(to, "golden.json"), `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  return golden;
}
