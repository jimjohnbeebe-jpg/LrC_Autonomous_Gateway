// `npm run crop:check` (GitHub issue #115): does lr_crop, the session's crop and straighten pass, work in Lightroom?
// Run from the repo root with Lightroom open, ONE raw photo at process Version 6 selected in the Library grid, and
// Claude Desktop quit (this takes the engine's instance lock). Every write goes to one virtual copy the check makes
// itself (as crop:spike does); the selected photo is only read, and only that copy, by the uuid
// lr_create_virtual_copies answered, is removed. Steps: the copy, selected; lr_begin_session on it; lr_crop
// {aspect "4:5", angle 3} with a render (aspect 0.8 within 2 %) and one y/n; lr_crop {reset: true} (the keys
// 0/0/1/1/0); lr_crop {aspect "16:9"} with a render; lr_end_session revert (the crop keys back as they started:
// whether the session snapshot puts a crop back is what this tests, [unverified] before the run); the copy removed;
// the photo selected again and compared with the start. lr_crop is called through its MCP definition (TOOL_DEFS:
// its zod schema, then its handler), as Claude Desktop calls it. Results and renders under %TEMP%\LrC-AVG\crop-check\.
// Report: docs\reports\phase11\CROP-CHECK.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, BridgeError } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, TOOL_DEFS, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { settingChanges } from "../mcp/tools-develop.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { CROP, loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { step, stepOk, type Step, type StepLog } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "crop-check");
const COPY = "AVG crop-check";
const ANGLE = 3;
const KEYS = [CROP.left, CROP.top, CROP.right, CROP.bottom, CROP.angle] as const;
const started = new Date().toISOString().replace(/[:.]/g, "-");
const map = loadDefaultParamMap();
const QUESTION = `Lightroom's Develop module shows the copy "${COPY}". Does it show a portrait 4:5 crop (taller than wide), turned about ${ANGLE} degrees?`;

type Check = StepLog & { tools: Tools; client: BridgeClient; previews: PreviewService; master: string; copy: string | null; session: string | null };

const settings = async (c: Check, uuid: string): Promise<SdkSettings> => (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
const num = (s: SdkSettings, k: string): number => (typeof s[k] === "number" ? (s[k] as number) : Number.NaN);
const cropKeys = (s: SdkSettings): Record<string, number> => Object.fromEntries(KEYS.map((k) => [k, num(s, k)]));
const ok = (j: Record<string, unknown>): string[] => [j["ok"] === true ? "ok" : `not ok: ${JSON.stringify(j).slice(0, 200)}`];

/** lr_crop through its MCP definition: its schema checks the args first, as for Claude Desktop. */
const CROP_DEF = TOOL_DEFS.find((d) => d.name === "lr_crop");
function lrCrop(c: Check, args: Record<string, unknown>): Promise<{ json: Record<string, unknown> }> {
  const def = CROP_DEF as NonNullable<typeof CROP_DEF>; // run() stops before any write when it is missing
  return def.run(c.tools, def.schema.parse({ session_id: c.session, rationale: "crop:check", return_image: "none", ...args }));
}

/** A render of the copy, saved next to the results; its aspect, or null when the render failed (recorded). */
async function render(c: Check, label: string): Promise<number | null> {
  const renders = (c.r["renders"] ??= {}) as Record<string, unknown>;
  try {
    const p = await c.previews.render({ photoUuid: c.copy as string, longEdge: 1024, quality: 85 });
    const file = path.join(OUT_DIR, `crop_check_${started}_${label}.jpg`);
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

/** One check line: `yes`, or `no: why`. */
function expectThat(c: Check, name: string, good: boolean, why: string): void {
  c.steps.push({ step: name, expect: ["yes"], statuses: [good ? "yes" : `no: ${why}`] });
}

/** One lr_crop pass: the call, its History name, the five keys read back from Lightroom, and (with `aspect`) a render. */
async function cropPass(c: Check, label: string, args: Record<string, unknown>, keysOk: (k: Record<string, number>) => boolean, aspect?: number): Promise<void> {
  const j = await step(c, `lr_crop ${label}`, ["ok"], () => lrCrop(c, args), ok);
  if (j === null) return;
  expectThat(c, `lr_crop ${label}: History name ends "crop"`, /"AVG [^"]* pass \d+\/\d+ crop"/.test(JSON.stringify(j)), "no History name like 'AVG <id> pass n/N crop' in the result");
  const back = cropKeys(await settings(c, c.copy as string));
  (c.r["read_back"] as Record<string, unknown>)[label] = back;
  c.say(`  read back ${JSON.stringify(back)}`);
  expectThat(c, `lr_crop ${label}: the five crop keys read back as asked`, keysOk(back), JSON.stringify(back));
  if (aspect === undefined) return;
  const a = await render(c, label.replace(/[^a-z0-9]+/gi, "-"));
  expectThat(c, `lr_crop ${label}: the render's aspect is ${aspect.toFixed(3)} within 2 %`, a !== null && Math.abs(a / aspect - 1) < 0.02, a === null ? "no render" : a.toFixed(3));
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
/** A crop box inside the photo, the right way round, at `angle` (its sign is Lightroom's: either is taken [inference: not yet observed]). */
const boxAt = (angle: number) => (k: Record<string, number>): boolean =>
  KEYS.slice(0, 4).every((x) => (k[x] as number) >= -1e-4 && (k[x] as number) <= 1 + 1e-4) && (k[CROP.left] as number) < (k[CROP.right] as number) && (k[CROP.top] as number) < (k[CROP.bottom] as number) && Math.abs(Math.abs(k[CROP.angle] as number) - angle) < 0.01;

async function removeCopy(c: Check): Promise<void> {
  const uuids = [c.copy as string];
  await step(c, "lr_remove_photos (the copy)", ["removed"], () => c.tools.call(removePhotos, { uuids, confirm: true }), (j) => [String(j["status"])]);
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  // Only unknown_photo means gone; another error (no answer, a disconnect) keeps the copy listed as left.
  const gone = await c.client.request("get_settings", { photo_uuid: c.copy as string }).then(() => false, (err: unknown) => err instanceof BridgeError && err.code === "unknown_photo");
  c.steps.push({ step: "the copy is no longer in the catalog", expect: ["gone"], statuses: [gone ? "gone" : "still there"] });
  if (gone) c.copy = null;
}

async function run(c: Check): Promise<string[]> {
  if (!CROP_DEF) throw new Error("this engine has no lr_crop tool (it comes with the lr_crop pull request, issue #115): git pull on main, then run this again. Nothing was written.");
  const sel = await c.client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select ONE raw photo in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  c.master = uuid;
  const before = await settings(c, uuid);
  Object.assign(c.r, { photo: { uuid, filename: sel.photos[0]?.filename ?? null }, crop_before: cropKeys(before), read_back: {} });
  c.say("Lightroom switches between Develop and the Library grid; do not click in Lightroom until the question.");
  const j = await step(c, "lr_create_virtual_copies", ["copied"], () => c.tools.createVirtualCopies({ uuids: [uuid], copy_name: COPY }));
  const copy = (j?.["photos"] as Array<{ copy_uuid?: string | null }> | undefined)?.[0]?.copy_uuid;
  if (typeof copy !== "string" || copy === uuid) throw new Error("no virtual copy was made, so nothing else was tried");
  c.copy = copy;
  const start = cropKeys(await settings(c, copy));
  await c.client.request("select_photo", { uuid: copy });
  const b = await step(c, "lr_begin_session (the copy, no intent)", ["ok"], () => c.tools.beginSession({ max_passes: 4, return_image: "none" }), ok);
  const sid = b?.["session_id"];
  if (typeof sid !== "string") throw new Error("the session did not start, so lr_crop was not tried");
  c.session = sid;
  await cropPass(c, "4:5 angle 3", { aspect: "4:5", angle: ANGLE }, boxAt(ANGLE), 4 / 5);
  const answers = [await ask(QUESTION)];
  await cropPass(c, "reset", { reset: true }, (k) => [0, 0, 1, 1, 0].every((v, i) => near(k[KEYS[i] as string] as number, v)));
  await cropPass(c, "16:9", { aspect: "16:9" }, boxAt(0), 16 / 9);
  const e = await step(c, "lr_end_session revert", ["ok"], () => c.tools.endSession({ session_id: sid, outcome: "revert" }), ok);
  c.session = null;
  const differing = ((e?.["revert"] as { differing?: string[] } | undefined)?.differing ?? null) as string[] | null;
  expectThat(c, "the revert reports nothing differing", differing !== null && differing.length === 0, JSON.stringify(differing));
  const end = cropKeys(await settings(c, copy));
  Object.assign(c.r, { crop_start: start, crop_after_revert: end });
  expectThat(c, "the snapshot put the crop back (the five keys as the copy started)", KEYS.every((k) => near(end[k] as number, start[k] as number)), JSON.stringify(end));
  await removeCopy(c);
  await c.client.request("select_photo", { uuid }).catch(() => undefined);
  const now = await c.client.request("get_selection", { max: 2 });
  c.steps.push({ step: "your photo is selected again", expect: ["yes"], statuses: [now.count === 1 && now.photos[0]?.uuid === uuid ? "yes" : `no (${now.count} selected)`] });
  const d = settingChanges(map, before, await settings(c, uuid), Object.keys(before).filter((k) => k.startsWith("Crop")));
  c.steps.push({ step: "your photo's settings against the start", expect: ["back"], statuses: [Object.keys(d.changed).length === 0 && !d.masks ? "back" : `differs: ${Object.keys(d.changed).join(", ")}`] });
  return answers;
}

function verdict(c: Check, answers: string[]): boolean {
  const lines = c.steps.map((s: Step) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(" or ")})`);
  for (const [i, a] of answers.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  Object.assign(c.r, { answers, lines });
  c.say("");
  for (const line of lines) c.say(`  ${line}`);
  return c.steps.every(stepOk) && answers.length === 1 && answers.every((a) => a === "y");
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const previews = new PreviewService(client);
  const tools = new Tools({ client, map, previews, intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-crop-check-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const r: Record<string, unknown> = { check: "crop-check", started, node: process.version, engine_version: ENGINE_VERSION, results: {} };
  const c: Check = { tools, client, previews, say, r, steps: [], master: "", copy: null, session: null };
  mkdirSync(OUT_DIR, { recursive: true });
  let worked = false;
  try {
    await gate.ready();
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    worked = verdict(c, await run(c));
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
    if (c.session !== null) await tools.endSession({ session_id: c.session, outcome: "revert" }).catch(() => undefined);
    if (c.copy !== null) await removeCopy(c).catch(() => undefined); // a run that stopped halfway: only the check's own copy
    if (c.master !== "") await client.request("select_photo", { uuid: c.master }).catch(() => undefined);
  } finally {
    r["steps"] = c.steps;
    r["copy_left"] = c.copy;
    await gate.release();
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  const file = path.join(OUT_DIR, `crop_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Crop check: ${worked ? "WORKED" : "FAILED"}`);
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
