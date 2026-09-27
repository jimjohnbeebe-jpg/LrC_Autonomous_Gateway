// lr_end_session (accept: log and recipe; revert: the pre-session snapshot) and lr_get_session_log.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RECIPE_SCHEMA_ID } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";
import { bridge, failed, ms, read, saveLog } from "./io.js";
import { WRITE_TIMEOUT_MS, type EndArgs, type Session, type SessionContext, type SessionOutput } from "./types.js";

/** Finish the session's log (and the recipe on accept). The caller then closes the session. */
export async function endSession(ctx: SessionContext, s: Session, args: EndArgs): Promise<SessionOutput> {
  const started = performance.now();
  const { client, map } = ctx.deps;
  let finalSettings: CanonicalSettings;
  let recipePath: string | null = null;
  let revert: { ms: number; differing: string[] } | null = null;
  try {
    if (args.outcome === "accept") {
      finalSettings = (await read(ctx, s)).settings;
      s.files.writeRecipe({
        schema: RECIPE_SCHEMA_ID,
        session_id: s.id,
        created: ctx.now().toISOString(),
        intent_id: s.intent.intent.id,
        source: { uuid: s.target.uuid, filename: s.target.filename },
        process_version: s.target.process_version,
        settings: finalSettings,
      });
      recipePath = s.files.recipePath;
    } else {
      const t = performance.now();
      const res = await bridge(s, () => client.request("apply_snapshot", { target_uuid: s.target.uuid, snapshot_id: s.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS }));
      const revertMs = ms(t);
      finalSettings = map.fromSdk(res.read_back).settings;
      const differing = differingSettings(finalSettings, s.startSettings);
      revert = { ms: revertMs, differing };
    }
  } catch (err) {
    throw failed(ctx, s, `end (${args.outcome})`, err);
  }
  s.log.outcome = args.outcome;
  s.log.ended = ctx.now().toISOString();
  s.log.final_settings = finalSettings;
  s.log.recipe_path = recipePath;
  s.log.revert = revert;
  saveLog(s);
  return {
    json: {
      ok: true,
      session_id: s.id,
      outcome: args.outcome,
      passes: `${s.passes}/${s.maxPasses}`,
      log_path: s.files.logPath,
      recipe_path: recipePath,
      final_settings: finalSettings,
      ...(revert ? { revert } : {}),
      timings: { total_ms: ms(started) },
    },
    log: { session_id: s.id, outcome: args.outcome, log_path: s.files.logPath, recipe_path: recipePath, ...(revert ? { revert } : {}) },
  };
}

/** A session's log: the open session's, one that ended in this engine run, or one found in the log folder. */
export function readSessionLog(logDir: string, open: Session | null, ended: ReadonlyMap<string, string>, sessionId: string): SessionOutput {
  if (open?.id === sessionId) return { json: { ok: true, open: true, log_path: open.files.logPath, log: open.log } };
  let file = ended.get(sessionId) ?? null;
  if (!file) {
    const short = sessionId.replace(/-/g, "").slice(0, 6);
    try {
      const match = readdirSync(logDir).find((f) => f.endsWith(`-${short}.json`));
      if (match) file = path.join(logDir, match);
    } catch {
      // no log folder yet
    }
  }
  if (file) {
    const log = JSON.parse(readFileSync(file, "utf8")) as { session_id?: unknown };
    if (log.session_id === sessionId) return { json: { ok: true, open: false, log_path: file, log } };
  }
  throw new ToolError("SESSION_NOT_FOUND", `No session log for ${sessionId} in ${logDir}.`, false);
}
