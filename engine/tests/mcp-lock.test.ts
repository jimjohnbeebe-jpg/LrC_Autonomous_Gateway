// The instance lock (src/mcp/instance-lock.ts) and the bridge gate (src/mcp/bridge-gate.ts):
// one engine at a time holds the Lightroom bridge; the others answer ENGINE_BUSY until it exits.

import net from "node:net";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { acquireInstanceLock, BridgeGate, ToolError, type LockResult } from "../src/mcp/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";

/** A port that was free a moment ago. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("mcp: instance lock", () => {
  it("lets one holder at a time listen on the lock port, and reports the holder's PID", async () => {
    const port = await freePort();
    const first = await acquireInstanceLock(port);
    expect(first.ok).toBe(true);
    const second = await acquireInstanceLock(port);
    expect(second).toEqual({ ok: false, port, pid: process.pid });
    if (first.ok) await first.lock.release();
    const third = await acquireInstanceLock(port);
    expect(third.ok).toBe(true);
    if (third.ok) await third.lock.release();
  });

  it("gives exactly one lock to many simultaneous attempts", async () => {
    const port = await freePort();
    const results = await Promise.all(Array.from({ length: 5 }, () => acquireInstanceLock(port)));
    const held = results.filter((r): r is Extract<LockResult, { ok: true }> => r.ok);
    expect(held).toHaveLength(1);
    await held[0]?.lock.release();
  });
});

describe("mcp: bridge gate", () => {
  it("answers ENGINE_BUSY while another engine holds the lock, and connects once it is free", async () => {
    const plugin = await FakePlugin.start();
    const client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    let holder: number | null = 424242;
    let acquired = 0;
    const gate = new BridgeGate(
      client,
      async () => (holder !== null ? { ok: false, port: 1, pid: holder } : { ok: true, lock: { port: 1, release: async () => {} } }),
      { waitMs: 2000, onAcquire: () => acquired++ },
    );
    try {
      expect(await gate.start()).toBe(false);
      const busy = await gate.ready().then(
        () => null,
        (e: unknown) => e,
      );
      expect(busy).toBeInstanceOf(ToolError);
      expect((busy as ToolError).body()).toMatchObject({ code: "ENGINE_BUSY", recoverable: true, details: { pid: 424242 } });
      expect(client.getState()).toBe("stopped");
      expect(acquired).toBe(0); // no purge of the shared previews folder without the lock

      holder = null; // the other engine exited
      await Promise.all([gate.ready(), gate.ready()]); // two calls at once take the lock once
      expect(acquired).toBe(1);
      expect(client.getState()).toBe("connected");
      expect(gate.holdsLock()).toBe(true);
      await gate.release();
      expect(client.getState()).toBe("stopped");
      expect(gate.holdsLock()).toBe(false);
    } finally {
      await gate.release();
      await plugin.close();
    }
  });

  it("says why the bridge is not there when Lightroom does not answer", async () => {
    const client = new BridgeClient({ commandPort: 1, eventPort: 2, reconnectMs: 20, connectTimeoutMs: 100, readToken: () => null });
    const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 1, release: async () => {} } }), { waitMs: 150 });
    try {
      const e = await gate.ready().then(
        () => null,
        (err: unknown) => err as Error,
      );
      expect(e?.message).toMatch(/last error: no bridge token/);
    } finally {
      await gate.release();
    }
  });
});
