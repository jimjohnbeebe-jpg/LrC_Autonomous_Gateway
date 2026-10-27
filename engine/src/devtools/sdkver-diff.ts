// `npm run sdkver:check` (GitHub issue #209, Phase 11), the part that needs no Lightroom: a run's record (which
// develop keys each photo reported under which declared LrSdkVersion), the comparison of two runs, and the
// reading of Info.lua. sdkver-check.ts takes the runs; docs\reports\phase11\SDKVER.md is the report.
// Keys are compared by name and JSON type only; a value's digest tells an SDK effect from a photo that was
// edited between the runs (the keys a photo carries depend on its state: masks, HDR mode, Monochrome).

import { createHash } from "node:crypto";
import { z } from "zod";
import type { HelloResult } from "../bridge/index.js";
import { jsonValueType } from "../params/sdk-keys.js";
import type { Photo } from "./s10-config.js";

const runPhotoSchema = z.object({
  uuid: z.string().min(1),
  filename: z.string(),
  copy_name: z.string().nullable(),
  /** Every key getDevelopSettings() returned, with its JSON type. */
  key_types: z.record(z.string(), z.string()),
  /** A short digest of every key's value. */
  digests: z.record(z.string(), z.string()),
  /** The keys the pinned file (engine\src\params\sdk-keys.lrc15.json) does not have. */
  extra_keys: z.array(z.string()),
});
export type RunPhoto = z.infer<typeof runPhotoSchema>;

export const runSchema = z.object({
  /** hello.sdk_declared: Bridge.lua's SDK_DECLARED in the plugin Lightroom has loaded (Info.lua's LrSdkVersion). */
  declared: z.number(),
  lrc_version: z.string(),
  plugin_version: z.string(),
  /** hello.process_started_at: another value in the second run shows the plugin was reloaded or Lightroom restarted. */
  process_started_at: z.string().nullable(),
  captured_at: z.string(),
  photos: z.array(runPhotoSchema),
});
export type Run = z.infer<typeof runSchema>;

/** 13 -> "13.0", 14.3 -> "14.3": how Info.lua and the Adobe reference write it. */
export const fmtSdk = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** LrSdkVersion and LrSdkMinimumVersion from Info.lua's text: only a line that starts with the name, never a comment. */
export function parseInfoLua(text: string): { sdk: number | null; min: number | null } {
  const num = (name: string): number | null => {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*,`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  return { sdk: num("LrSdkVersion"), min: num("LrSdkMinimumVersion") };
}

// Object keys sorted at every level, arrays kept in order: the plugin builds objects with Lua's pairs, whose order
// is not promised to stay the same across reloads [inference], so an unchanged table must hash the same (Greptile, PR #223).
const sorted = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(sorted)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]))
  : value;
export const digest = (value: unknown): string => createHash("sha1").update(JSON.stringify(sorted(value)) ?? "undefined").digest("hex").slice(0, 10);

/** One run from the hello of the plugin and the census's photos (each with its settings in `start`). */
export function buildRun(hello: HelloResult, photos: readonly Photo[], capturedAt: string): Run {
  return {
    declared: hello.sdk_declared,
    lrc_version: hello.lrc_version,
    plugin_version: hello.plugin_version,
    process_started_at: hello.process_started_at ?? null,
    captured_at: capturedAt,
    photos: photos.map((p) => ({
      uuid: p.uuid,
      filename: p.filename,
      copy_name: p.copy_name,
      key_types: Object.fromEntries(Object.entries(p.start).map(([k, v]) => [k, jsonValueType(v)])),
      digests: Object.fromEntries(Object.entries(p.start).map(([k, v]) => [k, digest(v)])),
      extra_keys: p.extra_keys,
    })),
  };
}

/** The keys any photo of the run carries that the pinned file lacks: "new vs the pinned file". */
export const newVsPinned = (run: Run): string[] => [...new Set(run.photos.flatMap((p) => p.extra_keys))].sort();

export type PhotoDiff = {
  uuid: string;
  label: string;
  only_a: string[];
  only_b: string[];
  type_changed: { key: string; a: string; b: string }[];
  /** Keys in both whose value differs: the photo changed between the runs. */
  value_changed: string[];
};

export type Comparison = {
  /** A is the run that declared the lower version. */
  a: { declared: string; lrc_version: string; captured_at: string };
  b: { declared: string; lrc_version: string; captured_at: string };
  same_lrc_version: boolean;
  photos_compared: number;
  photos_only_a: string[];
  photos_only_b: string[];
  per_photo: PhotoDiff[];
  /** The union over the photos. */
  only_a: string[];
  only_b: string[];
  type_changed: string[];
  values_changed: number;
  suggestion: string;
};

const labelOf = (p: Pick<RunPhoto, "filename" | "copy_name">): string => (p.copy_name ? `${p.filename} (${p.copy_name})` : p.filename);

function diffPhoto(a: RunPhoto, b: RunPhoto): PhotoDiff {
  const inA = new Set(Object.keys(a.key_types));
  const inB = new Set(Object.keys(b.key_types));
  const both = [...inA].filter((k) => inB.has(k)).sort();
  return {
    uuid: a.uuid,
    label: labelOf(a),
    only_a: [...inA].filter((k) => !inB.has(k)).sort(),
    only_b: [...inB].filter((k) => !inA.has(k)).sort(),
    type_changed: both.filter((k) => a.key_types[k] !== b.key_types[k]).map((key) => ({ key, a: a.key_types[key] ?? "?", b: b.key_types[key] ?? "?" })),
    value_changed: both.filter((k) => a.digests[k] !== b.digests[k]),
  };
}

const union = (lists: string[][]): string[] => [...new Set(lists.flat())].sort();

/** Compare two runs that declared different versions, photo by photo (matched by uuid). */
export function compareRuns(first: Run, second: Run): Comparison {
  const [a, b] = first.declared <= second.declared ? [first, second] : [second, first];
  const inB = new Map(b.photos.map((p) => [p.uuid, p]));
  const inA = new Set(a.photos.map((p) => p.uuid));
  const per_photo = a.photos.flatMap((p) => {
    const other = inB.get(p.uuid);
    return other ? [diffPhoto(p, other)] : [];
  });
  const c: Omit<Comparison, "suggestion"> = {
    a: { declared: fmtSdk(a.declared), lrc_version: a.lrc_version, captured_at: a.captured_at },
    b: { declared: fmtSdk(b.declared), lrc_version: b.lrc_version, captured_at: b.captured_at },
    same_lrc_version: a.lrc_version === b.lrc_version,
    photos_compared: per_photo.length,
    photos_only_a: a.photos.filter((p) => !inB.has(p.uuid)).map(labelOf),
    photos_only_b: b.photos.filter((p) => !inA.has(p.uuid)).map(labelOf),
    per_photo,
    only_a: union(per_photo.map((d) => d.only_a)),
    only_b: union(per_photo.map((d) => d.only_b)),
    type_changed: union(per_photo.map((d) => d.type_changed.map((t) => `${t.key} (${t.a} -> ${t.b})`))),
    values_changed: per_photo.reduce((n, d) => n + d.value_changed.length, 0),
  };
  return { ...c, suggestion: suggest(c) };
}

/** A reading of the comparison, never the verdict (that is Jim's, in the report). */
function suggest(c: Omit<Comparison, "suggestion">): string {
  if (c.photos_compared === 0) return "no photo is in both runs: nothing was compared";
  const same = c.only_a.length === 0 && c.only_b.length === 0 && c.type_changed.length === 0;
  const where = `on ${c.photos_compared} photo${c.photos_compared === 1 ? "" : "s"}`;
  const caveats = [
    c.same_lrc_version ? "" : ` Lightroom differs between the runs (${c.a.lrc_version}, ${c.b.lrc_version}).`,
    c.values_changed > 0 ? ` ${c.values_changed} value${c.values_changed === 1 ? "" : "s"} on shared keys differ${c.values_changed === 1 ? "s" : ""}: a photo may have been edited between the runs.` : "",
  ].join("");
  return (same
    ? `the same keys, with the same types, under ${c.a.declared} and ${c.b.declared} ${where}: the declared version hid none of them.`
    : `the key sets differ between ${c.a.declared} and ${c.b.declared} ${where}: ${c.only_a.length} only under ${c.a.declared}, ${c.only_b.length} only under ${c.b.declared}, ${c.type_changed.length} with another type.`) + caveats;
}

/** The run to compare with: the newest that declared another version, preferring one from the same Lightroom. */
export function pickPrevious(runs: readonly Run[], current: Run): Run | null {
  const others = runs.filter((r) => r.declared !== current.declared);
  const same = others.filter((r) => r.lrc_version === current.lrc_version);
  const pool = same.length > 0 ? same : others;
  return [...pool].sort((x, y) => y.captured_at.localeCompare(x.captured_at))[0] ?? null;
}

/** Notes on whether the declared version is the one in this repo's Info.lua (the plugin reports its own constant). */
export function labelNotes(declared: number, info: { path: string; text: string } | null): string[] {
  if (!info) return ["no Info.lua beside this command: the declared version is only what the loaded plugin reports (Bridge.lua SDK_DECLARED)."];
  const { sdk } = parseInfoLua(info.text);
  if (sdk === null) return [`${info.path} has no LrSdkVersion line.`];
  if (sdk === declared) return [];
  return [`the loaded plugin declares ${fmtSdk(declared)}, but ${info.path} declares ${fmtSdk(sdk)}: Lightroom loaded an older plugin (Reload Plug-in), or Bridge.lua SDK_DECLARED was not changed with Info.lua (tell Claude Code), or Lightroom loads the plugin from another folder.`];
}
