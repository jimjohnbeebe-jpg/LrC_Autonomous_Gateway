// Golden JPEGs of the six fixtures (PHASES.md Phase 3; src/devtools/goldens.ts): the engine must
// measure each one exactly as recorded in tests/golden/golden.json. The JPEGs are renders of Jim's
// photos and stay on disk only (decision 3), so on a machine without them these tests skip and say
// why; golden.json itself is committed.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GOLDEN_SCHEMA_ID, goldenDir, goldenEntry, writeGoldens, type GoldenFile } from "../src/devtools/goldens.js";

const dir = goldenDir();
const indexFile = path.join(dir, "golden.json");
const index: GoldenFile | null = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as GoldenFile) : null;
const entries = index?.entries ?? [];
const missing = entries.filter((e) => !existsSync(path.join(dir, e.file))).map((e) => e.file);

if (!index) console.warn("[golden] tests/golden/golden.json does not exist yet: run npm run phase3:check, then npm run goldens.");
else if (missing.length > 0) console.warn(`[golden] ${missing.length} golden JPEG(s) are not on this machine (they are not in git): ${missing.join(", ")}. Those tests are skipped.`);

describe("golden JPEGs", () => {
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
  it("copies the JPEGs and records their hash and metrics", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-golden-"));
    try {
      const from = path.join(tmp, "from");
      mkdirSync(from);
      writeFileSync(path.join(from, "a.jpg"), await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer());
      writeFileSync(path.join(from, "notes.txt"), "not a JPEG");
      const golden = await writeGoldens(from, path.join(tmp, "to"), new Date("2026-09-26T00:00:00Z"));
      expect(golden.entries.map((e) => [e.file, e.width, e.height])).toEqual([["a.jpg", 30, 20]]);
      expect(golden.entries[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(path.join(tmp, "to", "a.jpg"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(tmp, "to", "golden.json"), "utf8"))).toEqual(golden);
      await expect(writeGoldens(path.join(tmp, "to", "..", "from-none"), path.join(tmp, "x"))).rejects.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
