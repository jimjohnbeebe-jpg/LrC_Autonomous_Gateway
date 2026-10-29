// lr_get_contact_sheet (issues #111, #112, src/mcp/tools-sheet.ts) against the Lightroom sim: cached
// previews by uuid in the order given, the exact-export fallback, a per-photo error, the budget, the
// session refusal, and the arguments.

import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { CONTEXT_DEFS } from "../src/mcp/defs-context.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { MAX_SHEET_PHOTOS, SHEET_CELL_LONG_EDGE, getContactSheet } from "../src/mcp/tools-sheet.js";
import { PreviewService } from "../src/preview/index.js";
import { client, intent, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

let tools: Tools;
let thumbs = 0;
beforeEach(() => {
  thumbs = 0;
  plugin.handlers.set("thumbnail_preview", async (p) => {
    const dir = path.join(tmp, "previews", `thumb-${++thumbs}`);
    mkdirSync(dir);
    const file = path.join(dir, "thumbnail.jpg");
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toFile(file);
    return { ok: true, payload: { uuid: String(p["photo_uuid"]), path: file, export_ms: 12 } };
  });
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

const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
type Cell = { n: number; uuid: string; source: string; stale_possible: boolean; fast_fallback?: string; metrics: Record<string, unknown> };
const sheet = (uuids: string[], quality?: "fast" | "exact") => tools.call(getContactSheet, { uuids, ...(quality ? { quality } : {}) });

describe("lr_get_contact_sheet", () => {
  it("shows cached previews by uuid in the order given, numbered 1..n, and leaves the selection and last render alone", async () => {
    const out = await sheet(["P1", "P2", "P3"]);
    expect(sent("thumbnail_preview")).toEqual(["P1", "P2", "P3"].map((u) => ({ long_edge: SHEET_CELL_LONG_EDGE, photo_uuid: u })));
    expect(sent("export_preview")).toEqual([]);
    const cells = out.json["cells"] as Cell[];
    expect(cells.map((c) => [c.n, c.uuid, c.source, c.stale_possible])).toEqual([[1, "P1", "thumbnail", true], [2, "P2", "thumbnail", true], [3, "P3", "thumbnail", true]]);
    expect(typeof cells[0]?.metrics["sharpness"]).toBe("number");
    expect(cells[0]?.metrics).not.toHaveProperty("regions");
    expect(out.json).toMatchObject({ sheet: { cols: 2, rows: 2 }, counts: { shown: 3, failed: 0, fast_fallbacks: 0 } });
    expect(String(out.json["stale_note"])).toContain("lr_get_preview without quality");
    const meta = await sharp(out.image!).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2000);
    expect(tools.lastRender()).toBeNull();
    expect(plugin.received.some((r) => r.name === "select_photo" || r.name === "apply_settings")).toBe(false);
  });

  it("renders the exact export when Lightroom sends no cached preview, and says so per cell", async () => {
    plugin.handlers.set("thumbnail_preview", () => ({ ok: false, error: { code: "thumbnail_failed", message: "Lightroom sent no thumbnail: error loading thumb", recoverable: true } }));
    const out = await sheet(["SIM-UUID"]);
    expect(sent("export_preview")).toHaveLength(1);
    const cells = out.json["cells"] as Cell[];
    expect(cells[0]).toMatchObject({ n: 1, source: "export", stale_possible: false });
    expect(cells[0]?.fast_fallback).toContain("error loading thumb");
    expect(out.json["counts"]).toEqual({ shown: 1, failed: 0, fast_fallbacks: 1 });
    expect(out.json).not.toHaveProperty("stale_note");
  });

  it('with quality "exact" exports every photo, and leaves a failing photo off the sheet with its number and error', async () => {
    const out = await sheet(["SIM-UUID", "NO-SUCH-PHOTO"], "exact");
    expect(sent("thumbnail_preview")).toEqual([]);
    expect(sent("export_preview").map((p) => p["photo_uuid"])).toEqual(["SIM-UUID", "NO-SUCH-PHOTO"]);
    expect((out.json["cells"] as Cell[]).map((c) => c.n)).toEqual([1]);
    const failed = out.json["failed"] as Array<{ n: number; uuid: string; error: { code: string } }>;
    expect(failed.map((f) => [f.n, f.uuid])).toEqual([[2, "NO-SUCH-PHOTO"]]);
    expect(failed[0]?.error.code).toBeTruthy();
    expect(out.image).toBeInstanceOf(Buffer);
  });

  it("returns no image when every photo fails", async () => {
    const out = await sheet(["NO-SUCH-PHOTO"], "exact");
    expect(out.image).toBeUndefined();
    expect(out.json["counts"]).toEqual({ shown: 0, failed: 1, fast_fallbacks: 0 });
  });

  it("stops starting photos when the budget is spent and returns the rest as not_yet", async () => {
    let t = 0;
    const out = await tools.call((ctx, a: { uuids: string[] }) => getContactSheet(ctx, a, { now: () => (t += 40), ms: 30 }), { uuids: ["P1", "P2", "P3"] });
    expect((out.json["cells"] as Cell[]).length).toBe(1);
    expect(out.json["not_yet"]).toEqual(["P2", "P3"]);
    expect(String(out.json["next"])).toContain("Time is up");
  });

  it("is refused while a session is open", async () => {
    intent("look");
    await tools.beginSession({ intent_id: "look" });
    const err = await sheet(["SIM-UUID"]).then(() => null, toToolError);
    expect(err?.code).toBe("SESSION_ALREADY_ACTIVE");
  });

  it(`takes 1-${MAX_SHEET_PHOTOS} distinct uuids and is read-only`, () => {
    const def = CONTEXT_DEFS.find((d) => d.name === "lr_get_contact_sheet");
    expect(def?.annotations?.readOnlyHint).toBe(true);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(def?.schema.safeParse({ uuids: [] }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: ids(MAX_SHEET_PHOTOS + 1) }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: ["a", "a"] }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: ids(MAX_SHEET_PHOTOS), quality: "exact" }).success).toBe(true);
    expect(def?.schema.safeParse({ uuids: ["a"], quality: "draft" }).success).toBe(false);
  });
});
