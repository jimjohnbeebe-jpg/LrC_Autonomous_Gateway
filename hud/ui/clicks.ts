// What the Deck keeps between the engine's states (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md
// 5.3, Option C docs\hud\option-c\NOTES.md section 3):
//   - a sent click keeps every button off until its answer (`answer`, or a state's answered_click_id),
//     a new edit, an end stage, or CLICK_WAIT_MS; then the buttons come back with the no-answer line
//     (the classic HUD's 10 s, plugin\LrC-AVG.lrplugin\HudState.lua:30 PENDING_SECONDS);
//   - the first Ctrl+Backspace arms Abort; a second within ARM_MS aborts; Esc or ARM_MS disarms;
//   - a chosen copy card (Q11: choosing is local and changeable, "Continue on copy X" sends the pick),
//     cleared when the edit leaves awaiting_pick or a new edit starts.
// Pure, so hud\ui\clicks.test.ts covers it; deck.ts carries it.

export const CLICK_WAIT_MS = 10_000;
export const ARM_MS = 3000;
const END_STAGES = ["accepted", "aborted", "ended"];

export type Letter = "A" | "B" | "C";
export type Local = {
  session: string | null;
  pending: { id: string; label: string; at: number } | null;
  /** The label of the click that got no answer, until the next click or edit. */
  noAnswer: string | null;
  armedAt: number | null;
  chosen: Letter | null;
};
export const FRESH: Local = { session: null, pending: null, noAnswer: null, armedAt: null, chosen: null };

type StateLike = { session_id: string; stage: string; answered_click_id?: string | undefined };

export function onState(l: Local, s: StateLike): Local {
  if (s.session_id !== l.session) return { ...FRESH, session: s.session_id };
  const answered = l.pending !== null && (s.answered_click_id === l.pending.id || END_STAGES.includes(s.stage));
  return {
    ...l,
    pending: answered ? null : l.pending,
    chosen: s.stage === "awaiting_pick" ? l.chosen : null,
    armedAt: END_STAGES.includes(s.stage) ? null : l.armedAt,
  };
}

export function onAnswer(l: Local, clickId: string): Local {
  return l.pending?.id === clickId ? { ...l, pending: null } : l;
}

export function sent(l: Local, id: string, label: string, now: number): Local {
  return { ...l, pending: { id, label, at: now }, noAnswer: null, armedAt: null };
}

/** Timeouts; returns the same object when nothing changed, so the caller can skip a redraw. */
export function tick(l: Local, now: number): Local {
  let next = l;
  if (l.pending && now - l.pending.at >= CLICK_WAIT_MS) next = { ...next, pending: null, noAnswer: l.pending.label };
  if (l.armedAt !== null && now - l.armedAt >= ARM_MS) next = { ...next, armedAt: null };
  return next;
}

export const arm = (l: Local, now: number): Local => ({ ...l, armedAt: now });
export const disarm = (l: Local): Local => (l.armedAt === null ? l : { ...l, armedAt: null });
export const armed = (l: Local, now: number): boolean => l.armedAt !== null && now - l.armedAt < ARM_MS;
export const choose = (l: Local, letter: Letter): Local => ({ ...l, chosen: letter });
