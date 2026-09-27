// Contract tests for plugin 0.3.0's catalog commands (plugin\LrC-AVG.lrplugin\Catalog.lua,
// PHASE4_PLAN row 6): the engine's client against a fake plugin answering with results shaped the
// way Catalog.lua builds them and Json.lua writes them (an empty table as [], nil fields left out).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError, pluginVersionAtLeast } from "../src/bridge/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";

const FAST = { reconnectMs: 30, heartbeatMs: 40, missedBeats: 3, connectGapMs: 5, handshakeTimeoutMs: 500, requestTimeoutMs: 300 };
const MASTER = { uuid: "CF12AF60-0858-4181-9562-376D16B89126", local_id: 3869534 };
const NAMES = ["AVG landscape_golden_hour A", "AVG landscape_golden_hour B", "AVG landscape_golden_hour C"];

/** A copy as Catalog.lua's describe() plus the identity check reports it. */
function copy(i: number, name: string): Record<string, unknown> {
  return { local_id: MASTER.local_id + 1 + i, uuid: `COPY-${i}`, is_virtual_copy: true, master_local_id: MASTER.local_id, copy_name: name, identity_ok: true };
}

let plugin: FakePlugin;
let client: BridgeClient;

beforeEach(async () => {
  plugin = await FakePlugin.start();
  client = new BridgeClient({ ...FAST, commandPort: plugin.commandPort, eventPort: plugin.eventPort, readToken: () => plugin.token });
  client.start();
  await client.waitConnected(2000);
});

afterEach(async () => {
  client.stop();
  await plugin.close();
});

async function rejection(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p;
  } catch (e) {
    return e as BridgeError;
  }
  throw new Error("expected a rejection");
}

describe("bridge: create_virtual_copies", () => {
  it("sends the master's uuid and the names, and reads every copy back", async () => {
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: true,
      payload: { ...MASTER, requested: 3, copies: NAMES.map((n, i) => copy(i, n)), master_selected: true },
    }));
    const result = await client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES });
    expect(plugin.received.at(-1)).toEqual({ name: "create_virtual_copies", payload: { target_uuid: MASTER.uuid, names: NAMES } });
    expect(result.copies.map((c) => c.copy_name)).toEqual(NAMES);
    expect(result.copies.every((c) => c.identity_ok && c.master_local_id === MASTER.local_id)).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.master_selected).toBe(true);
  });

  it("reads a run that stopped early: the copies made so far, and why it stopped", async () => {
    const failure = { code: "select_failed", message: "Lightroom did not select photo 3869534 (active photo 3869535, 1 selected)" };
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: true,
      payload: { ...MASTER, requested: 3, copies: [copy(0, NAMES[0] as string)], failure, master_selected: false, master_select_error: failure.message },
    }));
    const result = await client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES });
    expect(result.copies).toHaveLength(1);
    expect(result.requested).toBe(3);
    expect(result.failure).toEqual(failure);
    expect(result.master_select_error).toBe(failure.message);
  });

  it("reads no copies as Json.lua writes an empty table ([]), and a copy whose identity failed", async () => {
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: true,
      payload: { ...MASTER, requested: 2, copies: [], failure: { code: "copy_failed", message: "createVirtualCopies returned nil" }, master_selected: true },
    }));
    expect((await client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES.slice(0, 2) })).copies).toEqual([]);

    const odd = { local_id: 7, is_virtual_copy: true, master_local_id: 99, identity_ok: false };
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: true,
      payload: { ...MASTER, requested: 2, copies: [odd], failure: { code: "identity_mismatch", message: "not a copy of the master" }, master_selected: true },
    }));
    const result = await client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES.slice(0, 2) });
    expect(result.copies[0]).toEqual(odd);
  });

  it("rejects a result without the identity check on each copy", async () => {
    const { identity_ok: _, ...unchecked } = copy(0, NAMES[0] as string);
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: true,
      payload: { ...MASTER, requested: 2, copies: [unchecked], master_selected: true },
    }));
    const e = await rejection(client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES.slice(0, 2) }));
    expect(e.code).toBe("bad_response");
  });

  it("passes the plugin's refusal through (a virtual copy selected as the master)", async () => {
    plugin.handlers.set("create_virtual_copies", () => ({
      ok: false,
      error: { code: "bad_target", message: "the selected photo is a virtual copy (or unreadable); select the master photo", recoverable: true },
    }));
    const e = await rejection(client.request("create_virtual_copies", { target_uuid: MASTER.uuid, names: NAMES }));
    expect(e).toMatchObject({ code: "bad_target", recoverable: true, command: "create_virtual_copies" });
  });
});

describe("bridge: select_photo", () => {
  it("sends the uuid and what the photo must be, and reads the selected photo back", async () => {
    const { identity_ok: _, ...photo } = copy(1, NAMES[1] as string);
    plugin.handlers.set("select_photo", () => ({ ok: true, payload: photo }));
    const expect_ = { copy_name: NAMES[1] as string, master_local_id: MASTER.local_id, is_virtual_copy: true };
    const result = await client.request("select_photo", { uuid: "COPY-1", expect: expect_ });
    expect(plugin.received.at(-1)).toEqual({ name: "select_photo", payload: { uuid: "COPY-1", expect: expect_ } });
    expect(result).toMatchObject({ uuid: "COPY-1", copy_name: NAMES[1], is_virtual_copy: true });
  });

  it("reads a master photo, which has no copy name", async () => {
    plugin.handlers.set("select_photo", () => ({
      ok: true,
      payload: { ...MASTER, is_virtual_copy: false, master_local_id: MASTER.local_id },
    }));
    const result = await client.request("select_photo", { uuid: MASTER.uuid });
    expect(result.copy_name).toBeUndefined();
    expect(result.master_local_id).toBe(result.local_id);
  });

  it("passes an identity mismatch through, not recoverable", async () => {
    plugin.handlers.set("select_photo", () => ({
      ok: false,
      error: { code: "identity_mismatch", message: "the photo with uuid COPY-1 has copy_name AVG x A, expected AVG x B", recoverable: false },
    }));
    const e = await rejection(client.request("select_photo", { uuid: "COPY-1", expect: { copy_name: "AVG x B" } }));
    expect(e).toMatchObject({ code: "identity_mismatch", recoverable: false, command: "select_photo" });
  });

  it("rejects a result without the photo's uuid", async () => {
    plugin.handlers.set("select_photo", () => ({ ok: true, payload: { local_id: 1, is_virtual_copy: true } }));
    expect((await rejection(client.request("select_photo", { uuid: "COPY-1" }))).code).toBe("bad_response");
  });
});

describe("bridge: plugin version", () => {
  it("compares major.minor.patch versions", () => {
    expect(pluginVersionAtLeast("0.3.0", "0.2.0")).toBe(true);
    expect(pluginVersionAtLeast("0.2.0", "0.2.0")).toBe(true);
    expect(pluginVersionAtLeast("0.10.0", "0.9.9")).toBe(true);
    expect(pluginVersionAtLeast("1.0.0", "0.9.0")).toBe(true);
    expect(pluginVersionAtLeast("0.1.9", "0.2.0")).toBe(false);
    expect(pluginVersionAtLeast("0.2", "0.2.0")).toBe(false);
    expect(pluginVersionAtLeast(undefined, "0.2.0")).toBe(false);
    expect(pluginVersionAtLeast("fake", "0.2.0")).toBe(false);
  });
});
