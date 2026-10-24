// `npm run stall:check` (issue #174): reads the lines that plugin\LrC-AVG.lrplugin\Stall.lua and Bridge.lua write
// to bridge.log and sums them per phase of the check (plugin disabled, then enabled). The CLI is stall-check-cli.ts.

export type StallEvent =
  | { at: number; kind: "stall"; ms: number; after: string }
  | { at: number; kind: "tend"; ms: number }
  | { at: number; kind: "rebind" | "on" | "start" | "stopped" | "other" };

export interface PhaseSummary {
  seconds: number;
  rebinds: number;
  stalls: number;
  stall_max_ms: number;
  stall_total_ms: number;
  stalls_after_tend: number;
  slow_tends: number;
  tend_max_ms: number;
  bridge_lines: number;
}

// bridge.log lines start with Lightroom's local time, "2026-10-17 18:32:55.100" (Log.timestamp).
const LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) \S+\s+(.*)$/;

export function parseLine(line: string): StallEvent | null {
  const m = LINE.exec(line.trimEnd());
  if (!m) return null;
  const [y, mo, d, h, mi, s, ms] = m.slice(1, 8).map(Number) as [number, number, number, number, number, number, number];
  const at = new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  const text = m[8] ?? "";
  let r: RegExpExecArray | null;
  if ((r = /^stall-diag: stall (\d+) ms after (\w+)/.exec(text))) return { at, kind: "stall", ms: Number(r[1]), after: r[2] ?? "" };
  if ((r = /^stall-diag: tend (\d+) ms/.exec(text))) return { at, kind: "tend", ms: Number(r[1]) };
  if (/^stall-diag: ((startup|idle) rebind$|rebind \S+ \()/.test(text)) return { at, kind: "rebind" };
  if (/^stall-diag: on\b/.test(text)) return { at, kind: "on" };
  if (text.startsWith("bridge: starting generation")) return { at, kind: "start" };
  if (text === "bridge: stopped (plugin disabled)") return { at, kind: "stopped" };
  return { at, kind: "other" };
}

export function parseLog(text: string): StallEvent[] {
  return text.split(/\r?\n/).map(parseLine).filter((e): e is StallEvent => e !== null);
}

/** The events in [from, to) (epoch ms), summed. */
export function summarize(events: StallEvent[], from: number, to: number): PhaseSummary {
  const inside = events.filter((e) => e.at >= from && e.at < to);
  const stalls = inside.flatMap((e) => (e.kind === "stall" ? [e] : []));
  const tends = inside.flatMap((e) => (e.kind === "tend" ? [e] : []));
  return {
    seconds: Math.round((to - from) / 1000),
    rebinds: inside.filter((e) => e.kind === "rebind").length,
    stalls: stalls.length,
    stall_max_ms: Math.max(0, ...stalls.map((e) => e.ms)),
    stall_total_ms: stalls.reduce((n, e) => n + e.ms, 0),
    stalls_after_tend: stalls.filter((e) => e.after === "tend").length,
    slow_tends: tends.length,
    tend_max_ms: Math.max(0, ...tends.map((e) => e.ms)),
    bridge_lines: inside.length,
  };
}

export function describePhase(name: string, p: PhaseSummary, stutter: boolean | null): string {
  const jim = stutter === null ? "no answer" : stutter ? "YES" : "NO";
  return `${name}: stutter seen by Jim ${jim}; plugin froze ${p.stalls} time(s), longest ${p.stall_max_ms} ms, `
    + `${p.stall_total_ms} ms in all (${p.stalls_after_tend} right after socket work); ${p.rebinds} rebind(s); `
    + `${p.slow_tends} slow socket tick(s), longest ${p.tend_max_ms} ms; ${p.bridge_lines} plugin log line(s)`;
}

/** A suggestion only; Jim decides the verdict. */
export function suggest(off: boolean | null, on: boolean | null, stopped: boolean, quietAfterStop: boolean): string {
  const parts: string[] = [];
  if (off) parts.push("Lightroom stutters without LrC-AVG running: look outside the plugin");
  else if (on) parts.push("the fixed plugin still stutters");
  else if (off === false && on === false) parts.push("the fix holds: no stutter with the plugin off or on");
  parts.push(stopped && quietAfterStop ? "Disable stops the bridge" : "Disable did NOT stop the bridge");
  return parts.join("; ");
}
