// What the tool groups share (tools.ts has the list of groups): the dependencies, the state of one
// engine run (the session manager, the last render, the write count), the preview settings, and
// the helpers every tool uses: run (tool log and bridge-gate bracketing), render, and the guards.

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary } from "../intents/index.js";
import type { ToolLog } from "../log/index.js";
import type { Metrics, Region } from "../metrics/index.js";
import type { ParamMap, PresetFormat } from "../params/index.js";
import type { PreviewRequest, PreviewService, RenderedPreview } from "../preview/index.js";
import { SessionManager } from "../session/index.js";
import type { KnownLogFolders, PageSettings } from "../settings/index.js";
import { ToolError, toToolError } from "./errors.js";

/**
 * Preview long edge and JPEG quality outside a session: PRD section 6.2 defaults and range. A session
 * takes the settings page's (settings\session.ts); AVG-006 has the engine read the page at session start.
 */
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
  /**
   * The folder of the session logs and recipes (log\session-log.ts), or a function giving it at each
   * use (settings\folders.ts); the session tools refuse without it.
   */
  sessionLogDir?: string | (() => string);
  /**
   * The settings page (PHASE5_PLAN row 3): lr_begin_session, the intent tools, lr_get_session_log
   * and lr_sync_series read it through this. Absent, a session reads get_prefs directly and the
   * folders never change.
   */
  settings?: PageSettings;
  /** The log folders sessions were written to (settings\log-folders.ts); only the current folder is searched without it. */
  logFolders?: KnownLogFolders;
  /** Lightroom's preset folder (presets\folder.ts defaultPresetDir); lr_create_preset_from_active refuses without it. */
  presetDir?: string | undefined;
  /** How preset files are written; the pinned format (params\preset-format.lrc15.json) when absent. */
  presetFormat?: PresetFormat;
  engineVersion?: string;
  /** Resolves when the bridge is connected (bridge-gate.ts), or throws; `waitMs` shortens the wait. */
  ensureBridge: (waitMs?: number) => Promise<void>;
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
  const settings = deps.settings;
  ctx.sessions =
    deps.intents && deps.sessionLogDir
      ? new SessionManager({
          client: deps.client,
          map: deps.map,
          intents: deps.intents,
          render: (r) => render(ctx, r.longEdge, r.targetUuid, r.regions, r.quality),
          logDir: deps.sessionLogDir,
          ...(settings ? { readPage: () => settings.read() } : {}),
          ...(deps.logFolders ? { logFolders: deps.logFolders } : {}),
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

/**
 * How long a tool that only needs the page's folders (the intent tools, lr_get_session_log) waits
 * for Lightroom, the connection and the get_prefs answer together, before it keeps the folders it
 * has: the plugin answered a ping in 0.35 ms (median) and a connection took 521 ms [handle:
 * docs\reports\phase1\PHASE1.md "Numbers", connect_ms]; 2 s is [inference].
 */
export const PAGE_WAIT_MS = 2000;
/** get_prefs gets at least this long, even when the connection took nearly all of PAGE_WAIT_MS [inference]. */
const MIN_PAGE_REQUEST_MS = 100;

/**
 * Read the settings page for its folders (decision 2A of the PHASE5_PLAN row 3 plan [stated: Jim,
 * 2026-09-28, "Go with recommendations"]), within PAGE_WAIT_MS (plus at most MIN_PAGE_REQUEST_MS):
 * the connection first, then get_prefs with what is left (Greptile, PR #44). Never throws: without
 * an answer the folders stay as read before (or the variable's, or the defaults). Returns how the
 * read went, for the result; null for an engine without the page (the checks, the tests).
 */
export async function readPageFolders(ctx: ToolContext): Promise<string | null> {
  const settings = ctx.deps.settings;
  if (!settings) return null;
  const kept = (): string => (settings.last() ? "the page's folder as read before" : "no page read yet");
  const deadline = performance.now() + PAGE_WAIT_MS;
  try {
    await ctx.deps.ensureBridge(PAGE_WAIT_MS);
    const r = await settings.read(Math.max(MIN_PAGE_REQUEST_MS, Math.round(deadline - performance.now())));
    return r.read ? "read now" : `not read (${r.note ?? "no answer"}); ${kept()}`;
  } catch (err) {
    return `not read (${toToolError(err).code}); ${kept()}`;
  }
}

/** A tool that reads only the page's folders uses the bridge only when there is a page (the gate's idle release, PR #22). */
export function pageBridgeUse(ctx: ToolContext): { usesBridge: boolean } {
  return { usesBridge: ctx.deps.settings !== undefined };
}

export function library(ctx: ToolContext): IntentLibrary {
  if (!ctx.deps.intents) throw new ToolError("INTERNAL_ERROR", "This engine was started without the intent library.", false);
  return ctx.deps.intents;
}

export async function render(ctx: ToolContext, longEdge: number, targetUuid?: string, regions: readonly Region[] = [], quality = PREVIEW_QUALITY): Promise<RenderedPreview> {
  return renderRequest(ctx, {
    longEdge,
    quality,
    regions,
    ...(targetUuid !== undefined ? { targetUuid } : {}),
  });
}

/** Render any preview request (lr_sync_series names its photos with photoUuid) and keep it as the last render. */
export async function renderRequest(ctx: ToolContext, request: PreviewRequest): Promise<RenderedPreview> {
  const preview = await ctx.deps.previews.render(request);
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
