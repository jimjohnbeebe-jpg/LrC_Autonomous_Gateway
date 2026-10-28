// Issue #217 row 1: lr_delete_empty_masks (tools-develop.ts deleteEmptyMasks; plugin MaskClean.lua), against the simulated
// Lightroom. The stand-in for catalog:deleteAllEmptyMasks drops the corrections with no part, as upstream describes
// Lightroom's call [upstream claim: Automaat/lightroom-mcp 1040453, tool-contracts.ts delete_empty_masks]; what Lightroom
// deletes is Jim's `npm run masks:parity`. The mask kept beside it is Lightroom's own brush [handle:
// docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json `table_before` "Brush"].

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { DEVELOP_DEFS } from "../src/mcp/defs-develop.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { deleteEmptyMasks } from "../src/mcp/tools-develop.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { PreviewService } from "../src/preview/index.js";
import { installDevelop } from "./helpers/develop-sim.js";
import { luaize } from "./helpers/lightroom-sim.js";
import { client, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

const carry = JSON.parse(readFileSync(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url), "utf8")) as { table_before: Array<Record<string, unknown>> };
const brush = carry.table_before.find((e) => e["CorrectionName"] === "Brush") as Record<string, unknown>;
const emptied = { ...structuredClone(brush), CorrectionID: "EMPTY-1", CorrectionName: "Emptied", CorrectionMasks: [] };

let tools: Tools;
beforeEach(() => {
  installDevelop(plugin, lr);
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
  vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: "1.6.0" });
  plugin.handlers.set("delete_empty_masks", (p) => {
    const s = lr.settingsOf(String(p["photo_uuid"]));
    const table = (s["MaskGroupBasedCorrections"] ?? []) as Array<{ CorrectionMasks: unknown[] }>;
    const kept = table.filter((e) => e.CorrectionMasks.length > 0);
    if (kept.length === table.length) return { ok: true, payload: { uuid: p["photo_uuid"], status: "unchanged", read_back: luaize(s), ms: 3 } };
    s["MaskGroupBasedCorrections"] = kept;
    return { ok: true, payload: { uuid: p["photo_uuid"], status: "deleted", snapshot: { id: "S-1", name: p["snapshot_name"] }, read_back: luaize(s), ms: 3 } };
  });
});

const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
const photos = (out: ToolOutput) => out.json["photos"] as Array<Record<string, unknown>>;

describe("lr_delete_empty_masks", () => {
  it("sends one command per photo with an AVG snapshot name and reports the mask count before and after", async () => {
    lr.settings["MaskGroupBasedCorrections"] = [structuredClone(brush), emptied];
    const out = await tools.call(deleteEmptyMasks, { uuids: [lr.uuid] });
    expect(sent("delete_empty_masks")).toEqual([{ photo_uuid: lr.uuid, snapshot_name: expect.stringMatching(/^AVG pre-empty-masks [0-9a-f]{6}$/) }]);
    expect(photos(out)[0]).toMatchObject({ uuid: lr.uuid, status: "deleted", masks: { before: 2, after: 1 }, snapshot: { id: "S-1" } });
    expect(lr.settings["MaskGroupBasedCorrections"]).toEqual([brush]);
  });

  it("answers unchanged, without masks or snapshot, when nothing was empty", async () => {
    lr.settings["MaskGroupBasedCorrections"] = [structuredClone(brush)];
    const [p] = photos(await tools.call(deleteEmptyMasks, { uuids: [lr.uuid] }));
    expect(p).toMatchObject({ status: "unchanged", changed: {} });
    expect(p).not.toHaveProperty("masks");
    expect(p).not.toHaveProperty("snapshot");
  });

  it("refuses an older plugin before sending anything, and passes Lightroom's FEATURE_UNAVAILABLE on per photo", async () => {
    vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: "1.5.0" });
    const err = await tools.call(deleteEmptyMasks, { uuids: [lr.uuid] }).catch((e: unknown) => toToolError(e));
    expect((err as { code: string }).code).toBe("PLUGIN_TOO_OLD");
    vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: "1.6.0" });
    const message = "Deleting empty masks needs Lightroom Classic 14.0 or later: catalog:deleteAllEmptyMasks not found in this Lightroom Classic 13.1";
    plugin.handlers.set("delete_empty_masks", () => ({ ok: false, error: { code: "feature_unavailable", message, recoverable: true } }));
    const out = await tools.call(deleteEmptyMasks, { uuids: [lr.uuid] });
    expect(out.json["failed"]).toEqual([expect.objectContaining({ uuid: lr.uuid, code: "FEATURE_UNAVAILABLE" })]);
  });

  it("is destructive and takes 1-100 distinct uuids", () => {
    const def = DEVELOP_DEFS.find((d) => d.name === "lr_delete_empty_masks");
    expect(def?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(def?.schema.safeParse({ uuids: ["A"] }).success).toBe(true);
    for (const bad of [{ uuids: [] }, { uuids: ["A", "A"] }, {}]) expect(def?.schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
