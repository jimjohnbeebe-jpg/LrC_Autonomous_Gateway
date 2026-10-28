// The Develop parity tools that drive LrDevelopController (issue #214; plugin DevelopTools.lua): lr_apply_auto,
// lr_reset and lr_set_process_version. As lr_apply_denoise (tools-denoise.ts): only between sessions
// (SessionManager.whenIdle), one plugin command per photo named by uuid, within the call budget (`not_yet`), each
// changed photo snapshotted first. On top: a photo a stopped engine's session left open is refused (SESSION_LEFT_OPEN,
// session\left-open.ts), and each photo's settings are read before the command so the result names what changed.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CALL_BUDGET_MS } from "../library/index.js";
import { ParamError, differingSettings, tableInfo, type ParamMap, type SdkSettings } from "../params/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { eachInBudget, type Budget } from "./tools-files.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** The plugin with the issue #214 commands (DevelopTools.lua, Snapshots.lua, Copies.lua). */
export const DEVELOP_PLUGIN = "1.5.0";
/** The plugin with the issue #217 mask commands (MaskClean.lua delete_empty_masks). */
export const MASK_PARITY_PLUGIN = "1.6.0";

export type ApplyAutoArgs = { uuids: string[]; tone?: boolean | undefined; white_balance?: boolean | undefined };
export type ResetArgs = { uuids: string[]; confirm: true };
export type DeleteEmptyMasksArgs = { uuids: string[] };
export type ProcessVersionArgs = { uuids: string[]; version: number; confirm: true };

export type Changes = { names: "canonical" | "sdk"; changed: Record<string, { before: unknown; after: unknown }>; masks?: { before: number; after: number } };

/**
 * What differs between two getDevelopSettings() tables: by canonical name (and the mask count), or by SDK key when
 * the map refuses to read one of them (a legacy process version, an unknown pipeline: params\map.ts fromSdk).
 */
export function settingChanges(map: ParamMap, before: SdkSettings, after: SdkSettings): Changes {
  try {
    const [b, a] = [map.fromSdk(before), map.fromSdk(after)];
    const changed = Object.fromEntries(differingSettings(b.settings, a.settings).map((k) => [k, { before: b.settings[k] ?? null, after: a.settings[k] ?? null }]));
    const masks = b.masks.fingerprint === a.masks.fingerprint ? {} : { masks: { before: b.masks.count, after: a.masks.count } };
    return { names: "canonical", changed, ...masks };
  } catch (err) {
    if (!(err instanceof ParamError)) throw err;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !isDeepStrictEqual(before[k], after[k])).sort();
    return { names: "sdk", changed: Object.fromEntries(keys.map((k) => [k, { before: before[k] ?? null, after: after[k] ?? null }])) };
  }
}

/** The session a stopped engine left open on this photo (master or Variants copy), if any. */
export function leftOpenOn(ctx: ToolContext, uuid: string): { session_id: string; snapshot: { name: string; id: string } } | null {
  const left = ctx.sessions?.leftOpen().find(({ log }) => log.target.uuid === uuid || log.variants.some((v) => v.uuid === uuid));
  return left ? { session_id: left.log.session_id, snapshot: left.log.snapshot } : null;
}

export const leftOpenReason = (sessionId: string): string =>
  `session ${sessionId} was left open on this photo by an engine that stopped; end it with lr_end_session first (lr_get_active_photo_context lists it)`;

type Answer = { uuid: string; status: string; reason?: string | undefined; snapshot?: { id: string; name: string } | undefined; read_back: SdkSettings; ms: number } & Record<string, unknown>;
type Outcome = Record<string, unknown> & { uuid: string; status: string };

/** Each photo in the budget: refused when a session was left open on it, else its settings read, `send`, and what changed. */
async function eachPhoto(ctx: ToolContext, uuids: string[], budget: Budget, send: (uuid: string, before: SdkSettings) => Promise<Answer>) {
  const photos: Outcome[] = [];
  const { failed, left } = await eachInBudget(uuids, budget, () => photos, async (uuid) => {
    const open = leftOpenOn(ctx, uuid);
    if (open) return void photos.push({ uuid, status: "refused", code: "SESSION_LEFT_OPEN", reason: leftOpenReason(open.session_id) });
    const before = (await ctx.deps.client.request("get_settings", { photo_uuid: uuid })).settings;
    ctx.deps.allowQuiet?.();
    try {
      const { read_back, ...answer } = await send(uuid, before);
      photos.push({ ...answer, ...settingChanges(ctx.deps.map, before, read_back) });
    } finally {
      ctx.deps.allowQuiet?.();
    }
  });
  const counts: Record<string, number> = {};
  for (const p of photos) counts[p.status] = (counts[p.status] ?? 0) + 1;
  if (failed.length > 0) counts["failed"] = (counts["failed"] ?? 0) + failed.length;
  return {
    photos,
    counts,
    failed: failed.map((f) => ({ uuid: f.item, code: f.code, message: f.message })),
    ...(left.length > 0 ? { not_yet: left, next: `Time is up for this call: call again with uuids = not_yet (${left.length} photos) and the same other arguments.` } : {}),
  };
}

const undoHint = (name: string): string =>
  `Each photo changed has the snapshot "${name}" from just before (Develop, Snapshots panel; or lr_apply_snapshot with its id), which puts it back. Lightroom's History panel also has the step.`;

type Send = (uuid: string, before: SdkSettings, snapshotName: string) => Promise<Answer>;
const DRIVES = { plugin: DEVELOP_PLUGIN, why: "it drives the Develop module photo by photo" };

async function developTool(ctx: ToolContext, tool: string, args: unknown, uuids: string[], prefix: string, budget: Budget, send: Send, need = DRIVES): Promise<ToolOutput> {
  return run(ctx, tool, args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, tool, need.plugin, need.why);
    const snapshotName = `AVG ${prefix} ${randomUUID().slice(0, 6)}`;
    return sessions.whenIdle(tool, async () => {
      const out = await eachPhoto(ctx, uuids, budget, (uuid, before) => send(uuid, before, snapshotName));
      return { json: { ...out, undo: undoHint(snapshotName) }, log: { snapshot_name: snapshotName, counts: out.counts, not_yet: out.not_yet?.length ?? 0 } };
    });
  });
}

const realBudget = (): Budget => ({ now: () => performance.now(), ms: CALL_BUDGET_MS });
const timeout = { timeoutMs: WRITE_TIMEOUT_MS };

export function applyAuto(ctx: ToolContext, args: ApplyAutoArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  const [tone, wb] = [args.tone === true, args.white_balance === true];
  return developTool(ctx, "lr_apply_auto", args, args.uuids, "pre-auto", budget, (uuid, _before, name) =>
    ctx.deps.client.request("apply_auto", { photo_uuid: uuid, tone, white_balance: wb, snapshot_name: name }, timeout),
  );
}

export function resetDevelop(ctx: ToolContext, args: ResetArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  return developTool(ctx, "lr_reset", args, args.uuids, "pre-reset", budget, (uuid, _before, name) =>
    ctx.deps.client.request("reset_develop", { photo_uuid: uuid, confirm: true, snapshot_name: name }, timeout),
  );
}

export function setProcessVersion(ctx: ToolContext, args: ProcessVersionArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  const version = `Version ${args.version}`;
  return developTool(ctx, "lr_set_process_version", args, args.uuids, "pre-process-version", budget, (uuid, before, name) =>
    ctx.deps.client.request("set_process_version", { photo_uuid: uuid, version, masked: tableInfo(before).count > 0, confirm: true, snapshot_name: name }, timeout),
  );
}

/** Issue #217 row 1: Lightroom's catalog:deleteAllEmptyMasks on each photo (MaskClean.lua); each photo's `masks` gives the count before and after. */
export function deleteEmptyMasks(ctx: ToolContext, args: DeleteEmptyMasksArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  const need = { plugin: MASK_PARITY_PLUGIN, why: "it has the delete_empty_masks command" };
  return developTool(ctx, "lr_delete_empty_masks", args, args.uuids, "pre-empty-masks", budget, (uuid, _before, name) =>
    ctx.deps.client.request("delete_empty_masks", { photo_uuid: uuid, snapshot_name: name }, timeout), need);
}
