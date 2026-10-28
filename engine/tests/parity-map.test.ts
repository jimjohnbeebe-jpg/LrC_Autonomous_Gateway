// Issue #220 (epic #207): docs/PARITY.md maps every upstream tool name pinned in
// docs/parity/upstream-tools-1040453.txt to its lr_* tool. Fails when a pinned name has no row, a row has
// no known status, the page names an lr_ tool the server does not register, or a registered tool is not
// named on the page. Renewing the pin: docs/UPSTREAM_SYNC.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { TOOL_DEFS } from "../src/mcp/index.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../docs/${rel}`, import.meta.url)), "utf8");
const pinned = read("parity/upstream-tools-1040453.txt").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
const page = read("PARITY.md");
const rows = new Map(
  [...page.matchAll(/^\| `([a-z_]+)` \| ([^|]+) \| ([^|]+) \|/gm)].map((m) => [m[1] ?? "", { ours: m[2]?.trim() ?? "", status: m[3]?.trim() ?? "" }]),
);
const registered = new Set(TOOL_DEFS.map((d) => d.name));

it("pins 68 distinct upstream names", () => {
  expect(pinned).toHaveLength(68);
  expect(new Set(pinned).size).toBe(68);
});

it("gives every pinned upstream name a row with a known status", () => {
  expect(pinned.filter((n) => !rows.has(n))).toEqual([]);
  const bad = pinned.filter((n) => !/^(have|ours\+|planned #\d+|decision D[1-7])$/.test(rows.get(n)?.status ?? ""));
  expect(bad).toEqual([]);
  const counts: Record<string, number> = {};
  for (const n of pinned) {
    const s = (rows.get(n)?.status ?? "").replace(/ .*/, "");
    counts[s] = (counts[s] ?? 0) + 1;
  }
  // The "Count:" line in PARITY.md states these; change both together.
  expect(counts).toEqual({ have: 47, "ours+": 9, planned: 9, decision: 3 });
});

it("names only registered lr_ tools, and every registered tool", () => {
  const named = new Set([...page.matchAll(/\blr_[a-z_]+\b/g)].map((m) => m[0]));
  expect([...named].filter((n) => !registered.has(n))).toEqual([]);
  expect([...registered].filter((n) => !named.has(n))).toEqual([]);
});

it("has a status of have or ours+ only for rows that name an lr_ tool", () => {
  const empty = pinned.filter((n) => /^(have|ours\+)$/.test(rows.get(n)?.status ?? "") && !/`lr_[a-z_]+`/.test(rows.get(n)?.ours ?? ""));
  expect(empty).toEqual([]);
});
