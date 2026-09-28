// The simulated Lightroom's catalog commands (plugin 0.3.0, plugin\LrC-AVG.lrplugin\Catalog.lua):
//   - create_virtual_copies { target_uuid, names }: one copy of the selected master per name, each
//     starting from the master's settings [inference, as the engine assumes: session\variants.ts
//     copyPass0]; the answer lists every copy made, with `failure` when it stopped early (the plugin
//     answers ok once a copy exists [handle: Catalog.lua header and createCopies]);
//   - select_photo { uuid, expect }: find a photo by uuid, check `expect`, select it.
// `copyFault` and `selectFault` make them fail the ways Catalog.lua can [handle: Catalog.lua
// exclusive() "busy", copyOnce() failures and identity_ok, selectOnly() "select_failed"], plus no
// answer at all (the engine's timeout, PHASE4_PLAN "For row 7, from PR #33").

import type { FakeReply } from "./fake-plugin.js";

export type SimCopy = { uuid: string; local_id: number; copy_name: string; settings: Record<string, unknown> };
export type CopyFault =
  | { kind: "busy" }
  | { kind: "silent" }
  | { kind: "partial"; made: number; code: string }
  | { kind: "wrong_identity"; index: number };

/** What the catalog commands need of the simulated Lightroom. */
export type CatalogSim = {
  readonly uuid: string;
  selected: string;
  settings: Record<string, unknown>;
  readonly copies: Map<string, SimCopy>;
  copyFault: CopyFault | null;
  selectFault: string | null;
};

export const MASTER_LOCAL_ID = 1;
const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
const fail = (code: string, message: string, recoverable = false): FakeReply => ({ ok: false, error: { code, message, recoverable } });

/** A photo's identity as Catalog.lua describes it. */
export function describePhoto(sim: CatalogSim, uuid: string): Record<string, unknown> | null {
  if (uuid === sim.uuid) return { uuid, local_id: MASTER_LOCAL_ID, is_virtual_copy: false, master_local_id: MASTER_LOCAL_ID };
  const copy = sim.copies.get(uuid);
  return copy ? { uuid, local_id: copy.local_id, is_virtual_copy: true, master_local_id: MASTER_LOCAL_ID, copy_name: copy.copy_name } : null;
}

export function createVirtualCopies(sim: CatalogSim, p: Record<string, unknown>): FakeReply | "silent" {
  if (p["target_uuid"] !== sim.selected) return fail("target_mismatch", `The selected photo (${sim.selected}) is not the target`, true);
  if (sim.selected !== sim.uuid) return fail("bad_target", "the selected photo is a virtual copy (or unreadable); select the master photo", true);
  const names = p["names"];
  if (!Array.isArray(names) || names.length < 2 || names.length > 4 || names.some((n) => typeof n !== "string" || !n.startsWith("AVG "))) {
    return fail("bad_request", "names must be 2-4 different strings, each starting with 'AVG '");
  }
  const fault = sim.copyFault;
  if (fault?.kind === "busy") return fail("busy", "create_virtual_copies waited 10 s for select_photo to finish", true);
  if (fault?.kind === "silent") return "silent";
  const copies: Array<Record<string, unknown>> = [];
  let failure: { code: string; message: string } | undefined;
  for (const [i, name] of (names as string[]).entries()) {
    if (fault?.kind === "partial" && i >= fault.made) {
      failure = { code: fault.code, message: `the simulated ${fault.code}` };
      break;
    }
    const n = sim.copies.size + 1;
    const copy: SimCopy = { uuid: `SIM-COPY-${n}`, local_id: 100 + n, copy_name: fault?.kind === "wrong_identity" && fault.index === i ? "not asked for" : name, settings: structuredClone(sim.settings) };
    sim.copies.set(copy.uuid, copy);
    // The new copy becomes the active photo [handle: docs\reports\phase0\S6.md "Analysis"]; the
    // plugin selects the master again before the next copy and at the end (Catalog.lua copyOnce).
    sim.selected = copy.uuid;
    sim.selected = sim.uuid;
    copies.push({ ...describePhoto(sim, copy.uuid), identity_ok: copy.copy_name === name });
  }
  return ok({ uuid: sim.uuid, local_id: MASTER_LOCAL_ID, requested: names.length, copies, ...(failure ? { failure } : {}), master_selected: true });
}

export function selectPhoto(sim: CatalogSim, p: Record<string, unknown>): FakeReply {
  const uuid = String(p["uuid"]);
  const d = describePhoto(sim, uuid);
  if (!d) return fail("unknown_photo", `no photo in the catalog has uuid ${uuid}`);
  const expect = (p["expect"] ?? {}) as Record<string, unknown>;
  for (const field of ["copy_name", "master_local_id", "is_virtual_copy"]) {
    if (expect[field] !== undefined && d[field] !== expect[field]) return fail("identity_mismatch", `the photo with uuid ${uuid} has ${field} ${String(d[field])}`);
  }
  if (sim.selectFault) return fail("select_failed", sim.selectFault, true);
  sim.selected = uuid;
  return ok(d);
}
