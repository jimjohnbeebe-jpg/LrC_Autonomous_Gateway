// lr_step (src/session/step.ts, guardrail.ts) against the simulated Lightroom in its "tonal" model
// (tests/helpers/session-harness.ts): decay, both guardrails, the undo of a step still over a
// clipping limit, convergence, the pass cap, a changed
// selection, the before/after image, the operation queue, a render made stale by an edit in
// Lightroom, and the session id when the day's log name is taken.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { PreviewService } from "../src/preview/index.js";
import { SessionManager } from "../src/session/index.js";
import { ID, SHORT, clean, client, fails, logDir, logFile, lr, manager, map, readLog, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

describe("lr_step", () => {
  beforeEach(() => clean());

  it("adds each change, capped at the base maximum x decay, as one named History step per pass", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const one = await manager.step({ session_id: ID, settings: { shadows: 100 }, rationale: "open the shadows" });
    expect(one.json).toMatchObject({ pass: "1/4", applied: [{ name: "shadows", before: 0, after: 60, delta: 60 }], clamped: [expect.objectContaining({ name: "shadows", applied: 60 })] });
    const two = await manager.step({ session_id: ID, settings: { shadows: -100 }, rationale: "too much" });
    expect(two.json).toMatchObject({ pass: "2/4", applied: [{ name: "shadows", before: 60, after: 24, delta: -36 }] });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`, `AVG ${SHORT} pass 2/4`]);
    expect(two.json["delta_metrics"]).toMatchObject({ luma_mean: expect.any(Number) });
  });

  it("refuses a change that pushes into a limit already reached, and writes nothing when all are refused", async () => {
    lr.settings["Exposure2012"] = -0.5; // no pixel near 253, JPEG artefacts included, so 0 % is reached, not exceeded
    await manager.begin({ intent_id: "test_plain", guardrails: { clip_high_pct: 0 } });
    const steps = lr.history.length; // pass 0 may lift the (now crushed) dark end first
    const e = await fails(manager.step({ session_id: ID, settings: { exposure: 0.3 }, rationale: "brighter" }));
    expect(e.code).toBe("GUARDRAIL_REFUSED");
    expect(lr.history).toHaveLength(steps);
    const out = await manager.step({ session_id: ID, settings: { exposure: 0.3, shadows: 10 }, rationale: "brighter" });
    expect(out.json).toMatchObject({ pass: "1/4", refused: [expect.objectContaining({ name: "exposure" })], applied: [expect.objectContaining({ name: "shadows" })] });
  });

  it("answers NO_CHANGE, not GUARDRAIL_REFUSED, when only a slider's own limits leave nothing to do", async () => {
    lr.settings["Highlights2012"] = -100;
    await manager.begin({ intent_id: "test_plain" });
    const e = await fails(manager.step({ session_id: ID, settings: { highlights: -10 }, rationale: "darker highlights" }));
    expect(e.code).toBe("NO_CHANGE");
    expect(e.message).toMatch(/no change is left/);
  });

  it("pulls back the slider that broke a limit: half, then all (the actual guardrail)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { exposure: 1 }, rationale: "much brighter" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`, `AVG ${SHORT} pass 1/4 guard 1`, `AVG ${SHORT} pass 1/4 guard 2`]);
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; changes: Record<string, number> }>;
    expect(actions.map((a) => [a.kind, a.changes])).toEqual([
      ["corrected", { exposure: 0.5 }],
      ["corrected", { exposure: 0 }],
    ]);
    expect((out.json["metrics"] as { clip_high_pct: number }).clip_high_pct).toBeLessThanOrEqual(0.5);
    expect(readLog().passes[1]?.guardrail_actions).toHaveLength(2);
  });

  it("undoes a step still over a limit after its 3 corrections when the photo was within it before (PHASE4_PLAN decision 1)", async () => {
    lr.settings["Whites2012"] = -10; // bright, but within the limits
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    // Warming clips the red channel in the tonal model; temperature is not a slider the pull-back
    // knows, and the three fixed steps do not bring it back under.
    const out = await manager.step({ session_id: ID, settings: { temperature: 1500 }, rationale: "much warmer" });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`, ...[1, 2, 3].map((k) => `AVG ${SHORT} pass 1/4 guard ${k}`), `AVG ${SHORT} pass 1/4 clip revert`]);
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string; reason: string }>;
    expect(actions.map((a) => [a.kind, a.limit])).toEqual([
      ["corrected", "clip_high"],
      ["corrected", "clip_high"],
      ["corrected", "clip_high"],
      ["unmet", "clip_high"],
      ["reverted", "clip_high"],
    ]);
    expect(actions[4]?.reason).toMatch(/before the pass/);
    for (const key of ["Temperature", "Whites2012", "Highlights2012", "Exposure2012"]) expect(lr.settings[key]).toBe(before[key]);
    expect((out.json["metrics"] as { clip_high_pct: number }).clip_high_pct).toBeLessThanOrEqual(0.5);
    const log = readLog();
    expect(log.passes[1]?.metrics_after.clip_high_pct).toBeLessThanOrEqual(0.5);
    expect(out.json["pass"]).toBe("1/4");
  });

  it("does not undo a step when the photo was already over the limit before it", async () => {
    lr.settings["Exposure2012"] = -5; // neither pass 0 nor the step can lift it under the shadow limit
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { temperature: 500 }, rationale: "warmer" });
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string }>;
    expect(actions.map((a) => [a.kind, a.limit]).at(-1)).toEqual(["unmet", "clip_low"]);
    expect(actions.some((a) => a.kind === "reverted")).toBe(false);
    expect(lr.history.at(-1)).not.toMatch(/revert/);
  });

  it("reports converged_by_metrics after a step too small to move the metrics, then refuses further steps", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { exposure: 0.02 }, rationale: "a touch" });
    expect(out.json).toMatchObject({ converged_by_metrics: true, passes_left: 0 });
    expect((await fails(manager.step({ session_id: ID, settings: { exposure: 0.02 }, rationale: "again" }))).code).toBe("CONVERGED");
  });

  it("stops at the pass cap", async () => {
    await manager.begin({ intent_id: "test_plain", max_passes: 1 });
    expect((await manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" })).json).toMatchObject({ pass: "1/1", cap_reached: true });
    expect((await fails(manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" }))).code).toBe("CAP_REACHED");
  });

  it("writes nothing when another photo is selected, and keeps the session open (PRD 6.13)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    lr.selected = "OTHER-UUID";
    const e = await fails(manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" }));
    expect(e).toMatchObject({ code: "TARGET_CHANGED", recoverable: true });
    expect(lr.history).toEqual([]);
    lr.selected = lr.uuid;
    expect((await manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" })).json["pass"]).toBe("1/4");
  });

  it("refuses unknown names before writing, and reports a value Lightroom did not take", async () => {
    await manager.begin({ intent_id: "test_plain" });
    expect((await fails(manager.step({ session_id: ID, settings: { exposur: 0.2 }, rationale: "r" }))).code).toBe("UNKNOWN_PARAMETER");
    expect(lr.history).toEqual([]);
    lr.ignored.add("Shadows2012");
    const e = await fails(manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    expect(manager.current()?.id).toBe(ID);
    expect(readLog().failures.map((f) => f.error.code)).toEqual(["WRITE_NOT_TAKEN"]);
  });

  it("returns the previous and the new preview in one labelled image with before_after", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r", return_image: "before_after" });
    const meta = await sharp(out.image as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1169, 2 * (18 + 779) + 4]);
    const none = await manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r", return_image: "none" });
    expect(none.image).toBeUndefined();
  });

  it("runs steps sent at the same time one after the other, each with its own pass number (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const [a, b] = await Promise.all([
      manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "one" }),
      manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "two" }),
    ]);
    expect([a.json["pass"], b.json["pass"]]).toEqual(["1/4", "2/4"]);
    expect(lr.history).toEqual([`AVG ${SHORT} pass 1/4`, `AVG ${SHORT} pass 2/4`]);
    expect(lr.settings["Shadows2012"]).toBe(20);
  });

  it("renders again before a step when the photo was edited in Lightroom since the last render (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    lr.settings["Exposure2012"] = 1; // Jim drags Exposure: the right end now clips
    const out = await manager.step({ session_id: ID, settings: { exposure: 0.3, shadows: 10 }, rationale: "r" });
    expect(out.json["metrics_refreshed"]).toMatch(/rendered again/);
    expect(out.json["refused"]).toEqual([expect.objectContaining({ name: "exposure", by: "guardrail" })]);
    // The pass's "before" is the refreshed render (clipping), not pass 0's (none).
    const log = readLog();
    expect(log.passes[0]?.metrics_after.clip_high_pct).toBeLessThanOrEqual(0.5);
    expect(log.passes[1]?.metrics_before?.clip_high_pct).toBeGreaterThan(0.5);
  });

  it("picks a new session id when the log name for the day is taken (Greptile, PR #23)", async () => {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logFile(), "{}", "utf8"); // another session's log with the same 6 hex digits
    const ids = [ID, "123456ab-0000-0000-0000-000000000000"];
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    const other = new SessionManager({
      client,
      map,
      intents: new IntentLibrary({ map, userDir }),
      render: (r) => previews.render({ longEdge: r.longEdge, quality: r.quality, targetUuid: r.targetUuid, regions: r.regions }),
      logDir,
      engineVersion: "test",
      newId: () => ids.shift() ?? "ffffffff-0000-0000-0000-000000000000",
    });
    const out = await other.begin({ intent_id: "test_plain" });
    expect(out.json["session_id"]).toBe("123456ab-0000-0000-0000-000000000000");
    expect(readFileSync(logFile(), "utf8")).toBe("{}");
  });

  it("refuses a session id that is not the open one", async () => {
    expect((await fails(manager.step({ session_id: "nope", settings: { shadows: 1 }, rationale: "r" }))).code).toBe("SESSION_NOT_ACTIVE");
  });
});
