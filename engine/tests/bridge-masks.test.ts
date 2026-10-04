// Contract tests for the plugin's AI-mask commands (plugin\LrC-AVG.lrplugin\Masks.lua: update_ai_settings
// from 0.11.0, create_ai_mask_dc from 0.12.0): the engine's client against the sim (lightroom-sim-masks.ts) and against answers shaped the way Masks.lua builds
// them and Json.lua writes them (an empty table as [], nil fields left out).

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
    lr.masks.tableRoute = "unavailable";
    const err = await rejection(client.request("update_ai_settings", { photo_uuid: lr.uuid }));
    expect([err.code, err.recoverable]).toEqual(["feature_unavailable", true]);
  });
});

describe("bridge: create_ai_mask_dc", () => {
  it("sends the subtype for the selected photo and reads the new mask ids back", async () => {
    const result = await client.request("create_ai_mask_dc", { target_uuid: lr.uuid, subtype: "sky" });
    expect(plugin.received.at(-1)).toEqual({ name: "create_ai_mask_dc", payload: { target_uuid: lr.uuid, subtype: "sky" } });
    expect(result.new_ids).toHaveLength(1);
    expect(result.waited_ms).toBe(900);
  });

  it("reads no new mask as Json.lua writes it, and why a call stopped", async () => {
    const stopped = "target_mismatch: The selected photo (OTHER) is not the target (SIM-UUID)";
    plugin.handlers.set("create_ai_mask_dc", () => ({ ok: true, payload: { uuid: lr.uuid, steps: [{ step: "stopped_before_createNewMask_sky", ok: false, ms: 0, error: stopped }], stopped, new_ids: [], waited_ms: 0 } }));
    const result = await client.request("create_ai_mask_dc", { target_uuid: lr.uuid, subtype: "sky" });
    expect([result.new_ids, result.stopped]).toEqual([[], stopped]);
  });

  it("is refused when another photo is selected; an answer without new_ids is a bad response", async () => {
    lr.selected = "OTHER";
    const err = await rejection(client.request("create_ai_mask_dc", { target_uuid: lr.uuid, subtype: "sky" }));
    expect([err.code, err.recoverable]).toEqual(["target_mismatch", true]);
    plugin.handlers.set("create_ai_mask_dc", () => ({ ok: true, payload: { steps: [], waited_ms: 1 } }));
    expect((await rejection(client.request("create_ai_mask_dc", { target_uuid: lr.uuid, subtype: "sky" }))).code).toBe("bad_response");
  });
});
