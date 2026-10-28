// `npm run presets:check` (issue #215): the six Develop preset tools against Lightroom, through the engine's own
// Tools (the pure parts are in presets-check.ts). Run from the repo root with Lightroom Classic open, the LrC-AVG
// plugin with the preset commands loaded, ONE photo selected (a virtual copy is safest), and Claude Desktop quit
// (this takes the engine's instance lock). Jim answers y/n in this window, as for npm run denoise:check.
// Steps: list (Lightroom, user and checkpoint presets); two checkpoints made from canonical settings; one read back;
// the two compared (expected: exposure and vibrance); a Lightroom preset read; a checkpoint exported, then again
// (must be refused); the second checkpoint and a Lightroom preset applied to the photo; the photo put back from the
// first snapshot and compared with how it started; four questions. The two checkpoints stay in Lightroom's plugin
// preset folder: the SDK has no call that deletes one [inference: none in API Reference\modules\LrApplication.html].
// Under %TEMP%\LrC-AVG\presets-check\ (Claude Code collects them): presets_check_<time>.json and the exported copy.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, toToolError, Tools } from "../mcp/index.js";
import { differingSettings, loadDefaultParamMap, tableInfo, type ParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { CHECKPOINT_A, CHECKPOINT_B, EXPECTED_DIFF, countKinds, pickLightroomPreset, verdict, type Answer, type ListedPreset, type Row } from "./presets-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "presets-check");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
type Results = Record<string, unknown>;
/** What the put-back needs, kept as it arrives so a run that stops halfway still puts the photo back. */
type Taken = { uuid: string | null; start: Record<string, unknown> | null; snapshot: string | null };
type Ctx = { client: BridgeClient; tools: Tools; map: ParamMap; r: Results; rows: Row[]; say: (l: string) => void; taken: Taken };

const row = (c: Ctx, step: string, ok: boolean, detail: string): void => {
  c.rows.push({ step, ok, detail });
  c.say(`  ${ok ? "YES" : "NO "} ${step}: ${detail}`);
};

async function listAll(c: Ctx): Promise<ListedPreset[]> {
  const out: ListedPreset[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = (await c.tools.listPresets({ offset, limit: 500 })).json as { folders: Array<{ folder: string; scope: string; presets: Array<{ name: string; uuid: string }> }>; next_offset?: number };
    for (const f of page.folders) for (const p of f.presets) out.push({ ...p, folder: f.folder, scope: f.scope });
    if (page.next_offset === undefined) return out;
  }
}

/** Steps 1-4: list, two checkpoints, read one back, compare them. Returns checkpoint B's uuid. */
async function checkpoints(c: Ctx, stem: string): Promise<string> {
  const kinds = countKinds(await listAll(c));
  c.r["kinds"] = kinds;
  row(c, "lr_list_presets lists Lightroom presets", kinds.lightroom > 0, `${kinds.lightroom} Lightroom (${kinds.user} with a file in CameraRaw\\Settings or ImportedSettings), ${kinds.plugin} checkpoints`);
  const a = (await c.tools.createCheckpoint({ name: `${stem} v1`, photo_uuid: c.taken.uuid as string, settings: CHECKPOINT_A })).json["checkpoint"] as ListedPreset;
  const b = (await c.tools.createCheckpoint({ name: `${stem} v2`, photo_uuid: c.taken.uuid as string, settings: CHECKPOINT_B })).json["checkpoint"] as ListedPreset;
  c.r["checkpoints"] = [a, b];
  const listed = (await c.tools.listPresets({ scope: "plugin", query: stem })).json["total"];
  row(c, "both checkpoints listed with scope plugin", listed === 2, `${String(listed)} listed`);
  const got = (await c.tools.getPreset({ preset_uuid: a.uuid, preset_scope: "plugin", raw: true })).json;
  c.r["checkpoint_read"] = got;
  const s = got["settings"] as Record<string, unknown>;
  row(c, "lr_get_preset reads the checkpoint back", s["exposure"] === CHECKPOINT_A.exposure && s["contrast"] === CHECKPOINT_A.contrast, `settings ${JSON.stringify(s)}`);
  const cmp = (await c.tools.comparePresets({ base: { preset_uuid: a.uuid, preset_scope: "plugin" }, candidate: { preset_uuid: b.uuid, preset_scope: "plugin" } })).json;
  c.r["compare"] = cmp;
  const names = (cmp["changes"] as Array<{ name: string }>).map((x) => x.name);
  row(c, "lr_compare_presets finds exactly the known diff", JSON.stringify(names) === JSON.stringify(EXPECTED_DIFF), `changes ${names.join(", ")}; other ${JSON.stringify(cmp["other_changes"])}`);
  const exportDir = path.join(OUT_DIR, `export_${started}`);
  const first = (await c.tools.exportPreset({ preset_uuid: a.uuid, preset_scope: "plugin", destination_dir: exportDir })).json;
  const again = await c.tools.exportPreset({ preset_uuid: a.uuid, preset_scope: "plugin", destination_dir: exportDir }).then(() => "copied again", (err: unknown) => toToolError(err).code);
  c.r["export"] = { first, again };
  row(c, "lr_export_preset copies once and refuses to replace", again === "PRESET_EXISTS", `${String(first["destination"])}; second call: ${again}`);
  return b.uuid;
}

/** Steps 5-6: apply checkpoint B, then a Lightroom preset (an AI one when a name says so). */
async function applies(c: Ctx, bUuid: string): Promise<void> {
  const uuid = c.taken.uuid as string;
  const one = (await c.tools.applyPreset({ preset_uuid: bUuid, preset_scope: "plugin", uuids: [uuid] })).json;
  const applied = (one["applied"] as Array<{ snapshot: { id: string }; after: Record<string, unknown> }>)[0];
  c.taken.snapshot = applied?.snapshot.id ?? null;
  const now = c.map.fromSdk((await c.client.request("get_settings", { photo_uuid: uuid })).settings).settings;
  row(c, "lr_apply_preset applies the checkpoint, after a snapshot", applied !== undefined && now["exposure"] === CHECKPOINT_B.exposure && now["vibrance"] === CHECKPOINT_B.vibrance, JSON.stringify(one["applied"] ?? one["failed"]));
  const pick = pickLightroomPreset(await listAll(c));
  if (!pick) return row(c, "a Lightroom preset to apply", false, "none listed");
  c.r["lightroom_preset_read"] = (await c.tools.getPreset({ preset_uuid: pick.uuid, preset_scope: "lightroom" })).json;
  const two = (await c.tools.applyPreset({ preset_uuid: pick.uuid, preset_scope: "lightroom", uuids: [uuid] })).json;
  c.r["lightroom_apply"] = two;
  row(c, `lr_apply_preset applies "${pick.folder} / ${pick.name}"`, (two["applied"] as unknown[]).length === 1, JSON.stringify(two["applied"] ?? two["failed"]));
}

/** The first snapshot applied, waiting out an AI recompute (ai_compute_pending), and the photo compared with its start. */
async function putBack(c: Ctx): Promise<boolean> {
  const { uuid, start, snapshot } = c.taken;
  if (!uuid || !start || !snapshot) return true;
  c.say("Putting the photo back from the snapshot the first apply took ...");
  for (let i = 0; ; i++) {
    try {
      await c.client.request("apply_snapshot", { photo_uuid: uuid, snapshot_id: snapshot });
      break;
    } catch (err) {
      if (toToolError(err).code !== "AI_COMPUTE_PENDING" || i >= 20) throw err;
      await sleep(3000);
    }
  }
  const now = (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
  const differing = differingSettings(c.map.fromSdk(start).settings, c.map.fromSdk(now).settings);
  const masksBack = tableInfo(start).fingerprint === tableInfo(now).fingerprint;
  c.r["put_back"] = { differing, masks_back: masksBack };
  c.taken.snapshot = null;
  row(c, "the snapshot puts the photo back", differing.length === 0 && masksBack, differing.length ? `differs: ${differing.join(", ")}` : `settings and masks as before`);
  return differing.length === 0 && masksBack;
}

async function run(c: Ctx): Promise<{ passFail: Answer[]; findings: Record<string, Answer> }> {
  const sel = await c.client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select ONE photo in Lightroom (${sel.count} selected), then run this again. Nothing was written.`);
  c.r["photo"] = { uuid, filename: sel.photos[0]?.filename ?? null };
  c.taken.start = (await c.client.request("get_settings", { photo_uuid: uuid })).settings;
  c.taken.uuid = uuid;
  const stem = `AVG presets-check ${started.slice(0, 19)}`;
  const bUuid = await checkpoints(c, stem);
  await applies(c, bUuid);
  const moduleSame = await ask("Is Lightroom still in the module it was in before this check, with the same photo selected?");
  await putBack(c);
  const history = await ask('Open the photo in Develop: does the History panel (left) show steps named "AVG preset ..." (not only the presets\' own names)?');
  const hidden = await ask(`In Develop's Presets panel (left), is there NO preset named "${stem} v1"?`);
  const looks = await ask("Does the photo look as it did before the check?");
  return { passFail: [moduleSame as Answer, looks as Answer], findings: { history_named_AVG: history as Answer, checkpoint_hidden_from_panel: hidden as Answer } };
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const map = loadDefaultParamMap();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const sessionLogDir = path.join(OUT_DIR, `sessions_${started}`);
  const tools = new Tools({ client, map, previews: new PreviewService(client), intents: new IntentLibrary({ map }), sessionLogDir, engineVersion: ENGINE_VERSION, ensureBridge: () => gate.ready() });
  const r: Results = { check: "presets-check", started, node: process.version, engine_version: ENGINE_VERSION };
  const c: Ctx = { client, tools, map, r, rows: [], say, taken: { uuid: null, start: null, snapshot: null } };
  let v = { worked: false, lines: [] as string[] };
  try {
    await gate.ready(); // refuses without Lightroom and the plugin connected
    r["plugin_version"] = client.hello()?.plugin_version ?? null;
    const answers = await run(c);
    v = verdict(c.rows, answers.passFail, answers.findings);
    Object.assign(r, answers);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    if (c.taken.snapshot) await putBack(c).catch((err: unknown) => row(c, "the snapshot puts the photo back", false, describeError(err)));
    await gate.release();
  }
  const back = !c.rows.some((x) => x.step === "the snapshot puts the photo back" && !x.ok);
  Object.assign(r, { rows: c.rows, lines: v.lines, headline: v.worked ? "WORKED" : "FAILED" });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `presets_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const line of v.lines) say(`  ${line}`);
  say(`Presets check: ${v.worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${back ? "YES" : "NO"}`);
  if (!back) say('  To put the photo back by hand: Lightroom Develop, select it, Snapshots panel (left), click the first "AVG pre-preset ..." snapshot.');
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return v.worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
