// The MCP definitions of the intent tools (tools-intents.ts).

import { z } from "zod";
import { INTENT_ID_PATTERN } from "../intents/index.js";
import { noArgs, type ToolDef } from "./defs-shared.js";

const getIntentArgs = z.object({ id: z.string().min(1).describe("the intent's id, from lr_list_intents") });
const saveIntentArgs = z.object({
  intent: z
    .record(z.string(), z.unknown())
    .describe(
      "the intent object (schema v3, `schema_version: 3`; see lr_get_intent for an example). Required fields: schema_version, id, label, category, brief, priors " +
        "(may be {}). With from_photo, give id, label, category, brief (and priors {}); the engine fills profile, set, set_by_pipeline and references (the photo's uuid)",
    ),
  // A boolean rather than literal(true), so that false reaches the tool and gets NOT_CONFIRMED
  // rather than a generic INVALID_ARGUMENTS (Greptile, PR #22).
  confirmed: z.boolean().describe("true only after the user approved this exact intent in the chat (not needed with dry_run)"),
  replace: z.boolean().optional().describe("true to replace an existing user intent with the same id"),
  from_photo: z
    .boolean()
    .optional()
    .describe("true: take the look of the photo selected in Lightroom (profile, tone, presence, white balance, curves, HSL, grading, effects, B&W mixer, calibration) into `set`; only with dry_run (save the returned intent)"),
  dry_run: z.boolean().optional().describe("true: validate and return the intent as it would be saved; nothing is written"),
});
const deleteIntentArgs = z.object({
  id: z.string().regex(INTENT_ID_PATTERN).describe("the user intent's id, from lr_list_intents (source \"user\")"),
  confirmed: z.boolean().describe("true only after the user approved deleting this intent in the chat"),
});

export const INTENT_DEFS: ToolDef[] = [
  {
    name: "lr_list_intents",
    title: "List editing intents",
    description:
      "List the editing intents: optional starting points for a session, never rules over the user's request (id, label, category, and whether it is bundled with the engine " +
      "or the user's own; a user intent with the same id replaces the bundled one). Files that failed validation are listed " +
      "under `warnings` and are not usable. `intents_folder` names the user's folder (`path`, `real_path` where it is on disk, `virtualized` and a `warning` " +
      "when Windows redirects it into Claude Desktop's package); `notes` says which intents were copied in from the older folders. Changes nothing; does not need Lightroom.",
    schema: noArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools) => tools.listIntents(),
  },
  {
    name: "lr_get_intent",
    title: "Get an editing intent",
    description:
      "Return one intent in full (schema v3, or v2): `brief` (instructions for the edit), `profile` (the profile pass 0 sets on a raw " +
      "photo and on a rendered one: JPEG, TIFF, PNG …), `set` and `set_by_pipeline` (v3, a look: values written at pass 0 as given), `priors` (both pipelines; applied at pass 0: a number is added to the " +
      "photo's current value; a switch, boolean or curve is set as given), `priors_by_pipeline` (`raw` / `rendered`, added on a " +
      "photo of that pipeline: temperature and tint, Kelvin on raw, relative -100..100 on rendered), `variants` (A/B/C prior sets, " +
      "each with `priors` and optionally `priors_by_pipeline`), " +
      "`guardrail_overrides` (clipping limits replacing the defaults of 0.5 % high and 1.0 % low), `regions_expected`, " +
      "`convergence_hints`, `allow_probe`, `clip_baseline` (true: pass 0 pulls clipping in to the guardrails; off by default) and `references` " +
      "(v3: reference photos by `uuids` and/or `collection`, measured at lr_begin_session; each pass reports where the photo lies against them, never a target). " +
      "Changes nothing; does not need Lightroom.",
    schema: getIntentArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getIntent(args as z.infer<typeof getIntentArgs>),
  },
  {
    name: "lr_save_intent",
    title: "Save an editing intent",
    description:
      "Save a new or changed intent as <id>.json in the user's intents folder. ONLY call this after the user has explicitly " +
      "approved the exact intent in this chat; `confirmed: true` states that they did. " +
      "To save the edit of the photo selected in Lightroom as a look (\"save this edit as a look\"): call with `from_photo: true` and " +
      "`dry_run: true` (from_photo works only with dry_run), show the user the intent the result returns, then save that intent unchanged, without from_photo, after they approve. `set` holds absolute values, " +
      "written at pass 0 as given (`priors` are added to the photo's values); a name is in one of them, not both. " +
      "The intent is validated first (schema v3, or v2 without set; " +
      "canonical parameter names and values on each pipeline, temperature and tint only in `priors_by_pipeline` / `set_by_pipeline`, `profile.raw` a " +
      "raw profile and `profile.rendered` \"Color\" or \"Monochrome\", no colour-slider priors on a monochrome profile) and nothing is written if it is invalid (INVALID_INTENT, with " +
      "`details.problems`). An existing user intent with the same id is replaced only with `replace: true` (else INTENT_EXISTS); " +
      "a bundled intent with the same id is overridden, and its file is not changed. To copy an intent, lr_get_intent it and save it " +
      "under a new id; to rename one, copy it, then lr_delete_intent the old id. The result's `intents_folder.real_path` is the folder as File Explorer shows it. Does not touch Lightroom.",
    schema: saveIntentArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.saveIntent(args as z.infer<typeof saveIntentArgs>),
  },
  {
    name: "lr_delete_intent",
    title: "Delete an editing intent",
    description:
      "Delete one of the user's own intents (<id>.json in the user's intents folder, also one that failed validation). ONLY call " +
      "this after the user has explicitly approved deleting it in this chat; `confirmed: true` states that they did. Bundled " +
      "intents cannot be deleted (INTENT_NOT_FOUND says so); deleting a user intent that overrode a bundled one brings the bundled " +
      "one back (`restores_bundled`). Does not touch Lightroom.",
    schema: deleteIntentArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (tools, args) => tools.deleteIntent(args as z.infer<typeof deleteIntentArgs>),
  },
];
