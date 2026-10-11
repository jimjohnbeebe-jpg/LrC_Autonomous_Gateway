// `npm run ai:probe` (issue #123, fix/ai-mask-probe): one AI mask asked of Lightroom the way the engine asks
// it (session\ai-update.ts), every answer written down with its time. On 2026-10-11 a Vegetation mask brought
// an "unexpected error" dialog and a Lightroom Jim force-closed [stated: Jim, 2026-10-11]: Lightroom reported
// the update over with the catalog free (the probes stopped after three, ai-update.ts `settled`) [inference],
// the entry showed neither a digest nor an ErrorReason, and the engine read the settings about once a second
// until Lightroom was killed [handle: %TEMP%\LrC-AVG\bridge.log lines 13495-13656 on Jim's PC]. The runs:
//   1. Mountains, reads as the engine reads them (the control: it computed twice in that chat, 15-28 s
//      [handle: GitHub issue #123]);
//   2. Vegetation, reads as the engine reads them (the 2026-10-11 call);
//   3. Vegetation without reads while Lightroom computes (H2: do the engine's reads take part?): only gate
//      probes until Lightroom reports the update over with the catalog free, then a read every 5 s.
// Each run writes one entry with the 2026-10-11 sliders (History "AVG ai-probe <run>"), then update_ai_settings
// with the plugin's guard (`watch`), and watches for LIMIT_MS at most. Putting the photo back, the screenshots
// and Jim's answers are the CLI's (ai-probe-cli.ts). Report: docs\reports\phase8.5\ai-vegetation.md.

import { randomUUID } from "node:crypto";
import type { BridgeClient, CommandResult } from "../bridge/index.js";
import { toToolError } from "../mcp/index.js";
import { aiError, aiWatch, applyOp, computed, firstComponent, readTable, tableSettings } from "../params/index.js";

export type RunSpec = { id: string; kind: "landscape_mountains" | "landscape_vegetation"; reads: boolean };
export const RUNS: readonly RunSpec[] = [
  { id: "mountains_reads", kind: "landscape_mountains", reads: true },
  { id: "vegetation_reads", kind: "landscape_vegetation", reads: true },
  { id: "vegetation_no_reads", kind: "landscape_vegetation", reads: false },
];
/** Three minutes: the 2026-10-11 wait had shown nothing for 150 s when Lightroom was killed [inference from the plugin log times in the header]. */
export const LIMIT_MS = 180_000;
/** The engine's rhythm (ai-update.ts AI_TIMINGS): reads from 250 ms doubling to 1 s, probes every 2 s from 10 s. */
export const PROBE_TIMINGS = { limitMs: LIMIT_MS, pollMs: 250, pollMaxMs: 1000, probeFromMs: 10_000, probeEveryMs: 2000, probeReplyMs: 5000, replyMs: 10_000, readsAfterMs: 5000, noResultShotMs: 10_000 };
export type ProbeTimings = typeof PROBE_TIMINGS;
/** The 2026-10-11 call's sliders [handle: repo logs\engine-20261010.jsonl, lr_create_mask at 2026-10-11T05:49:48.588Z]. */
const SLIDERS = { "local.saturation": 15, "local.temperature": -10 };

export type ProbeEvent = { t_ms: number; what: "update" | "read" | "probe" | "screenshot"; took_ms?: number; result: string };
export type RunResult = { run: string; kind: string; reads: boolean; mask_id: string; outcome: string; t_ms: number; settled_ms: number | null; first_busy_ms: number | null; events: ProbeEvent[] };
export type RunDeps = {
  client: BridgeClient;
  uuid: string;
  /** A screenshot of the screen, its file name or why none was taken. */
  shot: (label: string) => string;
  say: (line: string) => void;
  /** PROBE_TIMINGS; the tests' are shorter. noResultShotMs: a screenshot this long after the update is over with no result (capture 3's digests came 0.3-0.5 s after it [handle: docs\reports\phase6\masks-capture\capture3-check.json steps `4_*`]). */
  timings?: ProbeTimings;
};

const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));
const since = (t0: number): number => Math.round(performance.now() - t0);

/** Run `spec` on the photo; ends on a result, the time limit or a dropped bridge, never throws after the update went out. */
export async function runOne(deps: RunDeps, spec: RunSpec): Promise<RunResult> {
  const { client, uuid } = deps;
  const before = readTable((await client.request("get_settings", { photo_uuid: uuid })).settings);
  const plan = applyOp(before, { op: "create", kind: spec.kind, name: `AVG probe ${spec.id}`, sliders: SLIDERS });
  await client.request("apply_settings", { target_uuid: uuid, settings: tableSettings(plan.entries, false), history_name: `AVG ai-probe ${spec.id}` });
  const r: RunResult = { run: spec.id, kind: spec.kind, reads: spec.reads, mask_id: plan.id, outcome: "", t_ms: 0, settled_ms: null, first_busy_ms: null, events: [] };
  const t0 = performance.now();
  const token = randomUUID();
  const note = (what: ProbeEvent["what"], result: string, took?: number): void => {
    r.events.push({ t_ms: since(t0), what, ...(took !== undefined ? { took_ms: took } : {}), result });
  };
  try {
    const T = deps.timings ?? PROBE_TIMINGS;
    const u = await timed(() => client.request("update_ai_settings", { photo_uuid: uuid, request_id: token, watch: aiWatch([plan.id]) }, { timeoutMs: T.replyMs }));
    note("update", "value" in u ? `${u.value.status ?? "?"}, state ${u.value.state ?? "?"}, guarded ${String(u.value.guarded)}` : u.error, u.ms);
    r.outcome = await watch(deps, spec, plan.id, token, t0, r, note);
  } catch (err) {
    r.outcome = `stopped: ${toToolError(err).code} (${toToolError(err).message})`;
  }
  r.t_ms = since(t0);
  return r;
}

type Timed<V> = { value: V; ms: number } | { error: string; code: string; ms: number };
async function timed<V>(call: () => Promise<V>): Promise<Timed<V>> {
  const t = performance.now();
  try {
    return { value: await call(), ms: since(t) };
  } catch (err) {
    const e = toToolError(err);
    if (e.code === "BRIDGE_DISCONNECTED") throw err;
    return { error: `${e.code}: ${e.message}`, code: e.code, ms: since(t) };
  }
}

/** The entry as a read shows it: the outcome when it ends the run, else null. */
function entryOf(sdk: Record<string, unknown>, id: string): { text: string; end: boolean } {
  const m = firstComponent(readTable(sdk), id);
  if (!m) return { text: "entry gone", end: true };
  const reason = aiError(m);
  if (reason !== null) return { text: `ErrorReason ${reason}`, end: true };
  return computed(m) ? { text: "computed", end: true } : { text: "no result yet", end: false };
}

function probeText(p: CommandResult<"probe_write_gate">, token: string): { text: string; over: boolean } {
  const u = p.update && p.update.request_id === token ? p.update : null;
  const text = `${p.status}${u ? `, update ${u.state}${u.error ? ` (${u.error})` : ""}` : ", update not this run's"}`;
  return { text, over: p.status === "executed" && u !== null && u.state !== "started" && u.state !== "running" };
}

/** Run 3 after a gate that never freed: one read at the end, for the record. */
async function lastRead(deps: RunDeps, id: string, note: (what: ProbeEvent["what"], result: string, took?: number) => void): Promise<void> {
  const read = await timed(() => deps.client.request("get_settings", { photo_uuid: deps.uuid }));
  note("read", "value" in read ? entryOf(read.value.settings, id).text : read.error, read.ms);
}

async function watch(deps: RunDeps, spec: RunSpec, id: string, token: string, t0: number, r: RunResult, note: (what: ProbeEvent["what"], result: string, took?: number) => void): Promise<string> {
  const T = deps.timings ?? PROBE_TIMINGS;
  let wait = T.pollMs;
  let nextRead = spec.reads ? 0 : Infinity;
  let nextProbe = spec.reads ? T.probeFromMs : T.pollMs;
  let shotNoResult = false;
  for (;;) {
    const now = since(t0);
    if (now >= T.limitMs) {
      if (!spec.reads) await lastRead(deps, id, note);
      return `no result within ${T.limitMs / 1000} s`;
    }
    if (now >= nextRead) {
      const read = await timed(() => deps.client.request("get_settings", { photo_uuid: deps.uuid }));
      const seen = "value" in read ? entryOf(read.value.settings, id) : { text: read.error, end: false };
      note("read", seen.text, read.ms);
      if (seen.end) return seen.text;
      nextRead = since(t0) + (spec.reads ? wait : T.readsAfterMs);
      if (spec.reads) wait = Math.min(wait * 2, T.pollMaxMs);
    }
    if (r.settled_ms === null && now >= nextProbe) {
      const p = await timed(() => deps.client.request("probe_write_gate", {}, { timeoutMs: T.probeReplyMs }));
      const seen = "value" in p ? probeText(p.value, token) : { text: p.error, over: false };
      note("probe", seen.text, p.ms);
      if ("value" in p && p.value.status === "aborted" && r.first_busy_ms === null) {
        r.first_busy_ms = now;
        note("screenshot", deps.shot(`${spec.id}_gate_busy`));
      }
      if (seen.over) {
        r.settled_ms = now; // as the engine: no more probes once the update is over and the gate is free
        if (!spec.reads) nextRead = now;
      }
      nextProbe = now + T.probeEveryMs;
    }
    if (r.settled_ms !== null && !shotNoResult && now - r.settled_ms >= T.noResultShotMs) {
      shotNoResult = true;
      deps.say(`  Lightroom reported the update over ${Math.round(now / 1000)} s in, and no result shows: taking a screenshot.`);
      note("screenshot", deps.shot(`${spec.id}_no_result`));
    }
    await sleep(Math.max(10, Math.min(nextRead, r.settled_ms === null ? nextProbe : Infinity, T.limitMs) - since(t0)));
  }
}
