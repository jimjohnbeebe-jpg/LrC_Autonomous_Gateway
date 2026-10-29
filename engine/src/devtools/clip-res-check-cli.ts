// `npm run clip:res` (issue #168): export time and clipping of the selected photos at 1600, 2560 and 4096 px, from
// the command line (the pure parts are in clip-res-check.ts). Run from the repo root with Lightroom open, the
// LrC-AVG plugin loaded, 1 to MAX_PHOTOS photos selected, and Claude Desktop quit (this takes the engine's instance
// lock). Each photo is exported by its uuid (export_preview photo_uuid), so the selection stays. For each photo and
// edge: WARMUPS untimed renders, then RUNS timed ones, each the engine's own PreviewService.render (the export a
// session pass uses), measured at the size exported. Read only: nothing is written to the catalog, so there is
// nothing to put back. It asks nothing. Stops at the first render that fails.
// Results: %TEMP%\LrC-AVG\clip-res\clip_res_<time>.json (Claude Code collects them). Report: docs\reports\phase11\CLIP-RES.md.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, PREVIEW_QUALITY } from "../mcp/index.js";
import { PreviewService } from "../preview/index.js";
import { EDGES, RUNS, WARMUPS, summarize, verdict, type Sample } from "./clip-res-check.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "clip-res");
/** About a minute a photo at ~2.6 s an export [handle: docs\reports\phase2\PHASE2.md "Numbers"]; more at 4096 px [unverified]. */
const MAX_PHOTOS = 4;
const started = new Date().toISOString().replace(/[:.]/g, "-");
type Say = (line: string) => void;
type Row = { edge: number; samples: Sample[] };
type Photo = { uuid: string; filename: string | null; byEdge: Row[] };

async function sample(previews: PreviewService, uuid: string, edge: number): Promise<Sample> {
  const p = await previews.render({ longEdge: edge, quality: PREVIEW_QUALITY, photoUuid: uuid });
  const { clip_high_pct, clip_high_tone_pct, clip_low_pct } = p.metrics;
  return { width: p.width, height: p.height, ...p.timings, clip_high_pct, clip_high_tone_pct, clip_low_pct };
}

/** Every edge of one photo; throws at the first timed render that fails, after recording it. */
async function measure(previews: PreviewService, photo: Photo, say: Say): Promise<void> {
  say(`${photo.filename ?? photo.uuid}:`);
  for (const edge of EDGES) {
    const row: Row = { edge, samples: [] };
    photo.byEdge.push(row);
    for (let i = 0; i < WARMUPS; i++) await sample(previews, photo.uuid, edge);
    for (let i = 0; i < RUNS; i++) {
      const s = await sample(previews, photo.uuid, edge).catch((err: unknown): Sample => ({ error: describeError(err) }));
      row.samples.push(s);
      if ("error" in s) throw new Error(`the ${edge} px export of ${photo.filename ?? photo.uuid} failed: ${s.error}`);
      say(`   ${edge} px: ${(s.total_ms / 1000).toFixed(2)} s, ${Math.max(s.width, s.height)} px, clip_high_tone ${s.clip_high_tone_pct} %, clip_low ${s.clip_low_pct} %`);
    }
  }
}

async function main(say: Say): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const previews = new PreviewService(client);
  const r: Record<string, unknown> = { check: "clip-res", started, node: process.version, engine_version: ENGINE_VERSION, edges: EDGES, warmups: WARMUPS, runs: RUNS, quality: PREVIEW_QUALITY };
  const photos: Photo[] = [];
  try {
    await gate.ready();
    Object.assign(r, { plugin_version: client.hello()?.plugin_version ?? null, lrc_version: client.hello()?.lrc_version ?? null });
    const sel = await client.request("get_selection", { max: MAX_PHOTOS + 1 });
    const chosen = sel.photos.flatMap((p) => (typeof p.uuid === "string" ? [{ uuid: p.uuid, filename: p.filename ?? null, byEdge: [] }] : []));
    if (chosen.length < 1 || chosen.length > MAX_PHOTOS || chosen.length !== sel.count) throw new Error(`select 1 to ${MAX_PHOTOS} photos in Lightroom (${sel.count} selected), then run this again. Nothing was written.`);
    say(`${chosen.length} photo(s), ${EDGES.length} sizes, ${WARMUPS} warm-up + ${RUNS} timed exports each; nothing is written to the catalog.`);
    for (const photo of chosen) {
      photos.push(photo);
      await measure(previews, photo, say);
    }
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    await gate.release();
  }
  const results = photos.map((p) => {
    const summary = summarize(p.byEdge);
    return { ...p, summary, ...verdict(summary) };
  });
  const worked = results.length > 0 && results.every((p) => p.worked) && r["errors"] === undefined;
  Object.assign(r, { photos: results, headline: worked ? "WORKED" : "FAILED", put_back: "YES (nothing written)" });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `clip_res_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const p of results) {
    say(`${p.filename ?? p.uuid}:`);
    for (const line of p.lines) say(`  ${line}`);
  }
  say(`Clip resolution check: ${worked ? "WORKED" : "FAILED"}`);
  say("put back: YES (nothing written)");
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
