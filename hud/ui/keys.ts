// The Deck's keys, only while it has the keyboard (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md
// 4.6, 6; Option C docs\hud\option-c\NOTES.md section 3 "Keys"). Nothing is global: without focus every
// key stays Lightroom's. Tab, Shift+Tab and Space are the browser's own (focus order is the page's
// order; Space presses the focused button).
//   - Enter presses the turn's primary, never the focused button, so a reflex Enter on a focused Abort
//     cannot abort; it does nothing while Abort is armed.
//   - Ctrl+Backspace arms Abort; again within 3 s aborts (hud\ui\clicks.ts ARM_MS).
//   - Esc disarms; else hides the Deck at the end of an edit; else closes the opened deck; else hands
//     the keyboard back to Lightroom. It never aborts.
//   - 1, 2, 3 choose copy A, B, C at the pick; Left and Right move between the cards (focus is not a choice).
// Pure, so hud\ui\keys.test.ts covers it; deck.ts carries out the command.
import type { Letter } from "./clicks.ts";

export type KeyIn = { key: string; ctrl: boolean; alt: boolean; shift: boolean };
export type KeyCtx = { armed: boolean; abortOn: boolean; primaryOn: boolean; choosable: Letter[]; done: boolean; open: boolean };
export type Command =
  | { do: "primary" | "arm" | "abort" | "disarm" | "hide" | "collapse" | "lightroom" | "swallow" }
  | { do: "choose"; letter: Letter }
  | { do: "card"; step: -1 | 1 };

const LETTERS: Record<string, Letter> = { "1": "A", "2": "B", "3": "C" };

export function command(k: KeyIn, c: KeyCtx): Command | null {
  if (k.alt) return null;
  if (k.key === "Enter") return c.primaryOn && !c.armed ? { do: "primary" } : { do: "swallow" };
  if (k.key === "Backspace" && k.ctrl) {
    if (!c.abortOn) return { do: "swallow" };
    return c.armed ? { do: "abort" } : { do: "arm" };
  }
  if (k.key === "Escape") {
    if (c.armed) return { do: "disarm" };
    if (c.done) return { do: "hide" };
    return c.open ? { do: "collapse" } : { do: "lightroom" };
  }
  if (k.ctrl || k.shift) return null;
  const letter = LETTERS[k.key];
  if (letter !== undefined) return c.choosable.includes(letter) ? { do: "choose", letter } : null;
  if (c.choosable.length > 0 && (k.key === "ArrowLeft" || k.key === "ArrowRight")) return { do: "card", step: k.key === "ArrowLeft" ? -1 : 1 };
  return null;
}
