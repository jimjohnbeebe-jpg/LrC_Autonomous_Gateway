// `npm run phase10:check` (Phase 10 row 13, issue #194): the Lightroom-side acceptance lines of Phase 10 that no other
// check has observed. Run from the repo root with Lightroom open, ONE photo you edited the way you like selected in the
// Library grid (only read), and Claude Desktop quit (this takes the engine's instance lock). Steps, through the engine's
// own tool functions as a chat calls them:
//   1. lr_save_intent from_photo dry run on your photo, then saved as the user intent avg_phase10_check (the check's own id,
//      deleted at the end); from_preset dry runs on Lightroom's presets until one gives a look with settings.
//   2. One virtual copy of your photo ("AVG phase10-check"), reset to as shot (lr_reset), selected.
//   3. A session with the look (tone_mode adapt, your photo as the reference): pass 0 writes the look's `set` on the copy
//      as the look holds it (L-7); the reference measured and the selection still on the copy; one step with a
//      reference_gap; revert.
//   4. The same look with tone_mode auto: Lightroom's Auto Tone, then the look on top; one y/n on the History panel; revert.
//   5. classic_zone_system: look_checks at begin; revert.
//   6. The copy removed (only it, by its uuid), the test intent deleted, your photo selected again and compared.
//   7. After the engine lets go of Lightroom: one y/n on the look prompts in Claude Desktop (L-8).
// Results under %TEMP%\LrC-AVG\phase10-check\. Report: docs\reports\phase10\PHASE10.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, BridgeError } from "../bridge/index.js";
import { IntentLibrary, setFor, type Intent } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { settingChanges } from "../mcp/tools-develop.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { loadDefaultParamMap, type Pipeline, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { step, type StepLog } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { notReproduced, verdictLines } from "./phase10-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "phase10-check");
const COPY = "AVG phase10-check";
const LOOK = "avg_phase10_check";
const CLASSIC = "classic_zone_system";
const PRESETS_TRIED = 20;
const started = new Date().toISOString().replace(/[:.]/g, "-");
const map = loadDefaultParamMap();
const HISTORY_Q = `Lightroom's Develop module shows the copy "${COPY}". In its History panel, is there a Lightroom Auto step (Lightroom's own name, such as "Auto Settings" or "Auto Tone") directly below an "AVG ... pass 0/..." step?`;
const PROMPTS_Q = `Start Claude Desktop and open a new chat. In the chat box, click + and look for lrc-avg's prompts. Is there a prompt named "look-${CLASSIC}"?`;

type Check = StepLog & { tools: Tools; client: BridgeClient; master: string; copy: string | null; session: string | null; saved: boolean };

const settings = async (c: Check, uuid: string): Promise<SdkSettings> => (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
const ok = (j: Record<string, unknown>): string[] => [j["ok"] === true ? "ok" : `not ok: ${JSON.stringify(j).slice(0, 200)}`];
const yes = (c: Check, name: string, good: boolean, why: string): void => void c.steps.push({ step: name, expect: ["yes"], statuses: [good ? "yes" : `no: ${why}`] });

/** Begin a session on the selected copy; null (recorded) when it did not start. */
async function begin(c: Check, label: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const b = await step(c, `lr_begin_session (${label})`, ["ok"], () => c.tools.beginSession({ max_passes: 4, return_image: "none", ...args }), ok);
  c.session = typeof b?.["session_id"] === "string" ? b["session_id"] : null;
  return c.session === null ? null : b;
}

/** Revert and end the session; a failed end throws, so main()'s cleanup ends it again and removes the copy. */
async function revert(c: Check, label: string): Promise<void> {
  const e = await step(c, `lr_end_session revert (${label})`, ["ok"], () => c.tools.endSession({ session_id: c.session as string, outcome: "revert" }), ok);
  if (e === null) throw new Error(`lr_end_session revert (${label}) failed, so the check ends the session again and removes its copy`);
  c.session = null;
  const differing = (e["revert"] as { differing?: string[] } | undefined)?.differing ?? null;
  yes(c, `${label}: the revert reports nothing differing`, differing !== null && differing.length === 0, JSON.stringify(differing));
}

/** Step 1: the look from your photo, saved; a look from a preset (dry run only). */
async function looks(c: Check, filename: string): Promise<Intent> {
  const candidate = { id: LOOK, label: LOOK, category: "look", brief: `phase10:check's look from ${filename}; deleted at the end of the check.`, priors: {} };
  const dry = await step(c, "lr_save_intent from_photo dry run", ["ok"], () => c.tools.saveIntent({ intent: candidate, confirmed: false, from_photo: true, dry_run: true }), ok);
  const intent = dry?.["intent"] as Intent | undefined;
  if (!intent) throw new Error("from_photo returned no look, so nothing else was tried");
  yes(c, "the look holds settings, tone_mode adapt, and your photo as its reference", Object.keys(intent.set ?? {}).length > 0 && intent.tone_mode === "adapt" && intent.references?.uuids?.[0] === c.master, JSON.stringify({ set: Object.keys(intent.set ?? {}).length, tone_mode: intent.tone_mode, references: intent.references }));
  await step(c, `lr_save_intent ${LOOK}`, ["ok"], () => c.tools.saveIntent({ intent, confirmed: true, replace: true }), ok);
  c.saved = true;
  const tried: Array<{ name: string; set: number | string }> = [];
  const list = await c.tools.listPresets({}).then((o) => o.json, (err: unknown) => (tried.push({ name: "lr_list_presets", set: describeError(err) }), {} as Record<string, unknown>));
  const presets = ((list["folders"] as Array<{ presets: Array<{ name: string; uuid: string }> }> | undefined) ?? []).flatMap((f) => f.presets).slice(0, PRESETS_TRIED);
  for (const p of presets) {
    try {
      const j = (await c.tools.saveIntent({ intent: { ...candidate, id: `${LOOK}_preset` }, confirmed: false, from_preset: p.uuid, dry_run: true })).json;
      const n = Object.keys((j["intent"] as Intent | undefined)?.set ?? {}).length;
      tried.push({ name: p.name, set: n });
      if (n > 0) break;
    } catch (err) {
      tried.push({ name: p.name, set: describeError(err) });
    }
  }
  c.r["from_preset"] = tried;
  yes(c, "from_preset: a Lightroom preset gave a look with settings (dry run)", tried.some((t) => typeof t.set === "number" && t.set > 0), JSON.stringify(tried).slice(0, 300));
  return intent;
}

/** Steps 3-5 on the reset copy. */
async function sessions(c: Check, look: Intent): Promise<string[]> {
  const copy = c.copy as string;
  const a = await begin(c, "the look, tone_mode adapt", { intent_id: LOOK });
  if (a === null) throw new Error("the look's session did not start, so nothing else was tried");
  const pipeline = (a["target"] as { pipeline?: Pipeline } | undefined)?.pipeline ?? "raw";
  const off = notReproduced(setFor(look, pipeline), map.fromSdk(await settings(c, copy)).settings, map, pipeline);
  c.r["not_reproduced"] = off;
  yes(c, `L-7: pass 0 wrote the look's ${Object.keys(setFor(look, pipeline)).length} set values on the copy as the look holds them`, off.length === 0, JSON.stringify(off).slice(0, 300));
  const refs = a["references"] as { measured?: string[] } | undefined;
  yes(c, "the reference (your photo) was measured", refs?.measured?.[0] === c.master, JSON.stringify(refs));
  const sel = await c.client.request("get_selection", { max: 2 });
  yes(c, "the reference render left the copy selected", sel.count === 1 && sel.photos[0]?.uuid === copy, `${sel.count} selected`);
  const s = await step(c, "lr_step exposure +0.1", ["ok"], () => c.tools.step({ session_id: c.session as string, settings: { exposure: 0.1 }, rationale: "phase10:check", return_image: "none" }), ok);
  yes(c, "the step reports a reference_gap", typeof s?.["reference_gap"] === "object", "no reference_gap");
  await revert(c, "adapt");

  const b = await begin(c, "the look, tone_mode auto", { intent_id: LOOK, tone_mode: "auto" });
  const auto = b?.["auto_tone"] as { status?: string } | undefined;
  yes(c, "Lightroom's Auto Tone ran at pass 0", auto?.status === "applied" || auto?.status === "unchanged", JSON.stringify(auto));
  const answers = [await ask(HISTORY_Q)];
  if (c.session !== null) await revert(c, "auto");

  const k = await begin(c, CLASSIC, { intent_id: CLASSIC });
  const checks = k?.["look_checks"] as Array<{ v: unknown }> | undefined;
  yes(c, `${CLASSIC}: look_checks at begin, each with a measured value`, Array.isArray(checks) && checks.length === 2 && checks.every((x) => typeof x.v === "number"), JSON.stringify(checks));
  if (c.session !== null) await revert(c, CLASSIC);
  return answers;
}

async function removeCopy(c: Check): Promise<void> {
  await step(c, "lr_remove_photos (the copy)", ["removed"], () => c.tools.call(removePhotos, { uuids: [c.copy as string], confirm: true }), (j) => [String(j["status"])]);
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  const gone = await c.client.request("get_settings", { photo_uuid: c.copy as string }).then(() => false, (err: unknown) => err instanceof BridgeError && err.code === "unknown_photo");
  c.steps.push({ step: "the copy is no longer in the catalog", expect: ["gone"], statuses: [gone ? "gone" : "still there"] });
  if (gone) c.copy = null;
}

async function deleteLook(c: Check): Promise<void> {
  await step(c, `lr_delete_intent ${LOOK}`, ["ok"], () => c.tools.deleteIntent({ id: LOOK, confirmed: true }), ok);
  c.saved = false;
}

async function run(c: Check): Promise<string[]> {
  const sel = await c.client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select ONE photo you edited in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  c.master = uuid;
  const before = await settings(c, uuid);
  c.r["photo"] = { uuid, filename: sel.photos[0]?.filename ?? null };
  c.say("Lightroom switches between Develop and the Library grid; do not click in Lightroom until a question.");
  await c.client.request("select_photo", { uuid });
  const look = await looks(c, sel.photos[0]?.filename ?? uuid);
  const j = await step(c, "lr_create_virtual_copies", ["copied"], () => c.tools.createVirtualCopies({ uuids: [uuid], copy_name: COPY }));
  const copy = (j?.["photos"] as Array<{ copy_uuid?: string | null }> | undefined)?.[0]?.copy_uuid;
  if (typeof copy !== "string" || copy === uuid) throw new Error("no virtual copy was made, so no session was tried");
  c.copy = copy;
  await step(c, "lr_reset (the copy, to as shot)", ["reset"], () => c.tools.resetDevelop({ uuids: [copy], confirm: true }));
  await c.client.request("select_photo", { uuid: copy });
  const answers = await sessions(c, look);
  await removeCopy(c);
  await deleteLook(c);
  await c.client.request("select_photo", { uuid }).catch(() => undefined);
  const d = settingChanges(map, before, await settings(c, uuid), []);
  c.steps.push({ step: "your photo's settings against the start", expect: ["back"], statuses: [Object.keys(d.changed).length === 0 && !d.masks ? "back" : `differs: ${Object.keys(d.changed).join(", ")}`] });
  return answers;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const previews = new PreviewService(client);
  const tools = new Tools({ client, map, previews, intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-phase10-check-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const r: Record<string, unknown> = { check: "phase10-check", started, node: process.version, engine_version: ENGINE_VERSION, results: {} };
  const c: Check = { tools, client, say, r, steps: [], master: "", copy: null, session: null, saved: false };
  mkdirSync(OUT_DIR, { recursive: true });
  let answers: string[] = [];
  try {
    await gate.ready();
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    answers = await run(c);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
    if (c.session !== null) await tools.endSession({ session_id: c.session, outcome: "revert" }).catch(() => undefined);
    if (c.copy !== null) await removeCopy(c).catch(() => undefined); // only the check's own copy
    if (c.saved) await deleteLook(c).catch(() => undefined);
    if (c.master !== "") await client.request("select_photo", { uuid: c.master }).catch(() => undefined);
  } finally {
    r["copy_left"] = c.copy;
    await gate.release();
  }
  // After the release, so Claude Desktop's engine can take the instance lock (L-8).
  if (r["errors"] === undefined) answers.push(await ask(PROMPTS_Q));
  const { lines, worked } = verdictLines(c.steps, answers, 2);
  Object.assign(r, { steps: c.steps, answers, lines, headline: worked ? "WORKED" : "FAILED" });
  const file = path.join(OUT_DIR, `phase10_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const line of lines) say(`  ${line}`);
  say("");
  say(`Phase 10 check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${c.copy === null && !c.saved ? "YES" : "NO"}`);
  if (c.copy !== null) say(`  The copy "${COPY}" is still in the catalog: select it in the Library grid, Photo > Remove Photos..., Remove.`);
  if (c.saved) say(`  The test look ${LOOK} is still in your intents folder: ask Claude to delete the intent ${LOOK}.`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
