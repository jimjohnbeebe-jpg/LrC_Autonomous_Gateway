// Contract tests for plugin 0.11.0's masks-capture commands (plugin\LrC-AVG.lrplugin\Masks.lua): the
// engine's client against the sim (lightroom-sim-masks.ts) and against answers shaped the way
// Masks.lua builds them and Json.lua writes them (an empty table as [], nil fields left out).

import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError } from "../src/bridge/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

const FAST = { reconnectMs: 30, heartbeatMs: 40, missedBeats: 3, connectGapMs: 5, handshakeTimeoutMs: 500, requestTimeoutMs: 300 };

let plugin: FakePlugin;
let client: BridgeClient;
let lr: LightroomSim;

beforeEach(async () => {
  plugin = await FakePlugin.start();
  lr = new LightroomSim(path.join(os.tmpdir(), "LrC-AVG-masks-test"));
  lr.install(plugin);
  client = new BridgeClient({ ...FAST, commandPort: plugin.commandPort, eventPort: plugin.eventPort, readToken: () => plugin.token });
  client.start();
  await client.waitConnected(2000);
});

afterEach(async () => {
  client.stop();
  await plugin.close();
});

const rejection = (p: Promise<unknown>): Promise<BridgeError> => p.then(() => Promise.reject(new Error("expected a rejection")), (e: BridgeError) => e);

describe("bridge: update_ai_settings", () => {
  it("names the photo by uuid and reads the timing back", async () => {
    const result = await client.request("update_ai_settings", { photo_uuid: lr.uuid, expect: { is_virtual_copy: false } });
    expect(plugin.received.at(-1)).toEqual({ name: "update_ai_settings", payload: { photo_uuid: lr.uuid, expect: { is_virtual_copy: false } } });
    expect(result).toEqual({ uuid: lr.uuid, call_ms: 1, command_ms: 2 });
  });

  it("passes on unknown_photo and feature_unavailable as recoverable errors", async () => {
    expect((await rejection(client.request("update_ai_settings", { photo_uuid: "NOPE" }))).code).toBe("unknown_photo");
    plugin.handlers.set("update_ai_settings", () => ({ ok: false, error: { code: "feature_unavailable", message: "photo:updateAISettings (SDK 13.3) is not available", recoverable: true } }));
    const err = await rejection(client.request("update_ai_settings", { photo_uuid: lr.uuid }));
    expect([err.code, err.recoverable]).toEqual(["feature_unavailable", true]);
  });
});

describe("bridge: probe_masks_dc", () => {
  it("reads the steps whatever their results hold, and an empty step list as Json.lua writes it", async () => {
    expect((await client.request("probe_masks_dc", { target_uuid: lr.uuid })).steps).toEqual([{ step: "switchToModule_develop", ok: false, error: "the sim has no Develop module", ms: 0 }]);
    const steps = [
      { step: "getAllMasks_before", ok: true, result: [{ ID: "A", "1": { ID: "B" } }], ms: 0.4 },
      { step: "goToMasking", ok: true, ms: 1 },
      { step: "getSelectedTool_after_goToMasking", ok: true, result: "masking", ms: 0.1 },
    ];
    plugin.handlers.set("probe_masks_dc", () => ({ ok: true, payload: { uuid: lr.uuid, filename: "x.NEF", steps } }));
    expect((await client.request("probe_masks_dc", { target_uuid: lr.uuid })).steps).toEqual(steps);
    plugin.handlers.set("probe_masks_dc", () => ({ ok: true, payload: { steps: [] } }));
    expect((await client.request("probe_masks_dc", { target_uuid: lr.uuid })).steps).toEqual([]);
  });

  it("is refused when another photo is selected, and reads why a probe stopped", async () => {
    lr.selected = "OTHER";
    const err = await rejection(client.request("probe_masks_dc", { target_uuid: lr.uuid }));
    expect([err.code, err.recoverable]).toEqual(["target_mismatch", true]);
    const stopped = "target_mismatch: The selected photo (OTHER) is not the target (SIM-UUID)";
    plugin.handlers.set("probe_masks_dc", () => ({ ok: true, payload: { uuid: lr.uuid, steps: [{ step: "stopped_before_createNewMask_sky", ok: false, ms: 0, error: stopped }], stopped } }));
    expect((await client.request("probe_masks_dc", { target_uuid: lr.uuid })).stopped).toBe(stopped);
  });

  it("refuses a step without its time", async () => {
    plugin.handlers.set("probe_masks_dc", () => ({ ok: true, payload: { steps: [{ step: "goToMasking", ok: true }] } }));
    expect((await rejection(client.request("probe_masks_dc", { target_uuid: lr.uuid }))).code).toBe("bad_response");
  });
});

describe("bridge: capture 2 probes (probe_masks_calibrate, probe_masks_create)", () => {
  it("sends the mask and the names, and reads the selected mask and the values back", async () => {
    const payload = { target_uuid: lr.uuid, mask_id: "CORR-1", mask_name: "AVG calibrate", names: ["local_Contrast", "local_Contrast2012"] };
    const steps = [
      { step: "getValue_local_Contrast", ok: true, result: 20, ms: 0.2 },
      { step: "getRange_local_Contrast", ok: true, result: [-100, 100], ms: 0.1 },
      { step: "getValue_local_Contrast2012", ok: false, error: "unknown parameter", ms: 0.1 },
    ];
    plugin.handlers.set("probe_masks_calibrate", () => ({ ok: true, payload: { uuid: lr.uuid, steps, selected: "CORR-1" } }));
    const result = await client.request("probe_masks_calibrate", payload);
    expect(plugin.received.at(-1)).toEqual({ name: "probe_masks_calibrate", payload });
    expect([result.selected, result.steps]).toEqual(["CORR-1", steps]);
  });

  it("refuses another selected photo in the sim, for both probes", async () => {
    lr.selected = "OTHER";
    const calibrate = await rejection(client.request("probe_masks_calibrate", { target_uuid: lr.uuid, mask_id: "CORR-1", names: ["local_Exposure"] }));
    const create = await rejection(client.request("probe_masks_create", { target_uuid: lr.uuid, subtypes: ["background"] }));
    expect([calibrate.code, create.code]).toEqual(["target_mismatch", "target_mismatch"]);
  });
});
