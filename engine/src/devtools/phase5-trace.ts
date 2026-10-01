// What the Phase 5 check sees of the HUD besides the tool results (phase5-check.ts):
//   - the plugin's log, %TEMP%\LrC-AVG\bridge.log, from the check's start on: each line starts with
//     the local time to the millisecond [handle: plugin\LrC-AVG.lrplugin\Log.lua Log.timestamp,
//     docs\reports\phase4\P4\p4_bridge_log_*.txt], and the HUD writes "hud: shown", "hud: closed" and,
//     for each click or menu item, "hud: <event> <click_id> from the <hud|menu>: sent"
//     [handle: plugin\LrC-AVG.lrplugin\Hud.lua finish()]. The click's line and the engine's session log
//     (`ended_by.click_id`, `received`, `done_ms`) give AC-2's time from the click to the photo back,
//     as row 5's live check measured it [handle: vault PHASE5_PLAN.md row 5 "Abort (AC-2)"];
//   - every hud_update the check's own engine sends (traceHudUpdates): the engine keeps only counts
//     [handle: engine\src\hud\publisher.ts `stats`], and the stages are the "HUD tracks stages" line.

import { existsSync, readFileSync, statSync } from "node:fs";
import type { BridgeClient } from "../bridge/index.js";

export type LogLine = { ms: number; text: string; index: number };

/** A line's local time ("2026-09-30 05:54:54.295 INFO  ...") as epoch ms; NaN when it has none. */
export function lineTime(text: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})/.exec(text);
  return m ? new Date(`${m[1]}T${m[2]}`).getTime() : Number.NaN;
}

export class PluginLog {
  private readonly file: string;
  private readonly start: number;

  /** Lines written to `file` after now count; earlier ones belong to earlier runs. */
  constructor(file: string) {
    this.file = file;
    this.start = existsSync(file) ? statSync(file).size : 0;
  }

  /**
   * The lines since the check started. A log the plugin rotated is read from its start (it deletes the
   * log past MAX_LOG_BYTES [handle: plugin\LrC-AVG.lrplugin\Log.lua Log.path]).
   */
  lines(): LogLine[] {
    if (!existsSync(this.file)) return [];
    const buf = readFileSync(this.file);
    const from = buf.length >= this.start ? this.start : 0;
    return buf.subarray(from).toString("utf8").split(/\r?\n/).filter((t) => t.trim() !== "").map((text, index) => ({ ms: lineTime(text), text, index }));
  }

  /** The HUD's lines (" hud: ") since the check started. */
  hudLines(): LogLine[] {
    return this.lines().filter((l) => l.text.includes(" hud: "));
  }

  /** When the plugin sent the click with this id, or null when its line is not in the log. */
  clickSent(clickId: string): number | null {
    const hit = this.hudLines().find((l) => l.text.includes(` ${clickId} from the `) && l.text.endsWith(": sent"));
    return hit && Number.isFinite(hit.ms) ? hit.ms : null;
  }

  /** The first HUD line matching `pattern` written at or after `afterMs` (1 s of slack between the plugin's clock and Node's [inference]), or null. */
  hudLineAfter(pattern: RegExp, afterMs: number): LogLine | null {
    return this.hudLines().find((l) => l.ms >= afterMs - 1000 && pattern.test(l.text)) ?? null;
  }
}

/** One hud_update the check's engine sent: what it carried, how long it took, and the HUD's answer. */
export type HudTraceEntry = { at: string; session_id: string; seq: number; stage: string; open: boolean; ms: number; applied: boolean | null; opened: boolean | null; error?: string };

/**
 * Record every hud_update sent through `client` into `into`. The check wraps its own client only
 * (the publisher calls client.request: engine\src\hud\publisher.ts send()); nothing is changed in
 * the engine.
 */
export function traceHudUpdates(client: BridgeClient, into: HudTraceEntry[]): void {
  const original = client.request.bind(client);
  const traced = async (name: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<unknown> => {
    if (name !== "hud_update") return (original as (n: string, p: unknown, o?: unknown) => Promise<unknown>)(name, payload, options);
    const started = performance.now();
    const base = { at: new Date().toISOString(), session_id: String(payload["session_id"]), seq: Number(payload["seq"]), stage: String(payload["stage"]), open: payload["open"] === true };
    const took = (): number => Math.round((performance.now() - started) * 10) / 10;
    try {
      const r = (await (original as (n: string, p: unknown, o?: unknown) => Promise<unknown>)(name, payload, options)) as { applied?: unknown; opened?: unknown };
      into.push({ ...base, ms: took(), applied: r.applied === true, opened: r.opened === true });
      return r;
    } catch (err) {
      into.push({ ...base, ms: took(), applied: null, opened: null, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
  client.request = traced as BridgeClient["request"];
}

/** The stages session `sid`'s taken updates showed, in order, each once in a row. */
export function stagesOf(trace: readonly HudTraceEntry[], sid: string): string[] {
  const out: string[] = [];
  for (const e of trace) if (e.session_id === sid && e.applied === true && out.at(-1) !== e.stage) out.push(e.stage);
  return out;
}

/**
 * Whether a session's HUD showed it from begin to end: the begin, the work of a pass, a wait between
 * passes, and an end stage. Not every stage need show: the publisher sends one update at a time and
 * a newer stage replaces one still waiting [handle: engine\src\hud\publisher.ts header], so a stage
 * shorter than an update's round trip can be skipped.
 */
export function tracked(stages: readonly string[]): boolean {
  const any = (names: readonly string[]): boolean => names.some((s) => stages.includes(s));
  return stages.includes("begin") && any(["pass0", "applying", "acquiring_preview", "metrics"]) && any(["awaiting_claude", "awaiting_approval", "awaiting_pick", "converged"]) && any(["accepted", "aborted", "ended"]);
}
