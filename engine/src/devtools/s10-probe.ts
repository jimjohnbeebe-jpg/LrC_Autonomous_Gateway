// Spike S10, the range probes (s10-config.ts has the plan): (1) every numeric canonical parameter
// the photo carries, at its pinned minimum and maximum, then 1 % of the range beyond each, four
// batched writes, each read back, exactly as the Phase 1 check probed the raw NEF
// (phase1-check.ts step 7 [handle: docs\reports\phase1\PHASE1.md run 3]); (2) the numeric keys the
// photo carries beyond the raw pin (on a rendered photo IncrementalTemperature and IncrementalTint
// [handle: logs\nonraw-2026-10-08\kinds.json]), whose limits are unknown: seven values in an order
// that tells a clamp from an ignore (a value past a limit comes right after a value well inside it).

import type { SdkSettings } from "../params/index.js";
import type { Json } from "./phase3-config.js";
import { historyName, same, write, type Ctx, type Photo } from "./s10-config.js";

/** 50 first, so 101 (past a ±100 limit) reads back as 100 when clamped and 50 when ignored; then the other side; then the limits and 0. */
export const EXTRA_VALUES = [50, 101, -50, -101, 100, -100, 0] as const;
const LABELS = ["at minimum", "at maximum", "1 % below minimum", "1 % above maximum"] as const;

/**
 * What Lightroom did with a value one step beyond a limit: took it as written, clamped it to that
 * limit, ignored it (the value from the previous write stayed), or something else. When the previous
 * value equals the limit, clamped and ignored look the same (phase1-check.ts).
 */
function outcome(written: number, read: unknown, limit: number, previous: unknown): string {
  if (typeof read !== "number") return "missing";
  const eq = (a: unknown): boolean => typeof a === "number" && Math.abs(a - read) <= 1e-6;
  if (eq(written)) return "accepted";
  if (eq(limit) && eq(previous)) return "clamped_or_ignored";
  if (eq(limit)) return "clamped";
  if (eq(previous)) return "ignored";
  return "other";
}

const tally = (outcomes: string[]): Json => Object.fromEntries(["accepted", "clamped", "ignored", "clamped_or_ignored", "other", "missing"].map((o) => [o, outcomes.filter((x) => x === o).length]));

/** The pinned limits of every numeric parameter whose key the photo carries, and the parameters whose key it lacks. */
export async function rangeProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  const { map } = ctx.deps;
  const numeric = map.names().flatMap((name) => {
    const spec = map.spec(name);
    return spec?.kind === "number" ? [{ name, spec }] : [];
  });
  const present = numeric.filter(({ spec }) => spec.sdkKey in photo.start);
  const absent = numeric.filter(({ spec }) => !(spec.sdkKey in photo.start)).map((n) => n.name);
  const out: Json = { parameters: present.length, absent, writes: [] };
  if (present.length === 0) return { ...out, note: "the photo carries none of the numeric parameters' keys" };
  const batch = (pick: (min: number, max: number, delta: number) => number): SdkSettings =>
    Object.fromEntries(present.map(({ spec }) => [spec.sdkKey, pick(spec.min, spec.max, (spec.max - spec.min) * 0.01)]));
  const values = [batch((min) => min), batch((_min, max) => max), batch((min, _max, d) => min - d), batch((_min, max, d) => max + d)];
  const reads: Array<SdkSettings | null> = [];
  for (const [i, settings] of values.entries()) {
    const w: Json = { label: LABELS[i], keys: present.length };
    (out["writes"] as Json[]).push(w);
    const rb = await write(ctx, photo, settings, historyName("range", i + 1, 4), w);
    reads.push(rb);
    if (!rb) break;
  }
  const read = (i: number, key: string): unknown => reads[i]?.[key] ?? null;
  const per = present.map(({ name, spec }) => {
    const delta = (spec.max - spec.min) * 0.01;
    return {
      name, sdk_key: spec.sdkKey, min: spec.min, max: spec.max,
      min_read: read(0, spec.sdkKey), max_read: read(1, spec.sdkKey),
      below_written: spec.min - delta, below_read: read(2, spec.sdkKey), below_outcome: outcome(spec.min - delta, read(2, spec.sdkKey), spec.min, read(1, spec.sdkKey)),
      above_written: spec.max + delta, above_read: read(3, spec.sdkKey), above_outcome: outcome(spec.max + delta, read(3, spec.sdkKey), spec.max, read(2, spec.sdkKey)),
    };
  });
  return {
    ...out,
    completed: reads.length === 4 && reads.every((r) => r !== null),
    min_accepted: per.filter((p) => same(p.min_read, p.min)).length,
    max_accepted: per.filter((p) => same(p.max_read, p.max)).length,
    below_min: tally(per.map((p) => p.below_outcome)),
    above_max: tally(per.map((p) => p.above_outcome)),
    per_parameter: per,
  };
}

/** One line for the window: how many limits were taken, and what happened beyond them. */
export function rangeLine(r: Json): string {
  if (r["parameters"] === 0) return "range probe: no numeric parameter's key on this photo";
  if (r["completed"] !== true) return "range probe: did not complete (see the results file)";
  const n = Number(r["parameters"]);
  const beyond = (t: Json): string => Object.entries(t).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${String(v)}`).join(", ");
  return `range probe: ${n} parameters; limits taken as written: min ${String(r["min_accepted"])}/${n}, max ${String(r["max_accepted"])}/${n}; ` +
    `1 % beyond: below {${beyond(r["below_min"] as Json)}}, above {${beyond(r["above_max"] as Json)}}; absent here: ${(r["absent"] as string[]).join(", ") || "none"}`;
}

/** The numeric keys beyond the raw pin, written in EXTRA_VALUES order; each value's outcome. */
export async function extraKeysProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  const keys = photo.extra_keys.filter((k) => typeof photo.start[k] === "number");
  if (keys.length === 0) return { keys: [], note: "no numeric key beyond the raw pin" };
  const reads: Array<SdkSettings | null> = [];
  const writes: Json[] = [];
  for (const [i, v] of EXTRA_VALUES.entries()) {
    const w: Json = { written: v };
    writes.push(w);
    const rb = await write(ctx, photo, Object.fromEntries(keys.map((k) => [k, v])), historyName("extra", i + 1, EXTRA_VALUES.length), w);
    reads.push(rb);
    if (!rb) break;
  }
  const perKey = keys.map((key) => {
    let previous: unknown = photo.start[key];
    const results = EXTRA_VALUES.map((v, i) => {
      const read = reads[i]?.[key];
      const o = typeof read !== "number" ? "missing" : same(read, v) ? "taken" : same(read, Number(previous)) ? "ignored" : `clamped to ${read}`;
      if (typeof read === "number") previous = read;
      return { written: v, read_back: typeof read === "number" ? read : null, outcome: o };
    });
    return { key, start: photo.start[key], results, taken: results.filter((r) => r.outcome === "taken").map((r) => r.written) };
  });
  return { keys, writes, per_key: perKey };
}

export function extraLine(r: Json): string {
  const per = r["per_key"] as Array<{ key: string; results: Array<{ written: number; outcome: string }> }> | undefined;
  if (!per) return "keys beyond the raw pin: none numeric";
  return `keys beyond the raw pin: ${per.map((k) => `${k.key} [${k.results.map((x) => `${x.written}: ${x.outcome}`).join("; ")}]`).join(" | ")}`;
}
