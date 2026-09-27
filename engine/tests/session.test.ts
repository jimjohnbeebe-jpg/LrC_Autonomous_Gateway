// The session loop (src/session/manager.ts) against the simulated Lightroom in its "tonal" model
// (tests/helpers/lightroom-sim.ts): pass 0, the baseline, decay, both guardrails, convergence, the
// pass cap, a changed selection, probes, regions, accept (log, recipe, AC-5 replay) and revert.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { dayStamp, recipeSchema, sessionLogSchema } from "../src/log/index.js";
import { toToolError, type ToolError } from "../src/mcp/errors.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { SessionManager, type SessionOutput } from "../src/session/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim, luaize } from "./helpers/lightroom-sim.js";

const map = loadDefaultParamMap();
const ID = "abcdef12-3456-7890-abcd-ef1234567890";
const SHORT = "abcdef";

let tmp: string;
let logDir: string;
let userDir: string;
let plugin: FakePlugin;
let lr: LightroomSim;
let client: BridgeClient;
let manager: SessionManager;

const intent = (id: string, extra: Record<string, unknown> = {}): void => {
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, `${id}.json`), JSON.stringify({ id, label: id, category: "test", brief: `The ${id} brief.`, priors: {}, ...extra }), "utf8");
};

/** A photo whose render clips at neither end (the tonal model with whites -20 and blacks +20). */
const clean = (): void => {
  Object.assign(lr.settings, { Exposure2012: 0, Whites2012: -20, Blacks2012: 20, Highlights2012: 0, Shadows2012: 0, Contrast2012: 0 });
};

/** The error a failed call reaches Claude as (Tools.run maps it the same way). */
const fails = async (p: Promise<SessionOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};

const newManager = (): SessionManager => {
  const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
  return new SessionManager({
    client,
    map,
    intents: new IntentLibrary({ map, userDir }),
    render: (r) => previews.render({ longEdge: r.longEdge, quality: r.quality, targetUuid: r.targetUuid, regions: r.regions }),
    logDir,
    engineVersion: "test",
    newId: () => ID,
  });
};

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-session-"));
  logDir = path.join(tmp, "logs");
  userDir = path.join(tmp, "intents");
  mkdirSync(path.join(tmp, "previews"));
  plugin = await FakePlugin.start();
  lr = new LightroomSim(path.join(tmp, "previews"));
  lr.renderModel = "tonal";
  lr.install(plugin);
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  client.start();
  await client.waitConnected(2000);
  intent("test_plain", { allow_probe: true });
  intent("test_prior", { default_camera_profile: "Adobe Color", priors: { exposure: 0.2, "lens.ca_remove": 0 } });
  manager = newManager();
});

afterEach(async () => {
  client.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

const logFile = (): string => path.join(logDir, `${dayStamp(new Date())}-${SHORT}.json`);
const readLog = () => sessionLogSchema.parse(JSON.parse(readFileSync(logFile(), "utf8")));

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

  it("refuses a session id that is not the open one", async () => {
    expect((await fails(manager.step({ session_id: "nope", settings: { shadows: 1 }, rationale: "r" }))).code).toBe("SESSION_NOT_ACTIVE");
  });
});

describe("lr_probe and lr_set_regions", () => {
  beforeEach(() => clean());

  it("probes sliders, puts the photo back, and records the slopes", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    const out = await manager.probe({ session_id: ID, sliders: ["exposure", "shadows"], magnitude: 0.5 });
    expect(lr.history).toEqual([`AVG ${SHORT} probe exposure`, `AVG ${SHORT} probe shadows`, `AVG ${SHORT} probe revert`]);
    expect(lr.settings["Exposure2012"]).toBe(before["Exposure2012"]);
    expect(lr.settings["Shadows2012"]).toBe(before["Shadows2012"]);
    const results = out.json["results"] as Array<{ name: string; delta_applied: number; per_unit: { luma_mean: number } }>;
    expect(results.map((r) => [r.name, r.delta_applied])).toEqual([["exposure", 0.5], ["shadows", 30]]);
    expect(results[0]?.per_unit.luma_mean).toBeGreaterThan(20); // the model adds 40 levels per EV, less the clipped end
    expect(readLog().probes).toHaveLength(1);
  });

  it("refuses to probe when the intent does not allow it", async () => {
    await manager.begin({ intent_id: "test_prior" });
    expect((await fails(manager.probe({ session_id: ID, sliders: ["exposure"] }))).code).toBe("PROBE_NOT_ALLOWED");
  });

  it("measures regions from now on, and undoes a pass that drifts a preserved region", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const set = await manager.setRegions({ session_id: ID, regions: [{ kind: "custom", label: "orange", box: { x: 0, y: 0.5, w: 1, h: 0.5 }, preserve: true }] });
    const region = (set.json["regions"] as Array<{ label: string; hue_mean: number }>)[0];
    expect(region?.label).toBe("orange");
    expect(Math.abs((region?.hue_mean ?? 0) - 30)).toBeLessThan(3);
    const kept = await manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    expect((kept.json["metrics"] as { regions: Array<{ label: string }> }).regions.map((r) => r.label)).toEqual(["orange"]);
    const out = await manager.step({ session_id: ID, settings: { temperature: 1000 }, rationale: "warmer" });
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string; reason: string }>;
    expect(actions.at(-1)).toMatchObject({ kind: "reverted", limit: "region" });
    expect(actions.at(-1)?.reason).toMatch(/region "orange" drifted/);
    expect(lr.settings["Temperature"]).toBe(5500);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 2/4 region revert`);
    expect(readLog().regions[0]).toMatchObject({ label: "orange", preserve: true, baseline: { hue_mean: expect.any(Number) } });
  });

  it("refuses bad or duplicate region boxes", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const box = { x: 0.8, y: 0, w: 0.5, h: 0.5 };
    expect((await fails(manager.setRegions({ session_id: ID, regions: [{ kind: "sky", label: "a", box }] }))).code).toBe("INVALID_ARGUMENTS");
    const ok = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const dup = [{ kind: "sky" as const, label: "a", box: ok }, { kind: "sky" as const, label: "a", box: ok }];
    expect((await fails(manager.setRegions({ session_id: ID, regions: dup }))).message).toMatch(/labels must differ/);
  });
});

describe("lr_end_session and the log", () => {
  beforeEach(() => clean());

  it("accept: finalises the log and writes a recipe that reproduces the final settings (AC-5, same photo)", async () => {
    await manager.begin({ intent_id: "test_prior" });
    await manager.step({ session_id: ID, settings: { shadows: 30, vibrance: 10 }, rationale: "r" });
    const final = map.fromSdk(lr.settings).settings;
    const out = await manager.end({ session_id: ID, outcome: "accept" });
    expect(manager.current()).toBeNull();
    expect(out.json).toMatchObject({ outcome: "accept", passes: "1/4", final_settings: final });
    const recipe = recipeSchema.parse(JSON.parse(readFileSync(String(out.json["recipe_path"]), "utf8")));
    expect(recipe.settings).toEqual(final);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "accept", recipe_path: out.json["recipe_path"], final_settings: final });

    // Replay: back to the pre-session snapshot, then the recipe as one write.
    lr.settings = structuredClone(lr.snapshots.get("SNAP-1") as Record<string, unknown>);
    expect(map.fromSdk(lr.settings).settings).not.toEqual(final);
    const sdk = map.toSdk(recipe.settings, { processVersion: recipe.process_version });
    const res = (await client.request("apply_settings", { target_uuid: lr.uuid, settings: sdk, history_name: "AVG replay" })).read_back;
    expect(map.verifyReadback(sdk, luaize(res) as Record<string, unknown>)).toEqual([]);
    expect(map.fromSdk(res).settings).toEqual(final);
  });

  it("revert: applies the pre-session snapshot and lists no differing setting", async () => {
    const start = map.fromSdk(lr.settings).settings;
    await manager.begin({ intent_id: "test_prior" });
    await manager.step({ session_id: ID, settings: { shadows: 30 }, rationale: "r" });
    const out = await manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json).toMatchObject({ outcome: "revert", recipe_path: null, revert: { ms: expect.any(Number), differing: [] }, final_settings: start });
    expect(map.fromSdk(lr.settings).settings).toEqual(start);
    expect(readLog()).toMatchObject({ outcome: "revert", revert: { differing: [] } });
  });

  it("returns the log while open, after the end, and from the file to a new engine", async () => {
    await manager.begin({ intent_id: "test_plain" });
    expect(manager.getLog({ session_id: ID }).json).toMatchObject({ open: true, log: { session_id: ID } });
    await manager.end({ session_id: ID, outcome: "accept" });
    expect(manager.getLog({ session_id: ID }).json).toMatchObject({ open: false, log: { outcome: "accept" } });
    expect(newManager().getLog({ session_id: ID }).json).toMatchObject({ open: false, log_path: logFile() });
    expect(() => manager.getLog({ session_id: "00000000-0000" })).toThrow(/No session log/);
    expect(existsSync(logFile())).toBe(true);
  });
});
