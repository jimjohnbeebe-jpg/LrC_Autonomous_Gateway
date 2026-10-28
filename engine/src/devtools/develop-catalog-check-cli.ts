// `npm run develop-catalog:check` (decisions D1-D3 of epic #207): lr_set_develop_settings, lr_undo_last_step and
// lr_remove_photos in Lightroom, through the tool functions themselves (Tools, as Claude Desktop calls them). Run from
// the repo root with Lightroom open, the LrC-AVG plugin of this branch loaded, ONE raw photo at process Version 6
// selected in the Library grid, and Claude Desktop quit (this takes the engine's instance lock). Jim answers y/n here.
// Every write goes to three virtual copies the check makes itself; the selected photo is only read. The check removes
// only those copies, by the uuids lr_create_virtual_copies answered. Steps: three copies A, B, C; two refusals that send
// nothing (an unknown key, a value out of range); a write on copy A (one canonical key, one unranged key); one undo,
// and copy A compared with before the write; a value Lightroom does not take on copy A, and copy A compared again; the
// three copies and a made-up uuid removed in one call, and each copy looked up again; the selection and the photo's
// settings compared with the start; four questions. Results under %TEMP%\LrC-AVG\develop-catalog-check\.
// Report: docs\reports\phase11\DEVELOP-CATALOG-D123.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, BridgeError, pluginVersionAtLeast } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { DECISIONS_PLUGIN, setDevelopSettings, settingChanges, undoLastStep } from "../mcp/tools-develop.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { step, stepOk, type Step, type StepLog } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "develop-catalog-check");
const COPY = "AVG develop-catalog-check";
const FAKE_UUID = "00000000-0000-0000-0000-00000000d123";
/** A value of LensManualDistortionAmount Lightroom should not take [inference: its slider runs -100..100]. */
const REFUSED = 1000;
const started = new Date().toISOString().replace(/[:.]/g, "-");
const map = loadDefaultParamMap();
const QUESTIONS = [
  "Is Lightroom in the module it was in before this check, showing the same folder or collection, with your photo selected?",
  "Did the whole check run without Lightroom showing a dialog you had to click (for example one asking to confirm the removal)?",
  `In the Library grid (All Photographs), are the three copies "${COPY} A", "B" and "C" gone, and your photo still there?`,
  'Select your photo in Develop and open its History panel (left): is there NO step from this check on it (none named "AVG set develop settings")?',
];

type Check = StepLog & { tools: Tools; client: BridgeClient; master: string; created: string[] };

const settings = async (c: Check, uuid: string): Promise<SdkSettings> => (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
const codes = (j: Record<string, unknown>): string[] => (j["failed"] as Array<{ code: string }>).map((f) => f.code);
const photoStatus = (j: Record<string, unknown>): string[] => [...(j["photos"] as Array<{ status: string }>).map((p) => p.status), ...codes(j)];

/** A comparison as a step: "back" when `uuid` reads as `before` (by canonical name and mask count), else what differs. */
async function compare(c: Check, name: string, uuid: string, before: SdkSettings): Promise<void> {
  try {
    const d = settingChanges(map, before, await settings(c, uuid));
    const keys = [...Object.keys(d.changed), ...(d.masks ? ["masks"] : [])];
    (c.r["results"] as Record<string, unknown>)[name] = d;
    c.steps.push({ step: name, expect: ["back"], statuses: [keys.length === 0 ? "back" : `differs: ${keys.join(", ")}`] });
  } catch (err) {
    c.steps.push({ step: name, expect: ["back"], statuses: [], error: describeError(err) });
  }
  c.say(`${name}: ${c.steps.at(-1)?.statuses.join(", ") ?? ""}`);
}

async function makeCopies(c: Check): Promise<void> {
  for (const letter of ["A", "B", "C"]) {
    const j = await step(c, `lr_create_virtual_copies ${letter}`, ["copied"], () => c.tools.createVirtualCopies({ uuids: [c.master], copy_name: `${COPY} ${letter}` }));
    const copy = (j?.["photos"] as Array<{ copy_uuid?: string | null }> | undefined)?.[0]?.copy_uuid;
    if (typeof copy === "string" && copy !== c.master) c.created.push(copy); // never the photo Jim selected
  }
  if (c.created.length !== 3) throw new Error(`only ${c.created.length} of 3 copies were made, so nothing else was tried`);
}

async function tryTools(c: Check): Promise<void> {
  const [a] = c.created as [string];
  const set = (s: Record<string, number>) => c.tools.call(setDevelopSettings, { uuids: [a], settings: s });
  await step(c, "refused: unknown key", ["UNKNOWN_PARAMETER"], () => set({ NotALightroomKey: 1 }), codes);
  await step(c, "refused: Exposure2012 out of range", ["OUT_OF_RANGE"], () => set({ Exposure2012: 9 }), codes);
  const beforeA = await settings(c, a);
  const ev = typeof beforeA["Exposure2012"] === "number" ? beforeA["Exposure2012"] : 0;
  await step(c, "lr_set_develop_settings on copy A", ["set"], () => set({ Exposure2012: ev <= 4 ? ev + 0.5 : ev - 0.5, LensManualDistortionAmount: 10 }), photoStatus);
  await step(c, "lr_undo_last_step", ["undone"], () => c.tools.call(undoLastStep, { confirm: true }), (j) => [j["undone"] === true ? "undone" : "nothing undone"]);
  await compare(c, "copy A after the undo, against before the write", a, beforeA);
  const beforeRefused = await settings(c, a);
  await step(c, `lr_set_develop_settings LensManualDistortionAmount ${REFUSED}`, ["not_taken"], () => set({ LensManualDistortionAmount: REFUSED }), photoStatus);
  await compare(c, "copy A after the put-back, against before that write", a, beforeRefused);
}

/** The copies this check made, and a made-up uuid, removed in one call; then each copy looked up again. */
async function removeCopies(c: Check): Promise<void> {
  const uuids = [...c.created, FAKE_UUID];
  await step(c, "lr_remove_photos (the three copies and a made-up uuid)", ["removed"], () => c.tools.call(removePhotos, { uuids, confirm: true }), (j) => {
    const [removed, missing] = [j["removed"] as string[], j["missing"] as string[]];
    const all = removed.length === c.created.length && missing.length === 1 && missing[0] === FAKE_UUID;
    return [all && j["status"] === "removed" ? "removed" : `${String(j["status"])} (${removed.length} removed, ${missing.length} missing)`];
  });
  const found: string[] = [];
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  for (const uuid of c.created) {
    const gone = await c.client.request("get_settings", { photo_uuid: uuid }).then(() => false, (err: unknown) => err instanceof BridgeError && err.code === "unknown_photo");
    if (!gone) found.push(uuid);
  }
  c.steps.push({ step: "the copies are no longer in the catalog", expect: ["gone"], statuses: [found.length === 0 ? "gone" : `still there: ${found.join(", ")}`] });
  c.say(`the copies looked up again: ${found.length === 0 ? "gone" : `${found.length} still there`}`);
  c.created = found;
}

async function run(c: Check): Promise<boolean> {
  const version = c.client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, DECISIONS_PLUGIN)) throw new Error(`reload the LrC-AVG plugin ${DECISIONS_PLUGIN} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  const sel = await c.client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select ONE raw photo in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  c.master = uuid;
  c.r["photo"] = { uuid, filename: sel.photos[0]?.filename ?? null };
  const before = await settings(c, uuid);
  c.say("Lightroom switches to Develop and to the Library grid and back; do not click in Lightroom until the questions.");
  await makeCopies(c);
  await tryTools(c);
  await removeCopies(c);
  const now = await c.client.request("get_selection", { max: 2 });
  c.steps.push({ step: "the selection is as it was", expect: ["yes"], statuses: [now.count === 1 && now.photos[0]?.uuid === uuid ? "yes" : `no (${now.count} selected)`] });
  await compare(c, "your photo's settings against the start", uuid, before);
  const answers: string[] = [];
  for (const q of QUESTIONS) answers.push(await ask(q));
  const lines = [...c.steps.map((s: Step) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(" or ")})`)];
  for (const [i, a] of answers.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  Object.assign(c.r, { answers, lines });
  c.say("");
  for (const line of lines) c.say(`  ${line}`);
  return c.steps.every(stepOk) && answers.length === QUESTIONS.length && answers.every((a) => a === "y");
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const tools = new Tools({ client, map, previews: new PreviewService(client), intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-develop-catalog-check-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const r: Record<string, unknown> = { check: "develop-catalog-check", started, node: process.version, engine_version: ENGINE_VERSION, results: {} };
  const c: Check = { tools, client, say, r, steps: [], master: "", created: [] };
  let worked = false;
  try {
    await gate.ready();
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    worked = await run(c);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
    if (c.created.length > 0) await removeCopies(c).catch(() => undefined); // a run that stopped halfway: only the check's own copies
  } finally {
    r["steps"] = c.steps;
    r["copies_left"] = c.created;
    await gate.release();
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `develop_catalog_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Develop and catalog decisions check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${c.created.length === 0 ? "YES" : "NO"}`);
  if (c.created.length > 0) say(`  ${c.created.length} copies named "${COPY} ..." are still in the catalog: select them in the Library grid, Photo > Remove Photos..., Remove.`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
