// Issue #214: lr_list_snapshots, lr_create_snapshot, lr_apply_snapshot, lr_delete_snapshot and lr_create_virtual_copies
// (tools-snapshots.ts), against the simulated Lightroom with the plugin's new commands (helpers\develop-sim.ts).

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { DEVELOP_DEFS } from "../src/mcp/defs-develop.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { PreviewService } from "../src/preview/index.js";
import type { LeftOpen } from "../src/session/index.js";
import { installDevelop, type DevelopSim } from "./helpers/develop-sim.js";
import { client, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

let tools: Tools;
let sim: DevelopSim;
beforeEach(() => {
  sim = installDevelop(plugin, lr);
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
});

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
const leftOpen = (uuid: string, id: string): LeftOpen[] =>
  [{ file: "x.json", log: { session_id: "20261027-bbbbbb", target: { uuid }, variants: [], snapshot: { name: "AVG pre-session 2026-10-27", id } } }] as unknown as LeftOpen[];

describe("lr_list_snapshots", () => {
  it("lists ids and names, marks LrC-AVG's, and names a session's put-back snapshot", async () => {
    sim.snapshots.set(lr.uuid, [{ id: "1", name: "Before print" }, { id: "2", name: "AVG pre-session 2026-10-27" }]);
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(leftOpen(lr.uuid, "2"));
    const out = await tools.listSnapshots({ uuid: lr.uuid });
    expect(out.json["snapshots"]).toEqual([
      { id: "1", name: "Before print", by_avg: false },
      { id: "2", name: "AVG pre-session 2026-10-27", by_avg: true, session: { session_id: "20261027-bbbbbb", state: "left_open" } },
    ]);
  });

  it("is read only and works while a session is open, naming the open session's snapshot", async () => {
    expect(DEVELOP_DEFS.find((d) => d.name === "lr_list_snapshots")?.annotations).toMatchObject({ readOnlyHint: true });
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const out = await tools.listSnapshots({ uuid: lr.uuid });
    const snaps = out.json["snapshots"] as Array<{ name: string; session?: { state: string } }>;
    expect(snaps.find((s) => s.name.startsWith("AVG pre-session "))?.session).toEqual({ session_id: begun.json["session_id"], state: "open" });
  });
});

describe("lr_create_snapshot", () => {
  it('puts "AVG " in front, and refuses a name the photo already has', async () => {
    const out = await tools.createSnapshot({ uuid: lr.uuid, name: "before crop" });
    expect(out.json["snapshot"]).toMatchObject({ name: "AVG before crop" });
    expect((await fails(tools.createSnapshot({ uuid: lr.uuid, name: "AVG before crop" }))).code).toBe("SNAPSHOT_EXISTS");
    expect(sent("create_snapshot")).toHaveLength(1);
  });
});

describe("lr_apply_snapshot", () => {
  it("snapshots the settings first, asks the plugin to put the view back, and names what changed", async () => {
    lr.settings["Exposure2012"] = 0;
    const saved = await tools.createSnapshot({ uuid: lr.uuid, name: "flat" });
    lr.settings["Exposure2012"] = 1.5;
    const id = (saved.json["snapshot"] as { id: string }).id;
    const out = await tools.applySnapshot({ uuid: lr.uuid, snapshot_id: id, confirm: true });
    expect(sent("apply_snapshot")).toEqual([{ photo_uuid: lr.uuid, snapshot_id: id, restore_view: true }]);
    expect(out.json).toMatchObject({ applied: { id, name: "AVG flat" }, snapshot: { name: expect.stringMatching(/^AVG pre-apply /) }, changed: { exposure: { before: 1.5, after: 0 } } });
    expect(sent("create_snapshot")).toHaveLength(2);
  });

  it("refuses an unknown id and a photo a stopped session left open, changing nothing", async () => {
    expect((await fails(tools.applySnapshot({ uuid: lr.uuid, snapshot_id: "nope", confirm: true }))).code).toBe("UNKNOWN_SNAPSHOT");
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(leftOpen(lr.uuid, "x"));
    expect((await fails(tools.applySnapshot({ uuid: lr.uuid, snapshot_id: "nope", confirm: true }))).code).toBe("SESSION_LEFT_OPEN");
    expect(sent("apply_snapshot")).toEqual([]);
  });
});

describe("lr_delete_snapshot", () => {
  it("deletes a snapshot, refuses a session's put-back one, and needs confirm: true", async () => {
    sim.snapshots.set(lr.uuid, [{ id: "1", name: "mine" }, { id: "2", name: "AVG pre-session 2026-10-27" }]);
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(leftOpen(lr.uuid, "2"));
    expect((await fails(tools.deleteSnapshot({ uuid: lr.uuid, snapshot_id: "2", confirm: true }))).code).toBe("SNAPSHOT_IN_USE");
    const out = await tools.deleteSnapshot({ uuid: lr.uuid, snapshot_id: "1", confirm: true });
    expect(out.json["deleted"]).toEqual({ id: "1", name: "mine" });
    expect(sent("delete_snapshot")).toEqual([{ photo_uuid: lr.uuid, snapshot_id: "1" }]);
    const def = DEVELOP_DEFS.find((d) => d.name === "lr_delete_snapshot");
    expect(def?.annotations).toMatchObject({ destructiveHint: true });
    expect(def?.schema.safeParse({ uuid: "A", snapshot_id: "1" }).success).toBe(false);
  });

  it("runs only between sessions", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.deleteSnapshot({ uuid: lr.uuid, snapshot_id: "1", confirm: true }))).code).toBe("SESSION_ALREADY_ACTIVE");
  });
});

describe("lr_create_virtual_copies", () => {
  it("makes one copy per photo, passes copy_name on, and returns each copy's uuid", async () => {
    const out = await tools.createVirtualCopies({ uuids: [lr.uuid, "GONE"], copy_name: "Print" });
    expect(sent("copy_photo")).toEqual([{ photo_uuid: lr.uuid, copy_name: "Print" }, { photo_uuid: "GONE", copy_name: "Print" }]);
    expect(out.json["photos"]).toEqual([{ uuid: lr.uuid, status: "copied", copy_uuid: `${lr.uuid}-COPY`, copy_name: "Print" }]);
    expect(out.json["failed"]).toEqual([{ uuid: "GONE", code: "UNKNOWN_PHOTO", message: "no photo has that uuid" }]);
  });

  it("takes 1-25 photos", () => {
    const s = DEVELOP_DEFS.find((d) => d.name === "lr_create_virtual_copies")?.schema;
    expect(s?.safeParse({ uuids: ["A"] }).success).toBe(true);
    expect(s?.safeParse({ uuids: Array.from({ length: 26 }, (_, i) => `U${i}`) }).success).toBe(false);
  });
});
