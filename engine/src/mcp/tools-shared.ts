// What the tool groups share (tools.ts has the list of groups): the dependencies, the state of one
// engine run (the session manager, the last render, the write count), the preview settings, and
// the helpers every tool uses: run (tool log and bridge-gate bracketing), render, and the guards.

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary } from "../intents/index.js";
import type { ToolLog } from "../log/index.js";
import type { Metrics, Region } from "../metrics/index.js";
import type { ParamMap } from "../params/index.js";
import type { PreviewService, RenderedPreview } from "../preview/index.js";
import { SessionManager } from "../session/index.js";
import { ToolError, toToolError } from "./errors.js";

/** Preview long edge and JPEG quality: PRD section 6.2 defaults and range (the settings page is Phase 5). */
export const DEFAULT_LONG_EDGE = 1600;
export const MIN_LONG_EDGE = 800;
export const MAX_LONG_EDGE = 1920;
export const PREVIEW_QUALITY = 75;

export type ToolOutput = {
  json: Record<string, unknown>;
  image?: Buffer;
  /** What the tool log records for this call, beyond the tool name, arguments and outcome. */
  log?: Record<string, unknown>;
};

export type LastRender = {
  uuid: string;
  preview_hash: string;
  rendered_at: string;
  width: number;
  height: number;
  metrics: Metrics;
};

export type ToolsDeps = {
  client: BridgeClient;
  map: ParamMap;
  previews: PreviewService;
  /** The intent library (Phase 3); the intent and session tools refuse without it. */
  intents?: IntentLibrary;
  /** The folder of the session logs and recipes (log\session-log.ts); the session tools refuse without it. */
  sessionLogDir?: string;
  engineVersion?: string;
  /** Resolves when the bridge is connected (bridge-gate.ts), or throws. */
  ensureBridge: () => Promise<void>;
  log?: ToolLog;
  /** History names are "<prefix> set <n>"; they must start with "AVG " (PRD FR-4.4, C-7). */
  historyPrefix?: string;
  /** Called when a tool call begins and ends (the gate's idle release, bridge-gate.ts). */
  onCallStart?: () => void;
  onCallEnd?: () => void;
  now?: () => Date;
};

/** One engine run's tools: their dependencies and state, passed to every tool function. */
export type ToolContext = {
  readonly deps: ToolsDeps;
  readonly historyPrefix: string;
  readonly now: () => Date;
  /** Null when the engine was started without intents or a log folder. */
  sessions: SessionManager | null;
  /** Writes by setSettings (tools-write.ts), for its History names. */
  writes: number;
  /** The last preview this engine rendered, if any. */
  last: LastRender | null;
};

export const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

export function createContext(deps: ToolsDeps): ToolContext {
  const historyPrefix = deps.historyPrefix ?? `AVG ${randomUUID().slice(0, 4)}`;
  if (!historyPrefix.startsWith("AVG ")) throw new Error(`history prefix must start with "AVG ": ${historyPrefix}`);
  const ctx: ToolContext = { deps, historyPrefix, now: deps.now ?? (() => new Date()), sessions: null, writes: 0, last: null };
  ctx.sessions =
    deps.intents && deps.sessionLogDir
      ? new SessionManager({
          client: deps.client,
          map: deps.map,
          intents: deps.intents,
          render: (r) => render(ctx, r.longEdge, r.targetUuid, r.regions, r.quality),
          logDir: deps.sessionLogDir,
          engineVersion: deps.engineVersion ?? "unknown",
          now: ctx.now,
        })
      : null;
  return ctx;
}

export function sessionTools(ctx: ToolContext): SessionManager {
  if (!ctx.sessions) throw new ToolError("INTERNAL_ERROR", "This engine was started without the intent library or a session log folder.", false);
  return ctx.sessions;
}

/** The open session with this id, or SESSION_NOT_ACTIVE. */
export function openSession(ctx: ToolContext, sessionId: string): { id: string; uuid: string } {
  const open = ctx.sessions?.current() ?? null;
  if (!open || open.id !== sessionId) {
    throw new ToolError("SESSION_NOT_ACTIVE", open ? `Session ${sessionId} is not the open one (${open.id}).` : `No session is open (asked for ${sessionId}).`, false);
  }
  return open;
}

export function library(ctx: ToolContext): IntentLibrary {
  if (!ctx.deps.intents) throw new ToolError("INTERNAL_ERROR", "This engine was started without the intent library.", false);
  return ctx.deps.intents;
}

export async function render(ctx: ToolContext, longEdge: number, targetUuid?: string, regions: readonly Region[] = [], quality = PREVIEW_QUALITY): Promise<RenderedPreview> {
  const preview = await ctx.deps.previews.render({
    longEdge,
    quality,
    regions,
    ...(targetUuid !== undefined ? { targetUuid } : {}),
  });
  ctx.last = {
    uuid: preview.uuid,
    preview_hash: preview.sha256,
    rendered_at: preview.rendered_at,
    width: preview.width,
    height: preview.height,
    metrics: preview.metrics,
  };
  return preview;
}

export function describe(preview: RenderedPreview): Record<string, unknown> {
  return {
    uuid: preview.uuid,
    preview_hash: preview.sha256,
    preview_source: preview.source,
    width: preview.width,
    height: preview.height,
    bytes: preview.bytes,
    reencoded: preview.reencoded,
  };
}

/**
 * Run a tool: log it, and tell the bridge gate a call is in progress. A tool that never uses
 * Lightroom (`usesBridge: false`, the intent tools) leaves the gate alone, so it does not restart
 * the idle release of a bridge lock this engine holds (Greptile, PR #22) [handle: the gate's idle
 * timer is cleared and restarted only in beginUse/endUse, engine\src\mcp\bridge-gate.ts; test
 * tests\intents.test.ts "leaves the bridge gate alone": three intent calls, 0 gate calls].
 */
export function run(ctx: ToolContext, tool: string, args: unknown, fn: () => Promise<ToolOutput>): Promise<ToolOutput>;
export function run(ctx: ToolContext, tool: string, args: unknown, options: { usesBridge: boolean }, fn: () => Promise<ToolOutput>): Promise<ToolOutput>;
export async function run(
  ctx: ToolContext,
  tool: string,
  args: unknown,
  optionsOrFn: { usesBridge: boolean } | (() => Promise<ToolOutput>),
  maybeFn?: () => Promise<ToolOutput>,
): Promise<ToolOutput> {
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : (maybeFn as () => Promise<ToolOutput>);
  const usesBridge = typeof optionsOrFn === "function" ? true : optionsOrFn.usesBridge;
  const ts = ctx.now().toISOString();
  const started = performance.now();
  if (usesBridge) ctx.deps.onCallStart?.();
  try {
    const out = await fn();
    ctx.deps.log?.append({ ts, tool, ok: true, duration_ms: ms(started), args, ...out.log });
    return out;
  } catch (err) {
    const error = toToolError(err);
    ctx.deps.log?.append({ ts, tool, ok: false, duration_ms: ms(started), args, error: error.body() });
    throw error;
  } finally {
    if (usesBridge) ctx.deps.onCallEnd?.();
  }
}
