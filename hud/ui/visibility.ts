// When the Deck shows and hides (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7 rule 5, 3.2):
//   - it opens by itself once per edit, when a state with a new session_id arrives (decision 6, kept by
//     Q13 [stated: Jim, 2026-10-05, "Go with recommendations"]);
//   - a Deck the user hid stays hidden until the next edit;
//   - Lightroom's "Show Vision Gateway HUD" (row 5, Q4) shows it again for the edit shown, even after the
//     user hid it (the engine sends `reveal` only for the open edit, engine\src\hud\deck-menu.ts);
//   - it hides `close_after` seconds after a state that carries it (every end state: close_after 10,
//     engine\src\hud\publisher.ts END_CLOSE_S), unless a newer state came.
// Pure, so hud\ui\visibility.test.ts covers it; deck.ts carries out the changes.

export type Visibility = { session: string | null; shown: boolean; hideAt: number | null };
export type Change = "show" | "hide" | null;
export const HIDDEN: Visibility = { session: null, shown: false, hideAt: null };

const deadline = (closeAfter: number | undefined, now: number): number | null => (closeAfter ? now + closeAfter * 1000 : null);

/** A state arrived. A new edit shows the Deck (placed afresh, so "show" even when already shown). */
export function onState(v: Visibility, s: { session_id: string; close_after?: number | undefined }, now: number): [Visibility, Change] {
  const hideAt = deadline(s.close_after, now);
  if (s.session_id !== v.session) return [{ session: s.session_id, shown: true, hideAt }, "show"];
  return [{ ...v, hideAt: v.shown ? hideAt : null }, null];
}

export function onTick(v: Visibility, now: number): [Visibility, Change] {
  if (v.hideAt === null || now < v.hideAt) return [v, null];
  return [{ ...v, shown: false, hideAt: null }, v.shown ? "hide" : null];
}

/**
 * `reveal` from the engine (row 5, Q4 [stated: Jim, 2026-10-05, "Show Deck, keep keys (Recommended)"]): shown for the edit
 * shown; another edit's does nothing. `closeAfter` is the shown state's: an ended edit (a menu Abort) hides again that long
 * after the reveal, as after its end state (Greptile, PR #90).
 */
export function onReveal(v: Visibility, sessionId: string, closeAfter: number | undefined, now: number): [Visibility, Change] {
  if (sessionId !== v.session) return [v, null];
  return [{ ...v, shown: true, hideAt: deadline(closeAfter, now) ?? v.hideAt }, "show"];
}

/** The user's × (or, later, Esc with nothing open). */
export function onUserHide(v: Visibility): [Visibility, Change] {
  return [{ ...v, shown: false, hideAt: null }, v.shown ? "hide" : null];
}
