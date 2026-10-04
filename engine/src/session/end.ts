// lr_end_session (accept: log and recipe; revert: the pre-session snapshot) and lr_get_session_log.
// The user's Accept and Abort from the HUD or the menu end a session the same way (hud-actions.ts);
// an Abort is logged as outcome "aborted", and `ended_by` says who ended it (PHASE5_PLAN row 5).
// In Variants mode, accept takes the recipe from the pick, and revert puts the master back; the
// copies stay in the catalog either way, named in the result [stated: Jim, 2026-09-27, PHASE4_PLAN
// decision 4: the SDK has no call that removes a photo; handle: tests\session-variants.test.ts
// "refuses accept before a pick; revert puts the master back and keeps the copies with their edits",
// against the Lightroom sim; in Lightroom [unverified] until PHASE4_PLAN row 10].

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RECIPE_SCHEMA_ID } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";
import type { EndedByEntry } from "../log/index.js";
import { bridge, checkAbort, failed, ms, read, saveLog } from "./io.js";
import { focus, variant } from "./targets.js";
import { WRITE_TIMEOUT_MS, type EndArgs, type Session, type SessionContext, type SessionOutput, type Target, type UserEnd } from "./types.js";

/** The photo whose settings an accept keeps: the master, or in Variants mode the pick (refused before one). */
function acceptTarget(s: Session): Target {
  if (s.mode === "converge") return s.master;
  const pick = s.picked ? variant(s, s.picked) : null;
  if (pick) return pick;
  throw new ToolError(
    "AWAITING_PICK",
    "No copy is picked yet: accept keeps the pick's edit. Call lr_select_variant with the user's pick first, or end with revert.",
    false,
    { session_id: s.id },
  );
}

/**
 * Finish the session's log (and the recipe on accept). The caller then closes the session. `by`: the
 * user's Accept or Abort from the HUD or the menu; without it, Claude's lr_end_session.
 */
export async function endSession(ctx: SessionContext, s: Session, args: EndArgs, by: UserEnd | null = null): Promise<SessionOutput> {
  const started = performance.now();
  const { client, map } = ctx.deps;
  const kept = args.outcome === "accept" ? acceptTarget(s) : s.master;
  let finalSettings: CanonicalSettings;
  let recipePath: string | null = null;
  let revert: { ms: number; differing: string[] } | null = null;
  let masks = 0;
  try {
    await focus(ctx, s, kept);
    if (args.outcome === "accept") {
      const view = await read(ctx, s, kept);
      finalSettings = view.settings;
      masks = view.masks.count;
      checkAbort(s); // the user's Abort, arrived during the read, wins over an accept
      s.files.writeRecipe({
        schema: RECIPE_SCHEMA_ID,
        session_id: s.id,
        created: ctx.now().toISOString(),
        intent_id: s.intent.intent.id,
        source: { uuid: kept.uuid, filename: kept.filename },
        process_version: kept.process_version,
        settings: finalSettings,
        ...(masks > 0 ? { masks } : {}),
      });
      recipePath = s.files.recipePath;
    } else {
      const t = performance.now();
      const res = await bridge(s, s.master, () => client.request("apply_snapshot", { target_uuid: s.master.uuid, snapshot_id: s.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS }));
      const revertMs = ms(t);
      const view = map.fromSdk(res.read_back);
      finalSettings = view.settings;
      // The snapshot puts the mask table back too [handle: docs\reports\phase6\masks-capture\check.json `11_snapshot`, 0 differing paths].
      const differing = [...differingSettings(finalSettings, s.startSettings), ...(view.masks.fingerprint !== s.startMasks ? ["masks"] : [])];
      revert = { ms: revertMs, differing };
    }
  } catch (err) {
    throw failed(ctx, s, `end (${args.outcome})`, err);
  }
  // A revert while the user's Abort is pending (it arrived during Claude's revert, or its own revert
  // failed) is the user's: logged as "aborted" with their click (Greptile, PR #47) [handle:
  // tests\hud-abort.test.ts "arriving during Claude's revert, is logged as the user's"].
  const user = by ?? (args.outcome === "revert" ? s.abort : null);
  const outcome = user && args.outcome === "revert" ? "aborted" : args.outcome;
  s.log.outcome = outcome;
  s.log.ended = ctx.now().toISOString();
  s.log.final_settings = finalSettings;
  s.log.recipe_path = recipePath;
  s.log.revert = revert;
  s.log.ended_by = endedBy(user);
  saveLog(s);
  const copies = s.mode === "variants" ? copiesJson(s, args.outcome) : {};
  return {
    json: {
      ok: true,
      session_id: s.id,
      outcome,
      ended_by: s.log.ended_by,
      ...(s.mode === "variants" ? { photo: kept.id } : {}),
      passes: `${kept.passes}/${s.maxPasses}`,
      log_path: s.files.logPath,
      recipe_path: recipePath,
      final_settings: finalSettings,
      ...(revert ? { revert } : {}),
      ...(masks > 0 ? { masks_note: MASKS_NOTE(masks) } : {}),
      ...copies,
      timings: { total_ms: ms(started) },
    },
    log: { session_id: s.id, outcome, ended_by: s.log.ended_by, log_path: s.files.logPath, recipe_path: recipePath, ...(revert ? { revert } : {}), ...(s.mode === "variants" ? { photo: kept.id } : {}) },
  };
}

const MASKS_NOTE = (n: number): string =>
  `The photo keeps its ${n === 1 ? "mask" : `${n} masks`}; the recipe carries the global settings only, so lr_sync_series and lr_create_preset_from_active do not copy masks.`;

/** The log's `ended_by`: Claude, or the user's click with its timings (done_ms: from the event to now, AC-2). */
function endedBy(by: UserEnd | null): EndedByEntry {
  if (!by) return { source: "claude" };
  return { source: by.source, click_id: by.click_id, received: by.received.toISOString(), interrupted: by.interrupted, done_ms: ms(by.t0) };
}

/** The copies a Variants session leaves in the catalog, and what the user can do with them. */
function copiesJson(s: Session, outcome: EndArgs["outcome"]): Record<string, unknown> {
  const copies = s.variants.map((v) => ({ id: v.id, label: v.label, uuid: v.uuid, copy_name: v.copy_name, picked: v.id === s.picked }));
  const note =
    outcome === "accept"
      ? `The edit is kept on copy ${s.picked ?? "?"}. The other copies stay in the catalog as they are; the user removes them in Lightroom when they want.`
      : "The master is back as it was before the session. The copies stay in the catalog with their edits; the user removes them in Lightroom when they want.";
  return { copies, copies_note: note };
}

/**
 * A session's log: the open session's, one that ended in this engine run, or one found in the log
 * folders (the current one first, then the earlier ones, settings\log-folders.ts). A file name
 * carries only 6 characters of the id, so another session's log can have the same name (another
 * day, another folder): every file with the name is read until one holds this session's full id
 * (Greptile, PR #44) [handle: tests\settings-tools.test.ts "lr_get_session_log looks past another
 * session's log with the same short id"]. A file that cannot be read is skipped and counted.
 */
export function readSessionLog(logDirs: readonly string[], open: Session | null, ended: ReadonlyMap<string, string>, sessionId: string): SessionOutput {
  if (open?.id === sessionId) return { json: { ok: true, open: true, log_path: open.files.logPath, log: open.log } };
  const short = sessionId.replace(/-/g, "").slice(0, 6);
  const candidates: string[] = [];
  const endedFile = ended.get(sessionId);
  if (endedFile) candidates.push(endedFile);
  for (const logDir of logDirs) {
    try {
      for (const f of readdirSync(logDir)) if (f.endsWith(`-${short}.json`)) candidates.push(path.join(logDir, f));
    } catch {
      // no such folder (yet, or any more)
    }
  }
  let unreadable = 0;
  for (const file of candidates) {
    let log: { session_id?: unknown };
    try {
      log = JSON.parse(readFileSync(file, "utf8")) as { session_id?: unknown };
    } catch {
      unreadable++;
      continue;
    }
    if (log.session_id === sessionId) return { json: { ok: true, open: false, log_path: file, log } };
  }
  const skipped = unreadable > 0 ? ` ${unreadable} log file(s) with that name could not be read.` : "";
  throw new ToolError("SESSION_NOT_FOUND", `No session log for ${sessionId} in ${logDirs.join(", ")}.${skipped}`, false);
}
