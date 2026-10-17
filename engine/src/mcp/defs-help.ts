// lr_help and the server instructions (engine 0.35.0, hands-on batch 1): how sessions, passes, previews and metrics work,
// in one place, so lr_begin_session's description can stay short. Mechanics only; the craft is the AI's
// [stated: Jim, 2026-10-16, "Guidance stays light ('suggested', 'for example', no numeric targets)"].
// The clip_baseline, Variants, precedence and pipeline text moved here from lr_begin_session's description.
// Item 3's "downscaling understates clipping at print size" is [inference]; "clip at export resolution" is tracked in issue #159.

import { MEASURED, noArgs, type ToolDef } from "./defs-shared.js";
import { DEFAULT_LONG_EDGE } from "./tools-shared.js";

export const HELP_TEXT = [
  "LrC-AVG: how it works. The mechanics are below; how to edit the photo (the craft) is left to the AI.",
  "",
  "1. Sessions. lr_begin_session starts a session on the photo selected in Lightroom and returns its session_id; every " +
    "session tool takes that session_id. One session at a time: it stays open until lr_end_session (accept, revert or " +
    "abandon). The session has a pass cap, max_passes (after pass 0); `cap_reached` in an lr_step result means no pass is left.",
  "",
  "2. What uses a pass. Each lr_step, and each mask create, edit or delete (lr_create_mask, lr_edit_mask, lr_delete_mask), " +
    "uses one pass, an undone one included. A rename alone (lr_edit_mask with only mask_id and name) uses no pass. " +
    "lr_probe, lr_set_regions, lr_list_masks, lr_get_preview and lr_get_metrics use none.",
  "",
  `3. Previews. Session previews are ${DEFAULT_LONG_EDGE} px on the long edge by default: downscaling averages pixels, so ` +
    "they understate clipping and fine detail at print size. lr_get_preview with `region` exports the photo " +
    "larger and returns a crop of that box, for finer detail (sharpness, noise, fringing). Its `metrics` describe the whole " +
    "export (`metrics_scope` \"frame\") and `crop_metrics` the requested box, measured at export resolution.",
  "",
  `4. Metrics. ${MEASURED}`,
  "",
  "5. Settings at begin. Pass 0 is one History step with the intent's camera profile (or `profile`), lens corrections and " +
    "priors (a numeric prior is added to the photo's value; later passes may undo any prior); without an intent it writes no profile or priors (only `profile` " +
    "when given). `target.pipeline` and `target.white_balance_unit` say how the photo's temperature and tint work " +
    "(lr_get_active_photo_context); pass 0 takes the intent's profile and priors for that pipeline (`profile.raw` or " +
    "`profile.rendered`, `priors` plus `priors_by_pipeline`). " +
    "clip_baseline (the argument, else the intent's; off by default; `clip_baseline` in the result): when on, pass 0, while " +
    "clipping is over a limit, pulls whites/highlights/exposure or blacks/shadows/exposure back in fixed steps until under, at " +
    "most 8 (\"… baseline k\"), and later passes correct clipping they did not cause. When off, clipping is measured and left " +
    "as it is, and a pass corrects only the clipping it caused. A limit still over is `unmet` in guardrail_actions. " +
    "The session's numbers (max passes, variant count, clipping limits, decay, preview size and quality) come from the " +
    "arguments, then (clipping limits only) the intent, then the user's settings page in Lightroom, then the defaults; " +
    "`session_settings` in the begin result says where each came from.",
  "",
  "Variants mode (mode \"variants\", an intent with variants; select the master, not a virtual copy): the engine makes " +
    "virtual copies \"AVG <intent> A\", \"… B\" (and \"… C\") and runs pass 0 on each with the intent's priors plus that " +
    "variant's (History \"AVG <id> A pass 0/N\"); it returns `variants` (each copy's settings and metrics) and a contact " +
    "sheet of the copies side by side as the image, and leaves the master as it is. Then one lr_step per copy " +
    "(target \"A\", …), the user picks with lr_select_variant, and the remaining passes go to the pick.",
  "",
  "6. Masks. A suggested name style is \"N. Subject - Purpose\", for example \"4. Lone Juniper - Foliage Separation\"; any " +
    "clear name works.",
  "",
  "7. Logs. lr_begin_session and lr_end_session return `log_path`, the session's provenance log; lr_get_session_log reads " +
    "it. `notes` at begin keeps the user's request in their own words in the log. `start_off_zero` in the begin result lists " +
    "the sliders found off zero when the session started: these may be import defaults or earlier edits.",
  "",
  "8. Errors. Errors are {code, message, recoverable, details?}. A recoverable error says what to do, for example " +
    "SESSION_NOT_ACTIVE names the open session in `details.open_session_id`; recoverable false means change the call first.",
].join("\n");

/** The server's instructions (MCP initialize result): a pointer to lr_help, kept short. */
export const INSTRUCTIONS =
  "LrC-AVG edits the photo selected in Lightroom Classic with native Develop settings, one measured pass at a time.\n" +
  "Call lr_help once for how sessions, passes, previews and metrics work.\n" +
  "The user's request comes first; intents and suggestions are starting points.";

export const HELP_DEFS: ToolDef[] = [
  {
    name: "lr_help",
    title: "How LrC-AVG works",
    description:
      "Explain how LrC-AVG works: sessions and session_id, what uses a pass, previews and region previews, the metrics, " +
      "Variants mode, clipping guardrails, mask names, logs and errors. Static text; touches nothing.",
    schema: noArgs,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    // Static text, so it returns here and not through Tools: the call is not in the tool log.
    run: () => Promise.resolve({ json: { help: HELP_TEXT } }),
  },
];
