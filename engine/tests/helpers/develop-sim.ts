// The issue #214 commands on the simulated Lightroom (plugin DevelopTools.lua, Snapshots.lua, Copies.lua), for
// develop-tools.test.ts and develop-snapshots.test.ts: each changes the photo's settings in LightroomSim the way the
// plugin's answer says, so the engine's before/after comparison runs on real settings tables. Snapshot names are
// recorded around the sim's own create_snapshot, which keeps only ids.

import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import { luaize, type LightroomSim } from "./lightroom-sim.js";

export type DevelopSim = {
  /** Each photo's snapshots by uuid, as list_snapshots answers them. */
  snapshots: Map<string, Array<{ id: string; name: string }>>;
  /** What set_process_version answers as the version before (LrDevelopController.getProcessVersion). */
  previous: string;
};

const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
const unknownPhoto: FakeReply = { ok: false, error: { code: "unknown_photo", message: "no photo has that uuid", recoverable: false } };

export function installDevelop(plugin: FakePlugin, lr: LightroomSim): DevelopSim {
  const sim: DevelopSim = { snapshots: new Map(), previous: "Version 6" };
  const listOf = (uuid: string) => sim.snapshots.get(uuid) ?? sim.snapshots.set(uuid, []).get(uuid)!;
  const create = plugin.handlers.get("create_snapshot");
  if (!create) throw new Error("install the LightroomSim first");
  plugin.handlers.set("create_snapshot", async (p, id) => {
    const r = await create(p, id);
    if (r !== "silent" && r.ok) {
      const a = r.payload as { uuid: string; snapshot_id: string; name: string };
      listOf(a.uuid).push({ id: a.snapshot_id, name: a.name });
    }
    return r;
  });
  const answer = (uuid: string, status: string, extra: Record<string, unknown> = {}): FakeReply =>
    ok({ uuid, status, read_back: luaize(lr.settingsOf(uuid)), ms: 5, ...extra });
  /** The snapshot the plugin takes before a change. */
  const snap = (uuid: string, name: string) => {
    const s = { id: `D-${listOf(uuid).length + 1}-${uuid}`, name };
    listOf(uuid).push(s);
    return s;
  };
  const photo = (p: Record<string, unknown>): string | null => (p["photo_uuid"] === "GONE" ? null : String(p["photo_uuid"]));

  plugin.handlers.set("apply_auto", (p) => {
    const u = photo(p);
    if (!u) return unknownPhoto;
    const s = lr.settingsOf(u);
    const snapshot = snap(u, String(p["snapshot_name"]));
    if (p["tone"] === true) s["Exposure2012"] = 0.7;
    if (p["white_balance"] === true) Object.assign(s, { Temperature: 5600, WhiteBalance: "Auto" });
    return answer(u, "applied", { snapshot, parts: { ...(p["tone"] ? { tone: "applied" } : {}), ...(p["white_balance"] ? { white_balance: "applied" } : {}) } });
  });
  plugin.handlers.set("reset_develop", (p) => {
    const u = photo(p);
    if (!u) return unknownPhoto;
    const snapshot = snap(u, String(p["snapshot_name"]));
    Object.assign(lr.settingsOf(u), { Exposure2012: 0, Contrast2012: 0 });
    delete lr.settingsOf(u)["MaskGroupBasedCorrections"];
    return answer(u, "reset", { snapshot });
  });
  plugin.handlers.set("set_process_version", (p) => {
    const u = photo(p);
    if (!u) return unknownPhoto;
    const [had, want] = [Number(sim.previous.slice(8)), Number(String(p["version"]).slice(8))];
    if (had === want) return answer(u, "unchanged", { previous: sim.previous, actual: sim.previous });
    if (want < had && p["masked"] === true) return answer(u, "skipped", { previous: sim.previous, actual: sim.previous, reason: "the photo has masks" });
    const snapshot = snap(u, String(p["snapshot_name"]));
    lr.settingsOf(u)["ProcessVersion"] = want === 6 ? "15.4" : "11.0";
    return answer(u, "changed", { previous: sim.previous, actual: p["version"], snapshot });
  });
  plugin.handlers.set("list_snapshots", (p) => {
    const u = photo(p);
    return u ? ok({ uuid: u, snapshots: listOf(u) }) : unknownPhoto;
  });
  plugin.handlers.set("delete_snapshot", (p) => {
    const u = String(p["photo_uuid"]);
    const list = listOf(u);
    const i = list.findIndex((s) => s.id === p["snapshot_id"]);
    if (i < 0) return { ok: false, error: { code: "unknown_snapshot", message: "no such snapshot", recoverable: false } };
    list.splice(i, 1);
    return ok({ uuid: u, snapshot_id: p["snapshot_id"] });
  });
  plugin.handlers.set("copy_photo", (p) => {
    const u = photo(p);
    if (!u) return unknownPhoto;
    const name = typeof p["copy_name"] === "string" ? p["copy_name"] : "Copy 1";
    return ok({ uuid: u, status: "copied", copy: { local_id: 90, uuid: `${u}-COPY`, is_virtual_copy: true, copy_name: name, identity_ok: true } });
  });
  return sim;
}
