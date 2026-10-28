// Snapshots and virtual copies by uuid (issue #214; plugin Snapshots.lua, Copies.lua, and Develop.lua's
// create_snapshot): lr_list_snapshots (read only, any time), lr_create_snapshot, lr_apply_snapshot,
// lr_delete_snapshot and lr_create_virtual_copies (only between sessions, SessionManager.whenIdle).
// A snapshot a session puts the photo back with is marked in the listing and never deleted: the open session's
// "AVG pre-session …" one and the one a stopped engine's session left open recorded in its log (session\left-open.ts).

import { randomUUID } from "node:crypto";
import { CALL_BUDGET_MS } from "../library/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { ToolError } from "./errors.js";
import { DEVELOP_PLUGIN, leftOpenOn, leftOpenReason, settingChanges } from "./tools-develop.js";
import { eachInBudget, type Budget } from "./tools-files.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SnapshotListArgs = { uuid: string };
export type CreateSnapshotArgs = { uuid: string; name: string };
export type SnapshotArgs = { uuid: string; snapshot_id: string; confirm: true };
export type VirtualCopiesArgs = { uuids: string[]; copy_name?: string | undefined };

type Snap = { id: string; name: string };
/** The name lr_begin_session gives its snapshot (session\begin.ts). */
const PRE_SESSION = "AVG pre-session ";

/** The session whose put-back is this snapshot of this photo, if any. */
function sessionOf(ctx: ToolContext, uuid: string, snap: Snap): { session_id: string; state: "open" | "left_open" } | null {
  const open = ctx.sessions?.current() ?? null;
  if (open && open.photos.some((p) => p.uuid === uuid) && snap.name.startsWith(PRE_SESSION)) return { session_id: open.id, state: "open" };
  const left = leftOpenOn(ctx, uuid);
  if (left && (left.snapshot.id === snap.id || left.snapshot.name === snap.name)) return { session_id: left.session_id, state: "left_open" };
  return null;
}

async function ready(ctx: ToolContext, tool: string): Promise<void> {
  await ctx.deps.ensureBridge();
  needPlugin(ctx, tool, DEVELOP_PLUGIN, "it reads and changes Develop snapshots by uuid");
}

async function snapshots(ctx: ToolContext, uuid: string): Promise<Snap[]> {
  return (await ctx.deps.client.request("list_snapshots", { photo_uuid: uuid })).snapshots;
}

async function findSnapshot(ctx: ToolContext, uuid: string, id: string): Promise<Snap> {
  const snap = (await snapshots(ctx, uuid)).find((s) => s.id === id);
  if (!snap) throw new ToolError("UNKNOWN_SNAPSHOT", `Photo ${uuid} has no snapshot with id ${id}: lr_list_snapshots lists its snapshots. Nothing was changed.`, false);
  return snap;
}

export function listSnapshots(ctx: ToolContext, args: SnapshotListArgs): Promise<ToolOutput> {
  return run(ctx, "lr_list_snapshots", args, async () => {
    await ready(ctx, "lr_list_snapshots");
    const list = (await snapshots(ctx, args.uuid)).map((s) => {
      const session = sessionOf(ctx, args.uuid, s);
      return { id: s.id, name: s.name, by_avg: s.name.startsWith("AVG "), ...(session ? { session } : {}) };
    });
    return { json: { uuid: args.uuid, snapshots: list }, log: { count: list.length } };
  });
}

export function createSnapshot(ctx: ToolContext, args: CreateSnapshotArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_snapshot", args, async () => {
    const sessions = sessionTools(ctx);
    await ready(ctx, "lr_create_snapshot");
    // Every snapshot this plugin makes starts "AVG " (Develop.lua createSnapshot), which also marks it as made by a tool.
    const name = args.name.startsWith("AVG ") ? args.name : `AVG ${args.name}`;
    return sessions.whenIdle("lr_create_snapshot", async () => {
      // Develop.lua calls createDevelopSnapshot(name, true), "True to update the snapshot in place, if one already exists
      // with this name" [handle: API Reference\modules\LrPhoto.html], and the old id was then unknown [handle: LR_SDK_NOTES
      // "Recorded in Phase 9 — 2026-10-24", denoise_check_2026-10-24T16-10-22-533Z.json put_back]: refuse the name here.
      if ((await snapshots(ctx, args.uuid)).some((s) => s.name === name)) {
        throw new ToolError("SNAPSHOT_EXISTS", `Photo ${args.uuid} already has a snapshot named "${name}"; choose another name. Nothing was changed.`, false);
      }
      const r = await ctx.deps.client.request("create_snapshot", { photo_uuid: args.uuid, name }, { timeoutMs: WRITE_TIMEOUT_MS });
      const snapshot = { id: r.snapshot_id, name: r.name };
      return { json: { uuid: r.uuid, snapshot, undo: `lr_delete_snapshot with snapshot_id "${snapshot.id}" removes it.` }, log: { snapshot } };
    });
  });
}

export function applySnapshot(ctx: ToolContext, args: SnapshotArgs): Promise<ToolOutput> {
  return run(ctx, "lr_apply_snapshot", args, async () => {
    const sessions = sessionTools(ctx);
    await ready(ctx, "lr_apply_snapshot");
    return sessions.whenIdle("lr_apply_snapshot", async () => {
      const open = leftOpenOn(ctx, args.uuid);
      if (open) throw new ToolError("SESSION_LEFT_OPEN", `Nothing was changed: ${leftOpenReason(open.session_id)}.`, false, { session_id: open.session_id });
      const applied = await findSnapshot(ctx, args.uuid, args.snapshot_id);
      const before = (await ctx.deps.client.request("get_settings", { photo_uuid: args.uuid })).settings;
      const pre = await ctx.deps.client.request("create_snapshot", { photo_uuid: args.uuid, name: `AVG pre-apply ${randomUUID().slice(0, 6)}` }, { timeoutMs: WRITE_TIMEOUT_MS });
      const snapshot = { id: pre.snapshot_id, name: pre.name };
      const r = await ctx.deps.client.request("apply_snapshot", { photo_uuid: args.uuid, snapshot_id: applied.id, restore_view: true }, { timeoutMs: WRITE_TIMEOUT_MS });
      const json = { uuid: args.uuid, applied, snapshot, ...settingChanges(ctx.deps.map, before, r.read_back), undo: `lr_apply_snapshot with snapshot_id "${snapshot.id}" puts the photo back as it was.` };
      return { json, log: { applied, snapshot, changed: Object.keys(json.changed).length } };
    });
  });
}

export function deleteSnapshot(ctx: ToolContext, args: SnapshotArgs): Promise<ToolOutput> {
  return run(ctx, "lr_delete_snapshot", args, async () => {
    const sessions = sessionTools(ctx);
    await ready(ctx, "lr_delete_snapshot");
    return sessions.whenIdle("lr_delete_snapshot", async () => {
      const snap = await findSnapshot(ctx, args.uuid, args.snapshot_id);
      const session = sessionOf(ctx, args.uuid, snap);
      if (session) {
        throw new ToolError("SNAPSHOT_IN_USE", `"${snap.name}" is what session ${session.session_id} puts the photo back with, so it was not deleted. End that session first (lr_end_session).`, false, { session_id: session.session_id });
      }
      await ctx.deps.client.request("delete_snapshot", { photo_uuid: args.uuid, snapshot_id: snap.id }, { timeoutMs: WRITE_TIMEOUT_MS });
      return { json: { uuid: args.uuid, deleted: snap, note: "A deleted snapshot cannot be brought back by a tool." }, log: { deleted: snap } };
    });
  });
}

export function createVirtualCopies(ctx: ToolContext, args: VirtualCopiesArgs, budget: Budget = { now: () => performance.now(), ms: CALL_BUDGET_MS }): Promise<ToolOutput> {
  return run(ctx, "lr_create_virtual_copies", args, async () => {
    const sessions = sessionTools(ctx);
    await ready(ctx, "lr_create_virtual_copies");
    return sessions.whenIdle("lr_create_virtual_copies", async () => {
      const photos: Array<Record<string, unknown>> = [];
      const { failed, left } = await eachInBudget(args.uuids, budget, () => photos, async (uuid) => {
        const r = await ctx.deps.client.request("copy_photo", { photo_uuid: uuid, ...(args.copy_name !== undefined ? { copy_name: args.copy_name } : {}) }, { timeoutMs: WRITE_TIMEOUT_MS });
        photos.push({ uuid, status: r.status, copy_uuid: r.copy?.uuid ?? null, copy_name: r.copy?.copy_name ?? null, ...(r.reason ? { reason: r.reason } : {}) });
      });
      const json = {
        photos,
        failed: failed.map((f) => ({ uuid: f.item, code: f.code, message: f.message })),
        undo: "lr_remove_photos with a copy_uuid and confirm: true removes that copy from the catalog; the master stays.",
        ...(left.length > 0 ? { not_yet: left, next: `Time is up for this call: call again with uuids = not_yet (${left.length} photos) and the same copy_name.` } : {}),
      };
      return { json, log: { copied: photos.filter((p) => p["status"] === "copied").length, failed: failed.length, not_yet: left.length } };
    });
  });
}
