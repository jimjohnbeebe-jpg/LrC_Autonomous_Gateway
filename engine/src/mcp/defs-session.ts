// The MCP definitions of the session tools (tools-session.ts).

import { z } from "zod";
import { TONE_MODES, referencesShape } from "../intents/index.js";
import { APPROVAL_WAIT_MS, SESSION_DEFAULTS } from "../session/index.js";
import { FRAME, MEASURED_CORE, box, longEdge, openSessionId, sessionId, target, type ToolDef } from "./defs-shared.js";
import { DEFAULT_LONG_EDGE, EXPORT_MAX_LONG_EDGE, MAX_LONG_EDGE, MIN_LONG_EDGE } from "./tools-shared.js";

const returnImage = z
  .enum(["after", "before_after", "none"])
  .optional()
  .describe('"after" (default): the new preview; "before_after": the previous and the new preview in one labelled image; "none": no image');
const beginArgs = z.object({
  intent_id: z
    .string()
    .min(1)
    .optional()
    .describe("an intent id from lr_list_intents, e.g. landscape_golden_hour, as a starting point; leave out (or give \"none\") when no intent fits the user's request"),
  profile: z
    .string()
    .min(1)
    .optional()
    .describe("the profile pass 0 sets, replacing the intent's: a profile of the photo's pipeline (raw: e.g. \"Adobe Color\"; rendered: \"Color\" or \"Monochrome\")"),
  clip_baseline: z.boolean().optional().describe("true only when the user's request asks pass 0 to pull clipping in; replaces the intent's"),
  mode: z
    .enum(["converge", "variants"])
    .optional()
    .describe('"converge" (default): edit the selected photo; "variants": make virtual copies A, B (and C) with the intent\'s variant looks, then the user picks one'),
  variant_count: z
    .number()
    .int()
    .min(2)
    .max(3)
    .optional()
    .describe('mode "variants" only (ignored in Converge mode): how many copies, 2-3 (default: the settings page\'s, else 3); A, B, C take the intent\'s variants of those letters'),
  max_passes: z
    .number()
    .int()
    .min(1)
    .max(SESSION_DEFAULTS.maxPassesLimit)
    .optional()
    .describe(`passes after pass 0, 1-${SESSION_DEFAULTS.maxPassesLimit} (default: the settings page's, else ${SESSION_DEFAULTS.maxPasses})`),
  guardrails: z
    .object({ clip_high_pct: z.number().min(0).max(100).optional(), clip_low_pct: z.number().min(0).max(100).optional() })
    .optional()
    .describe("clipping limits for this session, replacing the intent's, the settings page's and the defaults (0.5 % high, 1.0 % low)"),
  notes: z.string().max(2000).optional().describe("the user's request in their own words, kept in the log; suggested on every session; it takes precedence over the intent's brief"),
  model: z.string().max(80).optional().describe("Your own model name or id, shown to the user and logged; never used for decisions."),
  long_edge: longEdge.describe(`Preview long edge in pixels, ${MIN_LONG_EDGE}-${MAX_LONG_EDGE}, for the whole session (default: the settings page's, else ${DEFAULT_LONG_EDGE}).`),
  measure_long_edge: z
    .number()
    .int()
    .min(MIN_LONG_EDGE)
    .max(EXPORT_MAX_LONG_EDGE)
    .optional()
    .describe(
      `${MIN_LONG_EDGE}-${EXPORT_MAX_LONG_EDGE}: export and measure each render of the session at this long edge (clipping at print size); you still see long_edge. ` +
        "Each render takes longer [unverified: by how much]. Default: off (measured at long_edge)",
    ),
  return_image: returnImage,
  dry_run: z.boolean().optional().describe("true: check the call and return what pass 0 would write (`pass0.changes`), with no snapshot, no write and no session"),
  keep_regions: z.boolean().optional().describe("true: set again the regions (lr_set_regions) the last session on this photo in this engine run ended with, measured on pass 0's preview (`regions_kept`)"),
  references: z.object(referencesShape).optional().describe("reference photos the user names (uuids, a collection, or both; at most 8 used), replacing the intent's: each is rendered and measured once at begin"),
  tone_mode: z
    .enum(TONE_MODES)
    .optional()
    .describe(
      'how pass 0 treats the look\'s tones, replacing the intent\'s (default "set"): "set" writes them as given; "adapt" writes them as a start to adapt toward the references; ' +
        '"auto" runs Lightroom\'s Auto Tone first and skips them (its History step has Lightroom\'s own name)',
    ),
});
const stepArgs = z.object({
  session_id: openSessionId,
  target: target.describe('Variants mode: the copy, "A", "B" or "C" (after lr_select_variant, the pick; it may be left out). Converge mode: "master" or left out'),
  settings: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]))
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
    .describe("canonical name -> CHANGE for numeric sliders (e.g. {\"exposure\": 0.3, \"highlights\": -20}); the value to set for camera_profile, switches, booleans and curves"),
  rationale: z.string().min(1).max(500).describe("one line: what you saw and why this change"),
  return_image: returnImage,
});
const probeArgs = z.object({
  session_id: openSessionId,
  target: target.describe('Variants mode: the copy to probe, as for lr_step. Converge mode: "master" or left out'),
  sliders: z.array(z.string().min(1)).min(1).max(3).refine((s) => new Set(s).size === s.length, "sliders must differ").describe("1-3 numeric sliders, e.g. [\"exposure\", \"whites\"]"),
  magnitude: z.number().min(0.1).max(1).optional().describe("the probe's size as a fraction of the slider's per-pass maximum (default 0.5)"),
});
const regionsArgs = z.object({
  session_id: openSessionId,
  regions: z
    .array(
      z.object({
        kind: z.enum(["skin", "fur", "sky", "custom"]),
        label: z.string().min(1).max(40).describe("a short name, e.g. \"face\""),
        box,
        preserve: z.boolean().optional().describe("true: guard this region's hue and saturation from here on"),
      }),
    )
    .max(8)
    .describe("the whole set of regions (it replaces any earlier set); [] removes them"),
});
const endArgs = z.object({
  session_id: openSessionId,
  outcome: z
    .enum(["accept", "revert", "abandon"])
    .describe('"accept" keeps the edit and writes the recipe; "revert" applies the pre-session snapshot; "abandon" ends a stuck session without touching the photo'),
});
const selectArgs = z.object({
  session_id: openSessionId,
  variant: z.enum(["A", "B", "C"]).describe("the copy the user picked"),
});
const sessionLogArgs = z.object({ session_id: sessionId });
// lr_crop (issue #115, session\crop.ts): its own frame, the photo upright and UNcropped, so any crop is reachable
// [stated: Jim, 2026-10-29, "Go on all.", plan D1 (a)]. No crop in the recipe or a sync: the canonical map has no
// Crop key, and both carry canonical settings [inference: grep of engine\src\params\*.json, 2026-10-29].
const unit = z.number().min(0).max(1);
const UPRIGHT = "0-1 of the WHOLE photo shown upright and uncropped (not the preview, which is already cropped), from its top-left corner";
const cropArgs = z.object({
  session_id: openSessionId,
  target: target.describe('Variants mode: the pick only (after lr_select_variant). Converge mode: "master" or left out'),
  rationale: z.string().min(1).max(500).describe("one line: what you saw and why this crop"),
  box: z.object({ x: unit, y: unit, w: unit, h: unit }).optional().describe(`the area to keep, {x, y, w, h} in ${UPRIGHT}; default the whole photo`),
  aspect: z.string().regex(/^(original|\d+(\.\d+)?:\d+(\.\d+)?)$/).optional().describe('"original" or "W:H" such as "4:5" (portrait) or "16:9": the largest box of that shape centred in `box`'),
  angle: z.number().min(-45).max(45).optional().describe("straighten, degrees, clockwise positive (Lightroom's Angle); default 0. The box then shrinks about its centre until the turned box fits in the photo"),
  reset: z.boolean().optional().describe("true: no crop and no angle (alone, without box, aspect or angle)"),
  return_image: returnImage,
});
const approveArgs = z.object({
  session_id: openSessionId,
  confirmed: z.boolean().describe("true only after the user approved the pass in this chat"),
});

/** The HUD in Lightroom (PHASE5_PLAN rows 5-6): what the user can do there, and what Claude then sees. */
const HUD_NOTE =
  "The LrC-AVG HUD in Lightroom opens and follows the session; there the user can Abort (the photo goes back to the " +
  "pre-session snapshot, and a running call stops before its next write), Accept (after the running call), Pick a copy, " +
  "or Approve a pass (approve_each_pass mode). " +
  "A session the user ended answers every later call with SESSION_ENDED (details: outcome, source); tell the user, and " +
  "start a new session only if they ask. ";

export const SESSION_DEFS: ToolDef[] = [
  {
    name: "lr_begin_session",
    title: "Begin an editing session",
    description:
      "Start an editing session on the photo selected in Lightroom. THE USER'S REQUEST COMES FIRST: put it in `notes` in their " +
      "own words. An intent (lr_list_intents) is an optional starting point: leave intent_id out when none fits; pass `profile` " +
      "or `guardrails` when the request needs them (e.g. high key or crushed blacks). The engine makes a Develop snapshot " +
      "\"AVG pre-session …\" (lr_end_session revert returns to it), renders the photo, and runs pass 0 as one History step " +
      "\"AVG <id> pass 0/N\". Returns session_id, the intent's brief, guardrails, pass0_applied, the full settings, metrics, the " +
      "preview, `log_path`, and `start_off_zero` (settings found on the photo, which may be import defaults or earlier edits). " +
      "Then call lr_step once per pass, up to max_passes. Metrics include `perceptual` (lr_help item 4); with `references` (or an intent's) each pass adds " +
      "`reference_gap`, the photo against the reference photos' range. Both are reported, never targets. " +
      "To look at a photo without a session, use lr_get_preview with uuid and lr_get_photo_stats; to see what pass 0 would write, " +
      "`dry_run: true` (nothing written, no snapshot, no session). `advisory`, when present, is a warning, not a refusal: tell the user. " +
      "One session at a time; it stays open until lr_end_session. A photo with a session an engine that stopped left open " +
      "(lr_get_active_photo_context `left_open`) is refused with SESSION_LEFT_OPEN, nothing written, until that session is ended. " +
      "lr_help explains passes, variants mode, clipping guardrails, metrics and previews. " +
      HUD_NOTE,
    schema: beginArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.beginSession(args as z.infer<typeof beginArgs>),
  },
  {
    name: "lr_step",
    title: "One editing pass",
    // Decay: SESSION_DEFAULTS.decay [1.0, 0.6, 0.4, 0.25] and decayFor reusing the last value for later passes
    // [handle: engine\src\session\rules.ts:20, :94-97]. `recoverable`: engine\src\mcp\errors.ts:6.
    description:
      "Apply one pass to the session's photo. `settings` maps canonical names to a CHANGE for numeric sliders " +
      "(e.g. {\"exposure\": 0.3, \"highlights\": -20} adds 0.3 EV and lowers highlights by 20) and to the value to set for " +
      "camera_profile, switches, booleans and curves. Each change is capped at the slider's per-pass maximum × the pass's decay " +
      "(by default 1.0, 0.6, 0.4, 0.25 for passes 1-4, and a later pass takes the last value again; begin's " +
      "session_settings.decay has the session's. Per-pass maxima: exposure 1 EV, contrast/texture/clarity/dehaze 40, highlights/shadows/whites/blacks 60, " +
      "vibrance/saturation 30, temperature 1500 K on raw photos and 30 on rendered ones, whose temperature is relative, tint 30, " +
      "HSL 40, grading 30; a grading hue is an angle: it takes the shorter way round, wraps at 360 and is not capped) " +
      "and at the slider's range (`clamped`). " +
      "The clipping guard covers only an end within its limit before the pass (every end when the session's `clip_baseline` " +
      "is on; an end already over is left alone and reported `unmet`). A change that would push further into a guarded " +
      "limit already reached is refused (`refused`); the rest is written as " +
      "one History step \"AVG <id> pass n/N\", read back, rendered and measured. If clipping then exceeds a guarded limit, the engine " +
      "pulls back the sliders that caused it, else takes fixed steps, at most 3 (\"… guard k\", in `guardrail_actions`). The pass " +
      "is undone (\"… clip revert\" / \"… region revert\", a `reverted` action and `undone` in the result; the pass still counts) " +
      "when clipping is still over a limit the photo was within before the pass, or a preserved region drifts; `applied` then " +
      "lists what was written before the undo. Returns the applied changes, full settings, " +
      "metrics, delta_metrics against the previous pass, and the image. " +
      "`converged_by_metrics` (the metrics stopped moving) or `cap_reached` end the passes: then call lr_end_session. " +
      "Unknown names or wrong types are refused before anything is written. " +
      "Errors are {code, message, recoverable}: `recoverable`: true means the same call may work later unchanged (e.g. once " +
      "Lightroom is back); false means change the call first. " +
      "Variants mode: name the copy with `target`; each copy takes ONE pass before the pick (a second is refused with " +
      "AWAITING_PICK), and the step that gives the last copy its pass returns `awaiting_pick: true` and the contact sheet: " +
      "then ask the user to pick (lr_select_variant). After the pick, steps go to the pick, whose pass count carries on. " +
      "`hud_actions` lists what the user did in the HUD since your last call (a pick), and a `deck_fallback` note when the Deck " +
      "did not start and the classic HUD window opened instead (tell the user). " +
      "approve_each_pass mode (begin's session_settings.approval): pass 1 needs no approval; from pass 2 on, the call first waits " +
      `up to ${APPROVAL_WAIT_MS / 1000} s for the user's Approve of the pass before (the HUD's button, or lr_approve_pass after the user approved in chat), ` +
      "else returns AWAITING_APPROVAL (recoverable; nothing written, the pass not used): tell the user the pass waits for their " +
      "Approve, then call again. Unknown names are refused before the wait. `approval` in the result says which pass was approved, " +
      "by whom, and how long the call waited. " +
      MEASURED_CORE,
    schema: stepArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.step(args as z.infer<typeof stepArgs>),
  },
  {
    name: "lr_probe",
    title: "Probe slider sensitivity",
    description:
      "Measure how 1-3 numeric sliders move the metrics on this photo: each is changed by `magnitude` × its per-pass maximum, " +
      "rendered and measured (about 3.5 s each), and the photo is put back (History: \"AVG <id> probe <slider>\" … \"probe revert\"). " +
      "Returns the metric change per unit of each slider; later lr_step calls use it to cap changes that would cross a " +
      "clipping limit. Does not use a pass. Only when the intent sets allow_probe.",
    schema: probeArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.probe(args as z.infer<typeof probeArgs>),
  },
  {
    name: "lr_set_regions",
    title: "Set measured regions",
    description:
      `Name parts of the photo (skin, fur, sky or custom) as boxes in ${FRAME}, as mask geometry is; their metrics appear in every later ` +
      "`metrics.regions[]`, starting with the last preview (returned now). `preserve: true` guards a region: a pass that moves " +
      "its mean hue more than 6 degrees or its mean saturation more than 8 points from now is undone. A mask pass's " +
      "converged_by_metrics: every region's change is under the convergence thresholds (mean luma < 1/255, clipping < 0.1 point); " +
      "false without regions or when the pass was undone; a signal only, the session goes on. The list replaces any " +
      "earlier one. Does not touch Lightroom.",
    schema: regionsArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.setRegions(args as z.infer<typeof regionsArgs>),
  },
  {
    name: "lr_crop",
    title: "Crop and straighten",
    description:
      `Crop and straighten the session's photo: \`box\` in ${UPRIGHT}, an \`aspect\`, an \`angle\`, or \`reset\`. Each call sets the whole crop (left out: the whole photo, angle 0); ` +
      "`crop.before` in the result is the crop the photo had, in the same frame, to keep parts of it. ONE pass (it counts against max_passes, approve_each_pass gates it): " +
      "one History step \"AVG <id> pass n/N crop\", read back (not taken: written back, WRITE_NOT_TAKEN, no pass used), rendered and measured; no clipping guard. " +
      "NO_CHANGE when the photo already has that crop. The preview, mask geometry and regions then follow the new crop: the session's regions are cleared " +
      "(`regions_cleared`), so call lr_set_regions again, and lr_probe's slopes are dropped. The recipe and lr_sync_series carry no crop. Variants mode: on the pick only (CROP_AFTER_PICK). " +
      "Mirrored photos are refused (CROP_FRAME_UNSUPPORTED). Quarter-turned photos, photos whose crop is not constrained to the image, and rendered photos are [unverified].",
    schema: cropArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.crop(args as z.infer<typeof cropArgs>),
  },
  {
    name: "lr_select_variant",
    title: "Pick a variant",
    description:
      "Variants mode: continue the session on the copy the user picked (ask the user; do not pick for them). The copy is selected " +
      "in Lightroom, later lr_step calls go to it, and its pass count carries on from its own passes. The other copies stay in the " +
      "catalog as they are (after lr_end_session, lr_remove_photos can remove them if the user wants). Returns the pick, its passes left and its last preview. " +
      "Also accepted before every copy has had its refined pass. Does not render. If the user already picked in the HUD, calling " +
      "this with that letter confirms it (`picked_by: \"hud\"`); another letter is refused.",
    schema: selectArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.selectVariant(args as z.infer<typeof selectArgs>),
  },
  {
    name: "lr_approve_pass",
    title: "Approve the pass shown",
    description:
      "approve_each_pass mode only: the user approves the pass they last saw, so the next lr_step may go ahead (the same as the " +
      "HUD's Approve button). Call it ONLY after the user approved that pass in this chat, and set `confirmed: true` to state that " +
      "they did; never call it on your own to get past AWAITING_APPROVAL. A waiting lr_step goes ahead at once. Returns " +
      "`approved_pass`. Refused with NOT_AWAITING_APPROVAL in autonomous mode or when no pass waits for approval (pass 1 needs " +
      "none; a Variants pick approves the pass it was picked at). Does not touch Lightroom.",
    schema: approveArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.approvePass(args as z.infer<typeof approveArgs>),
  },
  {
    name: "lr_end_session",
    title: "End the editing session",
    description:
      "End the session. \"accept\": keep the edit; the log is finalised and a recipe (the final settings under canonical names) " +
      "is written next to it. \"revert\": apply the pre-session snapshot, putting every setting back as it was before " +
      "lr_begin_session (the result lists any setting that still differs); when none differs the snapshot is deleted (`snapshot_removed`). Returns the log and recipe paths and the final settings. " +
      "Variants mode: \"accept\" needs a pick and keeps the pick's edit (the recipe is the pick's); \"revert\" puts the master back. " +
      "Either way the copies stay in the catalog, listed in `copies`. After the user clicked Abort in the HUD, only \"revert\" is taken. " +
      "Once the user ended the session on the Deck, the outcome matching theirs (\"accept\" after Accept; \"revert\" after Abort or " +
      "Put back) returns ok with `already_ended_by_user` {outcome, source, at, log_path}; any other outcome gets SESSION_ENDED. " +
      "\"abandon\": only when the session cannot end otherwise and the user agrees: Lightroom is gone or hung, or an AI mask failed " +
      "or seems stuck (AI_MASK_FAILED, LIGHTROOM_STUCK, AI_UPDATE_PENDING refuse revert). It reads and writes nothing (it does not " +
      "wait for Lightroom): the photo keeps what the session did and is NOT put back (`photo_put_back` false), the log's outcome is \"abandoned\", and a new session can begin. " +
      "LIGHTROOM_STUCK and AI_UPDATE_PENDING lift once Lightroom's result shows, so try \"revert\" again first if the user can wait. " +
      "The result's `note` says how the user puts the photo back by hand (the pre-session snapshot, `snapshot`) and whether " +
      "Lightroom still holds writes to the photo (`lightroom_guard`: \"none\" when no AI mask was pending, so nothing is held; " +
      "\"cleared\"; \"not_cleared\" or \"plugin_too_old\": held until Lightroom restarts; \"kept\": held until the mask's shape shows, so the user waits for it first); tell the user both. " +
      "A session an engine that stopped left open (lr_get_active_photo_context `left_open`) is ended the same three ways, with `left_open: true` " +
      "and the log's `ended_by` \"recovery\": revert applies its snapshot and says what it `checked`; accept reads the photo as it is now.",
    schema: endArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.endSession(args as z.infer<typeof endArgs>),
  },
  {
    name: "lr_get_session_log",
    title: "Session log",
    description:
      "Return a session's provenance log (every pass: settings before/after, changes, metrics, preview hash, rationale, " +
      "guardrail actions), open or ended. Does not touch Lightroom.",
    schema: sessionLogArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getSessionLog(args as z.infer<typeof sessionLogArgs>),
  },
];
