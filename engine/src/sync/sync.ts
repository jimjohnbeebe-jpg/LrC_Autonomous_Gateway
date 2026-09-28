// lr_sync_series (PRD 6.10, MCP_TOOLS lr_sync_series, PHASE4_PLAN row 8): copy a source's settings
// onto other photos, and with adaptive exposure match each one's brightness to the source's.
//   1. Checks, before anything is written: plugin 0.4.0; the source (source.ts); the mask (mask.ts);
//      the targets and their number (targets.ts); with adaptive exposure, the source photo, which
//      must still hold the recipe's settings, and whose render gives the luma to match. The caller
//      runs the sync in the session queue with no session open (SessionManager.whenIdle).
//   2. Per target (target.ts): snapshot "AVG pre-sync <id>", the copied settings as one History step
//      "AVG sync <id>", read back; adaptive exposure "AVG sync <id> exposure k" (exposure.ts). One
//      write per target rather than PRD 6.10's one write gate for all, so adaptive exposure can
//      render between writes and a failed target is skipped without stopping the rest [stated: Jim,
//      2026-09-27, "go with recommendations" on the row 8 plan, decision 4].
//   3. A contact sheet of the source and up to three targets.
// Tested against the Lightroom sim [handle: tests\sync.test.ts, tests\sync-adaptive.test.ts]; in
// Lightroom [unverified] until PHASE4_PLAN row 10.

import { randomUUID } from "node:crypto";
import { pluginVersionAtLeast } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { canonicalValuesEqual } from "../params/index.js";
import { composite, type Panel, type RenderedPreview } from "../preview/index.js";
import { MASK_GROUPS, applyMask } from "./mask.js";
import { resolveSource, type ResolvedSource } from "./source.js";
import { syncTarget } from "./target.js";
import { resolveTargets, type Skip } from "./targets.js";
import { MAX_ADAPTIVE_TARGETS, MAX_TARGETS, SHEET_TARGETS, SYNC_PLUGIN, type SyncArgs, type SyncDeps, type SyncOutput, type SyncRun, type TargetResult } from "./types.js";

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

function checkPlugin(deps: SyncDeps): void {
  const version = deps.client.hello()?.plugin_version;
  if (pluginVersionAtLeast(version, SYNC_PLUGIN)) return;
  throw new ToolError(
    "PLUGIN_TOO_OLD",
    `lr_sync_series needs the LrC-AVG plugin ${SYNC_PLUGIN} or later (it writes to photos without selecting them); Lightroom runs ${String(version ?? "an unknown version")}. Restart Lightroom so it loads the current plugin.`,
    false,
  );
}

type Reference = { luma: number; exposure: number | null; render: RenderedPreview };

/** Adaptive exposure's goal: the source photo as it is, which must still hold the recipe's settings. */
async function measureSource(deps: SyncDeps, args: SyncArgs, source: ResolvedSource): Promise<Reference> {
  const photo = source.photo as NonNullable<ResolvedSource["photo"]>;
  const now = deps.map.fromSdk((await deps.client.request("get_settings", { photo_uuid: photo.uuid })).settings);
  const differing = Object.keys(source.settings).filter((k) => !canonicalValuesEqual(source.settings[k], now.settings[k])).sort();
  if (differing.length > 0) {
    throw new ToolError(
      "SOURCE_CHANGED",
      `The source photo "${photo.filename ?? photo.uuid}" no longer holds its recipe's settings (${differing.slice(0, 8).join(", ")}${differing.length > 8 ? ", …" : ""}), ` +
        "so its render is not the look to match. Put it back to the recipe, or sync without adaptive_exposure. Nothing was written.",
      false,
      { differing },
    );
  }
  const render = await deps.render({ longEdge: args.long_edge, quality: args.quality, photoUuid: photo.uuid });
  const exposure = now.settings["exposure"];
  return { luma: render.metrics.luma_mean, exposure: typeof exposure === "number" ? exposure : null, render };
}

/** Sync each target in turn; a target that fails is skipped, but a lost bridge stops the call. */
async function syncAll(run: SyncRun, uuids: readonly string[], skipped: Skip[]): Promise<TargetResult[]> {
  const results: TargetResult[] = [];
  for (const [i, uuid] of uuids.entries()) {
    try {
      results.push(await syncTarget(run, uuid));
    } catch (err) {
      const error = toToolError(err);
      const d = (typeof error.details === "object" && error.details !== null ? error.details : {}) as Partial<Skip>;
      if (error.code === "BRIDGE_DISCONNECTED") {
        throw new ToolError(error.code, `${error.message} The sync stopped at target ${i + 1} of ${uuids.length}; the targets synced before it keep their settings.`, true, {
          synced: results.map((r) => r.uuid),
          stopped_at: uuid,
          ...(d.snapshot ? { snapshot: d.snapshot } : {}),
        });
      }
      skipped.push({ uuid, filename: d.filename ?? null, code: error.code, reason: error.message, ...(d.snapshot ? { snapshot: d.snapshot, history_names: d.history_names ?? [] } : {}) });
    }
  }
  return results;
}

/** The contact sheet: the source (when it is a photo) and the first targets, as they are now. */
async function sheet(run: SyncRun, source: ResolvedSource, reference: Reference | null, results: readonly TargetResult[]): Promise<{ image: Buffer; json: Record<string, unknown> } | null> {
  const render = (uuid: string): Promise<RenderedPreview> => run.deps.render({ longEdge: run.longEdge, quality: run.quality, photoUuid: uuid });
  const panels: Panel[] = [];
  if (source.photo) panels.push({ image: (reference?.render ?? (await render(source.photo.uuid))).jpeg, label: "source" });
  for (const [i, t] of results.slice(0, SHEET_TARGETS).entries()) {
    const offset = t.exposure?.offset;
    panels.push({ image: (t.render ?? (await render(t.uuid))).jpeg, label: `${i + 1}${typeof offset === "number" ? ` EV ${offset >= 0 ? "+" : ""}${offset.toFixed(2)}` : ""}` });
  }
  if (panels.length === 0) return null;
  const labels = panels.map((p) => p.label);
  if (panels.length === 1) return { image: (panels[0] as Panel).image, json: { panels: labels } };
  const c = await composite(panels, { longEdge: run.longEdge, quality: run.quality });
  return { image: c.jpeg, json: { panels: labels, layout: c.layout, width: c.width, height: c.height } };
}

function targetJson(t: TargetResult): Record<string, unknown> {
  const { render: _render, ...rest } = t;
  return rest;
}

export async function syncSeries(deps: SyncDeps, args: SyncArgs): Promise<SyncOutput> {
  const started = performance.now();
  checkPlugin(deps);
  const source = resolveSource(deps.logDir, deps.map, args.source);
  const groups = args.parameter_mask ?? [...MASK_GROUPS];
  const { copied, left } = applyMask(source.settings, groups, args.adaptive_exposure ? ["exposure"] : []);
  if (args.adaptive_exposure && !source.photo) {
    throw new ToolError("INVALID_ARGUMENTS", "adaptive_exposure needs a source photo to match (a session or a recipe); bare settings have none.", false);
  }
  if (!args.adaptive_exposure && Object.keys(copied).length === 0) {
    throw new ToolError("INVALID_ARGUMENTS", `Nothing to copy: the source has no settings in parameter_mask ${JSON.stringify(groups)}.`, false);
  }
  const cap = args.adaptive_exposure ? MAX_ADAPTIVE_TARGETS : MAX_TARGETS;
  const { uuids, skipped } = await resolveTargets(deps.client, args.targets, source.photo?.uuid ?? null, cap);
  const reference = args.adaptive_exposure ? await measureSource(deps, args, source) : null;
  const id = (deps.newId ?? randomUUID)();
  const run: SyncRun = { deps, short: id.replace(/-/g, "").slice(0, 4), copied, goal: reference && { luma: reference.luma, exposure: reference.exposure }, longEdge: args.long_edge, quality: args.quality };
  const results = await syncAll(run, uuids, skipped);
  let image: Awaited<ReturnType<typeof sheet>> = null;
  let imageError: unknown = null;
  if (args.return_image !== "none" && results.length > 0) {
    try {
      image = await sheet(run, source, reference, results);
    } catch (err) {
      imageError = toToolError(err).body(); // the writes happened; only the picture is missing
    }
  }
  return output({ id, run, source, groups, left, args, reference, results, skipped, image, imageError, started });
}

type OutputParts = {
  id: string;
  run: SyncRun;
  source: ResolvedSource;
  groups: readonly string[];
  left: string[];
  args: SyncArgs;
  reference: Reference | null;
  results: TargetResult[];
  skipped: Skip[];
  image: { image: Buffer; json: Record<string, unknown> } | null;
  imageError: unknown;
  started: number;
};

function output(p: OutputParts): SyncOutput {
  const sourceJson = { kind: p.source.kind, session_id: p.source.session_id, recipe_path: p.source.recipe_path, uuid: p.source.photo?.uuid ?? null, filename: p.source.photo?.filename ?? null };
  const offsets = p.args.adaptive_exposure ? Object.fromEntries(p.results.map((t) => [t.uuid, t.exposure?.offset ?? null])) : null;
  const targets = p.results.map(targetJson);
  const json: Record<string, unknown> = {
    ok: true,
    sync_id: p.id,
    source: sourceJson,
    parameter_mask: p.groups,
    adaptive_exposure: p.args.adaptive_exposure,
    copied: Object.keys(p.run.copied).sort(),
    not_copied: p.left,
    applied: p.results.length,
    skipped: p.skipped,
    per_target_exposure_offsets: offsets,
    ...(p.reference ? { source_luma: p.reference.luma } : {}),
    targets,
    undo: `Each synced photo has the snapshot "AVG pre-sync ${p.run.short}" from before the sync: apply it in Lightroom's Snapshots panel (or step back in History) to undo the sync on that photo.`,
    ...(p.image ? { image: p.image.json } : {}),
    ...(p.imageError ? { image_error: p.imageError } : {}),
    timings: { total_ms: ms(p.started) },
  };
  const log = { sync_id: p.id, source: sourceJson, parameter_mask: p.groups, adaptive_exposure: p.args.adaptive_exposure, applied: p.results.length, skipped: p.skipped, targets, timings: json["timings"] };
  return { json, ...(p.image ? { image: p.image.image } : {}), log };
}
