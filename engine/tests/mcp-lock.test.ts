// The instance lock (src/mcp/instance-lock.ts) and the bridge gate (src/mcp/bridge-gate.ts):
// one engine at a time holds the Lightroom bridge; the others answer ENGINE_BUSY until it exits.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { acquireInstanceLock, BridgeGate, ToolError } from "../src/mcp/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";

let tmp: string;
let lockFile: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-lock-"));
  lockFile = path.join(tmp, "sub", "engine-8765-8766.lock");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("mcp: instance lock", () => {
  it("takes a free lock, writes its PID and removes the file on release", () => {
    const result = acquireInstanceLock(lockFile);
    expect(result.ok).toBe(true);
    expect(readFileSync(lockFile, "utf8").trim()).toBe(String(process.pid));
    if (result.ok) result.lock.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("reports a lock held by a live process", () => {
    acquireInstanceLock(lockFile, () => true); // creates the folder
    writeFileSync(lockFile, "424242\n");
    const result = acquireInstanceLock(lockFile, (pid) => pid === 424242);
    expect(result).toEqual({ ok: false, pid: 424242, file: lockFile });
    expect(readFileSync(lockFile, "utf8").trim()).toBe("424242");
  });

  it("replaces a stale lock whose process is gone", () => {
    acquireInstanceLock(lockFile, () => true);
    writeFileSync(lockFile, "424242\n");
    const result = acquireInstanceLock(lockFile, () => false);
    expect(result.ok).toBe(true);
    expect(readFileSync(lockFile, "utf8").trim()).toBe(String(process.pid));
  });

  it("does not delete a lock another process has taken since", () => {
    const result = acquireInstanceLock(lockFile);
    writeFileSync(lockFile, "424242\n");
    if (result.ok) result.lock.release();
    expect(readFileSync(lockFile, "utf8").trim()).toBe("424242");
  });
});

describe("mcp: bridge gate", () => {
  it("answers ENGINE_BUSY while another engine holds the lock, and connects once it is free", async () => {
    const plugin = await FakePlugin.start();
    const client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    let holder: number | null = 424242;
    const gate = new BridgeGate(
      client,
      () => (holder !== null ? { ok: false, pid: holder, file: lockFile } : { ok: true, lock: { file: lockFile, release: () => {} } }),
      { waitMs: 2000 },
    );
    try {
      expect(gate.start()).toBe(false);
      const busy = await gate.ready().then(
        () => null,
        (e: unknown) => e,
      );
      expect(busy).toBeInstanceOf(ToolError);
      expect((busy as ToolError).body()).toMatchObject({ code: "ENGINE_BUSY", recoverable: true });
      expect(client.getState()).toBe("stopped");

      holder = null; // the other engine exited
      await gate.ready();
      expect(client.getState()).toBe("connected");
      expect(gate.holdsLock()).toBe(true);
      gate.release();
      expect(client.getState()).toBe("stopped");
    } finally {
      gate.release();
      await plugin.close();
    }
  });

  it("says why the bridge is not there when Lightroom does not answer", async () => {
    const client = new BridgeClient({ commandPort: 1, eventPort: 2, reconnectMs: 20, connectTimeoutMs: 100, readToken: () => null });
    const gate = new BridgeGate(client, () => ({ ok: true, lock: { file: lockFile, release: () => {} } }), { waitMs: 150 });
    try {
      const e = await gate.ready().then(
        () => null,
        (err: unknown) => err as Error,
      );
      expect(e?.message).toMatch(/last error: no bridge token/);
    } finally {
      gate.release();
    }
  });
});
