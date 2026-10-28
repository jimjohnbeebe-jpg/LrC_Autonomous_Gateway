// `npm run masks:crop` (GitHub issue #179): the crop-frame probe from the command line (the checks are in
// mask-crop-probe.ts, the steps in mask-crop-run.ts). Run from the repo root with Lightroom in Develop, two
// photos selected in the Filmstrip (one cropped landscape, one portrait photo), the LrC-AVG plugin loaded, and
// Claude Desktop quit (this takes the engine's instance lock). It asks nothing: the renders are measured with
// sharp. For each photo: snapshot "AVG masks:crop before", case A, put back from the snapshot, case B (its crop
// turned to CropAngle 10, shrunk to stay on the photo), put back again; a photo not put back ends the run. A
// run that stopped before the put-back is put back first on the next start.
// Under %TEMP%\LrC-AVG\masks-crop\ (Claude Code collects them):
//   state.json                        the snapshot to put back, until it is put back
//   mask_crop_<time>.json             the results: each photo, each case, each point
//   mask_crop_bridge_log_<time>.txt   a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { putBack, readPending, type Pending } from "./mask-carry-probe.js";
import { SNAPSHOT, eachPhoto, verdict, type PhotoResult } from "./mask-crop-probe.js";
import { oneCase, runFor, turnCrop } from "./mask-crop-run.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { throwawayRefusal } from "./throwaway.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "masks-crop");
const STATE = path.join(OUT_DIR, "state.json");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

type Results = Record<string, unknown>;

function save(results: Results): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const out: Results = { check: "masks-crop", ...results, node: process.version, engine_version: ENGINE_VERSION };
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `mask_crop_bridge_log_${started}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    out["plugin_log_copied"] = path.basename(copy);
  }
  const file = path.join(OUT_DIR, `mask_crop_${started}.json`);
  writeFileSync(file, redact(JSON.stringify(out, null, 2)) + "\n");
  return file;
}

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

/** Both cases on one photo, behind its snapshot; the photo is put back after each case. */
async function onePhoto(client: BridgeClient, uuid: string, filename: string, say: (line: string) => void): Promise<PhotoResult> {
  await client.request("select_photo", { uuid });
  const before_sdk = (await client.request("get_settings", { photo_uuid: uuid })).settings;
  const snap = await client.request("create_snapshot", { target_uuid: uuid, name: SNAPSHOT });
  const p: Pending = { uuid, filename, snapshot_id: snap.snapshot_id, before_sdk };
  setPending(p); // on disk before anything is written
  const run = runFor(client, uuid, say);
  const out: PhotoResult = { filename, orientation: before_sdk["orientation"] ?? null, cases: [] };
  say(`${filename}:`);
  out.cases.push(await oneCase(run, "A", before_sdk));
  out.put_back = await back(client, p);
  if (!out.put_back.ok) return out;
  setPending(p);
  try {
    out.cases.push(await oneCase(run, "B", await turnCrop(run, before_sdk)));
  } catch (err) {
    out.cases.push({ case: "B", ok: false, error: describeError(err) });
  }
  out.put_back = await back(client, p);
  return out;
}

async function run(client: BridgeClient, say: (line: string) => void, r: Results): Promise<boolean> {
  const sel = await client.request("get_selection", { max: 3 });
  const photos = sel.photos.filter((x): x is typeof x & { uuid: string } => typeof x.uuid === "string");
  if (sel.count < 1 || sel.count > 2 || photos.length !== sel.count) throw new Error(`select two photos in Lightroom's Develop Filmstrip, one cropped landscape and one portrait (${sel.count} selected), then run this again. Nothing was written.`);
  const results: PhotoResult[] = [];
  r["photos"] = results;
  await eachPhoto(photos, (x) => onePhoto(client, x.uuid, x.filename ?? x.uuid, say), results);
  await client.request("select_photo", { uuid: (photos[0] as { uuid: string }).uuid }).catch(() => undefined);
  const v = verdict(results);
  r["lines"] = v.lines;
  say("");
  for (const line of v.lines) say(`  ${line}`);
  return v.worked;
}

async function main(say: (line: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Results = { started };
  try {
    await gate.ready();
    // Issue #213: a catalog not marked throwaway is refused before anything is written, and outside the catch,
    // which puts back a pending record (Greptile, PR #247).
    const refused = throwawayRefusal(client.hello()?.catalog_path);
    if (refused) return finish(say, r, false, refused);
    const left = pending();
    if (damaged) return finish(say, r, false, "the last run's put-back record was damaged");
    if (left) {
      const pb = await back(client, left);
      say(`Put back ${left.filename} from the last run first: ${pb.ok ? "YES" : `NO (${pb.why})`}`);
      r["earlier_put_back"] = pb;
      if (!pb.ok) return finish(say, r, false, `${left.filename} could not be put back`);
    }
    const worked = await run(client, say, r);
    return finish(say, r, worked, worked ? "" : "see the lines above");
  } catch (err) {
    r["errors"] = [describeError(err)];
    const left = pending();
    if (left) r["put_back"] = await back(client, left);
    return finish(say, r, false, describeError(err));
  } finally {
    await gate.release();
  }
}

function finish(say: (line: string) => void, r: Results, worked: boolean, why: string): number {
  const left = pending(); // a snapshot still to apply: written and not put back (back() clears it only on success)
  const notBack = ((r["photos"] as PhotoResult[] | undefined) ?? []).some((p) => p.put_back?.ok === false);
  r["headline"] = worked ? "WORKED" : "FAILED";
  say("");
  say(`Mask crop probe: ${worked ? "WORKED" : `FAILED (${why})`}`);
  say(`put back: ${left || damaged || notBack ? "NO" : "YES"}`);
  if (left) say(`  To put it back by hand: Lightroom Develop, select ${left.filename}, Snapshots panel (left), click "${SNAPSHOT}". Or run npm run masks:crop again.`);
  if (damaged) {
    r["state_damaged"] = redact(damaged);
    say(`  The last run's put-back record was damaged (moved to ${redact(damaged)}). To put the photo back by hand: Lightroom Develop, select the photo, Snapshots panel (left), click "${SNAPSHOT}". Then run npm run masks:crop again.`);
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
