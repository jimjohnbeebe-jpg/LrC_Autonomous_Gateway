// `npm run crop:spike` (GitHub issue #115, feasibility spike): does Lightroom take a crop and a straighten written
// through lr_set_develop_settings (decision D1, the SDK-key passthrough), with no plugin change? Run from the repo
// root with Lightroom open, the LrC-AVG plugin 1.7.0+ loaded, ONE raw photo at process Version 6 selected in the
// Library grid, and Claude Desktop quit (this takes the engine's instance lock). Every write goes to one virtual copy
// the check makes itself (as develop-catalog:check does); the selected photo is only read, and only that copy, by
// the uuid lr_create_virtual_copies answered, is removed. Steps: the copy; a render; the crop (CropLeft 0.1, CropRight
// 0.9, CropTop 0.2, CropBottom 0.8: 80 % by 60 %, so the render's aspect changes) written and read back; a render;
// CropAngle 5 written and read back; a render; the copy shown in Lightroom; two y/n; the copy removed; the photo
// selected again and compared with the start. Results and the three renders under %TEMP%\LrC-AVG\crop-spike\.
// Report: docs\reports\phase11\CROP-SPIKE.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { DECISIONS_PLUGIN, setDevelopSettings, settingChanges } from "../mcp/tools-develop.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { CROP, loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { step, stepOk, type Step, type StepLog } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "crop-spike");
const COPY = "AVG crop-spike";
const BOX = { [CROP.left]: 0.1, [CROP.right]: 0.9, [CROP.top]: 0.2, [CROP.bottom]: 0.8 };
const ANGLE = 5;
/** The aspect the crop should give, over the uncropped one: 0.8 / 0.6, or its inverse on a photo Lightroom turns a quarter [inference: crop-frame.ts, the keys are fractions of the stored photo]. */
const RATIOS = [0.8 / 0.6, 0.6 / 0.8];
const started = new Date().toISOString().replace(/[:.]/g, "-");
const map = loadDefaultParamMap();
const QUESTIONS = [
  `Lightroom now shows the copy "${COPY}" in Develop. Does it show a tighter crop than your photo (about 80 % of the width, 60 % of the height)?`,
  `Is the copy's picture rotated by about ${ANGLE} degrees (Crop tool, R: the Angle slider near ${ANGLE})? Press R again to leave the Crop tool before answering.`,
];

type Check = StepLog & { tools: Tools; client: BridgeClient; previews: PreviewService; master: string; copy: string | null };

const settings = async (c: Check, uuid: string): Promise<SdkSettings> => (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
const photoStatus = (j: Record<string, unknown>): string[] => [
  ...((j["photos"] as Array<{ status: string }> | undefined) ?? []).map((p) => p.status),
  ...((j["failed"] as Array<{ code: string }> | undefined) ?? []).map((f) => f.code),
];
/** Every crop key Lightroom read back (CropConstrainToWarp and the others included), as they are. */
const cropKeys = (s: SdkSettings): SdkSettings => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("Crop")));

/** A render of the copy, saved next to the results; its aspect, or null when the render failed (recorded). */
async function render(c: Check, label: string): Promise<number | null> {
  const renders = (c.r["renders"] ??= {}) as Record<string, unknown>;
  try {
    const p = await c.previews.render({ photoUuid: c.copy as string, longEdge: 1024, quality: 85 });
    const file = path.join(OUT_DIR, `crop_spike_${started}_${label}.jpg`);
    writeFileSync(file, p.jpeg);
    renders[label] = { width: p.width, height: p.height, aspect: p.width / p.height, file: redactHome(file, os.homedir()) };
    c.say(`render ${label}: ${p.width} x ${p.height}`);
    return p.width / p.height;
  } catch (err) {
    renders[label] = { error: describeError(err) };
    c.say(`render ${label}: ${describeError(err)}`);
    return null;
  }
}

/** One write on the copy through the tool, and the crop keys read back afterwards. */
async function write(c: Check, name: string, s: Record<string, number>): Promise<void> {
  await step(c, name, ["set"], () => c.tools.call(setDevelopSettings, { uuids: [c.copy as string], settings: s }), photoStatus);
  const back = cropKeys(await settings(c, c.copy as string));
  (c.r["read_back"] as Record<string, unknown>)[name] = back;
  const off = Object.entries(s).filter(([k, v]) => typeof back[k] !== "number" || Math.abs((back[k] as number) - v) > 1e-4).map(([k]) => k);
  c.steps.push({ step: `${name}: read back as written`, expect: ["yes"], statuses: [off.length === 0 ? "yes" : `no: ${off.join(", ")}`] });
  c.say(`${name}: read back ${JSON.stringify(back)}`);
}

async function removeCopy(c: Check): Promise<void> {
  const uuids = [c.copy as string];
  await step(c, "lr_remove_photos (the copy)", ["removed"], () => c.tools.call(removePhotos, { uuids, confirm: true }), (j) => [String(j["status"])]);
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  const gone = await c.client.request("get_settings", { photo_uuid: c.copy as string }).then(() => false, () => true);
  c.steps.push({ step: "the copy is no longer in the catalog", expect: ["gone"], statuses: [gone ? "gone" : "still there"] });
  if (gone) c.copy = null;
}

async function run(c: Check): Promise<boolean> {
  const version = c.client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, DECISIONS_PLUGIN)) throw new Error(`reload the LrC-AVG plugin ${DECISIONS_PLUGIN} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  const sel = await c.client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select ONE raw photo in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  c.master = uuid;
  const before = await settings(c, uuid);
  Object.assign(c.r, { photo: { uuid, filename: sel.photos[0]?.filename ?? null }, crop_before: cropKeys(before), read_back: {} });
  c.say("Lightroom switches between Develop and the Library grid; do not click in Lightroom until the questions.");
  const j = await step(c, "lr_create_virtual_copies", ["copied"], () => c.tools.createVirtualCopies({ uuids: [uuid], copy_name: COPY }));
  const copy = (j?.["photos"] as Array<{ copy_uuid?: string | null }> | undefined)?.[0]?.copy_uuid;
  if (typeof copy !== "string" || copy === uuid) throw new Error("no virtual copy was made, so nothing else was tried");
  c.copy = copy;
  const a0 = await render(c, "1-before");
  await write(c, "crop", BOX);
  const a1 = await render(c, "2-crop");
  const ratio = a0 !== null && a1 !== null ? a1 / a0 : null;
  const near = ratio !== null && RATIOS.some((r) => Math.abs(ratio / r - 1) < 0.03);
  c.steps.push({ step: "the crop render's aspect changed as the crop says", expect: ["yes"], statuses: [ratio === null ? "no render" : near ? "yes" : `no: ${ratio.toFixed(3)} of the uncropped aspect`] });
  await write(c, "straighten", { [CROP.angle]: ANGLE });
  await render(c, "3-straighten");
  await c.client.request("select_photo", { uuid: copy });
  const answers: string[] = [];
  for (const q of QUESTIONS) answers.push(await ask(q));
  await removeCopy(c);
  await c.client.request("select_photo", { uuid }).catch(() => undefined);
  const now = await c.client.request("get_selection", { max: 2 });
  c.steps.push({ step: "your photo is selected again", expect: ["yes"], statuses: [now.count === 1 && now.photos[0]?.uuid === uuid ? "yes" : `no (${now.count} selected)`] });
  const d = settingChanges(map, before, await settings(c, uuid), Object.keys(cropKeys(before)));
  c.steps.push({ step: "your photo's settings against the start", expect: ["back"], statuses: [Object.keys(d.changed).length === 0 && !d.masks ? "back" : `differs: ${Object.keys(d.changed).join(", ")}`] });
  const lines = c.steps.map((s: Step) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(" or ")})`);
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
  const previews = new PreviewService(client);
  const tools = new Tools({ client, map, previews, intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-crop-spike-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const r: Record<string, unknown> = { check: "crop-spike", started, node: process.version, engine_version: ENGINE_VERSION, written: { crop: BOX, angle: ANGLE } };
  const c: Check = { tools, client, previews, say, r, steps: [], master: "", copy: null };
  mkdirSync(OUT_DIR, { recursive: true });
  let worked = false;
  try {
    await gate.ready();
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    worked = await run(c);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
    if (c.copy !== null) await removeCopy(c).catch(() => undefined); // a run that stopped halfway: only the check's own copy
    if (c.master !== "") await client.request("select_photo", { uuid: c.master }).catch(() => undefined);
  } finally {
    r["steps"] = c.steps;
    r["copy_left"] = c.copy;
    await gate.release();
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  const file = path.join(OUT_DIR, `crop_spike_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Crop and straighten spike: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${c.copy === null ? "YES" : "NO"}`);
  if (c.copy !== null) say(`  The copy "${COPY}" is still in the catalog: select it in the Library grid, Photo > Remove Photos..., Remove.`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
