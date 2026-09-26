// Bridge contract tests: the engine's client against a fake plugin that speaks the same line
// protocol as plugin\LrC-AVG.lrplugin\Bridge.lua (ARCHITECTURE section 3). Timings are shortened.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError } from "../src/bridge/index.js";
import { FakePlugin, waitUntil } from "./helpers/fake-plugin.js";

const FAST = { reconnectMs: 30, heartbeatMs: 40, missedBeats: 3, connectGapMs: 5, handshakeTimeoutMs: 500, requestTimeoutMs: 300 };

let plugin: FakePlugin;
let client: BridgeClient;

beforeEach(async () => {
  plugin = await FakePlugin.start();
  client = new BridgeClient({ ...FAST, commandPort: plugin.commandPort, eventPort: plugin.eventPort });
});

afterEach(async () => {
  client.stop();
  await plugin.close();
});

async function connected(): Promise<void> {
  client.start();
  await client.waitConnected(2000);
}

async function rejection(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p;
  } catch (e) {
    return e as BridgeError;
  }
  throw new Error("expected a rejection");
}

describe("bridge: client", () => {
  it("connects to both ports and completes the hello handshake", async () => {
    await connected();
    expect(client.getState()).toBe("connected");
    expect(client.hello()).toMatchObject({ protocol: 1, lrc_version: "15.5.1" });
    expect(plugin.received[0]).toEqual({ name: "hello", payload: { protocol: 1, engine_version: "0.0.0" } });
  });

  it("refuses requests before it is connected", async () => {
    const e = await rejection(client.request("get_settings", {}));
    expect(e).toBeInstanceOf(BridgeError);
    expect(e.code).toBe("not_connected");
  });

  it("matches responses to requests by id, whatever order they come back in", async () => {
    plugin.handlers.set("get_settings", async (payload) => {
      await new Promise((r) => setTimeout(r, payload["target_uuid"] === "slow" ? 60 : 0));
      return { ok: true, payload: { uuid: String(payload["target_uuid"]), settings: { Exposure2012: payload["target_uuid"] === "slow" ? 1 : 2 } } };
    });
    await connected();
    const [slow, fast] = await Promise.all([
      client.request("get_settings", { target_uuid: "slow" }),
      client.request("get_settings", { target_uuid: "fast" }),
    ]);
    expect(slow.settings["Exposure2012"]).toBe(1);
    expect(fast.settings["Exposure2012"]).toBe(2);
  });

  it("keeps several requests in flight at once", async () => {
    await connected();
    const nonces = ["a", "b", "c", "d", "e"];
    const results = await Promise.all(nonces.map((nonce) => client.request("ping", { nonce })));
    expect(results.map((r) => r.nonce)).toEqual(nonces);
  });

  it("round-trips non-ASCII text", async () => {
    await connected();
    const nonce = "é漢字 ✓ AVG";
    expect((await client.request("ping", { nonce })).nonce).toBe(nonce);
  });

  it("rejects with the plugin's structured error", async () => {
    plugin.handlers.set("apply_snapshot", () => ({
      ok: false,
      error: { code: "unknown_snapshot", message: "no such snapshot", recoverable: false },
    }));
    await connected();
    const e = await rejection(client.request("apply_snapshot", { snapshot_id: "X" }));
    expect(e).toMatchObject({ code: "unknown_snapshot", recoverable: false, command: "apply_snapshot" });
  });

  it("times out a request with no answer, and counts the late answer", async () => {
    let lateId = "";
    plugin.handlers.set("get_context", (_payload, id) => {
      lateId = id;
      return "silent";
    });
    await connected();
    const e = await rejection(client.request("get_context", {}, { timeoutMs: 50 }));
    expect(e.code).toBe("timeout");
    plugin.send({ id: lateId, type: "res", name: "get_context", ok: true, payload: { uuid: "u", local_id: 1, lrc_version: "15.5.1" } });
    await waitUntil(() => client.stats.unknown_response_ids === 1);
    expect(client.getState()).toBe("connected");
  });

  it("rejects a result that does not match the command's schema", async () => {
    plugin.handlers.set("create_snapshot", () => ({ ok: true, payload: { uuid: "u", name: "AVG x" } }));
    await connected();
    const e = await rejection(client.request("create_snapshot", { name: "AVG x" }));
    expect(e.code).toBe("bad_response");
  });

  it("ignores lines that are not JSON or not an envelope, and stays connected", async () => {
    await connected();
    plugin.writeRaw("this is not json\n");
    plugin.writeRaw('{"id":"1","type":"cmd","name":"x"}\n');
    await waitUntil(() => client.stats.malformed_lines === 2);
    expect((await client.request("ping", { nonce: "still" })).nonce).toBe("still");
  });

  it("reads a response split mid-character across writes, and two lines in one write", async () => {
    let first = "";
    let second = "";
    plugin.handlers.set("get_settings", (_p, id) => {
      if (!first) first = id;
      else second = id;
      return "silent";
    });
    await connected();
    const a = client.request("get_settings", {});
    const b = client.request("get_settings", {});
    await waitUntil(() => second !== "");
    const line = (id: string, v: string) =>
      JSON.stringify({ id, type: "res", name: "get_settings", ok: true, payload: { uuid: "u", settings: { CameraProfile: v } } }) + "\n";
    const bytes = Buffer.from(line(first, "Camera Landscape 漢") + line(second, "Adobe Standard"), "utf8");
    const cut = bytes.indexOf(0xe6) + 1;
    plugin.writeRaw(bytes.subarray(0, cut));
    await new Promise((r) => setTimeout(r, 10));
    plugin.writeRaw(bytes.subarray(cut));
    expect((await a).settings["CameraProfile"]).toBe("Camera Landscape 漢");
    expect((await b).settings["CameraProfile"]).toBe("Adobe Standard");
  });

  it("delivers events", async () => {
    const events: string[] = [];
    client.onEvent((e) => events.push(e.name));
    await connected();
    plugin.send({ id: "e1", type: "evt", name: "selection_changed", payload: { uuid: "u" } });
    await waitUntil(() => events.includes("selection_changed"));
  });

  it("drops after three silent heartbeats, fails pending requests, and reconnects", async () => {
    plugin.handlers.set("get_context", () => "silent");
    await connected();
    const pending = client.request("get_context", {}, { timeoutMs: 5000 });
    plugin.answerPings = false;
    const e = await rejection(pending);
    expect(e.code).toBe("disconnected");
    expect(client.stats.last_drop_reason).toMatch(/heartbeat/);
    plugin.answerPings = true;
    await client.waitConnected(2000);
    expect(client.stats.connects).toBe(2);
  });

  it("reconnects when the plugin closes the event socket", async () => {
    await connected();
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    expect((await client.request("ping", { nonce: "back" })).nonce).toBe("back");
  });

  it("does not connect to a plugin that speaks another protocol version", async () => {
    plugin.helloProtocol = 2;
    client.start();
    await waitUntil(() => client.stats.drops >= 1);
    expect(client.stats.last_drop_reason).toMatch(/protocol 2/);
    expect(client.getState()).not.toBe("connected");
  });

  it("retries quietly while nothing listens, then connects", async () => {
    const closed = await FakePlugin.start();
    const { commandPort, eventPort } = closed;
    await closed.close();
    const lonely = new BridgeClient({ ...FAST, commandPort, eventPort });
    lonely.start();
    await waitUntil(() => lonely.stats.connect_failures >= 2);
    expect(lonely.stats.drops).toBe(0);
    expect(lonely.getState()).toBe("connecting");
    lonely.stop();
    expect(lonely.getState()).toBe("stopped");
  });
});
