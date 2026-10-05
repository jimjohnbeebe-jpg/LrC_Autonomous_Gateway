// hud\ui\visibility.ts: spec 2.7 rule 5 (run by `npm test -w hud`).
import { describe, expect, it } from "vitest";
import { HIDDEN, onState, onTick, onUserHide } from "./visibility.ts";

describe("the Deck's visibility", () => {
  it("shows once per edit, by itself", () => {
    let [v, c] = onState(HIDDEN, { session_id: "a" }, 0);
    expect([v.shown, c]).toEqual([true, "show"]);
    [v, c] = onState(v, { session_id: "a" }, 10);
    expect(c).toBeNull();
    [, c] = onState(v, { session_id: "b" }, 20);
    expect(c).toBe("show");
  });

  it("stays hidden after the user hid it, until the next edit", () => {
    let [v] = onState(HIDDEN, { session_id: "a" }, 0);
    let c;
    [v, c] = onUserHide(v);
    expect(c).toBe("hide");
    [v, c] = onState(v, { session_id: "a" }, 5);
    expect([v.shown, c]).toEqual([false, null]);
    [v, c] = onState(v, { session_id: "a", close_after: 10 }, 6);
    expect(v.hideAt).toBeNull();
    [v, c] = onState(v, { session_id: "b" }, 7);
    expect([v.shown, c]).toEqual([true, "show"]);
  });

  it("hides close_after seconds after an end state, unless a newer state came", () => {
    let [v] = onState(HIDDEN, { session_id: "a" }, 0);
    let c;
    [v] = onState(v, { session_id: "a", close_after: 10 }, 1000);
    [v, c] = onTick(v, 10_999);
    expect(c).toBeNull();
    [v, c] = onTick(v, 11_000);
    expect([v.shown, c]).toEqual([false, "hide"]);
    [v] = onState(HIDDEN, { session_id: "x" }, 0);
    [v] = onState(v, { session_id: "x", close_after: 10 }, 0);
    [v] = onState(v, { session_id: "x" }, 5000);
    expect(onTick(v, 60_000)[1]).toBeNull();
  });
});
