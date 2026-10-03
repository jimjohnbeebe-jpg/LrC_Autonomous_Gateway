// lr_begin_session (src/session/begin.ts) against the simulated Lightroom in its "tonal" model
// (tests/helpers/session-harness.ts): the snapshot, pass 0, the clipping baseline ("until under",
// at most 8 corrections), guardrail overrides, and a failed pass 0 that leaves the session open.

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

  it("takes pass 0's profile when Lightroom stamps its own Look version, and logs the Lightroom version (issue #67)", async () => {
    clean();
    lr.lookVersion = "18.7";
    const out = await manager.begin({ intent_id: "test_prior" });
    expect(out.json["ok"]).toBe(true);
    expect((lr.settings["Look"] as { Parameters: Record<string, unknown> }).Parameters["Version"]).toBe("18.7");
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe("Adobe Color");
    expect(readLog().lightroom).toEqual({ lrc_version: "15.5.1", sdk_declared: 13, notices: [] });
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

  it("keeps correcting in pass 0 until under, going round each end's fixed table again (PHASE4_PLAN decision 1)", async () => {
    clean();
    Object.assign(lr.settings, { Blacks2012: -60, Shadows2012: -60 }); // crushed shadows three fixed steps do not lift
    const out = await manager.begin({ intent_id: "test_plain" });
    expect(lr.history).toEqual([1, 2, 3, 4, 5, 6, 7].map((k) => `AVG ${SHORT} pass 0/4 baseline ${k}`));
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string; changes: Record<string, number> }>;
    // Shadows: blacks, shadows, exposure, then round again. The exposure steps push the highlights
    // over, which get their own table (whites, then highlights), in the same write when both breach.
    expect(actions.map((a) => [a.kind, a.limit, a.changes])).toEqual([
      ["corrected", "clip_low", { blacks: -40 }],
      ["corrected", "clip_low", { shadows: -30 }],
      ["corrected", "clip_low", { exposure: 0.3 }],
      ["corrected", "clip_high", { whites: -40, blacks: -20 }],
      ["corrected", "clip_low", { whites: -40, blacks: -20 }],
      ["corrected", "clip_low", { shadows: 0 }],
      ["corrected", "clip_low", { exposure: 0.6 }],
      ["corrected", "clip_high", { highlights: -30 }],
    ]);
    const metrics = out.json["metrics"] as { clip_high_pct: number; clip_low_pct: number };
    expect(metrics.clip_high_pct).toBeLessThanOrEqual(0.5);
    expect(metrics.clip_low_pct).toBeLessThanOrEqual(1);
  });

  it("stops pass 0 after 8 corrections and reports the limit unmet", async () => {
    clean();
    lr.settings["Exposure2012"] = -3; // far too dark for 8 fixed steps
    const out = await manager.begin({ intent_id: "test_plain" });
    expect(lr.history).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((k) => `AVG ${SHORT} pass 0/4 baseline ${k}`));
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string }>;
    expect(actions).toHaveLength(9);
    expect(actions[8]).toMatchObject({ kind: "unmet", limit: "clip_low" });
    expect(readLog().passes[0]?.guardrail_actions).toHaveLength(9);
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
