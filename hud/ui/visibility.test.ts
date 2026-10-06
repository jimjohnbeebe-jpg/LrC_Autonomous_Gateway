// hud\ui\visibility.ts: spec 2.7 rule 5 (run by `npm test -w hud`).
import { describe, expect, it } from "vitest";
import { HIDDEN, onReveal, onState, onTick, onUserHide } from "./visibility.ts";

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

  it("shows again on the menu's reveal for the edit shown, even after the user hid it; not for another edit", () => {
    let [v] = onState(HIDDEN, { session_id: "a" }, 0);
    let c;
    [v] = onUserHide(v);
    [v, c] = onReveal(v, "b", undefined, 1);
    expect([v.shown, c]).toEqual([false, null]);
    [v, c] = onReveal(v, "a", undefined, 2);
    expect([v.shown, c, v.hideAt]).toEqual([true, "show", null]);
    expect(onReveal(HIDDEN, "a", undefined, 3)[1]).toBeNull(); // no edit shown yet
  });

  it("an ended edit revealed while hidden (a menu Abort) hides again close_after seconds later", () => {
    let [v] = onState(HIDDEN, { session_id: "a" }, 0);
    let c;
    [v] = onUserHide(v);
    [v] = onState(v, { session_id: "a", close_after: 10 }, 1000); // the end state, while hidden
    expect(v.hideAt).toBeNull();
    [v, c] = onReveal(v, "a", 10, 2000);
    expect([v.shown, c, v.hideAt]).toEqual([true, "show", 12_000]);
    expect(onTick(v, 12_000)[1]).toBe("hide");
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
