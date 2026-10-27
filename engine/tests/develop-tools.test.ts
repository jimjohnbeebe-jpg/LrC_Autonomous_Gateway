// Issue #214: lr_apply_auto, lr_reset and lr_set_process_version (tools-develop.ts) and lr_get_metadata raw: true,
// against the simulated Lightroom with the plugin's new commands (helpers\develop-sim.ts).

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { DEVELOP_DEFS } from "../src/mcp/defs-develop.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { ParamError } from "../src/params/index.js";
import { checkProcessVersion } from "../src/params/pipeline.js";
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
type Photo = { uuid: string; status: string; names: string; changed: Record<string, { before: unknown; after: unknown }>; snapshot?: { name: string }; code?: string };
const photos = (out: ToolOutput): Photo[] => out.json["photos"] as Photo[];
const schema = (name: string) => DEVELOP_DEFS.find((d) => d.name === name)?.schema;
/** A stopped engine's session left open on `uuid` (session\left-open.ts). */
const leftOpen = (uuid: string): LeftOpen[] =>
  [{ file: "x.json", log: { session_id: "20261027-aaaaaa", target: { uuid }, variants: [], snapshot: { name: "AVG pre-session 2026", id: "S-LEFT" } } }] as unknown as LeftOpen[];

describe("lr_apply_auto", () => {
  it("sends one command per photo with one AVG snapshot name, and names what changed by setting", async () => {
    lr.settings["Exposure2012"] = 0;
    const out = await tools.applyAuto({ uuids: [lr.uuid, "GONE"], tone: true });
    // GONE is refused at the read before, so no apply_auto goes out for it.
    expect(sent("apply_auto")).toEqual([{ photo_uuid: lr.uuid, tone: true, white_balance: false, snapshot_name: expect.stringMatching(/^AVG pre-auto [0-9a-f]{6}$/) }]);
    const [p] = photos(out);
    expect(p).toMatchObject({ uuid: lr.uuid, status: "applied", names: "canonical", changed: { exposure: { before: 0, after: 0.7 } } });
    expect(out.json["failed"]).toEqual([expect.objectContaining({ uuid: "GONE" })]);
    expect(out.json["counts"]).toEqual({ applied: 1, failed: 1 });
    expect(String(out.json["undo"])).toContain(String(p?.snapshot?.name));
  });

  it("refuses a photo a stopped session left open, and sends nothing for it", async () => {
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(leftOpen(lr.uuid));
    const out = await tools.applyAuto({ uuids: [lr.uuid], white_balance: true });
    expect(photos(out)[0]).toMatchObject({ status: "refused", code: "SESSION_LEFT_OPEN" });
    expect(sent("apply_auto")).toEqual([]);
  });

  it("refuses while a session is open and with an older plugin, before sending anything", async () => {
    const hello = client.hello() as HelloResult;
    vi.spyOn(client, "hello").mockReturnValueOnce({ ...hello, plugin_version: "1.0.0" });
    expect((await fails(tools.applyAuto({ uuids: [lr.uuid], tone: true }))).code).toBe("PLUGIN_TOO_OLD");
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.applyAuto({ uuids: [lr.uuid], tone: true }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("apply_auto")).toEqual([]);
  });

  it("stops starting photos when the budget is spent", async () => {
    let t = 0;
    const out = await tools.applyAuto({ uuids: [lr.uuid, "SIM-LIB-2", "SIM-LIB-3"], tone: true }, { now: () => (t += 20_000), ms: 30_000 });
    expect(out.json["not_yet"]).toEqual(["SIM-LIB-3"]);
  });

  it("takes 1-100 distinct photos and needs tone or white_balance", () => {
    expect(schema("lr_apply_auto")?.safeParse({ uuids: ["A"], tone: true }).success).toBe(true);
    for (const bad of [{ uuids: ["A"] }, { uuids: ["A"], tone: false, white_balance: false }, { uuids: [], tone: true }, { uuids: ["A", "A"], tone: true }]) {
      expect(schema("lr_apply_auto")?.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("lr_reset", () => {
  it("passes confirm on, snapshots first and reports the cleared masks", async () => {
    Object.assign(lr.settings, { Exposure2012: 1.2, MaskGroupBasedCorrections: [{ What: "Correction", CorrectionMasks: [] }] });
    const out = await tools.resetDevelop({ uuids: [lr.uuid], confirm: true });
    expect(sent("reset_develop")[0]).toMatchObject({ photo_uuid: lr.uuid, confirm: true, snapshot_name: expect.stringMatching(/^AVG pre-reset /) });
    expect(photos(out)[0]).toMatchObject({ status: "reset", changed: { exposure: { before: 1.2, after: 0 } }, masks: { before: 1, after: 0 } });
  });

  it("is destructive and refuses without confirm: true", () => {
    const def = DEVELOP_DEFS.find((d) => d.name === "lr_reset");
    expect(def?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(def?.description).toMatch(/clears the crop and the masks/);
    expect(def?.schema.safeParse({ uuids: ["A"] }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: ["A"], confirm: false }).success).toBe(false);
  });
});

describe("lr_set_process_version", () => {
  it("sends Version N and whether the photo has masks; a masked downgrade is skipped", async () => {
    lr.settings["MaskGroupBasedCorrections"] = [{ What: "Correction" }];
    const out = await tools.setProcessVersion({ uuids: [lr.uuid], version: 5, confirm: true });
    expect(sent("set_process_version")[0]).toMatchObject({ version: "Version 5", masked: true, confirm: true });
    expect(photos(out)[0]).toMatchObject({ status: "skipped", previous: "Version 6", actual: "Version 6", changed: {} });
  });

  it("updates a legacy photo and names its changes by Lightroom key, since the map does not read the old version", async () => {
    Object.assign(lr.settings, { ProcessVersion: "6.7" });
    sim.previous = "Version 3";
    const out = await tools.setProcessVersion({ uuids: [lr.uuid], version: 6, confirm: true });
    expect(photos(out)[0]).toMatchObject({ status: "changed", previous: "Version 3", actual: "Version 6", names: "sdk", changed: { ProcessVersion: { before: "6.7", after: "15.4" } } });
  });

  it("points the legacy-version refusal at the new tool, refusing what it refused before", () => {
    expect(() => checkProcessVersion("6.7")).toThrow(ParamError);
    expect(() => checkProcessVersion("6.7")).toThrow(/lr_set_process_version \(version 6, confirm: true/);
    expect(() => checkProcessVersion("15.4")).not.toThrow();
  });
});

describe("npm run develop:check verdict", () => {
  it("works only when every step, the put-back, the snapshot clean-up and every answer are as expected", async () => {
    const { statusesOf, verdict } = await import("../src/devtools/develop-check.js");
    expect(statusesOf({ photos: [{ status: "reset" }], failed: [{ uuid: "X" }] })).toEqual(["reset", "failed"]);
    expect(statusesOf({ snapshot: { id: "1" } })).toEqual(["ok"]);
    const all = { steps: [{ step: "lr_reset", expect: ["reset"], statuses: ["reset", "reset"] }], selection_back: true, settings_back: true, snapshots_back: true, answers: ["y", "y", "y"], questions: 3 };
    expect(verdict(all).worked).toBe(true);
    expect(verdict({ ...all, steps: [{ step: "lr_reset", expect: ["reset"], statuses: [], error: "BRIDGE_TIMEOUT" }] }).worked).toBe(false);
    expect(verdict({ ...all, snapshots_back: false }).worked).toBe(false);
    expect(verdict({ ...all, answers: ["y", "y"] }).worked).toBe(false);
    expect(verdict({ ...all, answers: ["y", "n", "y"] }).lines.at(-2)).toBe("NO  Jim's answer 2: n");
  });
});

describe("lr_get_metadata raw: true", () => {
  it("adds each photo's Develop settings by setting name and by Lightroom key", async () => {
    lr.settings["Exposure2012"] = 0.4;
    const out = await tools.getMetadata({ uuids: [lr.uuid], raw: true });
    const develop = (out.json["photos"] as Array<{ develop: { settings: Record<string, unknown>; sdk: Record<string, unknown>; process_version: string } }>)[0]?.develop;
    expect(develop?.settings["exposure"]).toBe(0.4);
    expect(develop?.sdk["Exposure2012"]).toBe(0.4);
    expect(develop?.process_version).toBe("15.4");
    const plain = await tools.getMetadata({ uuids: [lr.uuid] });
    expect((plain.json["photos"] as Array<Record<string, unknown>>)[0]?.["develop"]).toBeUndefined();
  });
});
