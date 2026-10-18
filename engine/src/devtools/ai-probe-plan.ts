// `npm run ai:probe`'s options and runs for issue #181 (ai-probe.ts has the runs themselves, ai-probe-cli.ts the command):
//   npm run ai:probe -- --new --kind landscape_water --repeat 10 --sky-first
// asks Lightroom for the same AI mask N times the way the engine asks it, each on a photo put back first, and sums up how
// many computed, how many stalled and how long they took. `--sky-first` makes an AI Sky mask before each run, as the
// 2026-10-18 session did before its Water mask [handle: GitHub issue #181 "Evidence", passes 2 and 3]. Without options, the
// three runs of issue #123 (RUNS). A run waits as long as the engine does (ENGINE_WAIT_MS), so that "stuck" here is
// the engine's LIGHTROOM_STUCK.

import { AI_KINDS, KIND_LABELS, type AiKind } from "../params/index.js";
import { AI_TIMINGS } from "../session/index.js";
import { RUNS, type RunResult, type RunSpec } from "./ai-probe.js";

/** The engine's wait for an AI mask's result (session\ai-timings.ts), 5 minutes. */
export const ENGINE_WAIT_MS = AI_TIMINGS.computeMs;
/** The sliders of the 2026-10-18 call that stalled [handle: GitHub issue #181 "Evidence", pass 3]. */
export const ISSUE_SLIDERS = { "local.whites": 25, "local.exposure": 0.2, "local.contrast": 15, "local.texture": 12, "local.clarity": 8, "local.dehaze": 6 };

export type Options = { kind: AiKind | null; repeat: number; skyFirst: boolean; fresh: boolean };
/** The AI kinds that need no point on the photo: the ones this probe can ask for. */
export const PROBE_KINDS = (Object.keys(AI_KINDS) as AiKind[]).filter((k) => !AI_KINDS[k].point);

/** The options of the command line, or the message that says what is wrong with them. */
export function parseArgs(argv: readonly string[]): Options | string {
  const o: Options = { kind: null, repeat: 1, skyFirst: false, fresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new") o.fresh = true;
    else if (a === "--sky-first") o.skyFirst = true;
    else if (a === "--kind") {
      const k = argv[++i] ?? "";
      if (!(PROBE_KINDS as string[]).includes(k)) return `--kind needs one of: ${PROBE_KINDS.join(", ")}`;
      o.kind = k as AiKind;
    } else if (a === "--repeat") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 50) return "--repeat needs a whole number from 1 to 50";
      o.repeat = n;
    } else return `unknown option ${String(a)}`;
  }
  return o.kind === null && (o.repeat !== 1 || o.skyFirst) ? "--repeat and --sky-first need --kind" : o;
}

/** The runs the options ask for: `repeat` runs of one kind, or the three runs of issue #123. */
export function plan(o: Options): RunSpec[] {
  const kind = o.kind;
  if (kind === null) return [...RUNS];
  return Array.from({ length: o.repeat }, (_, i) => ({ id: `${kind}_${String(i + 1).padStart(2, "0")}`, kind, reads: true, sliders: ISSUE_SLIDERS, waitMs: ENGINE_WAIT_MS, ...(o.skyFirst ? { skyFirst: true as const } : {}) }));
}

/** What the command asks Jim about the photo before the first run (a y/n question each). */
export function photoQuestions(o: Options, filename: string): string[] {
  if (o.kind === null) return [`The probe runs on ${filename}. Does it show trees, shrubs or grass?`];
  const asks = [`The probe runs on ${filename}. Does it show ${KIND_LABELS[o.kind].toLowerCase()}?`];
  return o.skyFirst ? [...asks, "Does it show sky?"] : asks;
}

export type Summary = { runs: number; completed: number; stuck: number; other: number; median_ms: number | null; max_ms: number | null; completed_median_ms: number | null; completed_max_ms: number | null };
const median = (v: readonly number[]): number | null => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? null : s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const max = (v: readonly number[]): number | null => (v.length === 0 ? null : Math.max(...v));

/** How the runs ended: a result (completed), no result in time (stuck: the engine's LIGHTROOM_STUCK), or anything else. */
export function summarize(runs: ReadonlyArray<Pick<RunResult, "outcome" | "t_ms">>): Summary {
  const done = runs.filter((r) => r.outcome === "computed");
  const stuck = runs.filter((r) => r.outcome.includes("no result within"));
  const all = runs.map((r) => r.t_ms);
  const ok = done.map((r) => r.t_ms);
  return { runs: runs.length, completed: done.length, stuck: stuck.length, other: runs.length - done.length - stuck.length, median_ms: median(all), max_ms: max(all), completed_median_ms: median(ok), completed_max_ms: max(ok) };
}

export function summaryLine(s: Summary): string {
  const ms = (v: number | null): string => (v === null ? "none" : `${Math.round(v)} ms`);
  return `${s.runs} runs: ${s.completed} completed, ${s.stuck} stuck (no result in time), ${s.other} other; all runs median ${ms(s.median_ms)}, max ${ms(s.max_ms)}; completed runs median ${ms(s.completed_median_ms)}, max ${ms(s.completed_max_ms)}`;
}
