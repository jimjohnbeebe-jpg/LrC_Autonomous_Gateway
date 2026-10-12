// `npm run masks:carry`: the mask carry probe from the command line (the pure parts are in mask-carry-probe.ts;
// issue #121, with #131's shapes). Run from the repo root with Lightroom in Develop on the one photo that holds
// the hand-made masks of docs\reports\phase8.5\mask-carry.md "Steps for Jim" (that photo alone selected), the
// LrC-AVG plugin loaded, and Claude Desktop quit (this takes the engine's instance lock). Jim answers y/n in this
// window, as for npm run ai:probe [stated: Jim, 2026-10-11, "go" to that plan's decision 4]. Steps: read the
// table; refuse unless it holds the hand-made masks; snapshot "AVG masks:carry before"; write the table back
// verbatim plus one radial (History "AVG masks:carry"); read it back and diff every entry; ask Jim; put the
// photo back from the snapshot. A run that stopped before the put-back is put back first on the next start.
// Under %TEMP%\LrC-AVG\masks-carry\ (Claude Code collects them):
//   state.json                         the snapshot to put back, until it is put back
//   mask_carry_<time>.json             the results: tables before and after, the diff, the shapes, Jim's answer
//   mask_carry_bridge_log_<time>.txt   a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { MASK_TABLE_KEY, readTable } from "../params/index.js";
import { ask, carried, diffEntries, diffSummary, putBack, RADIAL_NAME, readPending, shapesOf, SNAPSHOT, writeAndRead, type Pending } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "masks-carry");
const STATE = path.join(OUT_DIR, "state.json");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

type Results = Record<string, unknown>;

function save(results: Results): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const out: Results = { check: "masks-carry", ...results, node: process.version, engine_version: ENGINE_VERSION };
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `mask_carry_bridge_log_${started}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    out["plugin_log_copied"] = path.basename(copy);
  }
  const file = path.join(OUT_DIR, `mask_carry_${started}.json`);
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

async function run(client: BridgeClient, say: (line: string) => void, r: Results): Promise<boolean> {
  const sel = await client.request("get_selection", { max: 2 });
  const photo = sel.photos[0];
  if (sel.count !== 1 || !photo?.uuid) throw new Error(`select one photo in Lightroom's Develop (${sel.count} selected), then run this again.`);
  const filename = photo.filename ?? photo.uuid;
  const before_sdk = (await client.request("get_settings", { photo_uuid: photo.uuid })).settings;
  const before = readTable(before_sdk);
  const { shapes, missing } = shapesOf(before);
  Object.assign(r, { photo: { uuid: photo.uuid, filename }, table_before: before, shapes });
  if (missing.length) {
    say(`REFUSED: ${filename} does not hold the hand-made masks of the report's steps (nothing was written):`);
    for (const m of missing) say(`  - ${m}`);
    r["refused"] = missing;
    return false;
  }
  for (const s of shapes) say(`  ${s.name}: ${s.parts.map((p) => `${p.what} (blend ${String(p.blend)}, inverted ${String(p.inverted)})`).join(" + ")}`);
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: SNAPSHOT });
  const p: Pending = { uuid: photo.uuid, filename, snapshot_id: snap.snapshot_id, before_sdk };
  setPending(p); // on disk before anything is written (Greptile, PR #132, for ai:probe)
  const { entries, radial_id } = carried(before);
  say(`Writing the ${before.length} masks back unchanged, plus "${RADIAL_NAME}". Do not click in Lightroom.`);
  const reads = await writeAndRead(client, photo.uuid, entries);
  const diffs = { read_back: diffEntries(entries, reads.read_back), read_again: diffEntries(entries, reads.read_again) };
  const summary = diffSummary(diffs);
  Object.assign(r, { written: entries, radial_id, table_after: reads.read_again[MASK_TABLE_KEY] ?? null, diff: diffs, diff_lines: summary.lines });
  for (const line of summary.lines) say(`  ${line}`);
  say("In Lightroom, open Masking (Shift+W) and click each of your masks (Add, Subtract, Intersect, Brush, Color) with Show Overlay ticked.");
  const answer = await ask(`Do the hand-made masks look unchanged? (The new "${RADIAL_NAME}" is ours.)`);
  const pb = await back(client, p);
  Object.assign(r, { answers: { masks_unchanged: answer }, put_back: pb });
  return summary.ok && answer === "y" && pb.ok;
}

async function main(say: (line: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Results = { started };
  try {
    await gate.ready();
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
    return finish(say, r, worked, worked ? "" : r["refused"] ? "refused" : !pb?.ok ? "the photo could not be put back" : "see the lines above");
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
  r["headline"] = worked ? "WORKED" : "FAILED";
  say("");
  say(`Mask carry probe: ${worked ? "WORKED" : `FAILED (${why})`}`);
  say(`put back: ${left || damaged ? "NO" : "YES"}`);
  if (left) say(`  To put it back by hand: Lightroom Develop, select ${left.filename}, Snapshots panel (left), click "${SNAPSHOT}". Or run npm run masks:carry again.`);
  if (damaged) {
    r["state_damaged"] = redact(damaged);
    say(`  The last run's put-back record was damaged (moved to ${redact(damaged)}). To put the photo back by hand: Lightroom Develop, select the photo with the hand-made masks, Snapshots panel (left), click "${SNAPSHOT}". Then run npm run masks:carry again.`);
  }
  say(`Results saved automatically: ${redact(save(r))}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : r["refused"] ? 2 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
