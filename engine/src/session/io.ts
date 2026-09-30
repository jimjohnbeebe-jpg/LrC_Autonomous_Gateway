// What every session operation shares: the bridge calls for a session photo (read, write, render),
// the log writes, and the pieces of a tool result. Each call names its photo, the target `t`: the
// master in Converge mode, a copy in Variants mode (targets.ts selects it first).
// Every write and every export of a session goes through write() and render() here (the guardrail's
// corrections and undo, the probe's writes and put-back included), so these are where an Abort from
// the HUD stops the running operation (PHASE5_PLAN decision 3) and where the HUD hears "applying" and
// "acquiring preview" (row 5) [handle: tests\hud-abort.test.ts "stops a step before its next write"].

import { BridgeError } from "../bridge/index.js";
import type { PassEntry } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import type { Metrics } from "../metrics/index.js";
import { differingSettings, type CanonicalSettings, type CanonicalValue, type FromSdkResult } from "../params/index.js";
import { composite } from "../preview/index.js";
import { WRITE_TIMEOUT_MS, type Rendered, type ReturnImage, type Session, type SessionContext, type Target } from "./types.js";

export const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;
export const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A photo of the session as a result names it: "copy A" or the master's file name. */
export function photoName(t: Target): string {
  return t.id === "master" ? `"${t.filename ?? t.uuid}"` : `copy ${t.id} ("${t.copy_name ?? t.uuid}")`;
}

/** Run a bridge call for a session photo; a changed selection keeps the session open (PRD 6.13). */
export async function bridge<T>(s: Session, t: Target, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const error = toToolError(err);
    if (error.code !== "TARGET_CHANGED") throw error;
    const again = s.mode === "variants" ? "Repeat the call: it selects that photo first" : "Select that photo again, then repeat the call";
    throw new ToolError(
      "TARGET_CHANGED",
      `The photo selected in Lightroom is not this session's ${photoName(t)}. Nothing was written. ${again}; the session is still open.`,
      true,
      { session_id: s.id, target: t.id, target_uuid: t.uuid },
    );
  }
}

export async function read(ctx: SessionContext, s: Session, t: Target): Promise<FromSdkResult> {
  const res = await bridge(s, t, () => ctx.deps.client.request("get_settings", { target_uuid: t.uuid }));
  return ctx.deps.map.fromSdk(res.settings);
}

/**
 * The error for a session the user is aborting from the HUD or the menu: the running operation stops
 * here, and the session's queue puts the photo back next (session\hud-actions.ts).
 */
export function abortError(s: Session): ToolError {
  const a = s.abort;
  const from = a?.source === "menu" ? "the Abort Session menu item" : "the HUD";
  const failedNote = a?.state === "failed" ? " Putting the photo back failed: end the session with lr_end_session outcome \"revert\"." : " The engine is putting the photo back as it was before the session.";
  return new ToolError("SESSION_ENDED", `The user aborted session ${s.id} from ${from}; nothing more is written.${failedNote} Start a new session only if the user asks.`, false, {
    session_id: s.id,
    outcome: "aborted",
    source: a?.source ?? "hud",
    state: a?.state === "failed" ? "revert_failed" : "reverting",
  });
}

/** Before a write or an export: refused once the user has aborted the session. */
export function checkAbort(s: Session): void {
  if (s.abort) throw abortError(s);
}

/**
 * A write the plugin got but did not answer (the bridge dropped, or no answer in time) may have been
 * applied: say so, so the call's error does not read as "nothing was written" (the classification of
 * PHASE4_PLAN rows 8-10). The session reads the photo before its next step (step.ts, fresh()).
 */
function maybeWritten(err: unknown, historyName: string): unknown {
  if (!(err instanceof BridgeError) || (err.code !== "disconnected" && err.code !== "timeout")) return err;
  const e = toToolError(err);
  return new ToolError(e.code, `${e.message}. "${historyName}" was sent and may have been written; the next lr_step reads the photo first.`, e.recoverable, {
    maybe_written: true,
    history_name: historyName,
  });
}

/** Write canonical values as one History step and check the read-back (Phase 0, P-12). */
export async function write(ctx: SessionContext, s: Session, t: Target, values: Record<string, CanonicalValue>, historyName: string): Promise<FromSdkResult> {
  checkAbort(s);
  const { client, map } = ctx.deps;
  const sdk = map.toSdk(values, { processVersion: t.process_version });
  ctx.deps.hud?.stage(s, "applying");
  const res = await bridge(s, t, () =>
    client
      .request("apply_settings", { target_uuid: t.uuid, settings: sdk, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS })
      .catch((err: unknown) => Promise.reject(maybeWritten(err, historyName))),
  );
  const mismatches = map.verifyReadback(sdk, res.read_back);
  if (mismatches.length > 0) {
    throw new ToolError("WRITE_NOT_TAKEN", `Lightroom did not take ${mismatches.map((m) => m.sdk_key).join(", ")} as written in "${historyName}".`, false, {
      history_name: historyName,
      mismatches,
    });
  }
  return map.fromSdk(res.read_back);
}

/**
 * Render a session photo, measuring the session's regions. `settings` are the settings the render
 * shows (the last read-back). `keep: false` leaves the photo's last render alone (probes).
 */
export async function render(ctx: SessionContext, s: Session, t: Target, settings: CanonicalSettings, options: { keep?: boolean; longEdge?: number } = {}): Promise<Rendered> {
  checkAbort(s);
  const longEdge = options.longEdge ?? s.longEdge;
  ctx.deps.hud?.stage(s, "acquiring_preview");
  const preview = await bridge(s, t, () =>
    ctx.deps.render({
      longEdge,
      quality: s.quality,
      targetUuid: t.uuid,
      regions: s.regions.map((r) => ({ label: r.label, box: r.box })),
    }),
  );
  // The export's metrics are measured with it (preview\service.ts); this stage covers the checks on them.
  ctx.deps.hud?.stage(s, "metrics");
  const rendered: Rendered = {
    metrics: preview.metrics,
    jpeg: preview.jpeg,
    hash: preview.sha256,
    width: preview.width,
    height: preview.height,
    timings: preview.timings,
    settings,
    longEdge,
    preview,
  };
  if (options.keep !== false) t.last = rendered;
  return rendered;
}

/**
 * The photo's last render, rendered again first when it no longer stands for the photo as the
 * session measures it (Greptile, PR #23):
 *   - its settings are not the photo's now (an edit in Lightroom between calls, or a render after
 *     a write failed);
 *   - it is at another size than the session's (lr_get_preview with another long_edge), since
 *     resizing averages pixels and so moves the clipping counts [inference].
 * The guardrails, deltas and convergence then compare like with like [handle: tests\session-step.test.ts
 * "renders again before a step when the photo was edited in Lightroom since the last render",
 * tests\session-probe.test.ts "renders at the session's size again before a step that follows a
 * preview at another size"].
 */
export async function fresh(ctx: SessionContext, s: Session, t: Target, view: FromSdkResult): Promise<{ last: Rendered; refreshed: boolean }> {
  if (t.last && t.last.longEdge === s.longEdge && differingSettings(t.last.settings, view.settings).length === 0) return { last: t.last, refreshed: false };
  return { last: await render(ctx, s, t, view.settings), refreshed: true };
}

/** "AVG <id> pass n/N" (PRD FR-4.4); a copy's steps name the copy, "AVG <id> A pass n/N" [inference: the letter is this engine's addition]. */
export function historyName(s: Session, t: Target, n: number, suffix?: string): string {
  const photo = t.id === "master" ? "" : ` ${t.id}`;
  return `AVG ${s.short}${photo} pass ${n}/${s.maxPasses}${suffix ? ` ${suffix}` : ""}`;
}

export async function image(s: Session, mode: ReturnImage, before: Rendered, after: Rendered, beforeLabel: string, afterLabel: string): Promise<Buffer | null> {
  if (mode === "none") return null;
  if (mode === "after") return after.jpeg;
  const out = await composite(
    [
      { image: before.jpeg, label: beforeLabel },
      { image: after.jpeg, label: afterLabel },
    ],
    { longEdge: s.longEdge, quality: s.quality },
  );
  return out.jpeg;
}

export function describe(r: Rendered): Record<string, unknown> {
  return { preview_source: "export", preview_hash: r.hash, width: r.width, height: r.height };
}

export function brief(m: Metrics): Record<string, number> {
  return { luma_mean: m.luma_mean, clip_high_pct: m.clip_high_pct, clip_low_pct: m.clip_low_pct };
}

export function recordPass(s: Session, entry: PassEntry): void {
  s.log.passes.push(entry);
  saveLog(s);
}

export function saveLog(s: Session): void {
  s.log.regions = s.regions.map((r) => ({ ...r, box: { ...r.box }, baselines: { ...r.baselines } }));
  s.files.writeLog(s.log);
}

/** Record a failure in the open session's log and return the error to throw, naming the session. */
export function failed(ctx: SessionContext, s: Session, stage: string, err: unknown): ToolError {
  const error = toToolError(err);
  if (error.code === "SESSION_ENDED") {
    // Not a failure: the user's Abort stopped this operation; the log's ended_by names it.
    if (s.abort) s.abort.interrupted ??= stage;
    return error;
  }
  s.log.failures.push({ at: ctx.now().toISOString(), stage, error: error.body() });
  try {
    saveLog(s);
  } catch {
    // the error being reported matters more than the log write
  }
  const details = typeof error.details === "object" && error.details !== null ? error.details : {};
  const back = s.mode === "variants" ? "puts the master back (the copies stay in the catalog)" : "puts the photo back";
  return new ToolError(error.code, `${error.message} (session ${s.id} is still open; lr_end_session with outcome "revert" ${back}.)`, error.recoverable, {
    ...details,
    session_id: s.id,
  });
}
