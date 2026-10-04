// The AI-mask commands in the Lightroom sim (plugin 0.12.0, plugin\LrC-AVG.lrplugin\Masks.lua). The sim
// keeps masks as the table its apply_settings writes (lightroom-sim.ts); here:
//   - update_ai_settings finds the photo by uuid and, with `tableRoute` "computes", gives every AI
//     component without a digest its digests, as Lightroom did in capture 1 (docs\reports\phase6\
//     masks-capture\check.json `7_sky`); "never" leaves them uncomputed, "unavailable" answers
//     feature_unavailable;
//   - create_ai_mask_dc refuses a missing target_uuid or another selected photo (MaskProbe.lua begin);
//     with `dc` "works" it adds Lightroom's own entry for the subtype (capture 1's, 3_dump-1.json, with
//     new ids) and answers its id; "none" answers no new id; "unknown" answers unknown_command, as a
//     plugin without the command.
// Only the answers' shapes are the plugin's; nothing here is a claim about Lightroom.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { C, IMAGE, M, MASK_TABLE_KEY, WHAT } from "../../src/params/mask-table.js";
import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import { findPhoto, type CatalogSim } from "./lightroom-sim-catalog.js";

/** Jim's five-entry table from capture 1 (linear, radial, sky, subject, luminance). */
export const captureTable = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/reports/phase6/masks-capture/3_dump-1.json", import.meta.url)), "utf8")) as Record<string, unknown>
)[MASK_TABLE_KEY] as Array<Record<string, unknown>>;

type Entry = Record<string, unknown>;
const fail = (code: string, message: string, recoverable: boolean): FakeReply => ({ ok: false, error: { code, message, recoverable } });
const parts = (e: Entry): Entry[] => (e[C.masks] as Entry[] | undefined) ?? [];

export class SimMasks {
  tableRoute: "computes" | "never" | "unavailable" = "computes";
  /** "late": the mask shows in the table only after the command's wait, so it answers no new id. */
  dc: "works" | "late" | "none" | "unknown" = "works";
  readonly calls: string[] = [];
}

/** What the masks commands need of the sim. */
export type MaskSim = CatalogSim & { readonly masks: SimMasks; settingsOf(uuid: string): Record<string, unknown> };

function table(settings: Record<string, unknown>): Entry[] {
  const t = settings[MASK_TABLE_KEY];
  if (!Array.isArray(t)) settings[MASK_TABLE_KEY] = [];
  return settings[MASK_TABLE_KEY] as Entry[];
}

/** Lightroom's entry for an AI subtype, with new ids, computed (capture 1's sky or subject; background as the subject with its subtype). */
function dcEntry(subtype: string): Entry {
  const sky = captureTable[2] as Entry;
  const subject = captureTable[3] as Entry;
  const e = structuredClone(subtype === "sky" ? sky : subject);
  e[C.id] = randomUUID().toUpperCase();
  const m = parts(e)[0] as Entry;
  m[M.id] = randomUUID().toUpperCase();
  if (subtype === "background") Object.assign(m, { [IMAGE.subType]: 0, [IMAGE.subCategory]: 22 });
  return e;
}

export function installMasks(sim: MaskSim, plugin: FakePlugin): void {
  plugin.handlers.set("update_ai_settings", (p): FakeReply => {
    sim.masks.calls.push("update_ai_settings");
    const uuid = findPhoto(sim, p);
    if (typeof uuid !== "string") return uuid;
    if (sim.masks.tableRoute === "unavailable") return fail("feature_unavailable", "photo:updateAISettings (SDK 13.3) is not available in this Lightroom (or not to this plugin)", true);
    if (sim.masks.tableRoute === "computes") {
      for (const m of table(sim.settingsOf(uuid)).flatMap(parts)) if (m[M.what] === WHAT.image && m[IMAGE.digest] === undefined) m[IMAGE.digest] = "D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0";
    }
    return { ok: true, payload: { uuid, call_ms: 1, command_ms: 2 } };
  });
  plugin.handlers.set("create_ai_mask_dc", (p): FakeReply => {
    sim.masks.calls.push("create_ai_mask_dc");
    if (sim.masks.dc === "unknown") return fail("unknown_command", "unknown command create_ai_mask_dc", false);
    const target = p["target_uuid"];
    if (typeof target !== "string" || target === "") return fail("bad_request", "target_uuid must be a non-empty string", false);
    if (sim.selected === "") return fail("no_target_photo", "No photo is selected in Lightroom", true);
    if (sim.selected !== target) return fail("target_mismatch", `The selected photo (${sim.selected}) is not the target (${target})`, true);
    const steps = [{ step: "createNewMask_" + String(p["subtype"]), ok: true, ms: 1 }];
    if (sim.masks.dc === "none") return { ok: true, payload: { uuid: target, steps, new_ids: [], waited_ms: 12000 } };
    const e = dcEntry(String(p["subtype"]));
    table(sim.settingsOf(target)).push(e);
    return { ok: true, payload: { uuid: target, steps, new_ids: sim.masks.dc === "late" ? [] : [e[C.id]], waited_ms: sim.masks.dc === "late" ? 12000 : 900 } };
  });
}
