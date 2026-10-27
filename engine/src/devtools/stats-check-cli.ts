// `npm run stats:check` (issue #216): lr_get_photo_stats and lr_get_preview quality "fast" against Lightroom,
// from the command line (the pure parts are in stats-check.ts). Run from the repo root with Lightroom open, the
// LrC-AVG plugin of this branch loaded (it has thumbnail_preview), 2 to 20 photos selected in the Library grid,
// and Claude Desktop quit (this takes the engine's instance lock). Jim answers in this window.
// Steps: (1) lr_get_photo_stats on the selection, called again with not_yet until every photo is measured, timed;
// (2) a fast and an exact preview of up to three of them; (3) on the first photo, opened in Develop by Jim:
// a snapshot, Exposure moved by 1 (History "AVG stats:check exposure"), fast previews at OFFSETS_S after it,
// an exact export, then the photo put back from the snapshot and its Exposure read back; one question.
// Results: %TEMP%\LrC-AVG\stats-check\stats_check_<time>.json (Claude Code collects them).

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { OFFSETS_S, caughtUpAt, verdict, type Sample, type StatsRun } from "./stats-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "stats-check");
const SNAPSHOT = "AVG stats:check before";
const started = new Date().toISOString().replace(/[:.]/g, "-");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
type Results = Record<string, unknown>;
type Say = (line: string) => void;
type Json = Record<string, unknown>;
/** What the put-back needs, kept as it arrives so a run that stops halfway still puts the photo back. */
type Taken = { uuid: string; snapshot: string; key: string; before: number } | null;

const luma = (json: Json): number | null => ((json["metrics"] as { luma_mean?: number } | undefined)?.luma_mean ?? null);

async function stats(tools: Tools, uuids: string[], say: Say): Promise<{ run: Pick<StatsRun, "photos" | "measured" | "total_ms">; detail: Json }> {
  say(`1. lr_get_photo_stats on ${uuids.length} photos (exports at 800 px; Lightroom stays where it is) ...`);
  const t0 = performance.now();
  const calls: Json[] = [];
  const photos: Json[] = [];
  for (let left = uuids; left.length > 0; ) {
    const c0 = performance.now();
    const out = (await tools.getPhotoStats({ uuids: left })).json;
    photos.push(...(out["photos"] as Json[]));
    left = (out["not_yet"] as string[] | undefined) ?? [];
    calls.push({ ms: Math.round(performance.now() - c0), measured: (out["photos"] as Json[]).length, not_yet: left.length });
  }
  const total = Math.round(performance.now() - t0);
  const measured = photos.filter((p) => p["ok"] === true).length;
  say(`   ${measured} of ${uuids.length} measured in ${(total / 1000).toFixed(1)} s over ${calls.length} call(s).`);
  return { run: { photos: uuids.length, measured, total_ms: total }, detail: { calls, photos } };
}

async function fastVsExact(tools: Tools, uuids: string[], say: Say): Promise<{ thumbnails: number; tries: number; detail: Json[] }> {
  say("2. Fast and exact previews of up to three photos ...");
  const detail: Json[] = [];
  for (const uuid of uuids.slice(0, 3)) {
    const fast = (await tools.getPreview({ uuid, quality: "fast" })).json;
    const exact = (await tools.getPreview({ uuid })).json;
    if (String(fast["fast_fallback"] ?? "").includes("unknown_command")) throw new Error("the loaded plugin has no thumbnail_preview: File > Plug-in Manager, LrC-AVG, Reload Plug-in (this branch's plugin). Nothing was written.");
    const pick = (j: Json): Json => ({ source: j["source"] ?? j["preview_source"], width: j["width"], height: j["height"], ms: (j["timings"] as Json)["total_ms"], metrics: j["metrics"], fallback: j["fast_fallback"] ?? null });
    detail.push({ uuid, fast: pick(fast), exact: pick(exact) });
    say(`   ${uuid}: fast ${String(fast["source"])} ${String((fast["timings"] as Json)["total_ms"])} ms, exact ${String((exact["timings"] as Json)["total_ms"])} ms`);
  }
  return { thumbnails: detail.filter((d) => (d["fast"] as Json)["source"] === "thumbnail").length, tries: detail.length, detail };
}

/** Exposure moved by 1 on `uuid` after a snapshot; fast previews at OFFSETS_S; the exact export after. Put back by the caller. */
async function staleness(client: BridgeClient, tools: Tools, uuid: string, key: string, hold: (t: Taken) => void, say: Say): Promise<Json> {
  const settings = (await client.request("get_settings", { photo_uuid: uuid })).settings;
  const before = settings[key];
  if (typeof before !== "number") throw new Error(`the photo has no numeric ${key}; select a raw photo first. Nothing was written.`);
  const snap = await client.request("create_snapshot", { photo_uuid: uuid, name: SNAPSHOT });
  hold({ uuid, snapshot: snap.snapshot_id, key, before });
  const thumbBefore = luma((await tools.getPreview({ uuid, quality: "fast" })).json);
  const exportBefore = luma((await tools.getPreview({ uuid })).json);
  const value = before <= 4 ? before + 1 : before - 1;
  say(`3. Exposure ${before} -> ${value} on the first photo (History "AVG stats:check exposure"), then fast previews for ${OFFSETS_S.at(-1)} s ...`);
  await client.request("apply_settings", { photo_uuid: uuid, settings: { [key]: value }, history_name: "AVG stats:check exposure" });
  const t0 = performance.now();
  const samples: Sample[] = [];
  for (const offset of OFFSETS_S) {
    await sleep(Math.max(0, offset * 1000 - (performance.now() - t0)));
    const j = (await tools.getPreview({ uuid, quality: "fast" })).json;
    samples.push({ at_ms: Math.round(performance.now() - t0), source: String(j["source"]), luma_mean: luma(j), ms: Number((j["timings"] as Json)["total_ms"]) });
  }
  const exportAfter = luma((await tools.getPreview({ uuid })).json);
  const caught = thumbBefore !== null && exportBefore !== null && exportAfter !== null ? caughtUpAt(samples, thumbBefore, exportBefore, exportAfter) : { at_ms: null, why: "a luma was missing" };
  say(`   fast preview caught up: ${caught.at_ms === null ? `no (${caught.why ?? ""})` : `at ${caught.at_ms} ms`}`);
  return { key, before, value, thumb_before: thumbBefore, export_before: exportBefore, export_after: exportAfter, samples, caught_up: caught };
}

async function putBack(client: BridgeClient, taken: Taken): Promise<boolean | null> {
  if (!taken) return null;
  await client.request("apply_snapshot", { photo_uuid: taken.uuid, snapshot_id: taken.snapshot });
  return (await client.request("get_settings", { photo_uuid: taken.uuid })).settings[taken.key] === taken.before;
}

async function main(say: Say): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const map = loadDefaultParamMap();
  const tools = new Tools({ client, map, previews: new PreviewService(client), engineVersion: ENGINE_VERSION, ensureBridge: () => client.waitConnected(5000).then(() => undefined) });
  const r: Results = { check: "stats-check", started, node: process.version, engine_version: ENGINE_VERSION };
  const run: StatsRun = { photos: 0, measured: 0, total_ms: 0, thumbnails: 0, fast_tries: 0, put_back: null, answer: null };
  let taken: Taken = null;
  try {
    await gate.ready();
    r["plugin_version"] = client.hello()?.plugin_version ?? null;
    const sel = await client.request("get_selection", { max: 21 });
    const uuids = sel.photos.map((p) => p.uuid).filter((u): u is string => typeof u === "string");
    if (uuids.length < 2 || uuids.length > 20) throw new Error(`select 2 to 20 photos in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
    r["photos"] = sel.photos.map((p) => ({ uuid: p.uuid, filename: p.filename ?? null }));
    const s = await stats(tools, uuids, say);
    Object.assign(run, s.run);
    r["stats"] = s.detail;
    const f = await fastVsExact(tools, uuids, say);
    Object.assign(run, { thumbnails: f.thumbnails, fast_tries: f.tries });
    r["fast_vs_exact"] = f.detail;
    say(`Now in Lightroom: click ${String(sel.photos[0]?.filename ?? "the first selected photo")} and press D to open it in Develop.`);
    if ((await ask("Is that photo open in Develop?")) === "y") {
      r["staleness"] = await staleness(client, tools, uuids[0] as string, map.sdkKey("exposure") ?? "Exposure2012", (t) => (taken = t), say);
      run.put_back = await putBack(client, taken);
      taken = null;
      run.answer = await ask("Look at the Basic panel: is Exposure back where it was before the check?");
    }
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    if (taken) run.put_back = await putBack(client, taken).catch(() => false);
    await gate.release();
  }
  const v = verdict(run);
  Object.assign(r, { run, lines: v.lines, headline: v.worked ? "WORKED" : "FAILED" });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `stats_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const line of v.lines) say(`  ${line}`);
  say(`Stats check: ${v.worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${run.put_back === false ? "NO" : "YES"}`);
  if (run.put_back === false) say(`  To put the photo back by hand: Lightroom Develop, Snapshots panel (left), click "${SNAPSHOT}".`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return v.worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
