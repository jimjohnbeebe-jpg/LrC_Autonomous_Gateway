// Golden JPEGs of the six fixtures (PHASES.md Phase 3; src/devtools/goldens.ts): the engine must
// measure each one exactly as recorded in tests/golden/golden.json. The JPEGs are renders of Jim's
// photos and stay on disk only (decision 3), so on a machine without them these tests skip and say
// why; golden.json itself is committed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GOLDEN_SCHEMA_ID, goldenDir, goldenEntry, newestResults, recordedGoldens, sha256, writeGoldens, type GoldenFile } from "../src/devtools/goldens.js";

const dir = goldenDir();
const indexFile = path.join(dir, "golden.json");
const index: GoldenFile | null = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as GoldenFile) : null;
const entries = index?.entries ?? [];
const missing = entries.filter((e) => !existsSync(path.join(dir, e.file))).map((e) => e.file);

if (!index) console.warn("[golden] tests/golden/golden.json does not exist yet: run npm run phase3:check, then npm run goldens.");
else if (missing.length > 0) console.warn(`[golden] ${missing.length} golden JPEG(s) are not on this machine (they are not in git): ${missing.join(", ")}. Those tests are skipped.`);

describe("golden JPEGs", () => {
  it("live in the repo's tests/golden, where git ignores JPEGs (they are renders of Jim's photos; Greptile, PR #24)", () => {
    const repo = path.resolve(dir, "..", "..");
    expect(path.relative(repo, dir).replace(/\\/g, "/")).toBe("tests/golden");
    // git check-ignore exits 0 when the path is ignored.
    expect(() => execFileSync("git", ["check-ignore", "-q", "tests/golden/20260907-_OZ80093.jpg"], { cwd: repo })).not.toThrow();
    expect(() => execFileSync("git", ["check-ignore", "-q", "engine/tests/golden/x.jpg"], { cwd: repo })).not.toThrow();
    expect(() => execFileSync("git", ["check-ignore", "-q", "tests/golden/golden.json"], { cwd: repo })).toThrow(); // committed
  });

  it.skipIf(index === null)("golden.json lists the six fixtures", () => {
    expect(index?.schema).toBe(GOLDEN_SCHEMA_ID);
    expect(entries).toHaveLength(6);
  });

  for (const entry of entries) {
    it.skipIf(missing.includes(entry.file))(`measures ${entry.file} as recorded`, async () => {
      const measured = await goldenEntry(path.join(dir, entry.file));
      expect(measured.sha256).toBe(entry.sha256);
      expect(measured).toEqual(entry);
    });
  }
});

describe("golden JPEGs: the writer", () => {
  const jpeg = (r: number) => sharp({ create: { width: 30, height: 20, channels: 3, background: { r, g: 120, b: 40 } } }).jpeg().toBuffer();

  it("copies only the JPEGs the check recorded, hash checked, and records their metrics", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-golden-"));
    try {
      const from = path.join(tmp, "from");
      mkdirSync(from);
      const a = await jpeg(200);
      writeFileSync(path.join(from, "a.jpg"), a);
      writeFileSync(path.join(from, "old.jpg"), await jpeg(10)); // left from an earlier run: not recorded
      const golden = await writeGoldens(from, path.join(tmp, "to"), [{ file: "a.jpg", sha256: sha256(a) }], new Date("2026-09-26T00:00:00Z"));
      expect(golden.entries.map((e) => [e.file, e.width, e.height])).toEqual([["a.jpg", 30, 20]]);
      expect(existsSync(path.join(tmp, "to", "a.jpg"))).toBe(true);
      expect(existsSync(path.join(tmp, "to", "old.jpg"))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(tmp, "to", "golden.json"), "utf8"))).toEqual(golden);
      // A file whose hash is not the recorded one (a stale render; Greptile, PR #24) is refused.
      await expect(writeGoldens(from, path.join(tmp, "x"), [{ file: "old.jpg", sha256: sha256(a) }])).rejects.toThrow(/not the render the check recorded/);
      await expect(writeGoldens(from, path.join(tmp, "x"), [])).rejects.toThrow(/record no golden/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads the recorded goldens from the newest check results", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-golden-"));
    try {
      writeFileSync(path.join(tmp, "p3_check_2026-09-26T01-00-00-000Z.json"), "{}");
      writeFileSync(path.join(tmp, "p3_check_2026-09-26T02-00-00-000Z.json"), "{}");
      expect(path.basename(newestResults(tmp) ?? "")).toBe("p3_check_2026-09-26T02-00-00-000Z.json");
      const results = { fixtures: [{ golden: { saved_as: "golden\\a.jpg", preview_hash: "h1" } }, { status: "skipped" }] };
      expect(recordedGoldens(results)).toEqual([{ file: "a.jpg", sha256: "h1" }]);
      expect(newestResults(path.join(tmp, "none"))).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
