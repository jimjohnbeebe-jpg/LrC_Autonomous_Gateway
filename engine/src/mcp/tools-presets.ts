// The Develop preset tools of issue #215 (presets\lightroom.ts, apply.ts, checkpoint.ts, export.ts): lr_list_presets,
// lr_get_preset, lr_compare_presets and lr_export_preset read Lightroom's presets and LrC-AVG's checkpoints and change
// nothing in Lightroom; lr_apply_preset and lr_create_checkpoint write, in the session queue, so they run only between
// sessions (SessionManager.whenIdle), as lr_sync_series and lr_apply_denoise do. A plugin without the preset commands
// answers unknown_command to list_presets, which every tool sends first, so nothing is written on an older plugin
// (errors.ts fromBridge: FEATURE_UNAVAILABLE, "Update the plugin").

import { randomUUID } from "node:crypto";
import type { PresetScope } from "../bridge/index.js";
import { CALL_BUDGET_MS } from "../library/index.js";
import { hasAiMask } from "../params/index.js";
import {
  applyPresetToPhoto,
  brief,
  choosePreset,
  createCheckpoint,
  describePreset,
  diffPresets,
  exportPreset,
  listPresets,
  presetSettings,
  type ApplyOutcome,
  type CheckpointArgs,
  type LrPreset,
  type PresetSelector,
} from "../presets/index.js";
import { eachInBudget, type Budget } from "./tools-files.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** How many photos one lr_apply_preset call takes; the budget may stop it sooner (`not_yet`). */
export const MAX_PRESET_PHOTOS = 100;
export const LIST_LIMIT = { default: 200, max: 500 } as const;

export type ListPresetsArgs = { folder?: string | undefined; scope?: PresetScope | undefined; query?: string | undefined; offset?: number | undefined; limit?: number | undefined };
export type GetPresetArgs = PresetSelector & { raw?: boolean | undefined };
export type ComparePresetsArgs = { base: PresetSelector; candidate: PresetSelector; raw?: boolean | undefined };
export type ExportPresetArgs = PresetSelector & { destination_dir: string; filename?: string | undefined };
export type ApplyPresetArgs = PresetSelector & { uuids: string[] };
export type { CheckpointArgs };

async function chosen(ctx: ToolContext, sel: PresetSelector): Promise<LrPreset> {
  await ctx.deps.ensureBridge();
  return choosePreset(await listPresets(ctx.deps.client), sel);
}

/** A page of presets, grouped by folder in the order Lightroom lists them. */
function grouped(page: readonly LrPreset[]): Array<{ folder: string; scope: PresetScope; presets: Array<{ name: string; uuid: string }> }> {
  const folders = new Map<string, { folder: string; scope: PresetScope; presets: Array<{ name: string; uuid: string }> }>();
  for (const p of page) {
    const key = `${p.scope}\u0000${p.folder}`;
    const f = folders.get(key) ?? { folder: p.folder, scope: p.scope, presets: [] };
    f.presets.push({ name: p.name, uuid: p.uuid });
    folders.set(key, f);
  }
  return [...folders.values()];
}

export function listPresetsTool(ctx: ToolContext, args: ListPresetsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_list_presets", args, async () => {
    await ctx.deps.ensureBridge();
    const all = await listPresets(ctx.deps.client);
    const q = args.query?.toLowerCase();
    const hits = all.filter((p) => (args.folder === undefined || p.folder === args.folder) && (args.scope === undefined || p.scope === args.scope) && (!q || p.name.toLowerCase().includes(q)));
    const [offset, limit] = [args.offset ?? 0, args.limit ?? LIST_LIMIT.default];
    const page = hits.slice(offset, offset + limit);
    const json = {
      total: hits.length,
      offset,
      count: page.length,
      folders: grouped(page),
      ...(offset + limit < hits.length ? { next_offset: offset + limit } : {}),
      note: 'scope "plugin": LrC-AVG checkpoints (lr_create_checkpoint), which the Develop Presets panel does not show.',
    };
    return { json, log: { listed: all.length, matched: hits.length, returned: page.length } };
  });
}

export function getPresetTool(ctx: ToolContext, args: GetPresetArgs): Promise<ToolOutput> {
  return run(ctx, "lr_get_preset", args, async () => {
    const p = await chosen(ctx, args);
    const sdk = await presetSettings(ctx.deps.client, p);
    return { json: describePreset(ctx.deps.map, p, sdk, args.raw === true), log: { preset: brief(p) } };
  });
}

export function comparePresetsTool(ctx: ToolContext, args: ComparePresetsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_compare_presets", args, async () => {
    await ctx.deps.ensureBridge();
    const list = await listPresets(ctx.deps.client);
    const [base, candidate] = [choosePreset(list, args.base), choosePreset(list, args.candidate)];
    const [a, b] = [await presetSettings(ctx.deps.client, base), await presetSettings(ctx.deps.client, candidate)];
    const diff = diffPresets(ctx.deps.map, a, b, args.raw === true);
    const json = { base: brief(base), candidate: brief(candidate), changed_count: diff.changes.length + diff.other_changes.length, ...diff };
    return { json, log: { base: base.uuid, candidate: candidate.uuid, changed: json.changed_count } };
  });
}

export function exportPresetTool(ctx: ToolContext, args: ExportPresetArgs): Promise<ToolOutput> {
  return run(ctx, "lr_export_preset", args, async () => {
    const p = await chosen(ctx, args);
    const json = exportPreset(p, args.destination_dir, args.filename);
    return { json, log: { preset: p.uuid, destination: json["destination"] } };
  });
}

export function applyPresetTool(ctx: ToolContext, args: ApplyPresetArgs, budget: Budget = { now: () => performance.now(), ms: CALL_BUDGET_MS }): Promise<ToolOutput> {
  return run(ctx, "lr_apply_preset", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_apply_preset", async () => {
      const p = choosePreset(await listPresets(ctx.deps.client), args);
      const ai = hasAiMask(await presetSettings(ctx.deps.client, p));
      const id = randomUUID().slice(0, 6);
      const names = { snapshot: `AVG pre-preset ${id}`, history: `AVG preset ${id}: ${p.name}` };
      const applied: ApplyOutcome[] = [];
      const deps = { client: ctx.deps.client, map: ctx.deps.map };
      const { failed, left } = await eachInBudget(args.uuids, budget, () => applied, async (uuid) => {
        applied.push(await applyPresetToPhoto(deps, p, ai, uuid, names));
      });
      const json = {
        preset: brief(p),
        applied,
        failed: failed.map((f) => ({ uuid: f.item, code: f.code, message: f.message })),
        undo: `Each photo in \`applied\` has the snapshot "${names.snapshot}" (Develop, Snapshots panel) from just before the preset; applying it puts the photo back. The preset is the History step "${names.history}".`,
        ...(ai ? { ai_note: "The preset carries AI masks: Lightroom recomputes them for each photo in the background (`ai_update`); a render right after may not show them yet." } : {}),
        ...(left.length > 0 ? { not_yet: left, next: `Time is up for this call: call again with uuids = not_yet (${left.length} photos) and the same preset.` } : {}),
      };
      return { json, log: { preset: p.uuid, snapshot_name: names.snapshot, applied: applied.length, failed: failed.length, not_yet: left.length } };
    });
  });
}

/** In the session queue, as lr_create_preset_from_active: it reads a photo's settings between sessions. */
export function createCheckpointTool(ctx: ToolContext, args: CheckpointArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_checkpoint", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_create_checkpoint", () => createCheckpoint({ client: ctx.deps.client, map: ctx.deps.map }, args));
  });
}
