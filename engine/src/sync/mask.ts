// lr_sync_series' parameter_mask: which canonical settings a sync copies, by group (MCP_TOOLS
// lr_sync_series). MCP_TOOLS names six groups; `white_balance` and `tone_curve` are added, because
// PRD 6.10 copies white balance ("white balance copied absolute") and the curves belong to no other
// group [stated: Jim, 2026-09-27, "go with recommendations" on the row 8 plan, decision 3]. Every canonical
// name has exactly one group [handle: tests\sync-mask.test.ts "puts every canonical name in one group"].

import { CAMERA_PROFILE_PARAM, type CanonicalSettings } from "../params/index.js";

export const MASK_GROUPS = ["basic_tone", "white_balance", "tone_curve", "hsl", "grading", "detail", "lens", "camera_profile"] as const;
export type MaskGroup = (typeof MASK_GROUPS)[number];

/** The Basic panel's tone and presence sliders (canonical.ts "Basic panel"), white balance aside. */
const BASIC_TONE = new Set(["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "texture", "clarity", "dehaze", "vibrance", "saturation"]);
const WHITE_BALANCE = new Set(["temperature", "tint"]);
const BY_PREFIX: ReadonlyArray<[string, MaskGroup]> = [
  ["tone_curve.", "tone_curve"],
  ["hsl.", "hsl"],
  ["grading.", "grading"],
  ["sharpening.", "detail"],
  ["noise.", "detail"],
  ["lens.", "lens"],
];

/** The group of a canonical name, or null for a name no group holds. */
export function groupOf(name: string): MaskGroup | null {
  if (name === CAMERA_PROFILE_PARAM) return "camera_profile";
  if (BASIC_TONE.has(name)) return "basic_tone";
  if (WHITE_BALANCE.has(name)) return "white_balance";
  return BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null;
}

/**
 * The settings of `source` in the groups asked for, less the names in `exclude` (adaptive exposure
 * leaves `exposure` out: each target keeps its own and the solver moves it, sync\exposure.ts).
 * `left` lists the names not copied, sorted.
 */
export function applyMask(source: Readonly<CanonicalSettings>, groups: readonly MaskGroup[], exclude: readonly string[] = []): { copied: CanonicalSettings; left: string[] } {
  const wanted = new Set(groups);
  const copied: CanonicalSettings = {};
  const left: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    const group = groupOf(name);
    if (group !== null && wanted.has(group) && !exclude.includes(name)) copied[name] = value;
    else left.push(name);
  }
  return { copied, left: left.sort() };
}
