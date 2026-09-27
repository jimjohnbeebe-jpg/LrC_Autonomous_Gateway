// lr_begin_session (src/session/begin.ts) against the simulated Lightroom in its "tonal" model
// (tests/helpers/session-harness.ts): the snapshot, pass 0, the clipping baseline, guardrail
// overrides, and a failed pass 0 that leaves the session open.

import { describe, expect, it } from "vitest";
import { ID, SHORT, clean, fails, intent, lr, manager, map, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

describe("lr_begin_session", () => {
  it("takes a snapshot, then writes pass 0: the intent's profile and priors, a number added to the photo's value", async () => {
    clean();
    const out = await manager.begin({ intent_id: "test_prior" });
    expect(lr.snapshots.size).toBe(1);
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4`]);
    expect(lr.settings["Exposure2012"]).toBe(0.2);
    expect(lr.settings["AutoLateralCA"]).toBe(0);
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe("Adobe Color");
    expect(out.json).toMatchObject({ ok: true, session_id: ID, pass: "0/4", intent_brief: { brief: "The test_prior brief." }, guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 } });
    expect(out.json["pass0_applied"]).toContainEqual({ name: "exposure", before: 0, requested: 0.2, after: 0.2, delta: 0.2 });
    expect(out.image?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const log = readLog();
    expect(log.passes).toHaveLength(1);
    expect(log.passes[0]).toMatchObject({ n: 0, kind: "pass0", history_names: [`AVG ${SHORT} pass 0/4`] });
  });

  it("refuses a second session while one is open", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain" });
    expect((await fails(manager.begin({ intent_id: "test_plain" }))).code).toBe("SESSION_ALREADY_ACTIVE");
  });

  it("pulls clipping back under the limits in pass 0 (the baseline of PRD 6.5), in one write for both ends", async () => {
    clean();
    Object.assign(lr.settings, { Whites2012: 0, Blacks2012: -20 }); // both ends clip in the tonal model
    const out = await manager.begin({ intent_id: "test_plain" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4 baseline 1`]);
    expect(lr.settings["Whites2012"]).toBe(-20);
    expect(lr.settings["Blacks2012"]).toBe(0);
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string }>;
    expect(actions.map((a) => [a.kind, a.limit])).toEqual([["corrected", "clip_high"], ["corrected", "clip_low"]]);
    const metrics = out.json["metrics"] as { clip_high_pct: number; clip_low_pct: number };
    expect(metrics.clip_high_pct).toBeLessThanOrEqual(0.5);
    expect(metrics.clip_low_pct).toBeLessThanOrEqual(1);
  });

  it("uses the intent's guardrail overrides unless the call sets its own", async () => {
    clean();
    intent("test_loose", { guardrail_overrides: { clip_low_pct: 5 } });
    expect((await manager.begin({ intent_id: "test_loose", guardrails: { clip_high_pct: 0.3 } })).json["guardrails"]).toEqual({ clip_high_pct: 0.3, clip_low_pct: 5 });
  });

  it("keeps the session open when pass 0 fails after the snapshot, so it can be reverted", async () => {
    clean();
    lr.exportError = "disk full";
    const e = await fails(manager.begin({ intent_id: "test_prior" }));
    expect(e.details).toMatchObject({ session_id: ID });
    expect(e.message).toMatch(/still open/);
    expect(manager.current()?.id).toBe(ID);
    lr.exportError = null;
    const end = await manager.end({ session_id: ID, outcome: "revert" });
    expect(end.json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
    expect(readLog().failures[0]).toMatchObject({ stage: "begin" });
  });
});
