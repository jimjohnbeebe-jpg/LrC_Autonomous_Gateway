// The MCP definitions of the intent tools (tools-intents.ts).

import { z } from "zod";
import { noArgs, type ToolDef } from "./defs-shared.js";

const getIntentArgs = z.object({ id: z.string().min(1).describe("the intent's id, from lr_list_intents") });
const saveIntentArgs = z.object({
  intent: z.record(z.string(), z.unknown()).describe("the whole intent object (schema v1; see lr_get_intent for an example)"),
  // A boolean rather than literal(true), so that false reaches the tool and gets NOT_CONFIRMED
  // rather than a generic INVALID_ARGUMENTS (Greptile, PR #22).
  confirmed: z.boolean().describe("true only after the user approved this exact intent in the chat"),
  replace: z.boolean().optional().describe("true to replace an existing user intent with the same id"),
});

export const INTENT_DEFS: ToolDef[] = [
  {
    name: "lr_list_intents",
    title: "List editing intents",
    description:
      "List the editing intents a session can start from (id, label, category, and whether it is bundled with the engine " +
      "or the user's own; a user intent with the same id replaces the bundled one). Files that failed validation are listed " +
      "under `warnings` and are not usable. Changes nothing; does not need Lightroom.",
    schema: noArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools) => tools.listIntents(),
  },
  {
    name: "lr_get_intent",
    title: "Get an editing intent",
    description:
      "Return one intent in full: `brief` (instructions for the edit), `default_camera_profile`, `priors` (applied at pass 0: " +
      "a number is added to the photo's current value; a switch, boolean or curve is set as given), `variants` (A/B/C prior sets), " +
      "`guardrail_overrides` (clipping limits replacing the defaults of 0.5 % high and 1.0 % low), `regions_expected`, " +
      "`convergence_hints` and `allow_probe`. Changes nothing; does not need Lightroom.",
    schema: getIntentArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getIntent(args as z.infer<typeof getIntentArgs>),
  },
  {
    name: "lr_save_intent",
    title: "Save an editing intent",
    description:
      "Save a new or changed intent as <id>.json in the user's intents folder. ONLY call this after the user has explicitly " +
      "approved the exact intent in this chat; `confirmed: true` states that they did. The intent is validated first (schema v1, " +
      "canonical parameter names and values, camera profile name) and nothing is written if it is invalid (INVALID_INTENT, with " +
      "`details.problems`). An existing user intent with the same id is replaced only with `replace: true` (else INTENT_EXISTS); " +
      "a bundled intent with the same id is overridden, and its file is not changed. Does not touch Lightroom.",
    schema: saveIntentArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.saveIntent(args as z.infer<typeof saveIntentArgs>),
  },
];
