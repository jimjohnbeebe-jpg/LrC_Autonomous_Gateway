// The Phase 7 check's numbers (row 6; spec docs\hud\lrc-avg-hud-spec-v2.md section 9): the Deck's logs
// across every Deck process since the check began (%TEMP%\LrC-AVG\hud\hud_<pid>_<start>.jsonl,
// hud\src-tauri\src\log.rs; hud 0.3.1 adds `got` and `painted`, hud\ui\deck.ts), the engine's session
// logs (hud_events), and memory and CPU of the Deck's process tree, sampled as spike S9 did
// (spikes\S9\auto.ts `sample`, through spikes\S9\win32.ts).
// Where each number starts and stops:
//   - cold start: the Deck process's creation time (GetProcessTimes) to its first `painted`;
//   - warm show: a running, hidden Deck's first `got` of a new edit to its `show` (Rust's time);
//   - update to paint: `got` to the `painted` of the same seq, while the Deck is shown (JS times; the
//     WebSocket hop on 127.0.0.1 is not counted [inference: the engine's send time is not logged]);
//   - click to userAction: the Deck's `click` time (JS, before its send) to the session log's hud_events `at`
//     for that click id.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sessionLogSchema } from "../../../engine/dist/log/index.js";
import { cpuMs, privateBytes, processes, startedAt, tree } from "../../../spikes/S9/win32.ts";
import { DECK_IMAGE, DECK_LOGS, events, type DeckEvent } from "../kit.ts";
import type { Sample, State, Timings } from "./summary.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export type PidEvent = DeckEvent & { pid: number };

/** Every Deck log line written since `since` (epoch ms), each with its process's pid, oldest first. */
export function deckEvents(since: number): PidEvent[] {
  const out: PidEvent[] = [];
  for (const { file, pid } of deckLogFiles(since)) for (const e of events(file)) if (e.t >= since) out.push({ ...e, pid });
  return out.sort((a, b) => a.t - b.t);
}

/** The Deck logs of processes started since `since` (epoch ms), with their pids. */
export function deckLogFiles(since: number): { file: string; pid: number }[] {
  if (!existsSync(DECK_LOGS)) return [];
  return readdirSync(DECK_LOGS).flatMap((f) => {
    const m = /^hud_(\d+)_(\d+)\.jsonl$/.exec(f);
    return m && Number(m[2]) >= since - 1000 ? [{ file: path.join(DECK_LOGS, f), pid: Number(m[1]) }] : [];
  });
}

/** A `ui` line's field (deck.ts `log`), or undefined. */
export const ui = (e: DeckEvent, key: string): unknown => (e.ev === "ui" ? (e["line"] as Record<string, unknown> | undefined)?.[key] : undefined);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** The Deck processes running now. */
export const deckPids = (): number[] => [...processes()].filter(([, p]) => p.exe.toLowerCase() === DECK_IMAGE.toLowerCase()).map(([pid]) => pid);

/** A process's creation time as epoch ms (FILETIME counts 100 ns from 1601). */
export function createdMs(pid: number): number | null {
  const ft = startedAt(pid);
  return ft === null ? null : ft / 10_000 - 11_644_473_600_000;
}

/** The monitors Windows has connected (.NET's Screen class through Windows PowerShell). */
export function monitorCount(): number {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count"], { encoding: "utf8" });
  return Number(out.trim()) || 1;
}

/** CPU over `ms` and private bytes at its end, for the Deck's whole process tree (S9 `sample`). */
export async function sampleTree(root: number, ms: number): Promise<Sample> {
  const before = new Map(tree(root).map((p) => [p, cpuMs(p)] as const));
  const t0 = Date.now();
  await sleep(ms);
  const window = Date.now() - t0;
  const now = tree(root);
  let bytes = 0;
  let cpu = 0;
  let complete = [...before.keys()].every((p) => now.includes(p));
  for (const p of now) {
    const b = privateBytes(p);
    const c1 = cpuMs(p);
    const c0 = before.has(p) ? before.get(p) : 0; // started inside the window: all its CPU time is inside it
    if (b === null || c1 === null || c0 == null) complete = false;
    bytes += b ?? 0;
    cpu += c1 !== null && c0 != null ? c1 - c0 : 0;
  }
  return { window_ms: window, private_mib: bytes / 2 ** 20, cpu_pct: (cpu / window) * 100, complete, procs: now.length };
}

/** The session logs the check's engine wrote under `dir` (recipes and unreadable files left out). */
export function sessionLogs(dir: string): ReturnType<typeof sessionLogSchema.parse>[] {
  const out: ReturnType<typeof sessionLogSchema.parse>[] = [];
  const walk = (d: string): void => {
    for (const f of existsSync(d) ? readdirSync(d) : []) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".json") && !f.endsWith(".recipe.json")) {
        try {
          const parsed = sessionLogSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
          if (parsed.success) out.push(parsed.data);
        } catch {
          // a file being written
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** hud_events `at` by click id. */
export function clickTimes(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const log of sessionLogs(dir)) for (const h of log.hud_events ?? []) out.set(h.click_id, Date.parse(h.at));
  return out;
}

/** The budgets' timings from the logs (see the header for where each starts and stops). */
export function timings(state: State, sessionsDir: string): Timings {
  return timingsFrom(deckEvents(state.started), state.cold, clickTimes(sessionsDir));
}

/** timings() on given log lines, Deck process creation times and hud_events receipt times (pure). */
export function timingsFrom(all: readonly PidEvent[], coldStarts: State["cold"], received: ReadonlyMap<string, number>): Timings {
  const t: Timings = { cold_start: [], warm_show: [], update_paint: [], click_action: [] };
  for (const pid of new Set(all.map((e) => e.pid))) {
    const evs = all.filter((e) => e.pid === pid);
    const painted = (seq: unknown, after: number): number | null => {
      const p = evs.find((e) => ui(e, "painted") === seq && (num(ui(e, "at")) ?? 0) >= after);
      return p ? num(ui(p, "at")) : null;
    };
    const cold = coldStarts.find((x) => x.pid === pid && Math.abs((evs[0]?.t ?? 0) - x.created) < 60_000);
    const first = evs.find((e) => ui(e, "painted") !== undefined);
    const firstAt = first ? num(ui(first, "at")) : null;
    if (cold && firstAt !== null) t.cold_start.push(firstAt - cold.created);
    let shown = false;
    let session: unknown = undefined;
    let seenState = false;
    for (const e of evs) {
      if (e.ev === "show") shown = true;
      else if (e.ev === "hide") shown = false;
      const got = ui(e, "got");
      const at = num(ui(e, "at"));
      if (got === undefined || at === null) continue;
      const fresh = ui(e, "session") !== session && ui(e, "session") !== null;
      if (fresh && seenState && !shown) {
        const show = evs.find((x) => x.ev === "show" && x.t >= at - 5 && x.t <= at + 5000);
        if (show) t.warm_show.push(show.t - at);
      } else if (shown) {
        const p = painted(got, at);
        if (p !== null) t.update_paint.push(p - at);
      }
      session = ui(e, "session");
      seenState = true;
    }
  }
  for (const e of all) {
    const id = ui(e, "click_id");
    const at = typeof id === "string" ? received.get(id) : undefined;
    if (at !== undefined) t.click_action.push(at - (num(ui(e, "at")) ?? e.t));
  }
  return t;
}
