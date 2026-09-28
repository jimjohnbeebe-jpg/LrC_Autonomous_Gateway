// The MCP definitions of the session tools (tools-session.ts).

import { z } from "zod";
import { MEASURED, box, longEdge, sessionId, target, type ToolDef } from "./defs-shared.js";

const returnImage = z
  .enum(["after", "before_after", "none"])
  .optional()
  .describe('"after" (default): the new preview; "before_after": the previous and the new preview in one labelled image; "none": no image');
const beginArgs = z.object({
  intent_id: z.string().min(1).describe("an intent id from lr_list_intents, e.g. landscape_golden_hour"),
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
    .describe('mode "variants" only: how many copies, 2-3 (default 3); A, B, C take the intent\'s variants of those letters'),
  max_passes: z.number().int().min(1).max(8).optional().describe("passes after pass 0, 1-8 (default 4)"),
  guardrails: z
    .object({ clip_high_pct: z.number().min(0).max(100).optional(), clip_low_pct: z.number().min(0).max(100).optional() })
    .optional()
    .describe("clipping limits for this session, replacing the intent's and the defaults (0.5 % high, 1.0 % low)"),
  notes: z.string().max(2000).optional().describe("the user's own words about the photo, kept in the log"),
  long_edge: longEdge,
  return_image: returnImage,
});
const stepArgs = z.object({
  session_id: sessionId,
  target: target.describe('Variants mode: the copy, "A", "B" or "C" (after lr_select_variant, the pick; it may be left out). Converge mode: "master" or left out'),
  settings: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]))
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
    .describe("canonical name -> CHANGE for numeric sliders (e.g. {\"exposure\": 0.3, \"highlights\": -20}); the value to set for camera_profile, switches, booleans and curves"),
  rationale: z.string().min(1).max(500).describe("one line: what you saw and why this change"),
  return_image: returnImage,
});
const probeArgs = z.object({
  session_id: sessionId,
  target: target.describe('Variants mode: the copy to probe, as for lr_step. Converge mode: "master" or left out'),
  sliders: z.array(z.string().min(1)).min(1).max(3).refine((s) => new Set(s).size === s.length, "sliders must differ").describe("1-3 numeric sliders, e.g. [\"exposure\", \"whites\"]"),
  magnitude: z.number().min(0.1).max(1).optional().describe("the probe's size as a fraction of the slider's per-pass maximum (default 0.5)"),
});
const regionsArgs = z.object({
  session_id: sessionId,
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
  session_id: sessionId,
  outcome: z.enum(["accept", "revert"]).describe('"accept" keeps the edit and writes the recipe; "revert" applies the pre-session snapshot'),
});
const selectArgs = z.object({
  session_id: sessionId,
  variant: z.enum(["A", "B", "C"]).describe("the copy the user picked"),
});
const sessionLogArgs = z.object({ session_id: sessionId });

export const SESSION_DEFS: ToolDef[] = [
  {
    name: "lr_begin_session",
    title: "Begin an editing session",
    description:
      "Start an editing session on the photo selected in Lightroom, following an intent (lr_list_intents). The engine: " +
      "creates a Develop snapshot \"AVG pre-session …\" (lr_end_session revert returns to it); renders the photo as it is; " +
      "runs pass 0, one History step \"AVG <id> pass 0/N\" with the intent's camera profile, lens corrections and priors " +
      "(a numeric prior is added to the photo's value); then, while clipping is over a limit, pulls whites/highlights/exposure or " +
      "blacks/shadows/exposure back in fixed steps until under, at most 8 (\"… baseline k\"; a limit still over is `unmet` in " +
      "guardrail_actions). Returns session_id, the intent's brief (follow it), the " +
      "guardrails, pass0_applied, the full settings, metrics, and the preview. Then call lr_step for each pass. " +
      "mode \"variants\" (an intent with variants; select the master, not a virtual copy): instead of editing the photo, the engine " +
      "makes virtual copies \"AVG <intent> A\", \"… B\", \"… C\" and runs pass 0 on each with the intent's priors plus that " +
      "variant's (History \"AVG <id> A pass 0/N\"); it returns `variants` (each copy's settings and metrics) and a contact sheet " +
      "of the copies side by side as the image, and leaves the master as it is. Then one lr_step per copy (target \"A\", …), " +
      "then the user picks with lr_select_variant, and the remaining passes go to the pick. " +
      "One session at a time; the session stays open until lr_end_session. " +
      MEASURED,
    schema: beginArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.beginSession(args as z.infer<typeof beginArgs>),
  },
  {
    name: "lr_step",
    title: "One editing pass",
    description:
      "Apply one pass to the session's photo. `settings` maps canonical names to a CHANGE for numeric sliders " +
      "(e.g. {\"exposure\": 0.3, \"highlights\": -20} adds 0.3 EV and lowers highlights by 20) and to the value to set for " +
      "camera_profile, switches, booleans and curves. Each change is capped at the slider's per-pass maximum × the pass's decay " +
      "(1.0, 0.6, 0.4, 0.25: exposure 1 EV, contrast/texture/clarity/dehaze 40, highlights/shadows/whites/blacks 60, " +
      "vibrance/saturation 30, temperature 1500 K, tint 30, HSL 40, grading 30) and at the slider's range (`clamped`). " +
      "A change that would push further into a clipping limit already reached is refused (`refused`); the rest is written as " +
      "one History step \"AVG <id> pass n/N\", read back, rendered and measured. If clipping then exceeds a limit, the engine " +
      "pulls back the sliders that caused it, else takes fixed steps, at most 3 (\"… guard k\", in `guardrail_actions`). The pass " +
      "is undone (\"… clip revert\" / \"… region revert\", a `reverted` action and `undone` in the result; the pass still counts) " +
      "when clipping is still over a limit the photo was within before the pass, or a preserved region drifts; `applied` then " +
      "lists what was written before the undo. Returns the applied changes, full settings, " +
      "metrics, delta_metrics against the previous pass, and the image. " +
      "`converged_by_metrics` (the metrics stopped moving) or `cap_reached` end the passes: then call lr_end_session. " +
      "Unknown names or wrong types are refused before anything is written. " +
      "Variants mode: name the copy with `target`; each copy takes ONE pass before the pick (a second is refused with " +
      "AWAITING_PICK), and the step that gives the last copy its pass returns `awaiting_pick: true` and the contact sheet: " +
      "then ask the user to pick (lr_select_variant). After the pick, steps go to the pick, whose pass count carries on. " +
      MEASURED,
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
      "Name parts of the photo (skin, fur, sky or custom) as boxes in 0-1 of the image; their metrics appear in every later " +
      "`metrics.regions[]`, starting with the last preview (returned now). `preserve: true` guards a region: a pass that moves " +
      "its mean hue more than 6 degrees or its mean saturation more than 8 points from now is undone. The list replaces any " +
      "earlier one. Does not touch Lightroom.",
    schema: regionsArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.setRegions(args as z.infer<typeof regionsArgs>),
  },
  {
    name: "lr_select_variant",
    title: "Pick a variant",
    description:
      "Variants mode: continue the session on the copy the user picked (ask the user; do not pick for them). The copy is selected " +
      "in Lightroom, later lr_step calls go to it, and its pass count carries on from its own passes. The other copies stay in the " +
      "catalog as they are; the user removes them in Lightroom when they want. Returns the pick, its passes left and its last preview. " +
      "Also accepted before every copy has had its refined pass. Does not render.",
    schema: selectArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.selectVariant(args as z.infer<typeof selectArgs>),
  },
  {
    name: "lr_end_session",
    title: "End the editing session",
    description:
      "End the session. \"accept\": keep the edit; the log is finalised and a recipe (the final settings under canonical names) " +
      "is written next to it. \"revert\": apply the pre-session snapshot, putting every setting back as it was before " +
      "lr_begin_session (the result lists any setting that still differs). Returns the log and recipe paths and the final settings. " +
      "Variants mode: \"accept\" needs a pick and keeps the pick's edit (the recipe is the pick's); \"revert\" puts the master back. " +
      "Either way the copies stay in the catalog, listed in `copies`.",
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
