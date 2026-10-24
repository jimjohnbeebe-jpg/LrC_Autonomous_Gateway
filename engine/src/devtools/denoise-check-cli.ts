// `npm run denoise:check` (issue #190): lr_apply_denoise's plugin command in Lightroom, from the command line
// (the pure parts are in denoise-check.ts). Run from the repo root with Lightroom Classic 15 or later, the
// LrC-AVG plugin 1.1.0 loaded, two raw photos (virtual copies) selected in the Library grid, and Claude Desktop
// quit (this takes the engine's instance lock). Jim answers y/n in this window, as for npm run masks:combine.
// Steps: record both photos' FilterList; Denoise 30 on both (expect applied); again 30 (unchanged); 50
// (amount_changed); the selection read back; a preview of the second photo by uuid; each photo put back from
// the snapshot its first Denoise took, and its FilterList compared with the one recorded; two questions.
// Under %TEMP%\LrC-AVG\denoise-check\ (Claude Code collects them): denoise_check_<time>.json, the results with
// the FilterList dumps before, after and put back.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { DENOISE_PLUGIN } from "../mcp/tools-denoise.js";
import { PreviewService } from "../preview/index.js";
import { FILTER_LIST, verdict, type DenoiseAnswer, type Step } from "./denoise-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "denoise-check");
const SNAPSHOT = "AVG denoise:check before";
const started = new Date().toISOString().replace(/[:.]/g, "-");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
type Results = Record<string, unknown>;

async function filters(client: BridgeClient, uuid: string): Promise<unknown> {
  return (await client.request("get_settings", { photo_uuid: uuid })).settings[FILTER_LIST] ?? null;
}

async function denoise(client: BridgeClient, uuids: string[], amount: number, step: string, expect: string[], say: (l: string) => void): Promise<Step> {
  say(`${step}: Denoise ${amount} on ${uuids.length} photos. Lightroom switches to Develop for each; do not click in Lightroom.`);
  const answers: DenoiseAnswer[] = [];
  for (const uuid of uuids) answers.push(await client.request("apply_denoise", { photo_uuid: uuid, amount, snapshot_name: SNAPSHOT }, { timeoutMs: 90_000 }));
  for (const a of answers) say(`  ${a.uuid}: ${a.status}${a.reason ? ` (${a.reason})` : ""}, ${a.ms} ms`);
  return { step, expect, answers };
}

async function run(client: BridgeClient, say: (l: string) => void, r: Results): Promise<boolean> {
  const version = client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, DENOISE_PLUGIN)) throw new Error(`reload the LrC-AVG plugin ${DENOISE_PLUGIN} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  const sel = await client.request("get_selection", { max: 3 });
  const uuids = sel.photos.map((p) => p.uuid).filter((u): u is string => typeof u === "string");
  if (sel.count !== 2 || uuids.length !== 2) throw new Error(`select two raw photos in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  r["photos"] = sel.photos.map((p) => ({ uuid: p.uuid, filename: p.filename ?? null }));
  const before = await Promise.all(uuids.map((u) => filters(client, u)));
  r["filters_before"] = before;
  const steps: Step[] = [];
  r["steps"] = steps;
  steps.push(await denoise(client, uuids, 30, "first Denoise", ["applied", "amount_changed"], say));
  r["filters_after"] = await Promise.all(uuids.map((u) => filters(client, u)));
  say("Waiting 20 s for Lightroom to finish computing Denoise (its Activity Center) ...");
  await sleep(20_000);
  steps.push(await denoise(client, uuids, 30, "same amount again", ["unchanged"], say));
  steps.push(await denoise(client, uuids, 50, "a new amount", ["amount_changed"], say));
  const now = await client.request("get_selection", { max: 3 });
  const selectionBack = now.count === 2 && now.photos.every((p) => uuids.includes(String(p.uuid)));
  const preview = await new PreviewService(client).render({ longEdge: 800, quality: 80, photoUuid: uuids[1] as string }).catch((err: unknown) => describeError(err));
  const previewOk = typeof preview !== "string" && preview.uuid === uuids[1];
  r["preview"] = typeof preview === "string" ? { error: preview } : { uuid: preview.uuid, width: preview.width, height: preview.height };
  say("Putting both photos back from the snapshot their first Denoise took ...");
  const firsts = steps[0]?.answers ?? [];
  const putBack = [];
  for (const [i, uuid] of uuids.entries()) {
    const snap = firsts.find((a) => a.uuid === uuid)?.snapshot;
    if (!snap) {
      putBack.push({ uuid, ok: false, why: "the first Denoise took no snapshot" });
      continue;
    }
    const ok = await client.request("apply_snapshot", { photo_uuid: uuid, snapshot_id: snap.id }).then(() => true, (err: unknown) => describeError(err));
    const back = await filters(client, uuid);
    putBack.push({ uuid, ok: ok === true && JSON.stringify(back) === JSON.stringify(before[i]), ...(ok === true ? {} : { why: ok }), filters: back });
  }
  r["put_back"] = putBack;
  const answers = [
    await ask("Is Lightroom back in the module it was in before this check, with the same two photos selected?"),
    await ask("Open each photo in Develop: is Denoise off in the Detail panel on both (as before the check)?"),
  ];
  const v = verdict({ steps, selection_back: selectionBack, filters_back: putBack.every((p) => p.ok), preview_ok: previewOk, answers });
  Object.assign(r, { answers, lines: v.lines });
  say("");
  for (const line of v.lines) say(`  ${line}`);
  return v.worked;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Results = { check: "denoise-check", started, node: process.version, engine_version: ENGINE_VERSION };
  let worked = false;
  try {
    await gate.ready();
    worked = await run(client, say, r);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    await gate.release();
  }
  const putBack = r["put_back"] as Array<{ ok: boolean }> | undefined;
  const back = putBack ? putBack.every((p) => p.ok) : r["steps"] === undefined;
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `denoise_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Denoise check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${back ? "YES" : "NO"}`);
  if (!back) say(`  To put a photo back by hand: Lightroom Develop, select it, Snapshots panel (left), click "${SNAPSHOT}".`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
