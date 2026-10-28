// The pure parts of `npm run perf:check` (issue #212 Work 1, #219): the statistics and the line each timed
// call gets. The command line is perf-check-cli.ts. This measures only; it changes no Lua read path and no
// bridge framing, so Jim's baseline (docs\reports\phase11\PERF.md, "Baseline") is taken on the code as it is.

export type Timing = { name: string; note: string; runs: number; failed: number; ms: number[]; p50: number | null; p95: number | null; min: number | null; max: number | null };

/** Nearest-rank percentile of a sorted list (q in 0..1); null for an empty list. */
export function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? null;
}

const round = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

export function summarize(name: string, note: string, samples: Array<number | null>): Timing {
  const ms = samples.filter((s): s is number => s !== null).sort((a, b) => a - b);
  return {
    name,
    note,
    runs: samples.length,
    failed: samples.length - ms.length,
    ms: ms.map((m) => Math.round(m * 10) / 10),
    p50: round(percentile(ms, 0.5)),
    p95: round(percentile(ms, 0.95)),
    min: round(ms[0] ?? null),
    max: round(ms[ms.length - 1] ?? null),
  };
}

/** One printed line per timing. */
export function line(t: Timing): string {
  const stats = t.p50 === null ? "no successful run" : `p50 ${t.p50} ms, p95 ${t.p95} ms (min ${t.min}, max ${t.max})`;
  return `  ${t.name.padEnd(28)} ${stats}${t.failed > 0 ? `, ${t.failed} of ${t.runs} failed` : ""}${t.note ? `  [${t.note}]` : ""}`;
}

/** Time `fn` `runs` times (after `warmup` untimed calls); a call that throws counts as failed (null). */
export async function sample(runs: number, warmup: number, fn: () => Promise<unknown>, now: () => number = () => performance.now()): Promise<Array<number | null>> {
  for (let i = 0; i < warmup; i++) await fn().catch(() => undefined);
  const out: Array<number | null> = [];
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    try {
      await fn();
      out.push(now() - t0);
    } catch {
      out.push(null);
    }
  }
  return out;
}
