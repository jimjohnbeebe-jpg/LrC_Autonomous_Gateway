// The Deck's state table (spec docs\hud\lrc-avg-hud-spec-v2.md 5.2, 5.3, 6; hud\ui\view.ts), driven by
// states the engine's own schema accepts (engine\src\hud\channel-protocol.ts).
import { describe, expect, it } from "vitest";
import { hudChannelStateSchema, type HudChannelState } from "../../engine/src/hud/channel-protocol.ts";
import { arm, choose, FRESH, onState, sent, type Local } from "./clicks.ts";
import * as T from "./text.ts";
import { primary, view, type Ctx, type View } from "./view.ts";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({ connected: true, gone: false, focus: false, open: true, now: 1000, marks: {}, ...over });
const base = { session_id: "s1", mode: "converge", pass: 2, max_passes: 6, target: { uuid: "P1", filename: "f.NEF", iso: 100, shutter: "1/250 s", aperture: "f/8" }, lightroom: "connected", snapshot: "AVG pre-session X" };
const st = (over: Record<string, unknown> = {}): HudChannelState => hudChannelStateSchema.parse({ ...base, stage: "awaiting_claude", ...over });
const copies = ["A", "B", "C"].map((letter) => ({ letter, label: "natural", copy_name: `AVG intent ${letter}`, uuid: `U${letter}`, pass: 1, guardrail: { status: "green" } }));
const variants = (over: Record<string, unknown> = {}): HudChannelState => st({ mode: "variants", stage: "awaiting_pick", variants: ["A", "B", "C"], copies, ...over });
const local = (s: HudChannelState, f: (l: Local) => Local = (l) => l): Local => f(onState(FRESH, s));
const show = (s: HudChannelState, l: Local = local(s), c: Ctx = ctx()): View => view(s, l, c);
const primaries = (v: View) => v.actions.filter((a) => a.kind === "primary");
const ids = (v: View) => v.actions.map((a) => `${a.id}:${a.kind}:${a.on ? "on" : "off"}`);

describe("spec 5.2, in its order", () => {
  it("an end stage is Done, with no actions", () => {
    for (const [stage, words] of [["accepted", T.HEADLINE.accepted], ["aborted", T.HEADLINE.aborted], ["ended", T.HEADLINE.ended]] as const) {
      const v = show(st({ stage, close_after: 10 }), undefined, ctx({ connected: false }));
      expect([v.phase, v.sentence, v.actions.length, v.closeOnly]).toEqual(["done", words, 0, true]);
    }
    // After an Abort the photo is back: no "To undo it" line.
    expect(show(st({ stage: "aborted", close_after: 10 })).way).toBe("");
    expect(show(st({ stage: "accepted", close_after: 10 })).way).toBe(`${T.UNDO}AVG pre-session X`);
  });

  it("Lightroom down (1b): not running, every action off, the undo line", () => {
    const v = show(st({ lightroom: "down" }));
    expect([v.phase, v.sentence, v.centre, v.offLine, v.putBack]).toEqual(["problem", T.HEADLINE.not_running, "way", T.LINE.offConnected, null]);
    expect(v.actions.every((a) => !a.on)).toBe(true);
    expect(v.way).toBe(`${T.UNDO}AVG pre-session X`);
  });

  it("Claude not connected (6): the undo line and the way to the plugin's Put back (D5)", () => {
    const v = show(st({ stage: "converged" }), undefined, ctx({ connected: false }));
    expect([v.phase, v.sentence, v.putBack, v.offLine]).toEqual(["problem", T.HEADLINE.not_connected, T.PUT_BACK_PATH, T.LINE.offConnected]);
    expect(v.actions.every((a) => !a.on)).toBe(true);
    expect(show(st({ snapshot: undefined }), undefined, ctx({ connected: false })).way).toBe(T.UNDO + T.UNDO_NO_SNAPSHOT);
  });

  it("the edit gone (8)", () => {
    expect(show(st(), undefined, ctx({ gone: true })).sentence).toBe(T.HEADLINE.gone);
  });

  it("a sent click (5.3): the working ring, the click line, every action off until the answer", () => {
    const s = st({ stage: "converged" });
    const v = show(s, local(s, (l) => sent(l, "c1", "Accept", 0)));
    expect([v.phase, v.sentence, v.offLine]).toEqual(["working", T.clickSent("Accept"), T.LINE.offAnswer]);
    expect(v.actions.every((a) => !a.on)).toBe(true);
  });

  it("approve (10): Approve pass n is the one primary; Accept and Abort as a compact pair", () => {
    const v = show(st({ stage: "awaiting_approval", approve_pass: 1 }));
    expect(v.sentence).toBe(T.approveHeadline(1));
    expect(ids(v)).toEqual(["approve:primary:on", "accept:compact:on", "abort:compact:on"]);
    expect(primaries(v)[0]?.line).toBe(T.LINE.approve(1));
  });

  it("the pick (9), opened: cards, no primary until a card is chosen, no Accept", () => {
    const s = variants();
    const v = show(s);
    expect([v.sentence, v.centre, v.pickHint]).toEqual([T.HEADLINE.awaiting_pick, "cards", T.PICK.click]);
    expect(ids(v)).toEqual(["abort:abort:on"]);
    expect(v.actions[0]?.line).toBe(T.LINE.abortCopies);
    expect(v.cards.map((c) => [c.letter, c.on, c.chosen])).toEqual([["A", true, false], ["B", true, false], ["C", true, false]]);
    expect(show(s, undefined, ctx({ focus: true })).pickHint).toBe(T.PICK.keys);
    const chosen = show(s, local(s, (l) => choose(l, "B")));
    expect(ids(chosen)).toEqual(["continue:primary:on", "abort:abort:on"]);
    expect(chosen.actions[0]?.label).toBe(T.continueLabel("B"));
    expect(chosen.pickHint).toBeNull();
    expect(chosen.cards.find((c) => c.letter === "B")?.chosen).toBe(true);
  });

  it("the pick as the bar: Show the copies is the primary, and it stays on", () => {
    const v = show(variants(), undefined, ctx({ open: false }));
    expect(ids(v)).toEqual(["show_copies:primary:on", "abort:abort:on"]);
    expect(show(variants(), undefined, ctx({ open: false, connected: false })).actions[0]?.on).toBe(true);
  });

  it("a copy only offered by the engine is choosable; a choice outside it gives no Continue", () => {
    const s = variants({ variants: ["A", "C"] });
    const v = show(s, local(s, (l) => choose(l, "B")));
    expect(v.cards.map((c) => c.on)).toEqual([true, false, true]);
    expect(primaries(v)).toEqual([]);
  });

  it("converged (11) and the cap (Q6): Accept is the one primary", () => {
    expect(ids(show(st({ stage: "converged" })))).toEqual(["accept:primary:on", "abort:abort:on"]);
    const cap = show(st({ pass: 6, cap_reached: true }));
    expect([cap.phase, cap.sentence]).toEqual(["turn", T.capHeadline(6)]);
    expect(ids(cap)).toEqual(["accept:primary:on", "abort:abort:on"]);
    const picked = show(st({ stage: "converged", mode: "variants", picked: "B", copies }));
    expect(primaries(picked)[0]?.line).toBe(T.LINE.acceptCopy("B"));
  });

  it("target changed (12): no primary", () => {
    const v = show(st({ stage: "target_changed" }));
    expect([v.phase, v.sentence]).toEqual(["turn", T.HEADLINE.target_changed]);
    expect(primaries(v)).toEqual([]);
  });

  it("working (13-18): Accept quiet, off in Variants before a pick", () => {
    const v = show(st({ stage: "applying" }));
    expect([v.phase, v.sentence, v.line2]).toEqual(["working", T.HEADLINE.working, "Applying pass 2 of 6"]);
    expect(ids(v)).toEqual(["accept:quiet:on", "abort:abort:on"]);
    expect(show(st({ stage: "metrics" })).line2).toBe("Measuring the preview · pass 2 of 6");
    const unpicked = show(st({ mode: "variants", copies, stage: "metrics" }));
    expect(unpicked.actions[0]?.on).toBe(false);
    expect(unpicked.actions[0]?.tip).toBe(T.LINE.offPick);
  });

  it("a note at awaiting_claude becomes the sentence, and is not repeated below it", () => {
    const v = show(st({ note: "Picked B: Claude continues on copy B at its next call." }));
    expect([v.phase, v.sentence]).toEqual(["info", "Picked B: Claude continues on copy B at its next call."]);
    expect(v.band).not.toContain(v.sentence);
  });
});

describe("spec 5.3 and 6", () => {
  it("every state has one primary or none", () => {
    const states = [st(), st({ stage: "converged" }), st({ stage: "awaiting_approval", approve_pass: 2 }), variants(), st({ cap_reached: true }), st({ stage: "target_changed" })];
    for (const s of states) for (const open of [true, false]) expect(primaries(show(s, undefined, ctx({ open }))).length).toBeLessThanOrEqual(1);
  });

  it("an armed Abort reads 'Press again to abort'; Enter presses nothing while armed", () => {
    const s = st({ stage: "converged" });
    const v = show(s, local(s, (l) => arm(l, 900)));
    expect(v.actions.find((a) => a.id === "abort")).toMatchObject({ label: T.LABEL.armed, line: T.LINE.armed });
    expect(primary(v, true)).toBeNull();
    expect(primary(v, false)?.id).toBe("accept");
  });

  it("the target-changed line, built as HudState.targetChangedLine", () => {
    const v = show(st({ selection: { uuid: "X", name: "other.NEF", in_edit: false } }));
    expect(v.band[0]).toBe("Target changed: other.NEF is selected. Select f.NEF again; the edit is still open.");
    const none = show(variants({ selection: { uuid: null, name: null, in_edit: false } }));
    expect(none.band[0]).toBe("Target changed: No photo is selected. Claude's next call selects the edit's photo again; the edit is still open.");
  });

  it("the photo's identity, and a copy's name after the pick", () => {
    expect(show(st({ stage: "converged" })).line2).toBe("f.NEF · ISO 100 · 1/250 s · f/8");
    expect(show(st({ stage: "converged", target: { uuid: "UB", filename: "f.NEF", copy_name: "AVG intent B" } })).line2).toBe("f.NEF / AVG intent B");
  });

  it("the way back: the undo line in Converge, the copies line in Variants", () => {
    expect(show(variants()).way).toBe(T.copiesLine("AVG intent A", "C"));
  });

  it("the timeline: the current pass not yet done while it is applied; marks in Converge only", () => {
    expect(show(st({ stage: "applying" }), undefined, ctx({ marks: { 1: "green" } })).timeline).toMatchObject({ max: 6, current: 2, done: 1, marks: { 1: "green" }, label: "pass 2 of 6" });
    expect(show(variants(), undefined, ctx({ marks: { 1: "green" } })).timeline).toMatchObject({ marks: {}, label: "pass 2 · 3 copies" });
  });
});

describe("words (spec 10)", () => {
  const FORBIDDEN = /\b(session|engine|stage|seq|payload)\b/i;
  const all = (x: unknown): string[] =>
    typeof x === "string" ? [x] : typeof x === "function" ? [String((x as (...a: unknown[]) => unknown)(1, "B", "f.NEF"))] : x && typeof x === "object" ? Object.values(x).flatMap(all) : [];
  it("no engine words in any of the Deck's strings ('pre-session' is the snapshot's own name)", () => {
    const words = all(T).map((s) => s.replace(/pre-session/g, ""));
    expect(words.length).toBeGreaterThan(40);
    expect(words.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });
});
