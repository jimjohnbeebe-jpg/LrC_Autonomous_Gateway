// lr_set_settings, Phase 2's temporary "lr_step-lite": absolute values, one History step, read back.
// It is no longer offered over MCP: lr_step replaces it (PHASES.md Phase 2, "Inputs for Phase 3").
// setSettings() stays for the Phase 2 check (devtools\phase2-check.ts), which calls the Tools class
// directly.

import { deltaMetrics, summarize } from "../metrics/index.js";
import type { CanonicalValue } from "../params/index.js";
import { readbackError, toToolError } from "./errors.js";
import { DEFAULT_LONG_EDGE, describe, ms, render, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

/**
 * A write with its read-back took under 1 s in Phase 1 (0.45-1 s receipt to receipt)
 * [handle: docs\reports\phase1\PHASE1.md "Numbers"]; 30 s leaves room for a busy Lightroom.
 */
/** The plugin's write gate waits up to 60 s for the catalog (plugin\LrC-AVG.lrplugin\Gate.lua); 90 s leaves room for the write. */
const WRITE_TIMEOUT_MS = 90000;

export type SetSettingsArgs = {
  uuid: string;
  settings: Record<string, CanonicalValue>;
  return_image?: "after" | "none" | undefined;
  long_edge?: number | undefined;
};

export async function setSettings(ctx: ToolContext, args: SetSettingsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_settings", args, async () => {
    const { client, map } = ctx.deps;
    const started = performance.now();
    await ctx.deps.ensureBridge();

    // The settings before the write; the plugin refuses here already if another photo is selected.
    let t = performance.now();
    const before = await client.request("get_settings", { target_uuid: args.uuid });
    const getSettingsMs = ms(t);
    const view = map.fromSdk(before.settings); // refuses an unsupported process version
    const sdk = map.toSdk(args.settings, { processVersion: view.process_version }); // unknown or out-of-range: refused, nothing written

    ctx.writes++;
    const historyName = `${ctx.historyPrefix} set ${ctx.writes}`;
    t = performance.now();
    const res = await client.request(
      "apply_settings",
      { target_uuid: args.uuid, settings: sdk, history_name: historyName },
      { timeoutMs: WRITE_TIMEOUT_MS },
    );
    const writeMs = ms(t);

    // Every write is read back (Phase 0, P-12): Lightroom silently drops values it does not take
    // [handle: docs\reports\phase1\PHASE1.md "Run 3", range probe].
    const after = map.fromSdk(res.read_back);
    const changes = Object.keys(args.settings).map((name) => ({
      name,
      before: view.settings[name] ?? null,
      requested: args.settings[name] ?? null,
      after: after.settings[name] ?? null,
    }));
    const error = readbackError(map, sdk, res.read_back, historyName, client.hello(), { changes }); // `changes`: what the photo holds now
    if (error) throw error;

    const timings: Record<string, unknown> = {
      get_settings_ms: getSettingsMs,
      write_ms: writeMs,
      plugin_apply_ms: Math.round(res.apply_ms * 10) / 10,
      ...(res.read_ms !== undefined ? { plugin_read_ms: Math.round(res.read_ms * 10) / 10 } : {}),
      ...(res.command_ms !== undefined ? { plugin_command_ms: Math.round(res.command_ms * 10) / 10 } : {}),
    };
    const json: Record<string, unknown> = { ok: true, uuid: res.uuid, history_name: historyName, changes, read_back: "as written" };
    const image = args.return_image !== "none" ? await previewAfterWrite(ctx, res.uuid, args.long_edge, json, timings) : undefined;
    timings["total_ms"] = ms(started);
    json["timings"] = timings;
    return {
      json,
      ...(image ? { image } : {}),
      log: {
        uuid: res.uuid,
        history_name: historyName,
        changes,
        preview_hash: json["preview_hash"] ?? null,
        delta_metrics: json["delta_metrics"] ?? null,
        ...(json["preview_error"] ? { preview_error: json["preview_error"] } : {}),
        timings,
      },
    };
  });
}

/**
 * Render the photo after a write, adding the preview's fields to `json` and its timings to
 * `timings`. The write has happened by now. If only the render fails, the call still reports the
 * write (ok, History name, changes) with `preview_error`, so it is not mistaken for a failed write
 * and repeated (Greptile, PR #17).
 */
async function previewAfterWrite(
  ctx: ToolContext,
  uuid: string,
  longEdge: number | undefined,
  json: Record<string, unknown>,
  timings: Record<string, unknown>,
): Promise<Buffer | undefined> {
  const previous = ctx.last?.uuid === uuid ? ctx.last : null;
  try {
    const preview = await render(ctx, longEdge ?? DEFAULT_LONG_EDGE, uuid);
    Object.assign(json, describe(preview), {
      metrics: summarize(preview.metrics),
      delta_metrics: previous ? deltaMetrics(previous.metrics, preview.metrics) : null,
      ...(previous ? { delta_against: previous.preview_hash } : { delta_note: "no earlier preview of this photo in this engine run" }),
    });
    timings["preview"] = preview.timings;
    return preview.jpeg;
  } catch (err) {
    json["preview_error"] = toToolError(err).body();
    return undefined;
  }
}
