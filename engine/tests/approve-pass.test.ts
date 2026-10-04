// approve_each_pass (src/session/approval.ts, step.ts, pick.ts; PRD 6.2, MCP_TOOLS lr_step
// AWAITING_APPROVAL and lr_approve_pass; PHASE5_PLAN decision 4 and row 6) against the simulated
// Lightroom: pass 1 goes ahead at once, pass n+1 waits for the approval of pass n, a wait in vain
// writes nothing, lr_approve_pass releases a waiting step from outside the session's queue, and a
// Variants pick approves the pass it was picked at. The HUD's side is approve-pass-hud.test.ts.

import { describe, expect, it } from "vitest";
import type { SessionManager } from "../src/session/index.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";
import { ID, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const approveMode = (changes: Record<string, unknown> = {}): void => {
  lr.prefs = { ...defaultSimPrefs(), mode: "approve_each_pass", ...changes };
};
const step = (m: SessionManager, settings: Record<string, unknown> = { exposure: 0.2 }) => m.step({ session_id: ID, settings, rationale: "test" });
const stepCopy = (m: SessionManager, target: "A" | "B" | "C") => m.step({ session_id: ID, target, settings: { exposure: 0.1 }, rationale: "test" });
const approve = (m: SessionManager, confirmed = true) => m.approvePass({ session_id: ID, confirmed });
/** The commands sent to Lightroom, without the bridge's own. */
const commands = (): string[] => plugin.received.map((r) => r.name).filter((n) => n !== "hello" && n !== "ping");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("approve_each_pass: Converge mode", () => {
  it("pass 1 goes ahead at once; pass 2 waits in vain, writes nothing and does not use the pass", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    const first = await step(m);
    expect(first.json).toMatchObject({ pass: "1/4" });
    expect(first.json["approval"]).toBeUndefined();
    const sent = commands().length;
    const passes = readLog().passes.length;
    const e = await fails(step(m, { exposure: -0.1 }));
    expect(e).toMatchObject({ code: "AWAITING_APPROVAL", recoverable: true, details: { session_id: ID, target: "master", pass: 1 } });
    expect((e.details as { waited_ms: number }).waited_ms).toBeGreaterThanOrEqual(140);
    expect(e.message).toMatch(/^Pass 1 waits for the user's approval .*nothing was written/);
    expect(commands().length).toBe(sent); // not even a read
    const log = readLog();
    expect(log.passes.length).toBe(passes);
    expect(log.failures).toEqual([]);
    expect(m.current()?.pass).toBe("1/4");
  });

  it("an approval given before the call lets the next pass go ahead at once, and is logged", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await step(m);
    const ok = await approve(m);
    expect(ok.json).toEqual({ ok: true, session_id: ID, approved_pass: 1, next: "Call lr_step for the next pass." });
    const out = await step(m, { exposure: -0.1 });
    expect(out.json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "claude", waited_ms: 0 } });
    const log = readLog();
    expect(log.approvals).toEqual([{ at: expect.any(String), target: "master", pass: 1, by: "claude" }]);
    expect(log.passes.at(-1)).toMatchObject({ n: 2, approval: { pass: 1, by: "claude", waited_ms: 0 } });
    // Pass 2 now waits for its own approval.
    expect(await fails(step(m, { exposure: 0.1 }))).toMatchObject({ code: "AWAITING_APPROVAL", details: { pass: 2 } });
  });

  it("lr_approve_pass releases a step that is waiting for it", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 20000 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await step(m);
    const sent = commands().length;
    const started = performance.now();
    const waiting = step(m, { exposure: -0.1 });
    await pause(100);
    expect(commands().length).toBe(sent);
    const ok = await approve(m);
    expect(ok.json).toMatchObject({ approved_pass: 1, next: "The waiting lr_step goes ahead now." });
    const out = await waiting;
    expect(out.json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "claude" } });
    expect((out.json["approval"] as { waited_ms: number }).waited_ms).toBeGreaterThanOrEqual(90);
    expect(performance.now() - started).toBeLessThan(10000);
  });

  it("refuses unknown names before the wait, not after it", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 20000 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await step(m);
    const started = performance.now();
    const e = await fails(step(m, { exposur: 0.1 }));
    expect(e.code).toBe("UNKNOWN_PARAMETER");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("keeps an approval when the step it let through fails before its pass counts", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await step(m);
    await approve(m);
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", () => ({ ok: false, error: { code: "write_failed", message: "no", recoverable: false } }));
    const e = await fails(step(m, { exposure: -0.1 }));
    expect(e.code).not.toBe("AWAITING_APPROVAL");
    if (apply) plugin.handlers.set("apply_settings", apply);
    const out = await step(m, { exposure: -0.1 });
    expect(out.json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "claude", waited_ms: 0 } });
  });

  it("lr_approve_pass: refused without confirmed, when no pass waits, in autonomous mode; a repeat says so", async () => {
    clean();
    approveMode({ max_passes: 2 });
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    expect(await fails(approve(m))).toMatchObject({ code: "NOT_AWAITING_APPROVAL", message: expect.stringMatching(/no pass after pass 0 .*pass 1 needs no approval/) });
    await step(m);
    expect(await fails(approve(m, false))).toMatchObject({ code: "NOT_CONFIRMED" });
    expect(readLog().approvals).toBeUndefined();
    await approve(m);
    expect((await approve(m)).json).toMatchObject({ approved_pass: 1, already_approved: true });
    await step(m, { exposure: -0.1 });
    // Pass 2 of 2: no further pass, so nothing to approve.
    expect(await fails(approve(m))).toMatchObject({ code: "NOT_AWAITING_APPROVAL", message: expect.stringMatching(/all 2 passes are used/) });
    expect(readLog().approvals?.length).toBe(1);
  });

  it("a converged pass still waits for approval: a mask pass may follow it (masks.ts)", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    expect((await step(m, { exposure: 0.02 })).json).toMatchObject({ pass: "1/4", converged_by_metrics: true });
    expect((await approve(m)).json).toMatchObject({ approved_pass: 1 });
    expect(await fails(step(m, { exposure: 0.1 }))).toMatchObject({ code: "CONVERGED" });
  });

  it("autonomous mode (the default): no wait, no approval, and lr_approve_pass is refused", async () => {
    clean();
    const m = newManager({ approvalWaitMs: 20000 });
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await step(m);
    const out = await step(m, { exposure: -0.1 });
    expect(out.json).toMatchObject({ pass: "2/4" });
    expect(out.json["approval"]).toBeUndefined();
    expect(await fails(approve(m))).toMatchObject({ code: "NOT_AWAITING_APPROVAL", message: "This session runs in autonomous mode: its passes need no approval." });
    expect(readLog().approvals).toBeUndefined();
  });
});

describe("approve_each_pass: Variants mode", () => {
  it("the copies' refined passes need no approval; the pick approves the pass it was picked at", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_variants", mode: "variants", return_image: "none" });
    await stepCopy(m, "A");
    await stepCopy(m, "B");
    await stepCopy(m, "C");
    expect(await fails(approve(m))).toMatchObject({ code: "NOT_AWAITING_APPROVAL", message: expect.stringMatching(/no copy is picked yet/) });
    await m.selectVariant({ session_id: ID, variant: "B" });
    expect(readLog().approvals).toEqual([{ at: expect.any(String), target: "B", pass: 1, by: "pick" }]);
    const out = await step(m, { exposure: 0.1 });
    expect(out.json).toMatchObject({ target: "B", pass: "2/4", approval: { pass: 1, by: "pick", waited_ms: 0 } });
    expect(await fails(step(m, { exposure: -0.1 }))).toMatchObject({ code: "AWAITING_APPROVAL", details: { target: "B", pass: 2 } });
  });

  it("a copy picked before its refined pass takes that pass at once, then waits", async () => {
    clean();
    approveMode();
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ intent_id: "test_variants", mode: "variants", return_image: "none" });
    await m.selectVariant({ session_id: ID, variant: "A" });
    expect(readLog().approvals).toBeUndefined();
    expect((await step(m, { exposure: 0.1 })).json).toMatchObject({ target: "A", pass: "1/4" });
    expect(await fails(step(m, { exposure: -0.1 }))).toMatchObject({ code: "AWAITING_APPROVAL", details: { target: "A", pass: 1 } });
  });
});
