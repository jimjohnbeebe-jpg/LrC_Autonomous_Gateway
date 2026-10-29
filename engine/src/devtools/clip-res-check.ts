// The pure parts of `npm run clip:res` (issue #168): per export size, the medians of the timed renders and the
// clip figures, their ratios to the 1600 px render, a worst-case step estimate, and the verdict. The command line
// is clip-res-check-cli.ts. It only measures; it writes nothing to the catalog. Report: docs\reports\phase11\CLIP-RES.md.

import { MAX_CORRECTIONS } from "../session/index.js";
import { percentile } from "./perf-check.js";

/**
 * The long edges timed: the session default (engine\src\mcp\tools-shared.ts DEFAULT_LONG_EDGE), one between, and
 * the plugin's cap (plugin\LrC-AVG.lrplugin\Preview.lua Preview.MAX_LONG_EDGE = 4096). The first is the base.
 */
export const EDGES = [1600, 2560, 4096] as const;
export const WARMUPS = 1;
export const RUNS = 3;
/** Worst case for one lr_step: its render plus MAX_CORRECTIONS guardrail re-renders (engine\src\session\rules.ts). */
export const RENDERS_PER_STEP = 1 + MAX_CORRECTIONS;

export type Times = { export_ms: number; command_ms: number; file_ms: number; metrics_ms: number; total_ms: number };
export type Clip = { clip_high_pct: number; clip_high_tone_pct: number; clip_low_pct: number };
/** One timed render: its size, timings and clip figures, or the error it ended with. */
export type Sample = ({ width: number; height: number } & Times & Clip) | { error: string };

export type EdgeSummary = {
  edge: number;
  runs: number;
  failed: number;
  /** The long edge of the JPEG measured; under `edge` when Lightroom did not enlarge a smaller photo [unverified]. */
  measured_long_edge: number | null;
  median: { [K in keyof Times]: number | null };
  clip: { [K in keyof Clip]: number | null };
  /** Median total_ms over the base edge's. */
  total_x: number | null;
  export_x: number | null;
  /** This edge's clip figure minus the base edge's, in percentage points: how much the base understates it. */
  clip_high_tone_vs_base: number | null;
  clip_low_vs_base: number | null;
  /** RENDERS_PER_STEP times the median total_ms. */
  worst_step_ms: number | null;
};

const ok = (s: Sample): s is Exclude<Sample, { error: string }> => !("error" in s);
const median = (xs: number[]): number | null => percentile([...xs].sort((a, b) => a - b), 0.5);
const r = (n: number | null, places = 1): number | null => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);
const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : r(a / b, 2));
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : r(a - b, 4));

const TIMES: Array<keyof Times> = ["export_ms", "command_ms", "file_ms", "metrics_ms", "total_ms"];
const CLIPS: Array<keyof Clip> = ["clip_high_pct", "clip_high_tone_pct", "clip_low_pct"];

/** One summary per edge, in the order given; ratios and differences are against the first. */
export function summarize(byEdge: ReadonlyArray<{ edge: number; samples: readonly Sample[] }>): EdgeSummary[] {
  const rows = byEdge.map(({ edge, samples }) => {
    const good = samples.filter(ok);
    const first = good[0];
    const med = Object.fromEntries(TIMES.map((k) => [k, r(median(good.map((s) => s[k])))])) as EdgeSummary["median"];
    const clip = Object.fromEntries(CLIPS.map((k) => [k, median(good.map((s) => s[k]))])) as EdgeSummary["clip"];
    return { edge, runs: samples.length, failed: samples.length - good.length, measured_long_edge: first ? Math.max(first.width, first.height) : null, median: med, clip };
  });
  const base = rows[0];
  return rows.map((row) => ({
    ...row,
    total_x: div(row.median.total_ms, base?.median.total_ms ?? null),
    export_x: div(row.median.export_ms, base?.median.export_ms ?? null),
    clip_high_tone_vs_base: sub(row.clip.clip_high_tone_pct, base?.clip.clip_high_tone_pct ?? null),
    clip_low_vs_base: sub(row.clip.clip_low_pct, base?.clip.clip_low_pct ?? null),
    worst_step_ms: row.median.total_ms === null ? null : Math.round(RENDERS_PER_STEP * row.median.total_ms),
  }));
}

const s = (msVal: number | null): string => (msVal === null ? "-" : `${(msVal / 1000).toFixed(2)} s`);
const pct = (n: number | null): string => (n === null ? "-" : `${n} %`);

/** WORKED when every edge in EDGES got RUNS timed renders and every one answered. */
export function verdict(rows: readonly EdgeSummary[]): { worked: boolean; lines: string[] } {
  const lines = EDGES.map((edge) => {
    const row = rows.find((x) => x.edge === edge);
    const good = row !== undefined && row.runs === RUNS && row.failed === 0;
    if (!row) return `NO  ${edge} px: not reached`;
    const size = row.measured_long_edge !== null && row.measured_long_edge !== edge ? ` (Lightroom exported ${row.measured_long_edge} px)` : "";
    return (
      `${good ? "YES" : "NO "} ${edge} px${size}: ${row.runs - row.failed} of ${RUNS} renders answered; median ${s(row.median.total_ms)} ` +
      `(${row.total_x ?? "-"}x the ${EDGES[0]} px render; export ${s(row.median.export_ms)}, ${row.export_x ?? "-"}x); worst-case step (${RENDERS_PER_STEP} renders) ${s(row.worst_step_ms)}; ` +
      `clip_high_tone ${pct(row.clip.clip_high_tone_pct)}, clip_low ${pct(row.clip.clip_low_pct)}`
    );
  });
  return { worked: lines.every((l) => l.startsWith("YES")), lines };
}
