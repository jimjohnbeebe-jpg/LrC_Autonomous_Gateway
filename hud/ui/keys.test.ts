// The Deck's keys (hud\ui\keys.ts; spec 4.6, 6; Option C NOTES section 3 "Keys").
import { describe, expect, it } from "vitest";
import { command, type KeyCtx, type KeyIn } from "./keys.ts";

const k = (key: string, mods: Partial<KeyIn> = {}): KeyIn => ({ key, ctrl: false, alt: false, shift: false, ...mods });
const c = (over: Partial<KeyCtx> = {}): KeyCtx => ({ armed: false, abortOn: true, primaryOn: true, choosable: [], done: false, open: true, ...over });

describe("keys", () => {
  it("Enter presses the primary; never while armed or without one (and is swallowed, so no focused button fires)", () => {
    expect(command(k("Enter"), c())).toEqual({ do: "primary" });
    expect(command(k("Enter"), c({ armed: true }))).toEqual({ do: "swallow" });
    expect(command(k("Enter"), c({ primaryOn: false }))).toEqual({ do: "swallow" });
  });
  it("Ctrl+Backspace arms, then aborts; nothing while Abort is off", () => {
    expect(command(k("Backspace", { ctrl: true }), c())).toEqual({ do: "arm" });
    expect(command(k("Backspace", { ctrl: true }), c({ armed: true }))).toEqual({ do: "abort" });
    expect(command(k("Backspace", { ctrl: true }), c({ abortOn: false }))).toEqual({ do: "swallow" });
    expect(command(k("Backspace"), c())).toBeNull();
  });
  it("Esc never aborts: disarm, else hide at the end, else close the deck, else back to Lightroom", () => {
    expect(command(k("Escape"), c({ armed: true }))).toEqual({ do: "disarm" });
    expect(command(k("Escape"), c({ done: true }))).toEqual({ do: "hide" });
    expect(command(k("Escape"), c())).toEqual({ do: "collapse" });
    expect(command(k("Escape"), c({ open: false }))).toEqual({ do: "lightroom" });
  });
  it("1, 2, 3 choose an offered copy; arrows move between cards; nothing outside the pick", () => {
    const pick = c({ choosable: ["A", "C"] });
    expect(command(k("1"), pick)).toEqual({ do: "choose", letter: "A" });
    expect(command(k("2"), pick)).toBeNull();
    expect(command(k("3"), pick)).toEqual({ do: "choose", letter: "C" });
    expect(command(k("ArrowLeft"), pick)).toEqual({ do: "card", step: -1 });
    expect(command(k("1"), c())).toBeNull();
    expect(command(k("ArrowRight"), c())).toBeNull();
  });
  it("leaves Alt combinations, Tab and Space to the system", () => {
    expect(command(k("Enter", { alt: true }), c())).toBeNull();
    expect(command(k("Tab"), c())).toBeNull();
    expect(command(k(" "), c())).toBeNull();
  });
});
