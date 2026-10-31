// The look's parts of the begin result's intent_brief (PHASE10_PLAN "Third re-plan", rows 9+10): the session's tone mode
// and what it means (R3), the look's masks, which pass 0 does not create: the AI makes them for each photo, and its
// checks (row 12, R5), reported in every pass as look_checks.

import { TONAL_PARAMS, type ToneMode } from "../intents/index.js";
import type { Session } from "./types.js";

const TONE_NOTES: Readonly<Record<ToneMode, string | null>> = {
  set: null,
  adapt:
    `The look's tonal and presence values (${TONAL_PARAMS.join(", ")}) were written at pass 0 as a starting point: adapt them to this photo, ` +
    "toward the reference photos (`reference_gap`, in each pass when the session has references), rather than keeping the numbers.",
  auto: "Lightroom's Auto Tone set the tones at pass 0 (`auto_tone` in the result); the look's own tonal values were skipped and its other values written on top.",
};

const CHECKS_NOTE = "The look's method expects these ranges; each pass reports them in look_checks as met, not met, or null (no value). Reported only: weigh them against what you see, nothing is refused for them.";

const MASKS_NOTE = "Create each of these masks with lr_create_mask (its kind, name and sliders as starting values), then adjust it to this photo; each create uses a pass.";

/** tone_mode with its note, and the look's masks and checks with how to use them. */
export function lookBrief(s: Pick<Session, "toneMode" | "intent">): Record<string, unknown> {
  const { masks = [], checks = [] } = s.intent.intent;
  const note = TONE_NOTES[s.toneMode];
  return {
    tone_mode: s.toneMode,
    ...(note ? { tone_note: note } : {}),
    ...(masks.length > 0 ? { masks, masks_note: MASKS_NOTE } : {}),
    ...(checks.length > 0 ? { checks, checks_note: CHECKS_NOTE } : {}),
  };
}
