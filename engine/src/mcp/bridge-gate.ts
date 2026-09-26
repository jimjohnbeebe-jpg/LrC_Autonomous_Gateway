// The engine talks to Lightroom only while it holds the instance lock (instance-lock.ts). The gate
// tries the lock when the engine starts and again on each tool call, so an engine that started
// second takes over once the first one exits. Without the lock, tools answer ENGINE_BUSY.

import { BridgeError, type BridgeClient } from "../bridge/index.js";
import { ToolError } from "./errors.js";
import type { InstanceLock, LockResult } from "./instance-lock.js";

/** How long a tool call waits for the bridge (a connect takes ~0.5 s: PHASE1.md "Numbers", connect_ms 521). */
const DEFAULT_WAIT_MS = 5000;

export class BridgeGate {
  private readonly client: BridgeClient;
  private readonly acquire: () => LockResult;
  private readonly waitMs: number;
  private lock: InstanceLock | null = null;
  private lastBusy: { pid: number; file: string } | null = null;

  constructor(client: BridgeClient, acquire: () => LockResult, options: { waitMs?: number } = {}) {
    this.client = client;
    this.acquire = acquire;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  }

  /** Take the lock if it is free and start connecting. Returns whether this engine holds it. */
  start(): boolean {
    if (this.lock) return true;
    const result = this.acquire();
    if (!result.ok) {
      this.lastBusy = { pid: result.pid, file: result.file };
      return false;
    }
    this.lock = result.lock;
    this.lastBusy = null;
    this.client.start();
    return true;
  }

  holdsLock(): boolean {
    return this.lock !== null;
  }

  /** Resolves when the bridge is connected; throws ENGINE_BUSY or the bridge's own error. */
  async ready(): Promise<void> {
    if (!this.start()) {
      const busy = this.lastBusy;
      throw new ToolError(
        "ENGINE_BUSY",
        `Another LrC-AVG engine (process ${String(busy?.pid)}) is using the Lightroom bridge. ` +
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

  /** Stop the bridge and give the lock back. */
  release(): void {
    this.client.stop();
    this.lock?.release();
    this.lock = null;
  }
}
