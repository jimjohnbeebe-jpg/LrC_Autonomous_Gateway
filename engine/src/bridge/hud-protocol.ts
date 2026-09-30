// The HUD's part of the bridge protocol (PRD section 6.3, ARCHITECTURE section 3; PHASE5_PLAN row 4):
// the hud_update command the engine sends, its result, and the four events the HUD's buttons and
// menu items send. The engine's hud\ (row 5) sends the updates, and session\hud-actions.ts acts on
// the events.
//
// The plugin side is plugin\LrC-AVG.lrplugin\HudState.lua, which checks the same fields and limits
// (tests\lua-plugin.test.ts keeps the lists and limits equal; the smoke transcript runs payloads this
// schema accepts and refuses through the plugin's check [handle: docs\reports\phase5\hud-plugin-smoke\
// smoke.txt "Contract"]), and Hud.lua. The plugin:
//   - refuses an update with an unknown field or a wrong type (bad_request, naming the field);
//   - within a session takes only a newer `seq`, and never goes back to a session a newer one replaced
//     (the result says `applied: false` and why);
//   - shows text as given, shortened to HUD_LIMITS.text bytes on a character boundary;
//   - opens the window only for `open: true` when it is not open (decision 6), and closes it
//     CLOSE_AFTER_SECONDS (5) after an end stage (decision 1);
//   - enables Pick for the `variants` letters only at stage awaiting_pick, and Approve whenever
//     `approve_pass` is present and the session has not ended;
//   - keeps its buttons off after a click until an update names the click in `answered_click_id`, a
//     new session or an end stage arrives, or 10 s pass;
//   - shows "Target changed" when the selected photo is not in `session_photos` (or is not the
//     target, without it), so a copy the engine is about to select must be listed first.
// `target.iso` is shown after "ISO ", `target.lens_profile` after "lens profile "; the other target
// fields as given (e.g. shutter "1/250 s", aperture "f/8").

import { z } from "zod";
import type { EventEnvelope } from "./protocol.js";

export const HUD_STAGES = [
  "begin", "pass0", "applying", "acquiring_preview", "metrics", "awaiting_claude", "awaiting_pick",
  "awaiting_approval", "converged", "target_changed", "accepted", "aborted", "ended",
] as const;
export type HudStage = (typeof HUD_STAGES)[number];
/** The stages that end a session: the HUD turns its buttons off and closes itself. */
export const HUD_END_STAGES = ["accepted", "aborted", "ended"] as const;
export const HUD_GUARDRAIL = ["green", "clamped", "refused", "corrected", "unmet", "undone"] as const;
export const HUD_EVENTS = ["hud_abort", "hud_accept", "hud_pick", "hud_approve_pass"] as const;
export const HUD_VARIANTS = ["A", "B", "C"] as const;
/** `id` and `text` count UTF-8 bytes, as Lua's # does. */
export const HUD_LIMITS = { text: 120, id: 64, rows: 12, photos: 16, pass: 99, decay: 8 } as const;

const id = z.string().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= HUD_LIMITS.id, `at most ${HUD_LIMITS.id} bytes`);
/** Text for display; a number is shown as Lua's tostring writes it. */
const text = z.union([z.string(), z.number()]);
const int = (min: number, max?: number) => (max === undefined ? z.number().int().min(min) : z.number().int().min(min).max(max));

const target = z.strictObject({
  uuid: id,
  filename: text.optional(),
  copy_name: text.optional(),
  iso: text.optional(),
  shutter: text.optional(),
  aperture: text.optional(),
  lens: text.optional(),
  lens_profile: text.optional(),
});

const delta = z.strictObject({ slider: text, before: text.optional(), after: text.optional(), delta: text.optional() });

/** The session's settings as the HUD shows them (decision 4), under get_prefs' wire names. */
const settings = z.strictObject({
  mode: z.enum(["autonomous", "approve_each_pass"]).optional(),
  max_passes: int(0).optional(),
  variant_count: int(0).optional(),
  long_edge: int(0).optional(),
  quality: int(0).optional(),
  clip_high_pct: z.number().optional(),
  clip_low_pct: z.number().optional(),
  decay: z.array(z.number()).max(HUD_LIMITS.decay).optional(),
});

export const hudUpdatePayloadSchema = z.strictObject({
  session_id: id,
  /** Rises with every update of a session. */
  seq: int(1),
  /** Open the window if it is not open: sent once, at lr_begin_session (decision 6). */
  open: z.boolean().optional(),
  stage: z.enum(HUD_STAGES),
  mode: z.enum(["converge", "variants"]).optional(),
  pass: int(0, HUD_LIMITS.pass).optional(),
  max_passes: int(1, HUD_LIMITS.pass).optional(),
  target,
  /** Every photo the session works on (Variants: the master and its copies); default: the target. */
  session_photos: z.array(id).max(HUD_LIMITS.photos).optional(),
  /** The letters Pick may send, at stage awaiting_pick. */
  variants: z.array(z.enum(HUD_VARIANTS)).max(HUD_VARIANTS.length).optional(),
  /** The pass an Approve accepts (approve_each_pass mode, row 6). */
  approve_pass: int(1, HUD_LIMITS.pass).optional(),
  /** The click_id of the event this update answers. */
  answered_click_id: id.optional(),
  deltas: z.array(delta).max(HUD_LIMITS.rows).optional(),
  guardrail: z.strictObject({ status: z.enum(HUD_GUARDRAIL), reason: text.optional() }).optional(),
  note: text.optional(),
  settings: settings.optional(),
});
export type HudUpdatePayload = z.infer<typeof hudUpdatePayloadSchema>;

/** applied: the update was taken (else `reason`); shown: the window is open or opening; opened: this update opened it. */
export const hudUpdateResultSchema = z.object({
  applied: z.boolean(),
  shown: z.boolean(),
  opened: z.boolean(),
  reason: z.string().optional(),
});

const eventBase = {
  session_id: id,
  /** The seq of the last update the HUD had taken when it sent the event. */
  seq_seen: int(1),
  /** New for every click; an update answers it with answered_click_id. */
  click_id: id,
  source: z.enum(["hud", "menu"]),
};

export const hudEventSchemas = {
  hud_abort: z.strictObject(eventBase),
  hud_accept: z.strictObject(eventBase),
  hud_pick: z.strictObject({ ...eventBase, variant: z.enum(HUD_VARIANTS) }),
  hud_approve_pass: z.strictObject({ ...eventBase, pass: int(1, HUD_LIMITS.pass) }),
} as const;

export type HudEventName = (typeof HUD_EVENTS)[number];
export type HudEvent = { [N in HudEventName]: { name: N; payload: z.infer<(typeof hudEventSchemas)[N]> } }[HudEventName];

function isHudEventName(name: string): name is HudEventName {
  return (HUD_EVENTS as readonly string[]).includes(name);
}

/**
 * A plugin event checked as a HUD event: null when it is not one (e.g. the hello event), else the
 * event or why its payload was refused.
 */
export function parseHudEvent(event: EventEnvelope): { ok: true; event: HudEvent } | { ok: false; error: string } | null {
  if (!isHudEventName(event.name)) return null;
  const name = event.name;
  const parsed = hudEventSchemas[name].safeParse(event.payload);
  if (!parsed.success) {
    return { ok: false, error: `${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "payload"} ${i.message}`).join("; ")}` };
  }
  return { ok: true, event: { name, payload: parsed.data } as HudEvent };
}
