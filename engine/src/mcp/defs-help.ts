// lr_help and the server instructions (engine 0.35.0, hands-on batch 1): how sessions, passes, previews and metrics work,
// in one place, so lr_begin_session's description can stay short. Mechanics only; the craft is the AI's
// [stated: Jim, 2026-10-16, "Guidance stays light ('suggested', 'for example', no numeric targets)"].
// The clip_baseline, Variants, precedence and pipeline text moved here from lr_begin_session's description.
// Item 3's "downscaling understates clipping at print size" is [inference]; "clip at export resolution" is tracked in issue #159.

import { FRAME, MEASURED, noArgs, type ToolDef } from "./defs-shared.js";
import { describeProfile } from "./profiles.js";
import { DEFAULT_LONG_EDGE, EXPORT_MAX_LONG_EDGE } from "./tools-shared.js";

export const HELP_TEXT = [
  "LrC-AVG: how it works. The mechanics are below; how to edit the photo (the craft) is left to the AI.",
  "",
  "1. Sessions. lr_begin_session starts a session on the photo selected in Lightroom and returns its session_id; every " +
    "session tool takes that session_id, which may be left out while the session is open. One session at a time: it stays open until lr_end_session (accept, revert or " +
    "abandon). The session has a pass cap, max_passes (after pass 0); `cap_reached` in an lr_step result means no pass is left.",
  "",
  "2. What uses a pass. Each lr_step, each mask create, edit or delete (lr_create_mask, lr_edit_mask, lr_delete_mask), and each lr_crop " +
    "uses one pass, an undone one included. A rename alone (lr_edit_mask with only mask_id and name) uses no pass. " +
    "lr_probe, lr_set_regions, lr_list_masks, lr_get_preview and lr_get_metrics use none. An lr_step that Lightroom takes only " +
    "in part (WRITE_NOT_TAKEN, FEATURE_UNAVAILABLE) is undone whole and uses no pass (`details.undone`). The B&W mixer " +
    "(bw.red … bw.magenta) is there only on a black-and-white photo: set a monochrome camera_profile in an earlier step.",
  "",
  `3. Previews. Session previews are ${DEFAULT_LONG_EDGE} px on the long edge by default: downscaling averages pixels, so ` +
    `they understate clipping and fine detail at print size. lr_begin_session with \`measure_long_edge\` (up to ${EXPORT_MAX_LONG_EDGE}) measures ` +
    "every render of the session at that size, clipping and guardrails included, while you still see long_edge. " +
    "lr_get_preview with `region` exports the photo " +
    "larger and returns a crop of that box, for finer detail (sharpness, noise, fringing). Its `metrics` describe the whole " +
    "export (`metrics_scope` \"frame\") and `crop_metrics` the requested box, measured at export resolution. " +
    "For browsing, lr_get_preview with `quality` \"fast\" returns Lightroom's cached preview (quick, possibly stale), and " +
    "lr_get_photo_stats measures up to 20 photos at once. A pass that changed sharpening or noise and lowered `sharpness` " +
    "markedly gets an `advisory` row (limit \"sharpness\"): look at a crop. " +
    `Every point and box a tool takes or gives (\`region\`, lr_set_regions, mask geometry, points and people's boxes) is in ${FRAME}.`,
  "",
  `4. Metrics. ${MEASURED}`,
  "",
  "5. Settings at begin. Pass 0 is one History step with the intent's camera profile (or `profile`), lens corrections and " +
    "set values and priors (a look's `set` value is written as given; a numeric prior is added to the photo's value; later passes may undo either); without an intent it writes no profile or priors (only `profile` " +
    "when given). `target.pipeline` and `target.white_balance_unit` say how the photo's temperature and tint work " +
    "(lr_get_active_photo_context); pass 0 takes the intent's profile and priors for that pipeline (`profile.raw` or " +
    "`profile.rendered`, `priors` plus `priors_by_pipeline`). " +
    "clip_baseline (the argument, else the intent's; off by default; `clip_baseline` in the result): when on, pass 0, while " +
    "clipping is over a limit, pulls whites/highlights/exposure or blacks/shadows/exposure back in fixed steps until under, at " +
    "most 8 (\"… baseline k\"), and later passes correct clipping they did not cause. When off, clipping is measured and left " +
    "as it is, and a pass corrects only the clipping it caused. A limit still over is `unmet` in guardrail_actions. " +
    "The high end counts blown tone (clip_high_tone_pct, two or more channels); clipping in one channel alone (a saturated colour) " +
    "moves no slider and is an `advisory` row naming the channel: judge it yourself, for example with that hue's HSL luminance or saturation. " +
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
  "",
  "9. An AI mask Lightroom has not finished (LIGHTROOM_STUCK, AI_UPDATE_PENDING). Lightroom's AI mask is still computing: the " +
    "session stays open and writes, renders and reverts nothing; the HUD shows the time waited (m:ss). These errors say recoverable " +
    "false, but they end when Lightroom's result shows: the session then goes on; nothing else frees it. Lightroom does not notify you: " +
    "when the user says to go on, call lr_step, lr_end_session or lr_create_mask with a linear or radial kind (not the same AI mask " +
    "again, which would add a second one); each call checks. Tell the user to wait, or to press Abort in the Deck: it puts the photo " +
    "back if the result has shown, and otherwise ends the edit as it is, says the photo was NOT put back and names the snapshot that puts it back. " +
    "Abort also works during lr_create_mask's wait (up to 5 minutes): the wait ends within a few seconds and the call fails with " +
    "SESSION_ENDED, which says the same; do not call lr_create_mask again then. Lightroom may still be finishing that mask: the user " +
    "waits until its shape shows in Lightroom before clicking the snapshot or starting a new session. " +
    "A Lightroom restart also works: the engine then puts the photo back and ends the session (later calls naming it get SESSION_ENDED). " +
    "For the rest of the session prefer linear or radial masks to AI masks. AI_MASK_FAILED (Lightroom's update over, no result " +
    "within the wait) is different: the user saves their work and restarts Lightroom.",
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
      "Variants mode, clipping guardrails, mask names, logs and errors, and the tool profile in force (`tool_profile`). Static text; touches nothing.",
    schema: noArgs,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    // Static text, so it returns here and not through Tools: the call is not in the tool log.
    run: () => Promise.resolve({ json: { help: HELP_TEXT, tool_profile: describeProfile() } }),
  },
];
