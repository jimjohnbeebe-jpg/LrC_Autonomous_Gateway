// The module size rule (.claude\rules\01-stack.md "Module size"; PHASE4_PLAN decisions 6 and 8):
// no source file over 400 lines, except the files listed below, which may not grow. The next PR
// that changes a listed file splits it and removes it from the list.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SCANNED = ["engine/src", "engine/tests", "plugin", "spikes"];
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".lua"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);
const MAX_LINES = 400;

/** Files over MAX_LINES when the rule came in (wc -l, main 6e36453, 2026-09-27), at that size. */
const OVERSIZE: Record<string, number> = {
  "engine/src/bridge/client.ts": 430,
  "engine/src/devtools/phase2-check.ts": 408,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

/** Lines as `wc -l` counts them: the number of line breaks. */
function lineCount(file: string): number {
  return readFileSync(file, "utf8").split("\n").length - 1;
}

const sizes = new Map(
  SCANNED.flatMap((dir) => sourceFiles(path.join(repoRoot, dir))).map((file) => [path.relative(repoRoot, file).split(path.sep).join("/"), lineCount(file)] as const),
);

describe("module size", () => {
  it(`finds no source file over ${MAX_LINES} lines outside the oversize list`, () => {
    expect(sizes.size).toBeGreaterThan(50);
    const over = [...sizes].filter(([file, lines]) => lines > MAX_LINES && !(file in OVERSIZE));
    expect(over, "split the file (target 300 lines)").toEqual([]);
  });

  it("finds no listed oversize file grown past its recorded size", () => {
    const grown = Object.entries(OVERSIZE).filter(([file, limit]) => (sizes.get(file) ?? 0) > limit);
    expect(grown.map(([file]) => [file, sizes.get(file)]), "split the file instead of adding to it").toEqual([]);
  });

  it(`lists only files that still exist and are over ${MAX_LINES} lines`, () => {
    const stale = Object.keys(OVERSIZE).filter((file) => (sizes.get(file) ?? 0) <= MAX_LINES);
    expect(stale, "remove the file from OVERSIZE").toEqual([]);
  });
});
