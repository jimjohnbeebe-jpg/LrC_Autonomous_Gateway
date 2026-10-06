// The Deck's sent clicks, armed Abort and chosen card (hud\ui\clicks.ts; spec 5.3, Option C NOTES section 3).
import { describe, expect, it } from "vitest";
import { arm, ARM_MS, armed, choose, CLICK_WAIT_MS, disarm, FRESH, onAnswer, onState, sent, tick } from "./clicks.ts";

const at = (stage: string, extra: Record<string, string> = {}) => ({ session_id: "s1", stage, ...extra });
const started = onState(FRESH, at("converged"));

describe("a sent click", () => {
  const l = sent(started, "c1", "Accept", 0);
  it("is answered by its answer, a state naming it, or an end stage; not by another click's", () => {
    expect(onAnswer(l, "c1").pending).toBeNull();
    expect(onAnswer(l, "c2").pending).not.toBeNull();
    expect(onState(l, at("converged", { answered_click_id: "c1" })).pending).toBeNull();
    expect(onState(l, at("converged", { answered_click_id: "c0" })).pending).not.toBeNull();
    expect(onState(l, at("accepted")).pending).toBeNull();
  });
  it("is dropped by a new edit", () => {
    expect(onState(l, { session_id: "s2", stage: "begin" })).toEqual({ ...FRESH, session: "s2" });
  });
  it("gives the buttons back after 10 s, with the no-answer label", () => {
    expect(tick(l, CLICK_WAIT_MS - 1)).toBe(l);
    expect(tick(l, CLICK_WAIT_MS)).toMatchObject({ pending: null, noAnswer: "Accept" });
    expect(sent(tick(l, CLICK_WAIT_MS), "c2", "Abort", 1).noAnswer).toBeNull();
  });
});

describe("Abort armed", () => {
  it("lasts 3 s; Esc disarms; a click disarms", () => {
    const a = arm(started, 0);
    expect(armed(a, ARM_MS - 1)).toBe(true);
    expect(armed(a, ARM_MS)).toBe(false);
    expect(tick(a, ARM_MS).armedAt).toBeNull();
    expect(disarm(a).armedAt).toBeNull();
    expect(sent(a, "c1", "Abort", 1).armedAt).toBeNull();
  });
});

describe("the chosen card", () => {
  it("holds at the pick and is cleared when the pick is over", () => {
    const pick = choose(onState(FRESH, at("awaiting_pick")), "B");
    expect(onState(pick, at("awaiting_pick")).chosen).toBe("B");
    expect(onState(pick, at("awaiting_claude")).chosen).toBeNull();
  });
});
