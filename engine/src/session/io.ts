// What every session operation shares: the bridge calls for the session's photo (read, write,
// render), the log writes, and the pieces of a tool result.

import type { PassEntry } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import type { Metrics } from "../metrics/index.js";
import { differingSettings, type CanonicalSettings, type CanonicalValue, type FromSdkResult } from "../params/index.js";
import { composite } from "../preview/index.js";
import { WRITE_TIMEOUT_MS, type Rendered, type ReturnImage, type Session, type SessionContext } from "./types.js";

export const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;
export const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Run a bridge call for the session; a changed selection keeps the session open (PRD 6.13). */
export async function bridge<T>(s: Session, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const error = toToolError(err);
    if (error.code !== "TARGET_CHANGED") throw error;
    throw new ToolError(
      "TARGET_CHANGED",
      `The photo selected in Lightroom is not this session's photo ("${s.target.filename ?? s.target.uuid}"). Nothing was written. ` +
        "Select that photo again, then repeat the call; the session is still open.",
      true,
      { session_id: s.id, target_uuid: s.target.uuid },
    );
  }
}

export async function read(ctx: SessionContext, s: Session): Promise<FromSdkResult> {
  const res = await bridge(s, () => ctx.deps.client.request("get_settings", { target_uuid: s.target.uuid }));
  return ctx.deps.map.fromSdk(res.settings);
}

/** Write canonical values as one History step and check the read-back (Phase 0, P-12). */
export async function write(ctx: SessionContext, s: Session, values: Record<string, CanonicalValue>, historyName: string): Promise<FromSdkResult> {
  const { client, map } = ctx.deps;
  const sdk = map.toSdk(values, { processVersion: s.target.process_version });
  const res = await bridge(s, () =>
    client.request("apply_settings", { target_uuid: s.target.uuid, settings: sdk, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS }),
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
 * Render the session's photo, measuring its regions. `settings` are the settings the render
 * shows (the last read-back). `keep: false` leaves the session's last render alone (probes).
 */
export async function render(ctx: SessionContext, s: Session, settings: CanonicalSettings, options: { keep?: boolean; longEdge?: number } = {}): Promise<Rendered> {
  const longEdge = options.longEdge ?? s.longEdge;
  const preview = await bridge(s, () =>
    ctx.deps.render({
      longEdge,
      quality: s.quality,
      targetUuid: s.target.uuid,
      regions: s.regions.map((r) => ({ label: r.label, box: r.box })),
    }),
  );
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
  if (options.keep !== false) s.last = rendered;
  return rendered;
}

/**
 * The last render, rendered again first when it no longer stands for the photo as the session
 * measures it (Greptile, PR #23):
 *   - its settings are not the photo's now (an edit in Lightroom between calls, or a render after
 *     a write failed);
 *   - it is at another size than the session's (lr_get_preview with another long_edge), since
 *     resizing averages pixels and so moves the clipping counts [inference].
 * The guardrails, deltas and convergence then compare like with like [handle: tests\session-step.test.ts
 * "renders again before a step when the photo was edited in Lightroom since the last render",
 * tests\session-probe.test.ts "renders at the session's size again before a step that follows a
 * preview at another size"].
 */
export async function fresh(ctx: SessionContext, s: Session, view: FromSdkResult): Promise<{ last: Rendered; refreshed: boolean }> {
  if (s.last && s.last.longEdge === s.longEdge && differingSettings(s.last.settings, view.settings).length === 0) return { last: s.last, refreshed: false };
  return { last: await render(ctx, s, view.settings), refreshed: true };
}

export function historyName(s: Session, n: number, suffix?: string): string {
  return `AVG ${s.short} pass ${n}/${s.maxPasses}${suffix ? ` ${suffix}` : ""}`;
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
  s.log.regions = s.regions.map((r) => ({ ...r, box: { ...r.box } }));
  s.files.writeLog(s.log);
}

/** Record a failure in the open session's log and return the error to throw, naming the session. */
export function failed(ctx: SessionContext, s: Session, stage: string, err: unknown): ToolError {
  const error = toToolError(err);
  s.log.failures.push({ at: ctx.now().toISOString(), stage, error: error.body() });
  try {
    saveLog(s);
  } catch {
    // the error being reported matters more than the log write
  }
  const details = typeof error.details === "object" && error.details !== null ? error.details : {};
  return new ToolError(error.code, `${error.message} (session ${s.id} is still open; lr_end_session with outcome "revert" puts the photo back.)`, error.recoverable, {
    ...details,
    session_id: s.id,
  });
}
