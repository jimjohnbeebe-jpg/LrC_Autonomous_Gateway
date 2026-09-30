// The bridge client rides out a plugin pause while the engine allows a longer silence
// (silenceAllowanceMs: a session is open; PHASE5_PLAN row 5, decision D1): no drop, and a request the
// paused plugin answers late still resolves. Past the allowance the heartbeat drops as before, and a
// request the plugin leaves unanswered while it still answers pings times out as before.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, BridgeError } from "../src/bridge/index.js";
import { FakePlugin, type FakeReply } from "./helpers/fake-plugin.js";

// Heartbeat 40 ms, 3 missed beats: without the allowance the bridge drops after 120 ms of silence.
const FAST = { reconnectMs: 30, heartbeatMs: 40, missedBeats: 3, connectGapMs: 5, handshakeTimeoutMs: 500 };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let plugin: FakePlugin;
let client: BridgeClient;
let allowance: number;
/** True while the plugin is "paused": it answers nothing, not even pings. */
let paused: boolean;

const pong = (nonce: unknown): FakeReply => ({ ok: true, payload: { pong: true, ...(nonce ? { nonce } : {}) } });

beforeEach(async () => {
  plugin = await FakePlugin.start();
  allowance = 0;
  paused = false;
  plugin.handlers.set("ping", async (p) => {
    if (p["nonce"] === "late") {
      // The request the test waits on: answered once the pause is over.
      while (paused) await sleep(5);
      return pong("late");
    }
    return paused ? "silent" : pong(p["nonce"]);
  });
  client = new BridgeClient({ ...FAST, commandPort: plugin.commandPort, eventPort: plugin.eventPort, readToken: () => plugin.token, silenceAllowanceMs: () => allowance });
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
  } catch (err) {
    if (err instanceof BridgeError) return err;
    throw err;
  }
  throw new Error("expected a rejection");
}

describe("bridge client: a plugin pause", () => {
  it("while allowed, waits out a pause longer than three beats: no drop, and the late answer arrives", async () => {
    allowance = 1000;
    paused = true;
    const late = client.request("ping", { nonce: "late" }, { timeoutMs: 150 });
    await sleep(400); // over three beats (120 ms) and over the request's own timeout
    paused = false;
    expect((await late).nonce).toBe("late");
    expect([client.getState(), client.stats.drops]).toEqual(["connected", 0]);
  });

  it("without the allowance, the same pause drops the bridge and fails the request", async () => {
    paused = true;
    const e = await rejection(client.request("ping", { nonce: "late" }, { timeoutMs: 1000 }));
    paused = false;
    expect(e.code).toBe("disconnected");
    expect(client.stats.last_drop_reason).toMatch(/heartbeat/);
  });

  it("past the allowance, drops as before", async () => {
    allowance = 300;
    paused = true;
    const started = Date.now();
    const e = await rejection(client.request("ping", { nonce: "late" }, { timeoutMs: 150 }));
    const waited = Date.now() - started;
    paused = false;
    expect(e.code).toBe("disconnected");
    expect(client.stats.last_drop_reason).toMatch(/heartbeat/);
    expect(waited).toBeGreaterThanOrEqual(300);
  });

  it("a request the plugin leaves unanswered while it still answers pings times out as before", async () => {
    allowance = 1000;
    plugin.handlers.set("get_prefs", () => "silent");
    const e = await rejection(client.request("get_prefs", {}, { timeoutMs: 150 }));
    expect(e.code).toBe("timeout");
    expect(client.stats.drops).toBe(0);
  });
});
