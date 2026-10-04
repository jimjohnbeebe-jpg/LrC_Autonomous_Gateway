// The AI-mask commands in the Lightroom sim (plugin 0.13.0, plugin\LrC-AVG.lrplugin\Masks.lua). The sim
// keeps masks as the table its apply_settings writes (lightroom-sim.ts); here:
//   - update_ai_settings finds the photo by uuid and answers "started" at once, as plugin 0.14.0's task
//     does (PR C step 2c). A component with InstanceIDs (one person's mask) gets InstanceBounds, the
//     boxes of `people` (capture 4's two people by default, docs\reports\phase6\masks-capture\
//     capture4-row6_people_by_hand.json), or ErrorReason 1 when `people` is empty; `personDrift` makes
//     it come back as MaskSubType 3 + 13 without InstanceIDs, as the engine's instance-less entry did. With `tableRoute` "computes" every AI component without a digest gets its digests,
//     as Lightroom did in capture 1 (docs\reports\phase6\masks-capture\check.json `7_sky`); "absent"
//     gives it ErrorReason 1 instead (what Lightroom does for a kind the photo lacks is [unverified]);
//     "never" leaves it uncomputed; "unavailable" answers feature_unavailable; "failed" / "abandoned"
//     leave it uncomputed and probe_write_gate reports that state;
//   - `gate` "dialog": the update holds the write gate for `heldProbes` probes, as Lightroom's error
//     dialog did in Jim's step-2 run, then the user clicks OK and nothing has computed; "slow": the
//     same hold, then it computes (a cold model); `releaseState` "failed": the update reports it raised
//     once the hold ends. While the gate is held, writes answer gate_busy
//     and exports export_failed (each counted in `blocked`); reads answer;
//   - probe_write_gate: "aborted" while the gate is held, else "executed", with the update's record;
//     `probe` "unknown" answers unknown_command, as a plugin without it;
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
  tableRoute: "computes" | "absent" | "never" | "unavailable" | "failed" | "abandoned" = "computes";
  gate: "free" | "dialog" | "slow" = "free";
  heldProbes = 3;
  releaseState: "done" | "failed" = "done";
  people: Array<{ Top: number; Left: number; Bottom: number; Right: number }> = [
    { Top: 0.374479, Right: 0.532342, Left: 0.156001, Bottom: 0.785937 },
    { Top: 0.409896, Right: 0.823936, Left: 0.349014, Bottom: 1 },
  ];
  /** true: every one-person entry drifts; "wanted": only the wanted entry (not the probe, instance 0 of Entire Person). */
  personDrift: boolean | "wanted" = false;
  probe: "known" | "unknown" = "known";
  /** "late": the mask shows in the table only after the command's wait, so it answers no new id. */
  dc: "works" | "late" | "none" | "unknown" = "works";
  readonly calls: string[] = [];
  /** Writes and exports refused while the gate was held. */
  readonly blocked: string[] = [];
  /** Probes left while the update holds the gate, and what happens when it lets go. */
  held = 0;
  release: () => void = () => undefined;
  update: { uuid: string; state: string; error?: string } | null = null;
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

/** The uncomputed AI components of a photo. */
const pending = (sim: MaskSim, uuid: string): Entry[] => table(sim.settingsOf(uuid)).flatMap(parts).filter((m) => m[M.what] === WHAT.image && m[IMAGE.digest] === undefined);

function compute(sim: MaskSim, uuid: string): void {
  const sm = sim.masks;
  for (const m of pending(sim, uuid)) {
    const person = Array.isArray(m[IMAGE.instanceIds]);
    if (sm.tableRoute === "absent" || (person && sm.tableRoute === "computes" && sm.people.length === 0)) m[IMAGE.errorReason] = 1;
    else if (sm.tableRoute === "computes") {
      m[IMAGE.digest] = "D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0";
      if (person) m[IMAGE.instanceBounds] = structuredClone(sm.people);
      const probe = m[IMAGE.subCategory] === 20036 && (m[IMAGE.instanceIds] as Array<Record<string, unknown>>)[0]?.[IMAGE.instanceId] === 0;
      if (person && (sm.personDrift === true || (sm.personDrift === "wanted" && !probe))) {
        Object.assign(m, { [IMAGE.subType]: 3, [IMAGE.subCategory]: 13 });
        delete m[IMAGE.instanceIds];
      }
    }
  }
}

function updateAiSettings(sim: MaskSim, p: Record<string, unknown>): FakeReply {
  const sm = sim.masks;
  sm.calls.push("update_ai_settings");
  const uuid = findPhoto(sim, p);
  if (typeof uuid !== "string") return uuid;
  if (sm.tableRoute === "unavailable") return fail("feature_unavailable", "photo:updateAISettings (SDK 13.3) is not available in this Lightroom (or not to this plugin)", true);
  if (sm.tableRoute === "failed" || sm.tableRoute === "abandoned") {
    sm.update = { uuid, state: sm.tableRoute, ...(sm.tableRoute === "failed" ? { error: "dry: updateAISettings raised" } : {}) };
    return { ok: true, payload: { uuid, status: "started", state: "started", command_ms: 1 } };
  }
  if (sm.gate === "free") {
    compute(sim, uuid);
    sm.update = { uuid, state: "done" };
    return { ok: true, payload: { uuid, status: "started", state: "started", command_ms: 2 } };
  }
  sm.update = { uuid, state: "running" };
  sm.held = sm.heldProbes;
  const slow = sm.gate === "slow";
  sm.release = () => {
    if (slow) compute(sim, uuid);
    sm.update = sm.releaseState === "failed" ? { uuid, state: "failed", error: "dry: updateAISettings raised after the dialog" } : { uuid, state: "done" };
  };
  return { ok: true, payload: { uuid, status: "started", state: "started", command_ms: 1 } };
}

function probeWriteGate(sim: MaskSim): FakeReply {
  const sm = sim.masks;
  sm.calls.push("probe_write_gate");
  if (sm.probe === "unknown") return fail("unknown_command", "unknown command probe_write_gate", false);
  const update = sm.update ? { update: { ...sm.update } } : {};
  if (sm.held > 0) {
    sm.held--;
    if (sm.held === 0) sm.release();
    return { ok: true, payload: { status: "aborted", ms: 500, ...update } };
  }
  return { ok: true, payload: { status: "executed", ms: 1, ...update } };
}

function createAiMaskDc(sim: MaskSim, p: Record<string, unknown>): FakeReply {
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
}

/** Install the masks commands; call after the Develop commands, whose writes and exports it holds while the gate is held. */
export function installMasks(sim: MaskSim, plugin: FakePlugin): void {
  plugin.handlers.set("update_ai_settings", (p) => updateAiSettings(sim, p));
  plugin.handlers.set("probe_write_gate", () => probeWriteGate(sim));
  plugin.handlers.set("create_ai_mask_dc", (p) => createAiMaskDc(sim, p));
  for (const name of ["apply_settings", "apply_snapshot", "create_snapshot", "export_preview"]) {
    const real = plugin.handlers.get(name);
    if (!real) continue;
    plugin.handlers.set(name, (p, id) => {
      if (sim.masks.held === 0) return real(p, id);
      sim.masks.blocked.push(name);
      return name === "export_preview"
        ? fail("export_failed", "the export wrote no JPEG", true)
        : fail("gate_busy", `Lightroom's catalog stayed busy for 60 s, so '${String(p["history_name"] ?? name)}' was not written`, true);
    });
  }
}
