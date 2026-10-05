// What the Deck gets beyond the Lua HUD's update (Phase 7 row 3; spec docs\hud\lrc-avg-hud-spec-v2.md
// D5 E3, E6, E10, section 7): the copies in Variants mode, the changed sliders as rows with their
// panel group, range and weight, and Lightroom's connection state.
//   - Rows are the target's last pass (the photo hudState shows), in Lightroom's panel order (spec 7,
//     "Order"; the panel names are [unverified] in LrC 15.6 there). Over HUD_LIMITS.rows, the rows with
//     the highest weight are kept, then shown in panel order. Ranges are the probed ones in
//     params\canonical.ts. The weights are spec 7's tuning values [inference: not facts].
//   - A copy's thumbnail key names its last render (hud\thumbs.ts); its guardrail is its own last pass's.
// [handle: tests\hud-extras.test.ts]

import { HUD_LIMITS, utf8Bytes } from "../bridge/hud-protocol.js";
import type { BridgeClient } from "../bridge/index.js";
import type { PassEntry } from "../log/index.js";
import { CANONICAL_PARAMS, lightroomLabel } from "../params/index.js";
import type { Session, Target, VariantId } from "../session/index.js";
import type { DeckCopy, DeckRow, LightroomState } from "./channel-protocol.js";
import { hudGuardrail, lastPass, maskDeltas, shown } from "./payload.js";
import { thumbKey } from "./thumbs.js";

const COLOURS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const ZONES = ["shadows", "midtones", "highlights", "global"];

/** Lightroom's Develop panels, top to bottom, each with its sliders in panel order (spec 7 "Order"). */
const PANELS: ReadonlyArray<[string, string[]]> = [
  ["Basic", ["camera_profile", "temperature", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "texture", "clarity", "dehaze", "vibrance", "saturation"]],
  ["Tone Curve", ["tone_curve.master", "tone_curve.red", "tone_curve.green", "tone_curve.blue"]],
  ["HSL / Color", ["hue", "sat", "lum"].flatMap((k) => COLOURS.map((c) => `hsl.${c}.${k}`))],
  ["Color Grading", [...ZONES.flatMap((z) => ["hue", "sat", "lum"].map((k) => `grading.${z}.${k}`)), "grading.blending", "grading.balance"]],
  ["Detail", ["sharpening.amount", "sharpening.radius", "sharpening.detail", "sharpening.masking", "noise.luminance", "noise.color"]],
  ["Lens Corrections", ["lens.ca_remove", "lens.profile_enable", "lens.corrections_enable"]],
];
const ORDER: ReadonlyMap<string, number> = new Map(PANELS.flatMap(([, names]) => names).map((name, rank) => [name, rank]));
function groupOf(name: string): string {
  return PANELS.find(([, names]) => names.includes(name))?.[0] ?? "Other";
}

/** A slider's full scale, the |delta| that weighs 1 (spec 7 "Weights"); Temp's is 15 % of its before value. */
function fullScale(name: string, before: unknown): number | null {
  if (name === "temperature") return typeof before === "number" && before > 0 ? before * 0.15 : null;
  if (name === "exposure") return 1;
  if (["contrast", "highlights", "shadows", "whites", "blacks", "sharpening.amount"].includes(name)) return 40;
  if (["texture", "clarity", "dehaze", "vibrance", "saturation", "sharpening.detail", "sharpening.masking"].includes(name) || name.startsWith("noise.")) return 25;
  if (name === "tint") return 20;
  if (name === "sharpening.radius") return 0.5;
  if (name.startsWith("hsl.")) return 30;
  if (name.startsWith("grading.")) return name.endsWith(".hue") ? 60 : name.endsWith(".sat") ? 20 : 30;
  return null;
}

/** |delta| / full scale, capped at 1, two places; 1 for a change without a numeric delta or scale. */
export function weight(name: string, before: unknown, delta: number | null): number {
  const scale = delta === null ? null : fullScale(name, before);
  if (delta === null || scale === null) return 1;
  return Math.min(1, Math.round((Math.abs(delta) / scale) * 100) / 100);
}

/** Text cut to HUD_LIMITS.text bytes on a character boundary. */
export function fit(s: string): string {
  if (utf8Bytes(s) <= HUD_LIMITS.text) return s;
  let out = "";
  for (const ch of s) {
    if (utf8Bytes(out + ch) > HUD_LIMITS.text) break;
    out += ch;
  }
  return out;
}

const fitValue = (v: string | number): string | number => (typeof v === "string" ? fit(v) : v);

function row(c: PassEntry["changes"][number]): DeckRow {
  const spec = CANONICAL_PARAMS.get(c.name);
  return {
    name: fit(c.name),
    label: fit(lightroomLabel(c.name)),
    group: groupOf(c.name),
    ...(c.before !== null ? { before: fitValue(shown(c.before)) } : {}),
    after: fitValue(shown(c.after)),
    ...(c.delta !== null ? { delta: c.delta } : {}),
    ...(spec?.kind === "number" ? { min: spec.min, max: spec.max } : {}),
    weight: weight(c.name, c.before, c.delta),
  };
}

const rank = (r: DeckRow): number => ORDER.get(r.name) ?? Number.MAX_SAFE_INTEGER;

/** The target's last pass as rows (E6), at most HUD_LIMITS.rows, in panel order. */
export function deckRows(s: Session): DeckRow[] {
  const t = s.work?.target ?? s.active;
  const last = lastPass(s, t);
  if (!last) return [];
  if (last.mask) return maskRows(last.mask, last.guardrail_actions.some((a) => a.kind === "reverted"));
  const rows = last.changes.map(row);
  const kept = rows.length <= HUD_LIMITS.rows ? rows : [...rows].sort((a, b) => b.weight - a.weight).slice(0, HUD_LIMITS.rows);
  return kept.sort((a, b) => rank(a) - rank(b));
}

/** A mask pass's rows: the Lua HUD's (payload.ts maskDeltas), in the Masking group, each weighing 1. */
function maskRows(m: NonNullable<PassEntry["mask"]>, undone: boolean): DeckRow[] {
  return maskDeltas(m, undone)
    .slice(0, HUD_LIMITS.rows)
    .map((d) => ({
      name: "mask",
      label: fit(String(d.slider)),
      group: "Masking",
      ...(d.before !== undefined ? { before: fitValue(d.before) } : {}),
      after: fitValue(d.after ?? ""),
      ...(d.delta !== undefined ? { delta: Number(d.delta) } : {}),
      weight: 1,
    }));
}

/** The copies of a Variants session (E3), with a thumbnail key once a copy has a render (E4); [] in Converge mode. */
export function deckCopies(s: Session): DeckCopy[] {
  return s.variants.map((t: Target) => {
    const last = lastPass(s, t);
    return {
      letter: t.id as VariantId,
      ...(t.label ? { label: fit(t.label) } : {}),
      ...(t.copy_name ? { copy_name: fit(t.copy_name) } : {}),
      uuid: t.uuid,
      pass: Math.min(t.passes, HUD_LIMITS.pass),
      ...(t.last ? { thumb: thumbKey(t.id as VariantId, t.passes, t.last.hash) } : {}),
      ...(last ? { guardrail: hudGuardrail(last, s.limits) } : {}),
    };
  });
}

/**
 * Lightroom's state for the Deck (E10): "waiting" while the bridge rides out a plugin silence (the
 * client's pluginPaused: the state stays "connected" then, bridge\client.ts header), "down" without a
 * connection (stopped, connecting or handshaking).
 */
export function lightroomState(client: Pick<BridgeClient, "getState" | "pluginPaused">): LightroomState {
  if (client.getState() !== "connected") return "down";
  return client.pluginPaused() ? "waiting" : "connected";
}
