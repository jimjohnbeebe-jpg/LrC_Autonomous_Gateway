// `npm run offline:check` (fix/offline-original; plugin 0.19.1, engine 0.23.1): does Lightroom report a
// missing original, and does LrC-AVG refuse it before writing? On Jim's catalog, against the TIFF whose
// original is gone [stated: Jim, 2026-10-09, "seems to have disappeared"; docs\reports\phase8\S10.md]
// and a photo that is there (the S10 recorder's photo, DSC_0031.JPG Copy 1). Steps:
//   1. the plugin is 0.19.1 or later (the file-on-disk signal, fix/offline-file-exists);
//   2. get_context of both by uuid: `available` false for the TIFF, true for the JPG; when the TIFF is
//      not reported missing the check stops here, so no session or write ever reaches a photo that is there;
//   3. the TIFF selected (by the check, else Jim clicks it: Lightroom did not select it in Jim's runs 2-3,
//      "active photo nil, 20 selected" [handle: docs\reports\phase8\offline\bridge_log_excerpts.txt]):
//      lr_get_active_photo_context says original_missing; lr_begin_session is refused
//      with ORIGINAL_MISSING; its settings are as before;
//   4. the plugin's own refusals by uuid: apply_settings (the photo's own exposure, so a write that got
//      through changes no value) and export_preview answer original_missing;
//   5. Jim's selection put back. (The menu question of the first runs is answered: Jim saw "Find all
//      missing photos" under Library [stated: Jim, 2026-10-09].)
// Report: docs\reports\phase8\offline.md. The HUD's line for a file lost mid-edit is tested against the
// sim only [handle: tests\offline-original.test.ts]; in Lightroom [unverified].

import { pluginVersionAtLeast, type BridgeClient } from "../bridge/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import { toToolError } from "../mcp/index.js";
import { differingSettings, type ParamMap } from "../params/index.js";
import { describeError } from "./phase1-check.js";

export const MISSING = { uuid: "F472C80A-31EF-47B1-8C05-6910CC7D90AA", filename: "20260907-_OZ80099-Edit.tif" };
export const PRESENT = { uuid: "12409199-51E4-4AC3-8EE9-6DB994858630", filename: "DSC_0031.JPG Copy 1" };
export const OFFLINE_PLUGIN = "0.19.1";
const INTENT = "landscape_forest_shade";

type Json = Record<string, unknown>;
export type OfflineDeps = {
  client: BridgeClient;
  gate: Pick<BridgeGate, "ready" | "release">;
  tools: Pick<Tools, "beginSession" | "endSession" | "getActivePhotoContext" | "sessionManager">;
  map: ParamMap;
  /** Shows `text`, waits for Enter. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
};

const codeOf = (err: unknown): string => toToolError(err).code;

/** The error code a call answered with, or "none" when it went through. */
async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "none";
  } catch (err) {
    return codeOf(err);
  }
}

export async function runOfflineCheck(deps: OfflineDeps): Promise<{ worked: boolean; results: Json }> {
  const { client, say } = deps;
  const results: Json = { check: "offline", started: new Date().toISOString(), missing: MISSING, present: PRESENT };
  const lines: Record<string, boolean> = {};
  results["lines"] = lines;
  const errors: string[] = [];
  results["errors"] = errors;
  let selected: string | null = null;
  try {
    await deps.gate.ready();
    const version = client.hello()?.plugin_version;
    results["plugin_version"] = version ?? null;
    if (!pluginVersionAtLeast(version, OFFLINE_PLUGIN)) throw new Error(`Lightroom runs plugin ${String(version)}, not ${OFFLINE_PLUGIN} or later: File > Plug-in Manager > LrC-AVG > Reload Plug-in, then run this again.`);
    selected = (await client.request("get_selection", { max: 1 })).photos[0]?.uuid ?? null;
    results["selected_uuid"] = selected;

    const missing = await client.request("get_context", { photo_uuid: MISSING.uuid });
    const present = await client.request("get_context", { photo_uuid: PRESENT.uuid });
    results["contexts"] = { missing: pick(missing), present: pick(present) };
    lines["missing_reported"] = missing.available === false;
    lines["present_reported"] = present.available === true;
    say(`${MISSING.filename}: available ${String(missing.available)}${missing.availability_error ? ` (error: ${missing.availability_error})` : ""}, smart preview ${String(missing.smart_preview)}`);
    say(`${PRESENT.filename}: available ${String(present.available)}`);
    // A photo Lightroom finds would take the begin's pass 0 and the write: stop before either.
    if (missing.available !== false) throw new Error(`Lightroom does not report ${MISSING.filename} as missing, so nothing was tried on it.`);

    const before = deps.map.fromSdk((await client.request("get_settings", { photo_uuid: MISSING.uuid })).settings);
    results["selected_by"] = await selectMissing(deps);
    const ctx = (await deps.tools.getActivePhotoContext()).json;
    results["context_tool"] = { original_missing: ctx["original_missing"] ?? null, original_missing_note: ctx["original_missing_note"] ?? null };
    lines["context_tool_reports"] = ctx["original_missing"] === true;
    const begin = await refusal(() => deps.tools.beginSession({ intent_id: INTENT, return_image: "none" }));
    results["begin"] = begin;
    lines["begin_refused"] = begin === "ORIGINAL_MISSING";
    // A begin that went through (the file came back, or another photo was clicked meanwhile) or failed after
    // its snapshot leaves a session open: put that photo back (Greptile, PR #101).
    const open = deps.tools.sessionManager()?.current() ?? null;
    if (open) {
      const r = await refusal(() => deps.tools.endSession({ session_id: open.id, outcome: "revert" }));
      results["session_reverted"] = r === "none";
      throw new Error(`lr_begin_session left session ${open.id} open; the check ended it with revert: ${r === "none" ? "the photo is put back" : `that failed (${r}), apply its "AVG pre-session" snapshot in Develop > Snapshots`}.`);
    }
    const exposure = before.settings["exposure"];
    const sdk = deps.map.toSdk({ exposure: typeof exposure === "number" ? exposure : 0 }, { processVersion: before.process_version, pipeline: before.pipeline });
    const write = await refusal(() => client.request("apply_settings", { photo_uuid: MISSING.uuid, settings: sdk, history_name: "AVG offline-check" }));
    const exported = await refusal(() => client.request("export_preview", { photo_uuid: MISSING.uuid, long_edge: 800, quality: 75 }));
    results["plugin_refusals"] = { apply_settings: write, export_preview: exported };
    lines["write_refused"] = write === "ORIGINAL_MISSING";
    lines["export_refused"] = exported === "ORIGINAL_MISSING";
    const after = deps.map.fromSdk((await client.request("get_settings", { photo_uuid: MISSING.uuid })).settings);
    const differing = differingSettings(before.settings, after.settings);
    results["differing_after"] = differing;
    lines["nothing_written"] = differing.length === 0;
  } catch (err) {
    errors.push(describeError(err));
  }
  lines["selection_restored"] = await restore(deps, selected, errors);
  await deps.gate.release(); // the bridge and the instance lock, so the command ends and Claude Desktop can connect (Greptile, PR #101)
  return summarize(results, lines, errors, say);
}

/**
 * Select the TIFF. When Lightroom does not select it (Jim's runs 2-3; why is [unverified], e.g. a photo
 * outside the current view), Jim clicks it, and the check reads the selection back: the TIFF alone.
 */
async function selectMissing(deps: OfflineDeps): Promise<"check" | "jim"> {
  try {
    await deps.client.request("select_photo", { uuid: MISSING.uuid });
    return "check";
  } catch (err) {
    deps.say(`Lightroom did not select ${MISSING.filename} (${describeError(err)}).`);
  }
  await deps.prompt(`In Lightroom's Library, click ${MISSING.filename} (only that photo) in the "fixtures" collection, then press Enter here:`);
  const sel = await deps.client.request("get_selection", { max: 2 });
  if (sel.count !== 1 || sel.photos[0]?.uuid !== MISSING.uuid) {
    throw new Error(`the selection is not ${MISSING.filename} alone (${sel.count} selected, active ${String(sel.photos[0]?.filename ?? "none")}), so nothing was tried on it.`);
  }
  return "jim";
}
function pick(c: Json): Json {
  return { filename: c["filename"] ?? null, file_format: c["file_format"] ?? null, available: c["available"] ?? null, availability_error: c["availability_error"] ?? null, smart_preview: c["smart_preview"] ?? null, path: c["path"] ?? null };
}

/** Put back the photo Jim had selected; true when there was none to put back. */
async function restore(deps: OfflineDeps, uuid: string | null, errors: string[]): Promise<boolean> {
  if (uuid === null) return true;
  try {
    await deps.client.request("select_photo", { uuid });
    return true;
  } catch (err) {
    errors.push(`selection not put back: ${describeError(err)}`);
    return false;
  }
}

function summarize(results: Json, lines: Record<string, boolean>, errors: string[], say: (line: string) => void): { worked: boolean; results: Json } {
  const all = ["missing_reported", "present_reported", "context_tool_reports", "begin_refused", "write_refused", "export_refused", "nothing_written", "selection_restored"];
  const worked = errors.length === 0 && all.every((k) => lines[k] === true);
  results["suggestion"] = worked ? "WORKED" : "FAILED";
  say("");
  for (const k of all) say(`  ${k.replace(/_/g, " ")}: ${lines[k] === true ? "YES" : lines[k] === false ? "NO" : "not run"}`);
  for (const e of errors) say(`  error: ${e}`);
  say(`Offline original check: ${worked ? "WORKED" : "FAILED"}`);
  return { worked, results };
}
