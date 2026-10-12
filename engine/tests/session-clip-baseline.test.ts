// Issue #130 item 3: pass 0's clipping baseline runs only when lr_begin_session's `clip_baseline`,
// else the intent's, asks for it (off by default); from pass 1 on, the guard corrects only an end the
// pass pushed over its limit, unless clip_baseline is on [stated: Jim, issue #130 comment
// 2026-10-11T19:26:39Z, "each pass should follow the prompt and intent"]. Against the simulated
// Lightroom in its "tonal" model (tests/helpers/session-harness.ts).

import { describe, expect, it } from "vitest";
import { hudGuardrail } from "../src/hud/index.js";
import type { GuardrailAction } from "../src/log/index.js";
import { PIPELINES } from "../src/params/index.js";
import { ID, SHORT, clean, fails, intent, lr, manager, map, useSessionHarness } from "./helpers/session-harness.js";

type Action = { kind: string; limit: string; changes: Record<string, number> };
const actionsOf = (json: Record<string, unknown>): Action[] => json["guardrail_actions"] as Action[];
const clips = (): void => {
  clean();
  Object.assign(lr.settings, { Whites2012: 0, Blacks2012: -20 }); // both ends clip in the tonal model
};

describe.each(PIPELINES)("clip_baseline (%s pipeline)", (pipeline) => {
  useSessionHarness(pipeline);

  it("pass 0 writes no correction without clip_baseline: only the profile and priors, the clipping reported unmet", async () => {
    clips();
    const out = await manager.begin({ intent_id: "test_prior" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4`]);
    expect([lr.settings["Whites2012"], lr.settings["Blacks2012"], lr.settings["Exposure2012"]]).toEqual([0, -20, 0.2]);
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe(pipeline === "raw" ? "Adobe Color" : "Color");
    expect(actionsOf(out.json).map((a) => [a.kind, a.limit])).toEqual([["unmet", "clip_high"], ["unmet", "clip_low"]]);
    expect((actionsOf(out.json)[0] as Action & { reason: string }).reason).toMatch(/; left alone \(clip_baseline off\): pass 0 corrects no clipping$/);
    expect(out.json["clip_baseline"]).toBe(false);
  });

  it("pass 0 corrects as before when lr_begin_session asks for clip_baseline", async () => {
    clips();
    const out = await manager.begin({ intent_id: "test_plain", clip_baseline: true });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4 baseline 1`]);
    expect([lr.settings["Whites2012"], lr.settings["Blacks2012"]]).toEqual([-20, 0]);
    expect(actionsOf(out.json).map((a) => [a.kind, a.limit])).toEqual([["corrected", "clip_high"], ["corrected", "clip_low"]]);
    expect(out.json["clip_baseline"]).toBe(true);
  });

  it("pass 0 corrects when the intent sets clip_baseline", async () => {
    clips();
    intent("test_baseline", { clip_baseline: true });
    await manager.begin({ intent_id: "test_baseline" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4 baseline 1`]);
  });

  it("lr_begin_session's clip_baseline false replaces the intent's true", async () => {
    clips();
    intent("test_baseline", { clip_baseline: true });
    const off = await manager.begin({ intent_id: "test_baseline", clip_baseline: false });
    expect(actionsOf(off.json).some((a) => a.kind === "corrected")).toBe(false);
    expect([lr.settings["Whites2012"], lr.settings["Blacks2012"]]).toEqual([0, -20]);
  });

  it("a step leaves an end that was over before it alone without clip_baseline: no fixed-table write", async () => {
    clean();
    lr.settings["Blacks2012"] = -20; // the dark end clips
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { highlights: -10 }, rationale: "softer highlights" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`]);
    expect(lr.settings["Blacks2012"]).toBe(-20);
    expect(actionsOf(out.json).map((a) => [a.kind, a.limit])).toEqual([["unmet", "clip_low"]]);
  });

  it("with clip_baseline, a step still corrects an end that was over before it", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain", clip_baseline: true });
    lr.settings["Blacks2012"] = -20; // Jim drags Blacks: the dark end now clips
    const out = await manager.step({ session_id: ID, settings: { highlights: -10 }, rationale: "softer highlights" });
    expect(lr.history).toContain(`AVG ${SHORT} pass 1/4 guard 1`);
    expect(actionsOf(out.json)[0]).toMatchObject({ kind: "corrected", limit: "clip_low", changes: { blacks: 0 } });
  });

  it("without clip_baseline, a step pushing towards an end already over is written, not refused; the end is reported unmet", async () => {
    clean();
    lr.settings["Whites2012"] = 0; // the bright end clips
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { vibrance: 5 }, rationale: "a little more colour" });
    expect(out.json).toMatchObject({ refused: [], applied: [expect.objectContaining({ name: "vibrance", delta: 5 })] });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`]);
    expect(actionsOf(out.json).map((a) => [a.kind, a.limit])).toEqual([["unmet", "clip_high"]]);
  });

  it("with clip_baseline, that step is refused as before", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain", clip_baseline: true });
    lr.settings["Whites2012"] = 0; // Jim drags Whites: the bright end now clips
    expect((await fails(manager.step({ session_id: ID, settings: { vibrance: 5 }, rationale: "a little more colour" }))).code).toBe("GUARDRAIL_REFUSED");
  });

  it("a step that pushes a fine end over is corrected, its own slider first, while an end over before stays", async () => {
    clean();
    lr.settings["Blacks2012"] = -20; // the dark end clips; the bright end is fine
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { whites: 20 }, rationale: "brighter whites" });
    const corrected = actionsOf(out.json).filter((a) => a.kind === "corrected");
    expect(corrected.length).toBeGreaterThan(0);
    expect(corrected.every((a) => a.limit === "clip_high" && Object.keys(a.changes).join() === "whites")).toBe(true);
    expect(lr.history[1]).toBe(`AVG ${SHORT} pass 1/4 guard 1`);
    expect(lr.settings["Blacks2012"]).toBe(-20);
    expect((out.json["metrics"] as { clip_high_pct: number }).clip_high_pct).toBeLessThanOrEqual(0.5);
    // The low end has its own reason, and the HUD names the correction, not the end left alone.
    const actions = out.json["guardrail_actions"] as Array<Action & { reason: string }>;
    expect(actions.find((a) => a.kind === "unmet")?.reason).toMatch(/^clip_low_pct is [\d.]+ %, over the limit of 1 %; left alone \(clip_baseline off\): it was [\d.]+ % before this pass$/);
    const hud = hudGuardrail({ guardrail_actions: actions as unknown as GuardrailAction[], refused: [], clamped: [] }, { clipHighPct: 0.5, clipLowPct: 1 });
    expect(hud).toMatchObject({ status: "corrected", reason: expect.stringMatching(/^Highlight clipping was .*; corrected\.$/) });
  });
});
