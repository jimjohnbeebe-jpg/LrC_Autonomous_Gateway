// The Develop parity tools that drive LrDevelopController (issue #214; plugin DevelopTools.lua): lr_apply_auto,
// lr_reset, lr_set_process_version and lr_set_develop_settings (decision D1 of epic #207), and lr_undo_last_step (D2).
// As lr_apply_denoise (tools-denoise.ts): only between sessions
// (SessionManager.whenIdle), one plugin command per photo named by uuid, within the call budget (`not_yet`), each
// changed photo snapshotted first. On top: a photo a stopped engine's session left open is refused (SESSION_LEFT_OPEN,
// session\left-open.ts), and each photo's settings are read before the command so the result names what changed.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { BridgeError } from "../bridge/index.js";
import { CALL_BUDGET_MS } from "../library/index.js";
import { ParamError, differingSettings, sdkPassthrough, tableInfo, type ParamMap, type SdkSettings } from "../params/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { ToolError } from "./errors.js";
import { eachInBudget, type Budget } from "./tools-files.js";
import { needPlugin, run, sessionTools, type LastWrite, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** The plugin with the issue #214 commands (DevelopTools.lua, Snapshots.lua, Copies.lua). */
export const DEVELOP_PLUGIN = "1.5.0";
/** The plugin with the issue #217 mask commands (MaskClean.lua delete_empty_masks). */
export const MASK_PARITY_PLUGIN = "1.6.0";
/** The plugin with the commands of decisions D1-D3 (DevelopTools.lua set_develop_settings, undo_last_step; Remove.lua). */
export const DECISIONS_PLUGIN = "1.7.0";

export type ApplyAutoArgs = { uuids: string[]; tone?: boolean | undefined; white_balance?: boolean | undefined };
export type ResetArgs = { uuids: string[]; confirm: true };
export type DeleteEmptyMasksArgs = { uuids: string[] };
export type ProcessVersionArgs = { uuids: string[]; version: number; confirm: true };
export type SetDevelopSettingsArgs = { uuids: string[]; settings: Record<string, number | boolean | number[]> };
export type UndoArgs = { confirm: true };

export type Changes = { names: "canonical" | "sdk"; changed: Record<string, { before: unknown; after: unknown }>; masks?: { before: number; after: number } };

/**
 * What differs between two getDevelopSettings() tables: by canonical name (and the mask count), or by SDK key when
 * the map refuses to read one of them (a legacy process version, an unknown pipeline: params\map.ts fromSdk).
 * `sdkKeys` are compared by SDK key too: keys no canonical name reads (lr_set_develop_settings's `raw`).
 */
export function settingChanges(map: ParamMap, before: SdkSettings, after: SdkSettings, sdkKeys: readonly string[] = []): Changes {
  try {
    const [b, a] = [map.fromSdk(before), map.fromSdk(after)];
    const pick = (s: SdkSettings): SdkSettings => Object.fromEntries(sdkKeys.map((k) => [k, s[k]]));
    const diff = (x: SdkSettings, y: SdkSettings) => differingSettings(x, y).map((k) => [k, { before: x[k] ?? null, after: y[k] ?? null }]);
    const changed = Object.fromEntries([...diff(b.settings, a.settings), ...diff(pick(before), pick(after))]);
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

/** `compare`: SDK keys `changed` names as well (settingChanges `sdkKeys`). */
type Answer = { uuid: string; status: string; reason?: string | undefined; snapshot?: { id: string; name: string } | undefined; read_back: SdkSettings; ms: number; compare?: string[] | undefined } & Record<string, unknown>;
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
      const { read_back, compare, ...answer } = await send(uuid, before);
      photos.push({ ...answer, ...settingChanges(ctx.deps.map, before, read_back, compare) });
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

/** sdkPassthrough, with an unknown key's hint pointing at the SDK keys, not at the canonical names toToolError names. */
function passthrough(...a: Parameters<typeof sdkPassthrough>): ReturnType<typeof sdkPassthrough> {
  try {
    return sdkPassthrough(...a);
  } catch (err) {
    if (!(err instanceof ParamError) || err.code !== "unknown_parameter") throw err;
    throw new ToolError("UNKNOWN_PARAMETER", `${err.message}; nothing was written to the photo. lr_get_metadata with raw: true lists its keys.`, false, { parameter: err.parameter });
  }
}

/**
 * Decision D1 of epic #207 (issue #214): Develop settings by Lightroom's SDK key, validated against the pinned dump
 * (params\sdk-passthrough.ts), written as one named History step on the photo active in Develop (DevelopTools.lua
 * setSettings), snapshot first. A key Lightroom did not take as written puts the photo back from that snapshot
 * (`status` not_taken), as a session undoes a pass Lightroom took only in part (session\guardrail.ts undoRefused).
 */
export function setDevelopSettings(ctx: ToolContext, args: SetDevelopSettingsArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  const { client, map } = ctx.deps;
  const need = { plugin: DECISIONS_PLUGIN, why: "it has the set_develop_settings command" };
  return developTool(ctx, "lr_set_develop_settings", args, args.uuids, "pre-set", budget, async (uuid, before, name) => {
    const view = map.fromSdk(before); // a legacy or unknown process version is refused here, nothing sent
    const { sdk, unranged, raw } = passthrough(map, args.settings, { processVersion: view.process_version, pipeline: view.pipeline, hdr: view.hdr });
    const history_name = `AVG set develop settings ${name.slice(-6)}`;
    const r = await client.request("set_develop_settings", { photo_uuid: uuid, settings: sdk, history_name, snapshot_name: name }, timeout);
    const extra = { history_name, compare: raw, ...(unranged.length > 0 ? { unranged } : {}) };
    const not_taken = r.status === "set" ? map.verifyReadback(sdk, r.read_back) : [];
    ctx.lastWrite = not_taken.length === 0 && r.status === "set" ? { uuid, before, compare: raw, snapshot: r.snapshot } : null;
    if (not_taken.length === 0 || !r.snapshot) return { ...r, ...extra };
    const back = await client.request("apply_snapshot", { photo_uuid: uuid, snapshot_id: r.snapshot.id, restore_view: true }, timeout);
    const reason = `Lightroom did not take ${not_taken.map((m) => m.sdk_key).join(", ")} as written, so the photo was put back from the snapshot`;
    return { ...r, ...extra, status: "not_taken", not_taken, reason, read_back: back.read_back };
  }, need);
}

/** `last` while its photo is still in the catalog, else null, so the undo is the plain one (a photo removed by hand since the write). */
async function stillThere(ctx: ToolContext, last: LastWrite | null): Promise<LastWrite | null> {
  if (!last) return null;
  try {
    await ctx.deps.client.request("get_settings", { photo_uuid: last.uuid });
    return last;
  } catch (err) {
    if (err instanceof BridgeError && err.code === "unknown_photo") return null;
    throw err;
  }
}

/** Whether `last` is undone: the photo read again and compared with its settings before the write (settingChanges). */
async function checkUndone(ctx: ToolContext, last: LastWrite): Promise<Record<string, unknown>> {
  const now = (await ctx.deps.client.request("get_settings", { photo_uuid: last.uuid })).settings;
  const { changed } = settingChanges(ctx.deps.map, last.before, now, last.compare);
  const still = Object.keys(changed);
  if (still.length === 0) return { last_write: { uuid: last.uuid, reverted: true } };
  const put = last.snapshot ? ` The snapshot "${last.snapshot.name}" (lr_apply_snapshot with id ${last.snapshot.id}) puts it back.` : "";
  return {
    last_write: { uuid: last.uuid, reverted: false, still_changed: changed, ...(last.snapshot ? { snapshot: last.snapshot } : {}) },
    warning: `The undo did not revert this engine's last lr_set_develop_settings write on ${last.uuid}: ${still.join(", ")} still differ.${put}`,
  };
}

/**
 * Decision D2 of epic #207 (issue #214). Refused while any session is open or left open. After this engine's
 * lr_set_develop_settings write the photo is put back from that write's "AVG pre-set" snapshot and read back
 * (`last_write`, `via` "snapshot"): Edit > Undo left the write in place twice, in the view the write had put back and
 * with the photo active [handle: docs\reports\phase11\DEVELOP-CATALOG-D123\run1\ step "copy A after the undo";
 * %TEMP%\LrC-AVG\develop-catalog-check\develop_catalog_check_2026-10-29T02-49-24-274Z.json] [stated: Jim, 2026-10-29,
 * "Go with recommendations"]. Otherwise Lightroom's Edit > Undo, once (DevelopTools.lua undoLastStep), whoever made the step.
 */
export function undoLastStep(ctx: ToolContext, args: UndoArgs): Promise<ToolOutput> {
  return run(ctx, "lr_undo_last_step", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_undo_last_step", DECISIONS_PLUGIN, "it has the undo_last_step command");
    const [left] = sessions.leftOpen();
    if (left) throw new ToolError("SESSION_LEFT_OPEN", `Nothing was undone: session ${left.log.session_id} was left open by an engine that stopped, and Lightroom's undo could reach its steps; end it with lr_end_session first.`, false, { session_id: left.log.session_id });
    return sessions.whenIdle("lr_undo_last_step", async () => {
      const last = await stillThere(ctx, ctx.lastWrite);
      ctx.lastWrite = null;
      if (last?.snapshot) {
        await ctx.deps.client.request("apply_snapshot", { photo_uuid: last.uuid, snapshot_id: last.snapshot.id, restore_view: true }, timeout);
        const checked = await checkUndone(ctx, last);
        const note = `The photo was put back from the snapshot "${last.snapshot.name}" taken just before this engine's last lr_set_develop_settings write; Lightroom's History panel has the step.`;
        return { json: { undone: true, via: "snapshot", note, ...checked }, log: { undone: true, via: "snapshot", ...checked } };
      }
      const r = await ctx.deps.client.request("undo_last_step", { confirm: true, ...(last ? { photo_uuid: last.uuid } : {}) }, timeout);
      // Edit > Redo bringing the step back is [inference] from LrUndo.redo, "Redoes the last undone history state"
      // [handle: API Reference\modules\LrUndo.html].
      const note = r.undone
        ? "Lightroom undid its last step, whoever made it (Edit > Undo); Edit > Redo in Lightroom brings it back."
        : "Lightroom had nothing to undo; nothing changed.";
      const checked = r.undone && last ? await checkUndone(ctx, last) : {};
      return { json: { ...r, note, ...checked }, log: { ...r, ...checked } };
    });
  });
}

/** Issue #217 row 1: Lightroom's catalog:deleteAllEmptyMasks on each photo (MaskClean.lua); each photo's `masks` gives the count before and after. */
export function deleteEmptyMasks(ctx: ToolContext, args: DeleteEmptyMasksArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  const need = { plugin: MASK_PARITY_PLUGIN, why: "it has the delete_empty_masks command" };
  return developTool(ctx, "lr_delete_empty_masks", args, args.uuids, "pre-empty-masks", budget, (uuid, _before, name) =>
    ctx.deps.client.request("delete_empty_masks", { photo_uuid: uuid, snapshot_name: name }, timeout), need);
}
