// The engine talks to Lightroom only while it holds the instance lock (instance-lock.ts). The gate
// tries the lock when the engine starts and again on each tool call, so an engine that started
// second takes over once the first one exits. Without the lock, tools answer ENGINE_BUSY, and the
// engine leaves the shared previews folder alone (`onAcquire` runs only once the lock is held).

import { BridgeError, type BridgeClient } from "../bridge/index.js";
import { ToolError } from "./errors.js";
import type { InstanceLock, LockResult } from "./instance-lock.js";

/**
 * How long a tool call waits for the bridge. Connecting took 521 ms in Phase 1 run 3
 * [handle: docs\reports\phase1\PHASE1.md "Numbers", connect_ms].
 */
const DEFAULT_WAIT_MS = 5000;

export class BridgeGate {
  private readonly client: BridgeClient;
  private readonly acquire: () => Promise<LockResult>;
  private readonly waitMs: number;
  private readonly onAcquire: () => void;
  private lock: InstanceLock | null = null;
  private starting: Promise<boolean> | null = null;
  private lastBusy: { port: number; pid: number | null } | null = null;

  constructor(
    client: BridgeClient,
    acquire: () => Promise<LockResult>,
    options: { waitMs?: number; onAcquire?: () => void } = {},
  ) {
    this.client = client;
    this.acquire = acquire;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.onAcquire = options.onAcquire ?? (() => {});
  }

  /** Take the lock if it is free and start connecting. Resolves with whether this engine holds it. */
  start(): Promise<boolean> {
    if (this.lock) return Promise.resolve(true);
    // One attempt at a time: two tool calls at once must not both try to listen on the lock port.
    this.starting ??= this.acquire()
      .then((result) => {
        if (!result.ok) {
          this.lastBusy = { port: result.port, pid: result.pid };
          return false;
        }
        this.lock = result.lock;
        this.lastBusy = null;
        this.onAcquire();
        this.client.start();
        return true;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  holdsLock(): boolean {
    return this.lock !== null;
  }

  /** Resolves when the bridge is connected; throws ENGINE_BUSY or the bridge's own error. */
  async ready(): Promise<void> {
    if (!(await this.start())) {
      const busy = this.lastBusy;
      throw new ToolError(
        "ENGINE_BUSY",
        `Another LrC-AVG engine (process ${busy?.pid ?? "unknown"}) is using the Lightroom bridge. ` +
          "Close the other one (another Claude Desktop window, or the Phase 2 check), then try again.",
        true,
        busy ?? undefined,
      );
    }
    if (this.client.getState() === "connected") return;
    try {
      await this.client.waitConnected(this.waitMs);
    } catch (err) {
      // Say why: e.g. no token file (plugin not running) or the connection refused.
      const why = this.client.stats.last_drop_reason ?? this.client.stats.last_connect_error;
      if (err instanceof BridgeError && why) throw new BridgeError(err.code, `${err.message}; last error: ${why}`, err.recoverable);
      throw err;
    }
  }

  /** Stop the bridge and give the lock back; resolves once the lock port is free. */
  async release(): Promise<void> {
    this.client.stop();
    const lock = this.lock;
    this.lock = null;
    await lock?.release();
  }
}
