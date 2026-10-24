// `npm run masks:combine` (issue #131): which masks of several parts does Lightroom take, read back and draw
// as the engine means them? The engine writes a mask form only when params\mask-combine.ts VERIFIED_FORMS
// lists it; stage 1 lists only the three combinations Jim made by hand (a linear, then a radial). This probe
// writes each candidate form below ONE AT A TIME on one photo, built by the engine's own code
// (params\mask-ops.ts applyOp, mask-combine.ts editParts) with the allow-list opened for that build only (this
// process is the probe, not the MCP server), Exposure +2 on the mask so its area shows. For each: the
// read-back checked (verifyTable), an AI part computed by Lightroom first (update_ai_settings, then reads until
// every AI part shows its digest or an ErrorReason, as the engine reads them), then Jim says whether the bright
// area is where the description says. The pure parts are here; the CLI (mask-combine-probe-cli.ts) asks Jim,
// puts the photo back from a snapshot and saves the results. Report: docs\reports\phase8.5\mask-combine.md.
// `npm run masks:kinds` (issue #190) runs the same steps over KIND_CANDIDATES: one colour range, brush and depth
// range mask each (report: docs\reports\phase9\upstream-ports.md).

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import { VERIFIED_FORMS, aiError, aiWatch, applyOp, computed, depthMapMissing, firstComponent, readTable, type Correction, type EditOp, type Geometry, type SdkSettings } from "../params/index.js";
import { C, M, WHAT, components } from "../params/mask-table.js";
import { diffEntries } from "./mask-carry-probe.js";

export const HISTORY = "AVG masks:combine";
export const SNAPSHOT = "AVG masks:combine before";
/** +2 EV on the mask (the panel's Exposure), so the masked area shows plainly. */
const SLIDERS = { "local.exposure": 2 };

type Edit = Omit<EditOp, "op" | "mask_id">;
/** A candidate: the mask's first part, the edits that make the form, each edit's form (the last is the one under test), and what Jim should see. */
export type Candidate = { id: string; first: { kind: string; geometry?: Geometry; point?: { x: number; y: number } }; edits: Edit[]; forms: string[]; ask: string };

const BIG = { left: 0.15, top: 0.15, right: 0.85, bottom: 0.85 };
const SMALL = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 };
const UPPER = { left: 0.1, top: 0.02, right: 0.9, bottom: 0.7 };
const LOW = { left: 0.3, top: 0.55, right: 0.7, bottom: 0.95 };
const HOLE: Edit = { combine: { mode: "subtract", kind: "radial", geometry: SMALL } };

/** About ten forms: radial + AI sky in each mode (the #131 use case), then other kinds, then edits of one part. */
export const CANDIDATES: readonly Candidate[] = [
  { id: "radial_add_sky", first: { kind: "radial", geometry: LOW }, edits: [{ combine: { mode: "add", kind: "sky" } }], forms: ["radial, add sky"], ask: "Is the sky bright, and also an oval in the lower middle of the photo?" },
  { id: "radial_subtract_sky", first: { kind: "radial", geometry: UPPER }, edits: [{ combine: { mode: "subtract", kind: "sky" } }], forms: ["radial, subtract sky"], ask: "Is a large oval over the upper two-thirds bright, except the sky inside it, which looks as before?" },
  { id: "radial_intersect_sky", first: { kind: "radial", geometry: UPPER }, edits: [{ combine: { mode: "intersect", kind: "sky" } }], forms: ["radial, intersect sky"], ask: "Is only the sky inside a large oval over the upper two-thirds bright (sky outside the oval as before)?" },
  { id: "sky_add_radial", first: { kind: "sky" }, edits: [{ combine: { mode: "add", kind: "radial", geometry: LOW } }], forms: ["sky, add radial"], ask: "Is the sky bright, and also an oval in the lower middle of the photo?" },
  {
    id: "linear_subtract_linear",
    first: { kind: "linear", geometry: { zero: { x: 0.5, y: 0.6 }, full: { x: 0.5, y: 0.1 } } },
    edits: [{ combine: { mode: "subtract", kind: "linear", geometry: { zero: { x: 0.6, y: 0.5 }, full: { x: 0.4, y: 0.5 } } } }],
    forms: ["linear, subtract linear"],
    ask: "Is the top of the photo bright on its right half only (the top-left as before), fading out towards the middle?",
  },
  { id: "radial_subtract_radial", first: { kind: "radial", geometry: BIG }, edits: [HOLE], forms: ["radial, subtract radial"], ask: "Is a large oval in the centre bright, with a small hole in its middle that looks as before?" },
  { id: "radial_intersect_luminance", first: { kind: "radial", geometry: BIG }, edits: [{ combine: { mode: "intersect", kind: "luminance", geometry: { lum_range: [0.5, 0.7, 1, 1] } } }], forms: ["radial, intersect luminance"], ask: "Inside a large central oval, are only the light parts of the photo brighter (dark parts and everything outside the oval as before)?" },
  { id: "part2_reshape", first: { kind: "radial", geometry: BIG }, edits: [HOLE, { part: 2, geometry: { left: 0.2, right: 0.4 } }], forms: ["radial, subtract radial", "radial, subtract radial: reshape part 2"], ask: "Is a large oval in the centre bright, with its small unchanged hole now towards the left of the oval?" },
  { id: "part2_to_intersect", first: { kind: "radial", geometry: BIG }, edits: [HOLE, { part: 2, combine: { mode: "intersect" } }], forms: ["radial, subtract radial", "radial, subtract radial: part 2 to intersect"], ask: "Is only a small oval in the middle of the photo bright?" },
  { id: "part2_remove", first: { kind: "radial", geometry: BIG }, edits: [HOLE, { part: 2, remove_part: true }], forms: ["radial, subtract radial", "radial, subtract radial: remove part 2"], ask: "Is the whole large oval in the centre bright, with no hole?" },
];

/** masks:kinds (issue #190): one mask of each new kind; the colour range's colour is sampled by the CLI from a render (withSample). */
export const KIND_CANDIDATES: readonly Candidate[] = [
  { id: "color_range", first: { kind: "color_range", point: { x: 0.5, y: 0.5 } }, edits: [], forms: ["color_range"], ask: "Is the colour at the centre of the photo brighter, there and wherever else the photo has it, and other colours as before?" },
  {
    id: "brush",
    first: { kind: "brush", geometry: { strokes: [{ points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }, { points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }], flow: 0.5 }] } },
    edits: [],
    forms: ["brush"],
    ask: "Is a band across the middle of the photo bright, and a short diagonal in the top-left fainter?",
  },
  { id: "depth_range", first: { kind: "depth_range", geometry: { depth_range: [0, 0, 0.3, 0.5] } }, edits: [], forms: ["depth_range"], ask: "Are the nearest parts of the scene brighter, and the far parts as before?" },
];

/** `c` with its colour range's colour: `sample` is the render's colour at the point (metrics\pixel.ts sampleColor). */
export const withSample = (c: Candidate, sample: [number, number, number]): Candidate => (c.first.kind === "color_range" ? { ...c, first: { ...c.first, geometry: { ...c.first.geometry, sample } } } : c);

/** A depth range Lightroom read back without its depth sample: the photo has no depth map, so Jim is not asked. */
export const noDepthMap = (c: Candidate, readBack: SdkSettings, id: string): boolean => c.first.kind === "depth_range" && depthMapMissing(readTable(readBack), id);

/** `forms` listed in VERIFIED_FORMS while `f` runs, and taken out again after (only those that were not listed before). */
function withForms<T>(forms: readonly string[], f: () => T): T {
  const added = forms.filter((x) => !VERIFIED_FORMS.has(x));
  for (const x of added) VERIFIED_FORMS.add(x);
  try {
    return f();
  } finally {
    for (const x of added) VERIFIED_FORMS.delete(x);
  }
}

/** The table to write for candidate `c`: the photo's masks as read, untouched, then the candidate's mask (its id). */
export function build(before: readonly Correction[], c: Candidate): { entries: Correction[]; id: string } {
  return withForms(c.forms, () => {
    const first = { ...(c.first.geometry ? { geometry: c.first.geometry } : {}), ...(c.first.point ? { point: c.first.point } : {}) };
    let plan = applyOp(before, { op: "create", kind: c.first.kind, name: `AVG combine ${c.id}`, ...first, sliders: SLIDERS });
    for (const e of c.edits) plan = applyOp(plan.entries, { op: "edit", mask_id: plan.id, ...e });
    return { entries: plan.entries, id: plan.id };
  });
}

/** Whether entry `id` of `entries` holds an AI part, which Lightroom must compute before the photo is written again (Pending.lua). */
export const hasAi = (entries: readonly Correction[], id: string): boolean => entries.some((e) => e[C.id] === id && components(e).some((m) => m[M.what] === WHAT.image));

const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));

/**
 * update_ai_settings with the plugin's guard over every AI part (aiWatch), then reads until the AI part the
 * engine reads (firstComponent: one still computing first) shows a digest or an ErrorReason, or `limitMs`.
 * Three minutes, as `npm run ai:probe` waits (ai-probe.ts LIMIT_MS).
 */
export async function computeAi(client: BridgeClient, uuid: string, id: string, limitMs = 180_000, pollMs = 500): Promise<{ outcome: string; ok: boolean; ms: number }> {
  const t0 = performance.now();
  await client.request("update_ai_settings", { photo_uuid: uuid, request_id: randomUUID(), watch: aiWatch([id]) }, { timeoutMs: 10_000 });
  for (;;) {
    const m = firstComponent(readTable((await client.request("get_settings", { photo_uuid: uuid })).settings), id);
    const reason = m ? aiError(m) : null;
    const outcome = !m ? "entry gone" : reason !== null ? `ErrorReason ${reason}` : computed(m) ? "computed" : null;
    const ms = Math.round(performance.now() - t0);
    if (outcome) return { outcome, ok: outcome === "computed", ms };
    if (ms >= limitMs) return { outcome: `no result within ${limitMs / 1000} s`, ok: false, ms };
    await sleep(pollMs);
  }
}

export type FormResult = {
  id: string;
  form: string;
  ask: string;
  written: Correction | null;
  read_back: Correction | null;
  read_again: Correction | null;
  /** The engine's own check of each read (mask-carry-probe.ts diffEntries: verifyTable, and the paths that differ). */
  problems: string[];
  ai?: { outcome: string; ok: boolean; ms: number };
  answer: string;
  ok: boolean;
};

const entryIn = (sdk: SdkSettings | null, id: string): Correction | null => {
  try {
    return sdk ? (readTable(sdk).find((e) => e[C.id] === id) ?? null) : null;
  } catch {
    return null;
  }
};

/** One form's result: read back and read again as written (every entry), an AI part computed, and Jim's "y". */
export function judge(c: Candidate, written: Correction[], id: string, reads: { read_back: SdkSettings; read_again: SdkSettings }, ai: FormResult["ai"] | undefined, answer: string): FormResult {
  const problems = Object.entries(reads).flatMap(([read, sdk]) => {
    const d = diffEntries(written, sdk);
    return [...d.table, ...d.entries.filter((e) => !e.ok).map((e) => `${e.name}: ${e.problems.join("; ")}${e.changed.length ? ` (${e.changed.slice(0, 5).join(", ")})` : ""}`)].map((p) => `${read}: ${p}`);
  });
  const ok = problems.length === 0 && (ai?.ok ?? true) && (answer === "y" || answer === "skipped: no depth map");
  return { id: c.id, form: c.forms.at(-1) ?? "", ask: c.ask, written: written.find((e) => e[C.id] === id) ?? null, read_back: entryIn(reads.read_back, id), read_again: entryIn(reads.read_again, id), problems, ...(ai ? { ai } : {}), answer, ok };
}

/** The run's verdict: every candidate tried and each one ok; the lines name each form's result. */
export function verdict(results: readonly FormResult[], tried: number, candidates: readonly Candidate[] = CANDIDATES): { worked: boolean; lines: string[] } {
  const lines = results.map((r) => `${r.answer.startsWith("skipped") ? "SKIP" : r.ok ? "YES" : "NO "} ${r.form}${r.ok ? "" : ` (${[...r.problems.slice(0, 2), ...(r.ai && !r.ai.ok ? [`AI part: ${r.ai.outcome}`] : []), ...(r.answer !== "y" ? [`Jim: ${r.answer}`] : [])].join("; ")})`}`);
  for (const c of candidates.slice(tried)) lines.push(`--- ${c.forms.at(-1) ?? c.id} (not tried)`);
  return { worked: tried === candidates.length && results.every((r) => r.ok), lines };
}
