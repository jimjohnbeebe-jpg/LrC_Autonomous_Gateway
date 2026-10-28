// `npm run masks:carry` (issue #121, with the shapes issue #131 needs): does a mask table with hand-made masks
// survive the engine's kind of write, the whole table written back verbatim beside one new radial? Before
// engine 0.28.0 the mask tools refused any photo whose table held a mask with several components, a
// MaskBlendMode other than 0, a brush or a colour range (`uncaptured`, now in params\mask-combine.ts), as such entries had never
// been written back. This probe's WORKED run lifted that [handle: docs\reports\phase8.5\mask-carry.md
// "Numbers"]; only an edit of such a mask is still refused (session\masks.ts). The pure parts
// (which hand-made masks the photo holds, the per-entry diff) are here; the CLI (mask-carry-probe-cli.ts) asks
// Jim, puts the photo back and saves the results. Report: docs\reports\phase8.5\mask-carry.md.

import { existsSync, readFileSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { BridgeClient } from "../bridge/index.js";
import type { Answer } from "./phase1-check.js";
import { applyOp, differingSettings, loadDefaultParamMap, MASK_TABLE_KEY, readTable, tableSettings, verifyTable, type Correction, type SdkSettings } from "../params/index.js";
import { C, componentKind, components, M, RANGE, RECOMPUTED, type Component } from "../params/mask-table.js";

export const HISTORY = "AVG masks:carry";
export const SNAPSHOT = "AVG masks:carry before";
export const RADIAL_NAME = "AVG masks:carry radial";
/** The new entry: a radial in the photo's centre, +0.3 EV, so Jim can tell it from his own masks. */
const RADIAL = { geometry: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }, sliders: { "local.exposure": 0.3 } };
/**
 * A brush component's What: Mask/Aggregate (with MaskBrushTable and inline BrushTable_<hash> data) and
 * Mask/Paint, as Lightroom wrote them in a hand-made "Mountains" mask [handle: docs\reports\phase8\S10\census\
 * s10_20260906-_OZ80005-Rendered.dng__DDABB6F1.json, "Mountains"]. Read only: the probe writes no field of its own.
 */
const BRUSH_WHATS: ReadonlySet<string> = new Set(["Mask/Aggregate", "Mask/Paint"]);

/** The hand-made masks the report's steps have Jim make and name; `need` is what the probe checks of each. */
export const SHAPES = [
  { name: "Add", need: "combined" },
  { name: "Subtract", need: "combined" },
  { name: "Intersect", need: "combined" },
  { name: "Brush", need: "brush" },
  { name: "Color", need: "color" },
] as const;

/** One component as Lightroom stored it: what #131 needs (the MaskBlendMode / MaskInverted of each part). */
export type Part = { what: string; kind: string; blend: unknown; inverted: unknown; range_type?: unknown };
export type Shape = { name: string; id: string | null; parts: Part[]; ok: boolean; why: string };

const partOf = (m: Component): Part => {
  const kind = componentKind(m);
  const range = m[RANGE.holder] as Record<string, unknown> | undefined;
  return { what: String(m[M.what]), kind, blend: m[M.blend] ?? null, inverted: m[M.inverted] ?? null, ...(kind === "range" || kind === "color_range" ? { range_type: range?.[RANGE.type] ?? null } : {}) };
};

function fits(need: (typeof SHAPES)[number]["need"], parts: Part[]): string {
  if (need === "combined") return parts.length >= 2 ? "" : `it has ${parts.length} component; make it with Add, Subtract or Intersect`;
  if (need === "brush") return parts.some((p) => BRUSH_WHATS.has(p.what)) ? "" : `no brush component (kinds: ${parts.map((p) => p.what).join(", ")})`;
  return parts.some((p) => p.kind === "color_range") ? "" : `no Color Range component (kinds: ${parts.map((p) => p.kind).join(", ")})`;
}

/** Each SHAPES mask, found by its name (case and spaces aside), and whether it is what the steps made; `missing` says why not. */
export function shapesOf(entries: readonly Correction[]): { shapes: Shape[]; missing: string[] } {
  const shapes = SHAPES.map(({ name, need }): Shape => {
    const e = entries.find((x) => String(x[C.name] ?? "").trim().toLowerCase() === name.toLowerCase());
    if (!e) return { name, id: null, parts: [], ok: false, why: `no mask named "${name}"` };
    const parts = components(e).map(partOf);
    const why = fits(need, parts);
    return { name, id: String(e[C.id]), parts, ok: why === "", why: why || "as the steps make it" };
  });
  return { shapes, missing: shapes.filter((s) => !s.ok).map((s) => `${s.name}: ${s.why}`) };
}

/** The table to write: every entry as read, untouched, and one new radial at the end. */
export function carried(before: readonly Correction[]): { entries: Correction[]; radial_id: string } {
  const plan = applyOp(before, { op: "create", kind: "radial", name: RADIAL_NAME, ...RADIAL });
  return { entries: plan.entries, radial_id: plan.id };
}

/** Leaf paths where `a` and `b` differ (numbers within 1e-6, as verifyTable); a RECOMPUTED field is marked. */
export function changedPaths(a: unknown, b: unknown, at = "", out: string[] = []): string[] {
  if (a && b && typeof a === "object" && typeof b === "object") {
    const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) changedPaths(x[k], y[k], at ? `${at}.${k}` : k, out);
  } else if (!(typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-6 : a === b)) {
    out.push(RECOMPUTED.includes(at.split(".").at(-1) ?? "") ? `${at} (recomputed)` : at);
  }
  return out;
}

export type EntryDiff = { name: string; id: string; ok: boolean; problems: string[]; changed: string[] };

/** Each written entry against the read-back, by the engine's own check (verifyTable: covers() and the RECOMPUTED rules), with the paths that differ. */
export function diffEntries(written: readonly Correction[], readBack: SdkSettings): { table: string[]; entries: EntryDiff[] } {
  let back: Correction[] = [];
  try {
    back = readTable(readBack);
  } catch {
    // verifyTable below reports the unreadable table
  }
  const entries = written.map((w): EntryDiff => {
    const got = back.find((b) => b[C.id] === w[C.id]);
    const name = String(w[C.name] ?? w[C.id]);
    if (!got) return { name, id: String(w[C.id]), ok: false, problems: ["missing from the read-back"], changed: [] };
    const problems = verifyTable([w], { [MASK_TABLE_KEY]: [got] });
    return { name, id: String(w[C.id]), ok: problems.length === 0, problems, changed: changedPaths(w, got) };
  });
  return { table: verifyTable(written, readBack), entries };
}

/** One line per entry, then the verdict: every entry carried in every read. */
export function diffSummary(reads: Record<string, ReturnType<typeof diffEntries>>): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const [read, d] of Object.entries(reads)) {
    ok &&= d.table.length === 0 && d.entries.every((e) => e.ok);
    for (const p of d.table) lines.push(`${read}: ${p}`);
    for (const e of d.entries) lines.push(`${read}: ${e.name}: ${e.ok ? "unchanged" : `${e.problems.join("; ")}${e.changed.length ? ` (${e.changed.slice(0, 5).join(", ")})` : ""}`}`);
  }
  return { ok, lines };
}

/** Write the carried table (History HISTORY), then read it back twice: the write's own read-back and a get_settings. */
export async function writeAndRead(client: BridgeClient, uuid: string, entries: Correction[]): Promise<{ read_back: SdkSettings; read_again: SdkSettings }> {
  const res = await client.request("apply_settings", { target_uuid: uuid, settings: tableSettings(entries, false), history_name: HISTORY });
  const again = await client.request("get_settings", { photo_uuid: uuid });
  return { read_back: res.read_back, read_again: again.settings };
}

/** The photo back to the snapshot, checked as the engine's revert checks it (session\end.ts): settings and masks. */
export async function putBack(client: BridgeClient, uuid: string, snapshotId: string, before: SdkSettings): Promise<{ ok: boolean; why: string }> {
  await client.request("select_photo", { uuid });
  const res = await client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snapshotId });
  const map = loadDefaultParamMap();
  const [b, a] = [map.fromSdk(before), map.fromSdk(res.read_back)];
  const differing = [...differingSettings(b.settings, a.settings), ...(b.masks.fingerprint !== a.masks.fingerprint ? ["masks"] : [])];
  return { ok: differing.length === 0, why: differing.length ? `differing: ${differing.join(", ")}` : "settings and masks as before" };
}

const PendingRecord = z.object({ uuid: z.string(), filename: z.string(), snapshot_id: z.string(), before_sdk: z.record(z.string(), z.unknown()) });
/** The put-back a run still owes, saved before anything is written. */
export type Pending = z.infer<typeof PendingRecord>;

/**
 * The put-back owed by an earlier run, from `file`, or null. A record that does not parse or check (an
 * interrupted write) is moved to `damagedFile` and returned as `damaged`, so it cannot stop every later run
 * (Greptile, PR #137).
 */
export function readPending(file: string, damagedFile: string): { pending: Pending | null; damaged: string | null } {
  const { record, damaged } = readRecord(file, damagedFile, PendingRecord);
  return { pending: record, damaged };
}

/** A record `schema` checks, from `file`, or null; one that does not parse or check is moved to `damagedFile` (readPending). */
export function readRecord<T>(file: string, damagedFile: string, schema: z.ZodType<T>): { record: T | null; damaged: string | null } {
  if (!existsSync(file)) return { record: null, damaged: null };
  try {
    const p = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (p.success) return { record: p.data, damaged: null };
  } catch {
    // not JSON: reported as damaged below
  }
  try {
    renameSync(file, damagedFile);
  } catch {
    // left in place: the next run reports it again
  }
  return { record: null, damaged: damagedFile };
}

/** Ask Jim in this window until he types y or n (masks:carry, masks:combine); "no answer" when the input ends. */
export function ask(question: string): Promise<Answer> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return (async () => {
    try {
      for (;;) {
        process.stdout.write(`${question} Type y or n, then Enter: `);
        const next = await lines.next();
        if (next.done) return "no answer";
        const a = String(next.value).trim().toLowerCase();
        if (a === "y" || a === "n") return a;
      }
    } finally {
      rl.close();
    }
  })();
}
