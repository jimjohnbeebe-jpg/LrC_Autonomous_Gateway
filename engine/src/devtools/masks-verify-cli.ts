// `npm run masks:verify` (GitHub issue #210): the three mask checks from the command line (masks-verify.ts and its
// parts). Run from the repo root with Lightroom in Develop, the LrC-AVG plugin loaded, and Claude Desktop quit (this
// takes the engine's instance lock). Jim answers y/n in this window, as for npm run masks:combine. Before each part
// the check asks Jim to select its photos in the Filmstrip: two colourful photos (part 1), one photo of two or
// more people (part 2), one photo not mirrored (part 3). Every photo is written behind a snapshot
// "AVG masks:verify before" and put back from it; a run that stopped before a put-back puts it back first on the
// next start. `-- --part colour|person|mirror` runs one part again.
// Under %TEMP%\LrC-AVG\masks-verify\ (Claude Code collects them):
//   state.json                          the snapshot to put back, until it is put back
//   mask_verify_<time>.json             the results: each step, what was written and read back, Jim's answers
//   mask_verify_bridge_log_<time>.txt   a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { MASKS_PLUGIN } from "../session/index.js";
import { ask, putBack, readPending, type Pending } from "./mask-carry-probe.js";
import { PARTS, SNAPSHOT, notPutBack, selected, verdict, type Ctx, type Part, type Photo, type Step } from "./masks-verify.js";
import { colourPart } from "./masks-verify-colour.js";
import { mirrorPart } from "./masks-verify-mirror.js";
import { personPart } from "./masks-verify-person.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "masks-verify");
const STATE = path.join(OUT_DIR, "state.json");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());
const only = process.argv.includes("--part") ? process.argv[process.argv.indexOf("--part") + 1] : undefined;
const RUN: readonly Part[] = PARTS.filter((p) => only === undefined || p === only);

/** What Jim selects for each part, and how many photos. */
const SELECT: Record<Part, { count: number; what: string }> = {
  colour: { count: 2, what: "TWO colourful photos, each with a clearly red and a clearly green area (flowers, fruit, a colour chart); Ctrl+click the second" },
  person: { count: 1, what: "ONE photo with two or more people side by side" },
  mirror: { count: 1, what: "ONE photo that is not flipped (any photo you have not flipped in Lightroom)" },
};

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const out: Record<string, unknown> = { check: "masks-verify", ...results, node: process.version, engine_version: ENGINE_VERSION };
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `mask_verify_bridge_log_${started}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    out["plugin_log_copied"] = path.basename(copy);
  }
  const file = path.join(OUT_DIR, `mask_verify_${started}.json`);
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

const ctxFor = (client: BridgeClient, say: (line: string) => void): Ctx => ({
  client,
  say,
  ask,
  guard: async (photo, fn) => {
    // A put-back still outstanding is tried again first; the run stops rather than snapshot over it (state.json
    // would lose its record, and the next snapshot would hold the test edits as the photo's start).
    const left = pending();
    if (left) {
      const pb = await back(client, left);
      if (!pb.ok) throw new Error(`${left.filename} could not be put back (${pb.why}); nothing more was written`);
    }
    await client.request("select_photo", { uuid: photo.uuid });
    const before_sdk = (await client.request("get_settings", { photo_uuid: photo.uuid })).settings;
    const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: SNAPSHOT });
    const p: Pending = { uuid: photo.uuid, filename: photo.filename, snapshot_id: snap.snapshot_id, before_sdk };
    setPending(p); // on disk before anything is written
    let value = null;
    let error: string | undefined;
    try {
      value = await fn(before_sdk);
    } catch (err) {
      error = describeError(err);
      say(`  stopped: ${error}`);
    }
    return { value, put_back: await back(client, p), ...(error ? { error } : {}) };
  },
});

/** One part; its steps go into `steps` as they happen, so a run that stops keeps the answers already given. */
async function runPart(c: Ctx, part: Part, steps: Step[]): Promise<void> {
  const s = SELECT[part];
  c.say("");
  if ((await ask(`Part ${PARTS.indexOf(part) + 1} (${part}): in Lightroom's Develop Filmstrip select ${s.what}. Done?`)) !== "y") return void steps.push({ part, photo: "-", id: "select", question: null, answer: "Jim: n", ok: false, notes: [] });
  const photos = await selected(c.client, s.count);
  if (typeof photos === "string") return void steps.push({ part, photo: "-", id: "select", question: null, answer: photos, ok: false, notes: [`select ${s.what}`] });
  if (part === "colour") await colourPart(c, photos, steps);
  else if (part === "person") await personPart(c, photos[0] as Photo, steps);
  else await mirrorPart(c, photos[0] as Photo, steps);
}

async function main(say: (line: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Record<string, unknown> = { started, parts: RUN };
  const steps: Step[] = [];
  r["steps"] = steps;
  try {
    if (RUN.length === 0) return finish(say, r, false, `--part must be one of ${PARTS.join(", ")}`);
    await gate.ready();
    const version = client.hello()?.plugin_version;
    if (!pluginVersionAtLeast(version, MASKS_PLUGIN)) return finish(say, r, false, `reload the LrC-AVG plugin ${MASKS_PLUGIN} or later (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
    const left = pending();
    if (damaged) return finish(say, r, false, "the last run's put-back record was damaged");
    if (left) {
      const pb = await back(client, left);
      say(`Put back ${left.filename} from the last run first: ${pb.ok ? "YES" : `NO (${pb.why})`}`);
      if (!pb.ok) return finish(say, r, false, `${left.filename} could not be put back`);
    }
    const c = ctxFor(client, say);
    for (const part of RUN) await runPart(c, part, steps);
    const v = verdict(steps, RUN);
    r["lines"] = v.lines;
    say("");
    for (const line of v.lines) say(`  ${line}`);
    return finish(say, r, v.worked, "see the lines above");
  } catch (err) {
    r["errors"] = [describeError(err)];
    const left = pending();
    if (left) r["put_back"] = await back(client, left);
    return finish(say, r, false, describeError(err));
  } finally {
    await gate.release();
  }
}

function finish(say: (line: string) => void, r: Record<string, unknown>, worked: boolean, why: string): number {
  const left = pending();
  const notBack = notPutBack((r["steps"] as Step[] | undefined) ?? []);
  r["headline"] = worked ? "WORKED" : "FAILED";
  say("");
  say(`Mask verify: ${worked ? "WORKED" : `FAILED (${why})`}`);
  say(`put back: ${left || damaged || notBack ? "NO" : "YES"}`);
  if (left) say(`  To put it back by hand: Lightroom Develop, select ${left.filename}, Snapshots panel (left), click "${SNAPSHOT}". Or run npm run masks:verify again.`);
  if (damaged) {
    r["state_damaged"] = redact(damaged);
    say(`  The last run's put-back record was damaged (moved to ${redact(damaged)}). Put the photo back by hand: Lightroom Develop, select it, Snapshots panel (left), click "${SNAPSHOT}". Then run npm run masks:verify again.`);
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
