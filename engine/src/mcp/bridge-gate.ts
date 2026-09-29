// The engine talks to Lightroom only while it holds the instance lock (instance-lock.ts). Without
// the lock, tools answer ENGINE_BUSY, and the engine leaves the shared previews folder alone
// (`onAcquire` runs only once the lock is held).
//
// The lock is taken on the first tool call that needs the bridge, not when the engine starts, and
// (with `idleReleaseMs`) given back after that long without a tool call. Claude Desktop started two
// lrc-avg engines in the same second and sent every tool call to the one that did not hold the
// lock, because the other took it at start-up and was never called [handle: Jim's Phase 2 run,
// 2026-09-26: PIDs 2304 and 12632, both main.js children of claude.exe 10416 created 16:55:50 local;
// %LOCALAPPDATA%\Claude\Logs\mcp-server-lrc-avg.log, tool calls id 2-4 answered ENGINE_BUSY naming
// 2304; logs\engine-20260926.jsonl]. Why Desktop keeps two engines is [unverified].

import { BridgeError, type BridgeClient } from "../bridge/index.js";
import { ToolError } from "./errors.js";
import type { InstanceLock, LockResult } from "./instance-lock.js";

/**
 * How long a tool call waits for the bridge. Connecting took 521 ms in Phase 1 run 3
 * [handle: docs\reports\phase1\PHASE1.md "Numbers", connect_ms], but the plugin listens only ~10 s
 * after Lightroom starts [handle: docs\reports\phase2\PHASE2.md "Consequences", LR_SDK_NOTES
 * "Recorded in Phase 2": bridge log 16:54:50 -> 16:55:00, 17:44:57 -> 17:45:07, 18:50:58 -> 18:51:07],
 * and a call at 18:50:45 failed after the old 5 s wait. 15 s covers that (PHASES.md Phase 2, "Inputs
 * for Phase 3"). A call when Lightroom is closed waits the full 15 s before BRIDGE_DISCONNECTED.
 */
const DEFAULT_WAIT_MS = 15000;

export class BridgeGate {
  private readonly client: BridgeClient;
  private readonly acquire: () => Promise<LockResult>;
  private readonly waitMs: number;
  private readonly onAcquire: () => void;
  private readonly idleReleaseMs: number | null;
  private readonly onIdleRelease: () => void;
  private lock: InstanceLock | null = null;
  private starting: Promise<boolean> | null = null;
  private lastBusy: { port: number; pid: number | null } | null = null;
  private active = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    client: BridgeClient,
    acquire: () => Promise<LockResult>,
    options: { waitMs?: number; onAcquire?: () => void; idleReleaseMs?: number; onIdleRelease?: () => void } = {},
  ) {
    this.client = client;
    this.acquire = acquire;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.onAcquire = options.onAcquire ?? (() => {});
    this.idleReleaseMs = options.idleReleaseMs ?? null;
    this.onIdleRelease = options.onIdleRelease ?? (() => {});
  }

  /** A tool call begins: no idle release while any call runs. */
  beginUse(): void {
    this.active++;
    this.clearIdle();
  }

  /** A tool call ended: when none is left, give the lock back after `idleReleaseMs` without a new one. */
  endUse(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active > 0 || this.idleReleaseMs === null || !this.lock) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.active > 0 || !this.lock) return;
      this.onIdleRelease();
      void this.release();
    }, this.idleReleaseMs);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
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

  /**
   * Resolves when the bridge is connected; throws ENGINE_BUSY or the bridge's own error. `waitMs`
   * replaces the usual wait (the intent tools wait less, mcp\tools-intents.ts PAGE_WAIT_MS).
   */
  async ready(waitMs: number = this.waitMs): Promise<void> {
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
      await this.client.waitConnected(waitMs);
    } catch (err) {
      // Say why: e.g. no token file (plugin not running) or the connection refused.
      const why = this.client.stats.last_drop_reason ?? this.client.stats.last_connect_error;
      if (err instanceof BridgeError && why) throw new BridgeError(err.code, `${err.message}; last error: ${why}`, err.recoverable);
      throw err;
    }
  }

  /** Stop the bridge and give the lock back; resolves once the lock port is free. */
  async release(): Promise<void> {
    this.clearIdle();
    this.client.stop();
    const lock = this.lock;
    this.lock = null;
    await lock?.release();
  }
}
