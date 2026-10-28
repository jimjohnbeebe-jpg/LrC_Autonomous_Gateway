// `npm run masks:verify` (GitHub issue #210): the three mask behaviours Automaat's live testing contradicts,
// checked in Lightroom. The shared and pure parts: where a render is clearly red or green (sharp), how a
// place is told to Jim, one step's result, and the verdict. The parts are masks-verify-colour.ts (colour
// range: the engine's point sample on two photos, then a copy of Lightroom's own sample), masks-verify-person.ts
// (one person's mask on a photo of two or more people) and masks-verify-mirror.ts (masks on a mirrored photo,
// all four mirrored codes); the CLI (masks-verify-cli.ts) asks Jim, puts each photo back and saves the
// results. Report: docs\reports\phase11\MASKS-VERIFY.md.

import sharp from "sharp";
import type { BridgeClient } from "../bridge/index.js";
import { tableSettings, verifyTable, type Correction, type SdkSettings } from "../params/index.js";

export const HISTORY = "AVG masks:verify";
export const SNAPSHOT = "AVG masks:verify before";
/** +2 EV on each test mask (the panel's Exposure), so its area shows plainly. */
export const SLIDERS = { "local.exposure": 2 };
export const PARTS = ["colour", "person", "mirror"] as const;
export type Part = (typeof PARTS)[number];

export type Photo = { uuid: string; filename: string };
/** One step of a part: what was written and read back, Jim's answer (or why none was asked), and whether it counts as yes. */
export type Step = { part: Part; photo: string; id: string; question: string | null; answer: string; ok: boolean; skipped?: boolean; notes: string[]; data?: Record<string, unknown> };

/** What a part needs from the CLI: the bridge, output, Jim's y/n, and a photo behind its snapshot (put back after `fn`). */
export type Ctx = {
  client: BridgeClient;
  say: (line: string) => void;
  ask: (question: string) => Promise<string>;
  guard: <T>(photo: Photo, fn: (before: SdkSettings) => Promise<T>) => Promise<{ value: T | null; put_back: { ok: boolean; why: string }; error?: string }>;
};

/** Write `entries` as the photo's whole mask table; the read-back problems (verifyTable), [] when it took. */
export async function writeTable(client: BridgeClient, uuid: string, entries: readonly Correction[], label: string): Promise<{ read_back: SdkSettings; problems: string[] }> {
  const res = await client.request("apply_settings", { target_uuid: uuid, settings: tableSettings(entries, false), history_name: `${HISTORY} ${label}` });
  return { read_back: res.read_back, problems: verifyTable(entries, res.read_back) };
}

const part = (v: number, words: [string, string, string]): string => (v < 1 / 3 ? words[0] : v < 2 / 3 ? words[1] : words[2]);
/** A place in 0-1 of the photo as shown, in words and per cent from the top-left. */
export const where = (p: { x: number; y: number }): string =>
  `in the ${part(p.y, ["top", "middle", "bottom"])} ${part(p.x, ["left", "centre", "right"])} (about ${Math.round(p.x * 100)} % across, ${Math.round(p.y * 100)} % down)`;

/** A cell this much redder (or greener) than its other two channels, 0-1, counts as clearly that colour [inference: a saturated colour, not a warm grey]. */
export const MIN_LEAD = 0.25;
/** Cells along the render's long edge for the search [inference: coarse enough to average out texture]. */
const GRID = 48;

/** The centre of the clearly reddest and greenest cell of a render, in 0-1 of it; null where no cell leads by MIN_LEAD. */
export async function colourPoints(jpeg: Buffer): Promise<{ red: { x: number; y: number } | null; green: { x: number; y: number } | null }> {
  const { data, info } = await sharp(jpeg).rotate().removeAlpha().resize(GRID, GRID, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const best = { red: { lead: MIN_LEAD, at: null as { x: number; y: number } | null }, green: { lead: MIN_LEAD, at: null as { x: number; y: number } | null } };
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b] = [0, 1, 2].map((c) => (data[i * info.channels + c] as number) / 255) as [number, number, number];
    const at = { x: ((i % info.width) + 0.5) / info.width, y: (Math.floor(i / info.width) + 0.5) / info.height };
    if (r - Math.max(g, b) > best.red.lead) best.red = { lead: r - Math.max(g, b), at };
    if (g - Math.max(r, b) > best.green.lead) best.green = { lead: g - Math.max(r, b), at };
  }
  return { red: best.red.at, green: best.green.at };
}

/** The run's lines and verdict: every part run, each step a yes or a skip, at least one yes per part, every photo put back. */
export function verdict(steps: readonly Step[], parts: readonly Part[]): { worked: boolean; lines: string[] } {
  const lines = steps.map((s) => `${s.skipped ? "SKIP" : s.ok ? "YES " : "NO  "} ${s.part} ${s.photo} ${s.id}${s.ok && s.notes.length === 0 ? "" : ` (${[...s.notes.slice(0, 2), ...(s.question && s.answer !== "y" ? [`Jim: ${s.answer}`] : [])].join("; ") || s.answer})`}`);
  const missing = parts.filter((p) => !steps.some((s) => s.part === p && s.ok && !s.skipped));
  for (const p of missing) lines.push(`---- ${p}: no step answered yes`);
  return { worked: missing.length === 0 && steps.every((s) => s.ok || s.skipped === true), lines };
}

/** The one or two photos Jim has selected, or why not. */
export async function selected(client: BridgeClient, count: number): Promise<Photo[] | string> {
  const sel = await client.request("get_selection", { max: count + 1 });
  const photos = sel.photos.filter((x): x is typeof x & { uuid: string } => typeof x.uuid === "string").map((x) => ({ uuid: x.uuid, filename: x.filename ?? x.uuid }));
  return sel.count === count && photos.length === count ? photos : `${sel.count} photo(s) selected, not ${count}`;
}
