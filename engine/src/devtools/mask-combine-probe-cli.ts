// `npm run masks:combine`: the mask combine probe from the command line (the pure parts are in
// mask-combine-probe.ts; issue #131). Run from the repo root with Lightroom in Develop on one virtual copy of a
// photo with sky (that photo alone selected), the LrC-AVG plugin 0.21.0 loaded, and Claude Desktop quit (this
// takes the engine's instance lock). Jim answers y/n in this window, as for npm run masks:carry [stated: Jim,
// 2026-10-11, "go" to the ai:probe plan's decision 4]. Steps: snapshot "AVG masks:combine before"; for each
// candidate form, write the photo's masks as read plus the candidate's mask (History "AVG masks:combine <n>"),
// let Lightroom compute an AI part, read it back twice, ask Jim; then put the photo back from the snapshot.
// A run that stopped before the put-back is put back first on the next start.
// Under %TEMP%\LrC-AVG\masks-combine\ (Claude Code collects them):
//   state.json                           the snapshot to put back, until it is put back
//   mask_combine_<time>.json             the results: each form's mask written, read back, read again, Jim's answer
//   mask_combine_bridge_log_<time>.txt   a copy of the plugin's log, user folder redacted
// `--kinds` (npm run masks:kinds, issue #190): the colour range, brush and depth range masks instead
// (mask-combine-probe.ts KIND_CANDIDATES), plugin 0.16.0 (masks), files under %TEMP%\LrC-AVG\masks-kinds\
// named mask_kinds_*. A photo without a depth map skips the depth range ("skipped: no depth map", not asked).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { readTable, tableSettings } from "../params/index.js";
import { sampleColor } from "../metrics/index.js";
import { PreviewService } from "../preview/index.js";
import { MASKS_PLUGIN } from "../session/index.js";
import { AI_PART_PLUGIN } from "../session/mask-parts.js";
import { ask, putBack, readPending, type Pending } from "./mask-carry-probe.js";
import { build, CANDIDATES, computeAi, hasAi, HISTORY, judge, KIND_CANDIDATES, noDepthMap, SNAPSHOT, verdict, withSample, type FormResult } from "./mask-combine-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { requireThrowaway } from "./throwaway.js";

const KINDS = process.argv.includes("--kinds");
const SET = KINDS
  ? { dir: "masks-kinds", file: "mask_kinds", check: "masks-kinds", title: "Mask kinds probe", cmd: "npm run masks:kinds", history: "AVG masks:kinds", snapshot: "AVG masks:kinds before", candidates: KIND_CANDIDATES, plugin: MASKS_PLUGIN }
  : { dir: "masks-combine", file: "mask_combine", check: "masks-combine", title: "Mask combine probe", cmd: "npm run masks:combine", history: HISTORY, snapshot: SNAPSHOT, candidates: CANDIDATES, plugin: AI_PART_PLUGIN };
const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", SET.dir);
const STATE = path.join(OUT_DIR, "state.json");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

type Results = Record<string, unknown>;

function save(results: Results): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const out: Results = { check: SET.check, ...results, node: process.version, engine_version: ENGINE_VERSION };
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `${SET.file}_bridge_log_${started}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    out["plugin_log_copied"] = path.basename(copy);
  }
  const file = path.join(OUT_DIR, `${SET.file}_${started}.json`);
  writeFileSync(file, redact(JSON.stringify(out, null, 2)) + "\n");
  return file;
}

/** Where a damaged put-back record was moved to (readPending), once one was found. */
let damaged: string | null = null;
const pending = (): Pending | null => {
  const read = readPending(STATE, path.join(OUT_DIR, `state.damaged-${started}.json`));
  damaged ??= read.damaged;
  return read.pending;
};
const setPending = (p: Pending | null): void => {
  mkdirSync(OUT_DIR, { recursive: true });
  if (p) writeFileSync(STATE, JSON.stringify(p, null, 2) + "\n");
  else rmSync(STATE, { force: true });
};

async function back(client: BridgeClient, p: Pending): Promise<{ ok: boolean; why: string }> {
  const pb = await putBack(client, p.uuid, p.snapshot_id, p.before_sdk).catch((err: unknown) => ({ ok: false, why: describeError(err) }));
  if (pb.ok) setPending(null);
  return pb;
}

/** Each candidate in turn; stops early when an AI part gave no result (Lightroom refuses writes to the photo until it does, Pending.lua). */
async function tryAll(client: BridgeClient, uuid: string, say: (line: string) => void, before: ReturnType<typeof readTable>, results: FormResult[]): Promise<void> {
  const sample = KINDS ? await sampleColor((await new PreviewService(client).render({ longEdge: 800, quality: 80, photoUuid: uuid })).jpeg, { x: 0.5, y: 0.5 }) : null;
  for (const [i, raw] of SET.candidates.entries()) {
    const c = sample ? withSample(raw, sample) : raw;
    const form = c.forms.at(-1) ?? c.id;
    say(`${i + 1}/${SET.candidates.length} "${form}": writing it. Do not click in Lightroom.`);
    const { entries, id } = build(before, c);
    const res = await client.request("apply_settings", { target_uuid: uuid, settings: tableSettings(entries, false), history_name: `${SET.history} ${i + 1}` });
    const ai = hasAi(entries, id) ? await computeAi(client, uuid, id) : undefined;
    if (ai) say(`  Lightroom's AI part: ${ai.outcome} (${Math.round(ai.ms / 1000)} s)`);
    const again = (await client.request("get_settings", { photo_uuid: uuid })).settings;
    const skip = noDepthMap(c, res.read_back, id) ? "skipped: no depth map" : null;
    if (skip) say(`  ${skip}: Lightroom read the depth range back without its depth sample (not asked).`);
    const answer = skip ?? (ai && !ai.ok ? "not asked" : await ask(`  ${c.ask}`));
    const r = judge(c, entries, id, { read_back: res.read_back, read_again: again }, ai, answer);
    for (const p of r.problems) say(`  ${p}`);
    results.push(r);
    if (ai && !ai.ok && !ai.outcome.startsWith("ErrorReason")) break; // no result: Lightroom may still compute, so nothing more is written
  }
}

async function run(client: BridgeClient, say: (line: string) => void, r: Results): Promise<boolean> {
  const version = client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, SET.plugin)) throw new Error(`reload the LrC-AVG plugin ${SET.plugin} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  const sel = await client.request("get_selection", { max: 2 });
  const photo = sel.photos[0];
  if (sel.count !== 1 || !photo?.uuid) throw new Error(`select one photo in Lightroom's Develop (${sel.count} selected), then run this again.`);
  const filename = photo.filename ?? photo.uuid;
  const before_sdk = (await client.request("get_settings", { photo_uuid: photo.uuid })).settings;
  const before = readTable(before_sdk);
  Object.assign(r, { photo: { uuid: photo.uuid, filename }, table_before: before });
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: SET.snapshot });
  const p: Pending = { uuid: photo.uuid, filename, snapshot_id: snap.snapshot_id, before_sdk };
  setPending(p); // on disk before anything is written (Greptile, PR #132, for ai:probe)
  say(`${filename}: ${SET.candidates.length} mask forms, one at a time. Each mask brightens its area by +2 EV; look at the photo in Lightroom, then answer.`);
  const results: FormResult[] = [];
  await tryAll(client, photo.uuid, say, before, results).catch((err: unknown) => {
    r["errors"] = [describeError(err)]; // the forms tried so far are kept
  });
  const pb = await back(client, p);
  const v = verdict(results, results.length, SET.candidates);
  Object.assign(r, { forms: results, form_lines: v.lines, put_back: pb });
  say("");
  for (const line of v.lines) say(`  ${line}`);
  return v.worked && pb.ok && !r["errors"];
}

async function main(say: (line: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Results = { started };
  try {
    await gate.ready();
    requireThrowaway(client); // issue #213: a catalog not marked throwaway is refused before anything is written
    const left = pending();
    if (damaged) return finish(say, r, false, "the last run's put-back record was damaged");
    if (left) {
      const pb = await back(client, left);
      say(`Put back ${left.filename} from the last run first: ${pb.ok ? "YES" : `NO (${pb.why})`}`);
      r["earlier_put_back"] = pb;
      if (!pb.ok) return finish(say, r, false, `${left.filename} could not be put back`);
    }
    const worked = await run(client, say, r);
    const pb = r["put_back"] as { ok: boolean } | undefined;
    return finish(say, r, worked, worked ? "" : r["errors"] ? describeErrors(r) : !pb?.ok ? "the photo could not be put back" : "see the lines above");
  } catch (err) {
    r["errors"] = [describeError(err)];
    const left = pending();
    if (left) r["put_back"] = await back(client, left);
    return finish(say, r, false, describeError(err));
  } finally {
    await gate.release();
  }
}

const describeErrors = (r: Results): string => (r["errors"] as string[]).join("; ");

function finish(say: (line: string) => void, r: Results, worked: boolean, why: string): number {
  const left = pending(); // a snapshot still to apply: written and not put back (back() clears it only on success)
  r["headline"] = worked ? "WORKED" : "FAILED";
  say("");
  say(`${SET.title}: ${worked ? "WORKED" : `FAILED (${why})`}`);
  say(`put back: ${left || damaged ? "NO" : "YES"}`);
  if (left) say(`  To put it back by hand: Lightroom Develop, select ${left.filename}, Snapshots panel (left), click "${SET.snapshot}". Or run ${SET.cmd} again.`);
  if (damaged) {
    r["state_damaged"] = redact(damaged);
    say(`  The last run's put-back record was damaged (moved to ${redact(damaged)}). To put the photo back by hand: Lightroom Develop, select the virtual copy, Snapshots panel (left), click "${SET.snapshot}". Then run ${SET.cmd} again.`);
  }
  say(`Results saved automatically: ${redact(save(r))}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
