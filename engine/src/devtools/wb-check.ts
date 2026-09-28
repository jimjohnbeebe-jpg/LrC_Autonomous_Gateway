// The white balance check (fix/white-balance-custom; plan approved by Jim 2026-09-28 [stated: "go
// with recommendations"]). The command-line entry is wb-check-cli.ts (`npm run wb:check`); this
// module runs the steps, so tests\wb-check.test.ts can run them against the simulated plugin.
//
// The question: does Lightroom take WhiteBalance "Custom" through applyDevelopSettings? The Phase 4
// check wrote Temperature alone and Lightroom kept "As Shot" [handle:
// docs\reports\phase4\P4\p4_check_2026-09-28T04-18-17-511Z.json preset.source_prepared], so a preset
// leaves the white balance out (presets\select.ts). "Custom" itself was [unverified] before the
// check: the pinned dump shows only "As Shot" (params\sdk-keys.lrc15.json). Jim's run answered it:
// Lightroom takes it [handle: docs\reports\phase4\WB.md "Observed"]. Step 1 writes its table by hand,
// since toSdk now adds "Custom" to any temperature. On the photo Jim selects, written by uuid with
// the selection untouched (plugin 0.4.0):
//   0. a snapshot, which puts the photo back at the end, also after an error;
//   1. Temperature +300 K alone: the white balance read back, and the Basic panel (Jim, y/n);
//   2. Temperature +300 K more with WhiteBalance "Custom": both read back, the panel (Jim, y/n). If
//      "Custom" was not taken, Jim moves the Temp slider by hand and the value Lightroom sets is read;
//   3. from the snapshot again, Tint +5 with "Custom": read back, and whether Temperature stayed;
//   4. whether a preset of steps 1 and 2's settings carries the temperature (no file is written);
//   5. the snapshot applied, every setting compared with the start: PUT BACK YES/NO.
// SDK key names come from the params module only (.claude\rules\03-lightroom.md).

import type { BridgeClient } from "../bridge/index.js";
import { pluginVersionAtLeast } from "../bridge/version.js";
import type { BridgeGate } from "../mcp/index.js";
import { AS_SHOT_WHITE_BALANCE, CUSTOM_WHITE_BALANCE, READBACK_TOLERANCE, WHITE_BALANCE_KEY, type ParamMap, type SdkSettings } from "../params/index.js";
import { selectPresetSettings } from "../presets/index.js";
import { describeError, differingKeys, type Answer } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { errorBody, PHOTO, WRITE_TIMEOUT_MS } from "./phase4-config.js";

/**
 * Plugin 0.4.0 writes to a photo by uuid without touching the selection [handle:
 * plugin\LrC-AVG.lrplugin\Develop.lua target(); in Lightroom, docs\reports\phase4\PHASE4.md "Numbers",
 * the unselected-original row], so Jim's selection is not needed after the start.
 */
export const MIN_PLUGIN_VERSION = "0.4.0";
/** The Phase 4 check's shift (phase4-config.ts WB_SHIFT), so step 1 repeats what it saw. */
export const TEMPERATURE_SHIFT = 300;
export const TINT_SHIFT = 5;
export const HISTORY = {
  temperature: "AVG WBcheck 1/3 temperature",
  custom: "AVG WBcheck 2/3 temperature + Custom",
  tint: "AVG WBcheck 3/3 tint + Custom",
} as const;
export const snapshotName = (stamp: string): string => `AVG WBcheck before ${stamp}`;

export type WbDeps = {
  client: BridgeClient;
  gate: BridgeGate;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  stamp: string;
  connectTimeoutMs?: number;
  now?: () => Date;
};

type Ctx = { deps: WbDeps; results: Json; errors: string[]; fail: (message: string) => void };
type Photo = { uuid: string; start: SdkSettings; temperature: number; tint: number };
/** What one write read back: the white balance mode, and whether each value written was taken. */
type Written = { readBack: SdkSettings; customTaken: boolean; valueTaken: boolean };

const sdkKey = (map: ParamMap, name: string): string => {
  const spec = map.spec(name);
  if (!spec) throw new Error(`the params map has no ${name}`);
  return spec.sdkKey;
};
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const same = (a: unknown, b: number): boolean => typeof a === "number" && Math.abs(a - b) <= READBACK_TOLERANCE;
const answered = (a: Answer): boolean | null => (a === "no answer" ? null : a === "y");

/** `from` moved by `by`, the other way when that would pass the slider's maximum. */
export function shifted(map: ParamMap, name: string, from: number, by: number): number {
  const spec = map.spec(name);
  return spec?.kind === "number" && from + by > spec.max ? from - by : from + by;
}

export async function runWbCheck(deps: WbDeps): Promise<{ worked: boolean; results: Json }> {
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];
  const results: Json = { check: "wb", started_at: now().toISOString(), photo_name: PHOTO, errors };
  const ctx: Ctx = { deps, results, errors, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG white balance check");
  if (!(await connect(ctx))) return finish(ctx, now);
  let photo: Photo | null = null;
  let snapshot: string | null = null;
  try {
    photo = await selectPhoto(ctx);
    if (photo) snapshot = await takeSnapshot(ctx, photo);
    if (photo && snapshot) await runSteps(ctx, photo, snapshot);
  } catch (err) {
    ctx.fail(`the check stopped: ${describeError(err)}`);
  }
  if (photo && snapshot) await putBack(ctx, photo, snapshot);
  await deps.gate.release();
  return finish(ctx, now);
}

async function runSteps(ctx: Ctx, photo: Photo, snapshot: string): Promise<void> {
  const alone = await temperatureAlone(ctx, photo);
  const custom = await temperatureCustom(ctx, photo, num(alone.readBack[sdkKey(ctx.deps.map, "temperature")]) ?? photo.temperature);
  await tintCustom(ctx, photo, snapshot);
  presetCarries(ctx, alone.readBack, custom.readBack);
}

/** Take the bridge and connect to Lightroom's plugin (as phase4-check.ts). False, with the reason said, when it cannot. */
async function connect(ctx: Ctx): Promise<boolean> {
  const { deps, results } = ctx;
  if (!(await deps.gate.start())) {
    ctx.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  try {
    results["hello"] = await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
  } catch (err) {
    await deps.gate.release();
    ctx.fail(`could not connect to Lightroom (${deps.client.stats.last_drop_reason ?? deps.client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const version = (results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) {
    await deps.gate.release();
    ctx.fail(`Lightroom is running LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later. Restart Lightroom and run the command again.`);
    return false;
  }
  deps.say(`Connected (plugin ${String(version)}).`);
  return true;
}

/** Jim selects the photo (the original); its settings are read. Null after three tries, or when its white balance is not As Shot. */
async function selectPhoto(ctx: Ctx): Promise<Photo | null> {
  const { client, map } = ctx.deps;
  let text = `  In Lightroom's Filmstrip, click ${PHOTO} (the original, not a virtual copy) and stay in the Develop module. Then press Enter here.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if ((await ctx.deps.prompt(text)) === null) break;
    const context = await client.request("get_context", {});
    if (context["filename"] === PHOTO && context["is_virtual_copy"] !== true) {
      const start = (await client.request("get_settings", { photo_uuid: context.uuid })).settings;
      const read = map.fromSdk(start); // throws for an unsupported process version
      ctx.results["photo"] = { uuid: context.uuid, process_version: read.process_version, white_balance: start[WHITE_BALANCE_KEY] ?? null, temperature: read.settings["temperature"] ?? null, tint: read.settings["tint"] ?? null };
      const temperature = num(read.settings["temperature"]);
      const tint = num(read.settings["tint"]);
      if (start[WHITE_BALANCE_KEY] !== AS_SHOT_WHITE_BALANCE || temperature === null || tint === null) {
        ctx.fail(`the photo's white balance is "${String(start[WHITE_BALANCE_KEY])}", not "${AS_SHOT_WHITE_BALANCE}". In the Basic panel, set WB to As Shot, then run the command again. Nothing was written.`);
        return null;
      }
      return { uuid: context.uuid, start, temperature, tint };
    }
    const which = context["is_virtual_copy"] === true ? `a virtual copy ("${String(context["copy_name"])}")` : String(context["filename"]);
    text = `  The selected photo is ${which}, not ${PHOTO}. Click ${PHOTO} (the original), then press Enter.`;
  }
  ctx.fail(`${PHOTO} was not selected. Nothing was written.`);
  return null;
}

async function takeSnapshot(ctx: Ctx, photo: Photo): Promise<string | null> {
  const name = snapshotName(ctx.deps.stamp);
  try {
    const res = await ctx.deps.client.request("create_snapshot", { photo_uuid: photo.uuid, name });
    ctx.results["snapshot"] = { name, id: res.snapshot_id };
    return res.snapshot_id;
  } catch (err) {
    ctx.results["snapshot"] = { name, error: errorBody(err) };
    ctx.fail(`the snapshot: ${describeError(err)}. Nothing was written.`);
    return null;
  }
}

/** One write by uuid; its read-back. */
async function write(ctx: Ctx, photo: Photo, settings: SdkSettings, historyName: string): Promise<SdkSettings> {
  const res = await ctx.deps.client.request("apply_settings", { photo_uuid: photo.uuid, settings, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS });
  return res.read_back;
}

/** Step 1: Temperature alone, as the Phase 4 check wrote it. */
async function temperatureAlone(ctx: Ctx, photo: Photo): Promise<Written> {
  const { map, ask, say } = ctx.deps;
  const key = sdkKey(map, "temperature");
  const to = shifted(map, "temperature", photo.temperature, TEMPERATURE_SHIFT);
  const readBack = await write(ctx, photo, { [key]: to }, HISTORY.temperature);
  const done: Written = { readBack, customTaken: readBack[WHITE_BALANCE_KEY] === CUSTOM_WHITE_BALANCE, valueTaken: same(readBack[key], to) };
  const out: Json = { written: { [key]: to }, white_balance: readBack[WHITE_BALANCE_KEY] ?? null, temperature: readBack[key] ?? null, temperature_taken: done.valueTaken };
  ctx.results["temperature_alone"] = out;
  say(`  1. Temperature ${photo.temperature} -> ${to} K, written alone. White balance read back: "${String(out["white_balance"])}"; temperature as written: ${yn(done.valueTaken)}.`);
  const asShot = await ask(`  In Lightroom's Basic panel, does WB (the menu above the Temp slider) read "As Shot"?`);
  const custom = asShot === "n" ? await ask(`  Does WB read "Custom"?`) : null;
  const slider = await ask(`  Does the Temp slider read ${to}?`);
  out["jim"] = { panel_as_shot: answered(asShot), panel_custom: custom === null ? null : answered(custom), temp_slider_moved: answered(slider) };
  return done;
}

/** Step 2: Temperature with WhiteBalance "Custom"; if Lightroom did not take "Custom", Jim's slider shows what it sets. */
async function temperatureCustom(ctx: Ctx, photo: Photo, from: number): Promise<Written> {
  const { map, ask, say } = ctx.deps;
  const key = sdkKey(map, "temperature");
  const to = shifted(map, "temperature", from, TEMPERATURE_SHIFT);
  const settings = { [key]: to, [WHITE_BALANCE_KEY]: CUSTOM_WHITE_BALANCE };
  const readBack = await write(ctx, photo, settings, HISTORY.custom);
  const done: Written = { readBack, customTaken: readBack[WHITE_BALANCE_KEY] === CUSTOM_WHITE_BALANCE, valueTaken: same(readBack[key], to) };
  const out: Json = { written: settings, white_balance: readBack[WHITE_BALANCE_KEY] ?? null, temperature: readBack[key] ?? null, custom_taken: done.customTaken, temperature_taken: done.valueTaken, mismatches: map.verifyReadback(settings, readBack) };
  ctx.results["temperature_custom"] = out;
  say(`  2. Temperature ${from} -> ${to} K with WhiteBalance "${CUSTOM_WHITE_BALANCE}". Lightroom took "${CUSTOM_WHITE_BALANCE}": ${yn(done.customTaken)}; temperature as written: ${yn(done.valueTaken)}.`);
  out["jim"] = { panel_custom: answered(await ask(`  In the Basic panel, does WB read "Custom" now?`)) };
  if (!done.customTaken) out["by_hand"] = await byHand(ctx, photo, key);
  return done;
}

/** Jim moves the Temp slider; the white balance Lightroom then reports is the value it uses. */
async function byHand(ctx: Ctx, photo: Photo, key: string): Promise<Json> {
  const said = await ctx.deps.prompt(`  Lightroom did not take "${CUSTOM_WHITE_BALANCE}" from the plugin. In the Basic panel, drag the Temp slider a little to the right, then press Enter here.`);
  if (said === null) return { read: false };
  const now = (await ctx.deps.client.request("get_settings", { photo_uuid: photo.uuid })).settings;
  ctx.deps.say(`     After your drag, white balance reads back "${String(now[WHITE_BALANCE_KEY])}".`);
  return { read: true, white_balance: now[WHITE_BALANCE_KEY] ?? null, temperature: now[key] ?? null };
}

/**
 * Step 3: back to the start, then Tint with WhiteBalance "Custom"; does Temperature stay the As Shot
 * value? A reset that leaves any setting unlike the start fails the check, and the tint is not
 * written: it would not start from the As Shot photo (Greptile, PR #39).
 */
async function tintCustom(ctx: Ctx, photo: Photo, snapshot: string): Promise<void> {
  const { client, map, say } = ctx.deps;
  const back = await client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: snapshot }, { timeoutMs: WRITE_TIMEOUT_MS });
  const resetDiffering = differingKeys(map, photo.start, back.read_back);
  if (resetDiffering.length > 0) {
    ctx.results["tint_custom"] = { reset_to_as_shot: back.read_back[WHITE_BALANCE_KEY] === AS_SHOT_WHITE_BALANCE, reset_differing: resetDiffering, written: null };
    ctx.fail(`step 3: the snapshot did not put the photo back to its start (${resetDiffering.join(", ")} differ), so the tint was not written`);
    return;
  }
  const [tKey, tempKey] = [sdkKey(map, "tint"), sdkKey(map, "temperature")];
  const to = shifted(map, "tint", photo.tint, TINT_SHIFT);
  const settings = { [tKey]: to, [WHITE_BALANCE_KEY]: CUSTOM_WHITE_BALANCE };
  const readBack = await write(ctx, photo, settings, HISTORY.tint);
  const out = {
    reset_to_as_shot: back.read_back[WHITE_BALANCE_KEY] === AS_SHOT_WHITE_BALANCE,
    reset_differing: resetDiffering,
    written: settings,
    white_balance: readBack[WHITE_BALANCE_KEY] ?? null,
    tint: readBack[tKey] ?? null,
    temperature: readBack[tempKey] ?? null,
    custom_taken: readBack[WHITE_BALANCE_KEY] === CUSTOM_WHITE_BALANCE,
    tint_taken: same(readBack[tKey], to),
    temperature_kept: same(readBack[tempKey], photo.temperature),
    mismatches: map.verifyReadback(settings, readBack),
  };
  ctx.results["tint_custom"] = out;
  say(`  3. From the start again, Tint ${photo.tint} -> ${to} with "${CUSTOM_WHITE_BALANCE}". Lightroom took "${CUSTOM_WHITE_BALANCE}": ${yn(out.custom_taken)}; tint as written: ${yn(out.tint_taken)}; temperature kept at ${photo.temperature} K: ${yn(out.temperature_kept)}.`);
}

/** Step 4: the preset selection (presets\select.ts) of steps 1 and 2's settings, white balance group; no file. */
function presetCarries(ctx: Ctx, alone: SdkSettings, custom: SdkSettings): void {
  const carries = (sdk: SdkSettings): Json => {
    const s = selectPresetSettings(ctx.deps.map, sdk, ["white_balance"]);
    return { temperature_carried: s.written.includes("temperature"), tint_carried: s.written.includes("tint"), also_written: s.also_written, left_out: s.left_out };
  };
  const out = { after_temperature_alone: carries(alone), after_custom: carries(custom) };
  ctx.results["preset"] = out;
  ctx.deps.say(`  4. A preset of these settings carries the temperature: after step 2 ${yn(out.after_custom["temperature_carried"] === true)}; after step 1 ${yn(out.after_temperature_alone["temperature_carried"] === true)}.`);
}

/** Step 5: the snapshot puts the photo back; every setting is compared with the start. */
async function putBack(ctx: Ctx, photo: Photo, snapshot: string): Promise<void> {
  const out: Json = { ok: false };
  ctx.results["put_back"] = out;
  try {
    await ctx.deps.client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: snapshot }, { timeoutMs: WRITE_TIMEOUT_MS });
    const now = (await ctx.deps.client.request("get_settings", { photo_uuid: photo.uuid })).settings;
    const differing = differingKeys(ctx.deps.map, photo.start, now);
    Object.assign(out, { ok: differing.length === 0, differing, compared: Object.keys(photo.start).length });
    if (differing.length > 0) ctx.fail(`the photo is not as before the check: ${differing.join(", ")} differ. Tell Claude Code.`);
  } catch (err) {
    out["error"] = errorBody(err);
    ctx.fail(`putting the photo back: ${describeError(err)}. Tell Claude Code.`);
  }
}

const step = (results: Json, name: string): Json | null => {
  const s = results[name] as Json | undefined;
  return s === undefined || s["written"] === null ? null : s; // null: the step did not write (not run)
};
/** A step's yes/no field, or null when the step did not run, so a skipped step never reads as NO (Greptile, PR #39). */
const field = (s: Json | null, name: string): boolean | null => (s === null ? null : s[name] === true);
const ynr = (v: boolean | null): string => (v === null ? "not run" : yn(v));

/** The summary in the results and the headlines in the window. */
function finish(ctx: Ctx, now: () => Date): { worked: boolean; results: Json } {
  const { results, errors, deps } = ctx;
  const putBackOk = results["put_back"] !== undefined && (results["put_back"] as Json)["ok"] === true;
  const worked = errors.length === 0 && putBackOk;
  const preset = results["preset"] as Json | undefined;
  const summary = {
    suggestion: worked ? "WORKED" : "FAILED",
    white_balance_after_temperature_alone: step(results, "temperature_alone")?.["white_balance"] ?? null,
    custom_taken_with_temperature: field(step(results, "temperature_custom"), "custom_taken"),
    custom_taken_with_tint: field(step(results, "tint_custom"), "custom_taken"),
    preset_carries_temperature_after_custom: preset ? field(preset["after_custom"] as Json, "temperature_carried") : null,
    put_back: putBackOk,
  };
  results["summary"] = summary;
  results["finished_at"] = now().toISOString();
  deps.say("");
  deps.say(`White balance check: ${summary.suggestion}`);
  const alone = summary.white_balance_after_temperature_alone;
  deps.say(`  Temperature alone left white balance: ${alone === null ? "not run" : `"${String(alone)}"`}`);
  deps.say(`  Lightroom took "${CUSTOM_WHITE_BALANCE}" with a temperature: ${ynr(summary.custom_taken_with_temperature)}; with a tint: ${ynr(summary.custom_taken_with_tint)}; a preset then carries the temperature: ${ynr(summary.preset_carries_temperature_after_custom)}`);
  deps.say(`  PUT BACK: ${results["put_back"] === undefined ? "not run (nothing was written)" : yn(putBackOk)}`);
  return { worked, results };
}
