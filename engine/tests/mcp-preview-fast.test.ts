// lr_get_preview quality "fast" (issue #216, src/mcp/tools-preview-fast.ts): Lightroom's cached preview
// through the plugin's thumbnail_preview, marked stale_possible; the exact export when the plugin sends none.

import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { CONTEXT_DEFS } from "../src/mcp/defs-context.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { client, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

let tools: Tools;
let thumbs = 0;
beforeEach(() => {
  thumbs = 0;
  // A 2048 px thumbnail, larger than asked as Lightroom's may be [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrPhoto.html].
  plugin.handlers.set("thumbnail_preview", async (p) => {
    const dir = path.join(tmp, "previews", `thumb-${++thumbs}`);
    mkdirSync(dir);
    const file = path.join(dir, "thumbnail.jpg");
    await sharp({ create: { width: 2048, height: 1365, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toFile(file);
    return { ok: true, payload: { uuid: String(p["photo_uuid"] ?? "SIM-UUID"), path: file, export_ms: 12 } };
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

describe('lr_get_preview quality "fast"', () => {
  it("returns Lightroom's cached preview of a photo by uuid, sized to long_edge, marked stale_possible, and leaves the last render alone", async () => {
    const out = await tools.getPreview({ quality: "fast", uuid: "SIM-UUID", long_edge: 1200 });
    expect(sent("thumbnail_preview")).toEqual([{ long_edge: 1200, photo_uuid: "SIM-UUID" }]);
    expect(sent("export_preview")).toEqual([]);
    expect(out.json).toMatchObject({ ok: true, source: "thumbnail", preview_source: "thumbnail", stale_possible: true, width: 1200, uuid: "SIM-UUID" });
    expect(String(out.json["stale_note"])).toContain("lr_get_preview without quality");
    expect(out.image).toBeInstanceOf(Buffer);
    expect((out.json["metrics"] as { sharpness: unknown }).sharpness).toBe(0); // a flat colour
    expect(tools.lastRender()).toBeNull();
  });

  it("renders the exact export instead when Lightroom sends no thumbnail, and says why", async () => {
    plugin.handlers.set("thumbnail_preview", () => ({ ok: false, error: { code: "thumbnail_failed", message: "Lightroom sent no thumbnail: error loading thumb", recoverable: true } }));
    const out = await tools.getPreview({ quality: "fast" });
    expect(sent("export_preview")).toHaveLength(1);
    expect(out.json).toMatchObject({ source: "export", stale_possible: false });
    expect(String(out.json["fast_fallback"])).toContain("error loading thumb");
  });

  it("is refused with a session, a target or a region, and the default stays the export", async () => {
    for (const extra of [{ session_id: "x" }, { region: { x: 0, y: 0, w: 0.5, h: 0.5 } }]) {
      const err = await tools.getPreview({ quality: "fast", ...extra }).then(() => null, toToolError);
      expect(err?.code).toBe("INVALID_ARGUMENTS");
    }
    await tools.getPreview({});
    expect(sent("thumbnail_preview")).toEqual([]);
    expect(sent("export_preview")).toHaveLength(1);
  });

  it("offers quality as exact or fast", () => {
    const schema = CONTEXT_DEFS.find((d) => d.name === "lr_get_preview")?.schema;
    expect(schema?.safeParse({ quality: "fast" }).success).toBe(true);
    expect(schema?.safeParse({ quality: "draft" }).success).toBe(false);
  });
});
