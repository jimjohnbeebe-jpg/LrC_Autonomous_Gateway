// `npm run develop:check` (issue #214): the Develop parity tools in Lightroom, from the command line, through the
// tool functions themselves (Tools, as Claude Desktop calls them). Run from the repo root with Lightroom open, the
// LrC-AVG plugin of this branch loaded, two raw photos at process Version 6 selected in the Library grid (virtual
// copies are best), and Claude Desktop quit (this takes the engine's instance lock). Jim answers y/n in this window.
// Steps: read both photos' settings; lr_create_snapshot "develop-check start" on both; lr_list_snapshots; lr_apply_auto
// (tone and white balance); lr_reset; lr_set_process_version 5 then 6 on the first; lr_get_metadata raw: true;
// lr_create_virtual_copies of the first; the selection read back; both photos put back with lr_apply_snapshot (start)
// and compared with the settings read first; every snapshot the check made deleted with lr_delete_snapshot; three
// questions. Results under %TEMP%\LrC-AVG\develop-check\ (Claude Code collects them): develop_check_<time>.json.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { DEVELOP_PLUGIN, settingChanges } from "../mcp/tools-develop.js";
import type { ToolOutput } from "../mcp/tools-shared.js";
import { loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { CHECK_SNAPSHOTS, statusesOf, verdict, type Step } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "develop-check");
const COPY_NAME = "AVG develop-check copy";
const started = new Date().toISOString().replace(/[:.]/g, "-");
const map = loadDefaultParamMap();
const QUESTIONS = [
  "Is Lightroom in the module it was in before this check, showing the same folder or collection, with the same two photos selected?",
  "Select the first photo in Develop and open its History panel (left): are there steps from this check, such as Auto Settings, Reset and Process Version?",
  `In the Library grid there is a new virtual copy named "${COPY_NAME}". Remove it now (select only it, then Photo > Remove Photo, Remove). Is it gone?`,
];

type Check = { tools: Tools; client: BridgeClient; say: (l: string) => void; r: Record<string, unknown>; steps: Step[]; uuids: string[]; before: Map<string, SdkSettings>; start: Map<string, string> };

/** One tool call as a step of the check; its result is kept under its name. Returns the result's JSON, or null. */
async function step(c: Check, name: string, expect: string[], call: () => Promise<ToolOutput>, statuses = statusesOf): Promise<Record<string, unknown> | null> {
  c.say(`${name} ...`);
  try {
    const { json } = await call();
    const s: Step = { step: name, expect, statuses: statuses(json) };
    c.steps.push(s);
    (c.r["results"] as Record<string, unknown>)[name] = json;
    c.say(`  ${s.statuses.join(", ")}`);
    return json;
  } catch (err) {
    c.steps.push({ step: name, expect, statuses: [], error: describeError(err) });
    c.say(`  failed: ${describeError(err)}`);
    return null;
  }
}

const settings = async (c: Check, uuid: string): Promise<SdkSettings> => (await c.client.request("get_settings", { photo_uuid: uuid })).settings;

async function tryTools(c: Check): Promise<void> {
  const [first] = c.uuids as [string];
  for (const uuid of c.uuids) {
    const json = await step(c, `lr_create_snapshot ${uuid}`, ["ok"], () => c.tools.createSnapshot({ uuid, name: `develop-check start ${started}` }));
    const snap = json?.["snapshot"] as { id: string } | undefined;
    if (snap) c.start.set(uuid, snap.id);
  }
  if (c.start.size !== c.uuids.length) throw new Error("the start snapshots were not both taken, so nothing else was tried");
  await step(c, "lr_list_snapshots", ["listed"], () => c.tools.listSnapshots({ uuid: first }), (j) => [
    (j["snapshots"] as Array<{ id: string; by_avg: boolean }>).some((s) => s.id === c.start.get(first) && s.by_avg) ? "listed" : "missing",
  ]);
  await step(c, "lr_apply_auto tone + white balance", ["applied", "unchanged"], () => c.tools.applyAuto({ uuids: c.uuids, tone: true, white_balance: true }));
  await step(c, "lr_reset", ["reset"], () => c.tools.resetDevelop({ uuids: c.uuids, confirm: true }));
  await step(c, "lr_set_process_version 5", ["changed"], () => c.tools.setProcessVersion({ uuids: [first], version: 5, confirm: true }));
  await step(c, "lr_set_process_version 6", ["changed"], () => c.tools.setProcessVersion({ uuids: [first], version: 6, confirm: true }));
  await step(c, "lr_get_metadata raw", ["read"], () => c.tools.getMetadata({ uuids: [first], raw: true }), (j) =>
    (j["photos"] as Array<{ develop?: { sdk?: object } }>).map((p) => (p.develop?.sdk && Object.keys(p.develop.sdk).length > 0 ? "read" : "missing")),
  );
  await step(c, "lr_create_virtual_copies", ["copied"], () => c.tools.createVirtualCopies({ uuids: [first], copy_name: COPY_NAME }));
}

/** Each photo back to its start snapshot, compared with the settings read first. True when both are as before. */
async function putBack(c: Check): Promise<boolean> {
  c.say("Putting both photos back from their start snapshot ...");
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined);
  const back: Record<string, unknown> = {};
  for (const [uuid, id] of c.start) {
    await step(c, `lr_apply_snapshot (put back) ${uuid}`, ["ok"], () => c.tools.applySnapshot({ uuid, snapshot_id: id, confirm: true }));
    try {
      back[uuid] = settingChanges(map, c.before.get(uuid) as SdkSettings, await settings(c, uuid));
    } catch (err) {
      back[uuid] = { error: describeError(err) };
    }
  }
  c.r["put_back"] = back;
  c.start.clear();
  return Object.values(back).every((b) => { const x = b as { changed?: object; masks?: object }; return x.changed !== undefined && Object.keys(x.changed).length === 0 && x.masks === undefined; });
}

/** Every snapshot the check and its tools made, deleted. True when none is left. */
async function cleanSnapshots(c: Check): Promise<boolean> {
  let left = 0;
  for (const uuid of c.uuids) {
    const list = (await c.tools.listSnapshots({ uuid })).json["snapshots"] as Array<{ id: string; name: string }>;
    for (const s of list.filter((x) => CHECK_SNAPSHOTS.some((p) => x.name.startsWith(p)))) {
      await step(c, `lr_delete_snapshot "${s.name}"`, ["ok"], () => c.tools.deleteSnapshot({ uuid, snapshot_id: s.id, confirm: true }));
    }
    const after = (await c.tools.listSnapshots({ uuid })).json["snapshots"] as Array<{ name: string }>;
    left += after.filter((x) => CHECK_SNAPSHOTS.some((p) => x.name.startsWith(p))).length;
  }
  return left === 0;
}

async function run(c: Check): Promise<boolean> {
  const version = c.client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, DEVELOP_PLUGIN)) throw new Error(`reload the LrC-AVG plugin ${DEVELOP_PLUGIN} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  const sel = await c.client.request("get_selection", { max: 3 });
  c.uuids = sel.photos.map((p) => p.uuid).filter((u): u is string => typeof u === "string");
  if (sel.count !== 2 || c.uuids.length !== 2) throw new Error(`select two raw photos in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  c.r["photos"] = sel.photos.map((p) => ({ uuid: p.uuid, filename: p.filename ?? null }));
  for (const uuid of c.uuids) c.before.set(uuid, await settings(c, uuid));
  c.say("Lightroom switches to Develop for each photo and back; do not click in Lightroom until the questions.");
  await tryTools(c);
  const now = await c.client.request("get_selection", { max: 3 });
  const selectionBack = now.count === 2 && now.photos.every((p) => c.uuids.includes(String(p.uuid)));
  const settingsBack = await putBack(c);
  const snapshotsBack = await cleanSnapshots(c);
  const answers: string[] = [];
  for (const q of QUESTIONS) answers.push(await ask(q));
  const v = verdict({ steps: c.steps, selection_back: selectionBack, settings_back: settingsBack, snapshots_back: snapshotsBack, answers, questions: QUESTIONS.length });
  Object.assign(c.r, { answers, lines: v.lines, put_back_ok: settingsBack });
  c.say("");
  for (const line of v.lines) c.say(`  ${line}`);
  return v.worked;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const tools = new Tools({ client, map, previews: new PreviewService(client), intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-develop-check-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const r: Record<string, unknown> = { check: "develop-check", started, node: process.version, engine_version: ENGINE_VERSION, results: {} };
  const c: Check = { tools, client, say, r, steps: [], uuids: [], before: new Map(), start: new Map() };
  let worked = false;
  try {
    await gate.ready();
    r["plugin_version"] = client.hello()?.plugin_version;
    r["lrc_version"] = client.hello()?.lrc_version;
    worked = await run(c);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    if (c.start.size > 0) r["put_back_ok"] = await putBack(c).catch(() => false); // a run that stopped halfway
    r["steps"] = c.steps;
    await gate.release();
  }
  const back = r["put_back_ok"] === true || c.steps.length === 0;
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `develop_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Develop parity check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${back ? "YES" : "NO"}`);
  if (!back) say(`  To put a photo back by hand: Lightroom Develop, select it, Snapshots panel (left), click "AVG develop-check start ${started}".`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
