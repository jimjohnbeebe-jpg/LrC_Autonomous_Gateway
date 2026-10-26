// `npm run curve:probe` (devtools\curve-probe.ts, GitHub issue #187) against the simulated plugin: the session
// step, the direct writes, the question and the put-back. The sim takes or drops a key as told (`ignored`), so
// this checks the steps and the put-back, not what Lightroom does with the curve.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { ISSUE_PHOTO, LIFT3, QUESTION, runCurveProbe } from "../src/devtools/curve-probe.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { findLeftOpen } from "../src/session/left-open.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type J = Record<string, unknown>;

describe("curve probe (simulated plugin)", () => {
  let tmp = "";
  let plugin: FakePlugin;
  let lr: LightroomSim;
  let client: BridgeClient;
  const said: string[] = [];
  const asked: string[] = [];

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-curve-"));
    mkdirSync(path.join(tmp, "previews"));
    plugin = await FakePlugin.start();
    lr = new LightroomSim(path.join(tmp, "previews"));
    lr.filename = ISSUE_PHOTO.filename;
    lr.exportLongEdge = 240;
    lr.install(plugin);
    said.length = 0;
    asked.length = 0;
  });

  afterEach(async () => {
    client?.stop();
    await plugin.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const run = () => {
    client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
    return runCurveProbe({
      client, gate, map: loadDefaultParamMap(), say: (l) => said.push(l), stamp: "2026-10-25T10-00-00-000Z",
      ask: async (q) => {
        asked.push(q);
        return "y";
      },
      dumpDir: tmp, recorderDir: tmp, sessionDir: path.join(tmp, "sessions"), previewDir: path.join(tmp, "previews"), connectTimeoutMs: 2000, settleMs: 0,
    });
  };

  it("a refused curve: the session step is WRITE_NOT_TAKEN, the photo is back at its pre-step settings, and put back", async () => {
    const before = structuredClone(lr.settings);
    lr.ignored.add("ToneCurvePV2012");
    const { worked, results } = await run();
    expect(results["errors"]).toEqual([]);
    expect(worked).toBe(true);
    const photo = results["photo"] as J;
    expect(photo["session_step"]).toMatchObject({ outcome: "WRITE_NOT_TAKEN", back_at_pre_step: { ok: true, differing: [] }, error: { details: expect.objectContaining({ undone: true }) } });
    expect(((photo["direct"] as J)["writes"] as J[]).map((w) => w["taken"])).toEqual([false, false]);
    expect(photo["point_curve"]).toMatchObject({ answer: "y", write: { written: { ToneCurvePV2012: LIFT3 }, taken: false } });
    expect(asked).toEqual([QUESTION]);
    expect(photo["put_back"]).toMatchObject({ ok: true });
    expect(lr.settings).toEqual(before);
    expect(said).toContain("Curve probe: WORKED");
    expect(said).toContain("put back: YES");
  });

  it("a taken curve: the session step is taken, then reverted with the session", async () => {
    const before = structuredClone(lr.settings);
    const { worked, results } = await run();
    expect(worked).toBe(true);
    const photo = results["photo"] as J;
    expect(photo["session_step"]).toMatchObject({ outcome: "taken", after_step: { ToneCurvePV2012: [0, 0, 64, 56, 128, 128, 192, 200, 255, 255] } });
    expect(((photo["direct"] as J)["writes"] as J[]).map((w) => w["taken"])).toEqual([true, true]);
    expect(lr.settings).toEqual(before);
  });

  const leftOpen = () => findLeftOpen(path.join(tmp, "sessions"), null);

  it("ends the session when its begin fails in pass 0, so the next run is not refused SESSION_LEFT_OPEN (Greptile, PR #200)", async () => {
    const before = structuredClone(lr.settings);
    lr.exportError = "the export failed";
    const first = await run();
    expect(first.worked).toBe(false);
    expect((first.results["photo"] as J)["put_back"]).toMatchObject({ ok: true });
    expect(leftOpen()).toEqual([]);
    client.stop();
    lr.exportError = null;
    const second = await run();
    expect(second.results["errors"]).toEqual([]);
    expect(second.worked).toBe(true);
    expect(lr.settings).toEqual(before);
  });

  it("ends the session when a read throws before its end (Greptile, PR #200)", async () => {
    const apply = plugin.handlers.get("apply_settings")!;
    const get = plugin.handlers.get("get_settings")!;
    let failNext = false;
    plugin.handlers.set("apply_settings", (p, id) => {
      if (String(p["history_name"]).endsWith("pass 1/4")) failNext = true;
      return apply(p, id);
    });
    plugin.handlers.set("get_settings", (p, id) => {
      if (!failNext || !("photo_uuid" in p)) return get(p, id);
      failNext = false;
      return { ok: false, error: { code: "read_failed", message: "no", recoverable: true } };
    });
    const first = await run();
    expect(first.worked).toBe(false);
    expect(leftOpen()).toEqual([]);
    client.stop();
    plugin.handlers.set("apply_settings", apply);
    plugin.handlers.set("get_settings", get);
    const second = await run();
    expect(second.results["errors"]).toEqual([]);
    expect(second.worked).toBe(true);
  });

  it("fails, writing nothing, when the selected photo is not issue #187's", async () => {
    lr.filename = "OTHER.dng";
    const { worked, results } = await run();
    expect(worked).toBe(false);
    expect((results["errors"] as string[]).join(" ")).toContain(ISSUE_PHOTO.filename);
    expect(plugin.received.some((r) => r.name === "apply_settings" || r.name === "create_snapshot")).toBe(false);
    expect(said).toContain("Curve probe: FAILED");
  });
});
