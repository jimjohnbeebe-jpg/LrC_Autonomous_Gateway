// `npm run looks:eval` (Phase 10 row 6): the Lightroom side before the judging. The photos selected in Lightroom
// (masters only) are read with their Develop settings; each gets two virtual copies through lr_create_virtual_copies'
// code (mcp\tools-snapshots.ts); each copy is edited unattended by headless Claude Code through the clients check's
// launch path (clients-run.ts runClient: a per-run MCP config for this repo's engine\dist, stream-json, the harness's
// own bridge given up while the client runs and taken back after); the masters are read again; --cleanup removes the
// run's copies through lr_remove_photos' code (mcp\tools-remove.ts), never a master.

import { existsSync, readFileSync } from "node:fs";
import type { Tools } from "../mcp/index.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { differingSettings } from "../params/index.js";
import type { PreviewService } from "../preview/index.js";
import { runClient, type ClientsDeps, type Installed, type Run } from "./clients-run.js";
import { armOf, copyName, editOk, editPrompt, MAX_PHOTOS, MIN_PHOTOS, SLOTS, streamResult, type Choice, type EvalPhoto, type EvalRun, type Slot } from "./looks-eval.js";
import { describeError } from "./phase1-check.js";
import { sleep } from "./phase5-config.js";
import { SELECT_SETTLE_MS } from "./phase8-config.js";

export type EvalDeps = ClientsDeps & {
  tools: Tools;
  previews: PreviewService;
  /** %TEMP%\LrC-AVG\looks-eval\<run>\ */
  runDir: string;
  /** Opens a file with Windows' default viewer. */
  open: (file: string) => void;
  /** Asks L / R / T in this window; null when the input ended. */
  choose: (question: string) => Promise<Choice | null>;
};
/** `clients` is the clients check's Run that runClient and ensureMode take; it shares `fail`. */
export type EvalCtx = { deps: EvalDeps; ev: EvalRun; save: () => void; fail: (message: string) => void; clients: Run };

/** The photos selected in Lightroom with their canonical settings; an Error with what to do when the selection does not fit. */
export async function selectedMasters(deps: EvalDeps): Promise<Array<{ uuid: string; filename: string; start: Record<string, unknown> }>> {
  const sel = await deps.client.request("get_selection", { max: MAX_PHOTOS + 1 });
  if (sel.count < MIN_PHOTOS || sel.count > MAX_PHOTOS) throw new Error(`select ${MIN_PHOTOS} to ${MAX_PHOTOS} photos in Lightroom's Library grid (16 for a conclusive run; ${sel.count} selected), then run this again. Nothing was written.`);
  const out = [];
  for (const p of sel.photos) {
    const name = p.filename ?? p.uuid ?? `local id ${p.local_id}`;
    if (typeof p.uuid !== "string") throw new Error(`the uuid of ${name} could not be read; deselect it and run this again. Nothing was written.`);
    if (p.is_virtual_copy === true || p.copy_name !== undefined) throw new Error(`${name} is a virtual copy ("${p.copy_name ?? ""}"); select master photos only, then run this again. Nothing was written.`);
    const settings = deps.map.fromSdk((await deps.client.request("get_settings", { photo_uuid: p.uuid })).settings).settings;
    out.push({ uuid: p.uuid, filename: p.filename ?? p.uuid, start: settings as Record<string, unknown> });
  }
  return out;
}

/** The two copies of every photo that has none yet, each saved in the run file the moment it exists. */
export async function makeCopies(ctx: EvalCtx): Promise<void> {
  const { deps, ev } = ctx;
  for (const p of ev.photos) {
    for (const slot of SLOTS) {
      if (p.copies[slot] !== null) continue;
      const name = copyName(ev.run, p.nn, slot);
      const { json } = await deps.tools.createVirtualCopies({ uuids: [p.uuid], copy_name: name });
      const made = (json["photos"] as Array<{ status?: string; copy_uuid?: string | null }> | undefined)?.[0];
      if (made?.status !== "copied" || typeof made.copy_uuid !== "string" || made.copy_uuid === p.uuid) throw new Error(`no copy "${name}" of ${p.filename} was made (${JSON.stringify(json).slice(0, 300)})`);
      p.copies[slot] = made.copy_uuid;
      ctx.save();
    }
    deps.say(`  ${p.nn} ${p.filename}: two copies made.`);
  }
}

/** One copy edited by the headless client; false when the harness could not take the bridge back (the run stops). */
async function editCopy(ctx: EvalCtx, c: Installed, p: EvalPhoto, slot: Slot, label: string): Promise<boolean> {
  const { deps, ev } = ctx;
  const uuid = p.copies[slot] as string;
  // The client edits "the photo selected in Lightroom"; Develop loads it first (phase8-config.ts SELECT_SETTLE_MS).
  await deps.client.request("select_photo", { uuid });
  await sleep(SELECT_SETTLE_MS);
  await deps.gate.release(); // leave the bridge to the client's engine (clients-run.ts editRun)
  const t0 = Date.now();
  const r = await runClient(deps, ctx.clients, c, editPrompt(uuid, ev.arms[armOf(p, slot)]), `${p.nn}${slot}`);
  const res = streamResult(existsSync(r.stdout) ? readFileSync(r.stdout, "utf8") : "");
  const j = r.judged;
  p.edits[slot] = {
    at: new Date().toISOString(),
    exit: r.exit,
    timed_out: r.timed_out,
    error: r.error,
    begun: j.begun,
    session_id: j.session_id,
    passes: j.passes,
    ended: j.ended,
    client_error: res?.is_error ?? null,
    turns: res?.turns ?? null,
    minutes: Math.round((Date.now() - t0) / 6000) / 10,
    stdout: deps.redact(r.stdout),
  };
  ctx.save();
  const e = p.edits[slot];
  const how = e.timed_out ? `ended after ${ev.timeout_min} min` : e.error ? `did not start (${e.error})` : `exited ${String(e.exit)}`;
  deps.say(`  ${label}: ${editOk(e) ? "OK" : "NOT accepted"}: session ${e.session_id ?? "none"}, ${e.passes} pass(es), ended ${e.ended ?? "NO"}, ${e.minutes} min, client ${how}.`);
  if (!r.back) ctx.fail(`after edit ${p.nn} ${slot}, the harness could not take the Lightroom bridge back`);
  return r.back;
}

/**
 * Every copy without an accepted edit, one at a time (a resumed run tries a failed edit again: a session the killed
 * client left open is reverted by the next engine's recovery [inference: clients-judge.ts `recovered`, T7]).
 * Prints nothing that tells the arms apart. False when the run stopped.
 */
export async function editAll(ctx: EvalCtx, c: Installed): Promise<boolean> {
  const { deps, ev } = ctx;
  const todo = ev.photos.flatMap((p) => SLOTS.filter((s) => !editOk(p.edits[s])).map((s) => ({ p, s })));
  deps.say("");
  deps.say(`Edits: ${todo.length} to do, one at a time, each up to ${ev.timeout_min} min. Claude Code works by itself and shows nothing here.`);
  deps.say("Leave Lightroom alone, and do not look at the copies, the Deck or the History panel until the pairs are shown: the evaluation is blind.");
  for (const [i, { p, s }] of todo.entries()) {
    if (!(await editCopy(ctx, c, p, s, `${i + 1}/${todo.length} photo ${p.nn} copy ${s}`))) return false;
  }
  return true;
}

/** Reads every master again and records what differs from the start. */
export async function readMasters(ctx: EvalCtx): Promise<boolean> {
  const { deps, ev } = ctx;
  const differing: Record<string, string[]> = {};
  for (const p of ev.photos) {
    try {
      const now = deps.map.fromSdk((await deps.client.request("get_settings", { photo_uuid: p.uuid })).settings).settings;
      differing[p.uuid] = differingSettings(now, p.start);
    } catch (err) {
      differing[p.uuid] = [`not read: ${describeError(err)}`];
    }
  }
  ev.masters = { at: new Date().toISOString(), differing };
  ctx.save();
  const changed = ev.photos.filter((p) => (differing[p.uuid] ?? []).length > 0);
  for (const p of changed) deps.say(`  master ${p.nn} ${p.filename} changed: ${(differing[p.uuid] ?? []).join(", ")}`);
  return changed.length === 0;
}

/**
 * --cleanup: the run's copies, each checked first by its copy name (select_photo answers it), removed in one
 * lr_remove_photos call. A master's uuid is never sent. Returns how many were removed.
 */
export async function cleanup(ctx: EvalCtx): Promise<number> {
  const { deps, ev } = ctx;
  const masters = new Set(ev.photos.map((p) => p.uuid));
  const uuids: string[] = [];
  for (const p of ev.photos) {
    for (const slot of SLOTS) {
      const uuid = p.copies[slot];
      if (uuid === null || masters.has(uuid) || ev.removed.includes(uuid)) continue;
      const name = copyName(ev.run, p.nn, slot);
      const seen = await deps.client.request("select_photo", { uuid }).catch((err: unknown) => describeError(err));
      if (typeof seen === "string" || seen.copy_name !== name) {
        ctx.fail(`copy ${p.nn} ${slot} was not removed: ${typeof seen === "string" ? seen : `its copy name is "${seen.copy_name ?? ""}", not "${name}"`}`);
        continue;
      }
      uuids.push(uuid);
    }
  }
  let removed: string[] = [];
  if (uuids.length > 0) {
    const { json } = await deps.tools.call(removePhotos, { uuids, confirm: true });
    removed = Array.isArray(json["removed"]) ? (json["removed"] as string[]) : [];
    ev.removed.push(...removed);
    ctx.save();
    if (removed.length < uuids.length) ctx.fail(`${uuids.length - removed.length} copies were not removed (${String(json["reason"] ?? json["status"])})`);
  }
  const first = ev.photos[0];
  if (first) await deps.client.request("select_photo", { uuid: first.uuid }).catch(() => undefined);
  return removed.length;
}
