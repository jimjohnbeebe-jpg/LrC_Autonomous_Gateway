// The HUD's part of the bridge protocol (PRD section 6.3, ARCHITECTURE section 3; PHASE5_PLAN row 4):
// the hud_update command the engine sends, its result, and the four events the HUD's buttons and
// menu items send. The engine's hud\ (row 5) sends the updates, and session\hud-actions.ts acts on
// the events.
//
// The plugin side is plugin\LrC-AVG.lrplugin\HudState.lua, which checks the same fields and limits
// (tests\lua-plugin.test.ts keeps the lists and limits equal; the smoke transcript runs payloads this
// schema accepts and refuses through the plugin's check [handle: docs\reports\phase5\hud-plugin-smoke\
// smoke.txt "Contract"]), and Hud.lua. The plugin, from 0.9.0 (fix/hud-p1; what is new there was
// checked in Lightroom 15.6 [handle: docs\reports\phase6\hud-p1-check\check.txt, section 3]):
//   - refuses an update with an unknown field or a wrong type (bad_request, naming the field);
//   - within a session takes only a newer `seq`, and never goes back to a session a newer one replaced
//     (the result says `applied: false` and why);
//   - shows text as given, shortened to HUD_LIMITS.text bytes on a character boundary, and word-wraps
//     it itself into a fixed number of line slots, ending the last with "..." when it does not fit: it
//     never relies on LrView to wrap, since a long line runs off the window [stated: Jim, 2026-10-03,
//     "long lines do not wrap, the move off of the canvas"];
//   - opens the window only for `open: true` when it is not open (decision 6), and keeps it open after
//     an end stage until the user closes it or the next session starts [stated: Jim, 2026-10-03, "Stay
//     open (Recommended)"; replaces decision 1's 5 s close];
//   - enables Pick for the `variants` letters only at stage awaiting_pick, Accept at every stage of an
//     open session but awaiting_pick (the engine refuses it there, session\hud-actions.ts
//     acceptRefusal), and Approve whenever `approve_pass` is present and the session has not ended;
//   - keeps its buttons off after a click until an update names the click in `answered_click_id`, a
//     new session or an end stage arrives, or 10 s pass;
//   - after each engine (re)connection treats the session it shows as unknown, buttons off, until an
//     update for it arrives (the engine resends at once, hud\publisher.ts); after 10 s still unknown,
//     it says the edit is no longer open in Claude and shows the undo path through `snapshot` (a click
//     on a session the engine does not know gets one `ended` update for it, hud\events.ts);
//   - shows "Target changed" when the selected photo is not in `session_photos` (or is not the
//     target, without it), so a copy the engine is about to select must be listed first;
//   - from 0.13.0, keeps `put_back` and, once the open session's engine has been away 10 s or the
//     edit is no longer open in Claude, enables a Put back button that applies that snapshot to that
//     photo itself (HudClick.lua), so the photo never waits on a Lightroom restart [stated: Jim,
//     2026-10-03, "A LrC restart had to be done to revert the photo"].
// `target.iso` is shown after "ISO ", `target.lens_profile` after "lens profile "; the other target
// fields as given (e.g. shutter "1/250 s", aperture "f/8"). `deltas[].slider` is Lightroom's panel
// label (params\labels.ts) and `guardrail.reason` one finished sentence (hud\payload.ts); the plugin
// prints both as given, and "Clipping: within limits." for green without a reason.

import { z } from "zod";
import type { EventEnvelope } from "./protocol.js";

export const HUD_STAGES = [
  "begin", "pass0", "applying", "acquiring_preview", "metrics", "awaiting_claude", "awaiting_pick",
  "awaiting_approval", "converged", "target_changed", "accepted", "aborted", "ended",
] as const;
export type HudStage = (typeof HUD_STAGES)[number];
/** The stages that end a session: the HUD turns its buttons off and stays open (plugin 0.9.0). */
export const HUD_END_STAGES = ["accepted", "aborted", "ended"] as const;
export const HUD_GUARDRAIL = ["green", "clamped", "refused", "corrected", "unmet", "undone"] as const;
export const HUD_EVENTS = ["hud_abort", "hud_accept", "hud_pick", "hud_approve_pass", "hud_put_back"] as const;
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
  /** The pre-session snapshot's name (Develop > Snapshots), for the undo line when Claude is gone (plugin 0.9.0). */
  snapshot: text.optional(),
  /**
   * The pre-session snapshot and its photo (Variants: the master), for the HUD's Put back button when
   * the engine stops mid-session (plugin 0.13.0, PR C step 2b); sent while the session is open, absent
   * at an end stage.
   */
  put_back: z.strictObject({ photo_uuid: id, snapshot_id: id, snapshot_name: text }).optional(),
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
  /** Plugin 0.13.0: the HUD's Put back applied the session's snapshot itself; `outcome` says whether it took (engine\src\session\put-back.ts). */
  hud_put_back: z.strictObject({ ...eventBase, outcome: z.enum(["done", "failed"]) }),
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
