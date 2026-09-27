// A simulated Lightroom behind the fake plugin, for the Phase 2 tool tests. It starts from the live
// S5 NEF dump and imitates the plugin's commands (plugin\LrC-AVG.lrplugin\Develop.lua):
//   - the target_uuid check (C-2): a command naming another photo than the selected one is refused;
//   - apply_settings: History name recorded, values taken, the settings read back;
//   - create_snapshot / apply_snapshot: the settings stored and put back;
//   - export_preview: a grey-noise JPEG whose mean level follows Exposure2012, written into the previews
//     folder (one subfolder per request, like the plugin), path returned. With renderModel "tonal"
//     (Phase 3 session tests), a gradient whose ends clip and whose colour responds to the Basic
//     panel and white balance instead (tonalLevel below): a made-up model, only good for testing
//     the engine's rules, not a claim about Lightroom's rendering.
// Keys in `ignored` are dropped silently, as Lightroom drops out-of-range values (PHASE1.md run 3).

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { FakePlugin, FakeReply } from "./fake-plugin.js";

export const nefDump = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../docs/reports/phase0/S5/s5_20260907-_OZ80093.NEF.json", import.meta.url)), "utf8"),
) as { settings: Record<string, unknown> };

/** Lua's Json.lua writes every empty table as []. */
export function luaize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(luaize);
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    return entries.length === 0 ? [] : Object.fromEntries(entries.map(([k, x]) => [k, luaize(x)]));
  }
  return v;
}

/** The grey level the simulated render gives an exposure. */
export function simulatedLevel(exposure: number): number {
  return Math.max(0, Math.min(255, Math.round(118 + 40 * exposure)));
}

/**
 * The "tonal" model's level for a gradient position t (0 at the left edge, 1 at the right): each
 * Basic-panel slider moves its part of the range (whites and highlights the bright end, blacks and
 * shadows the dark end, exposure all, contrast both ends apart). Not clamped.
 */
export function tonalLevel(t: number, s: Record<string, unknown>): number {
  const v = (key: string): number => (typeof s[key] === "number" ? (s[key] as number) : 0);
  return (
    255 * t +
    40 * v("Exposure2012") +
    60 * (v("Whites2012") / 100) * t * t +
    40 * (v("Highlights2012") / 100) * t ** 4 +
    40 * (v("Shadows2012") / 100) * (1 - t) ** 4 +
    60 * (v("Blacks2012") / 100) * (1 - t) ** 2 +
    40 * (v("Contrast2012") / 100) * (t - 0.5)
  );
}

export class LightroomSim {
  readonly uuid = "SIM-UUID";
  /** The uuid of the photo selected in the simulated Lightroom. */
  selected = "SIM-UUID";
  settings: Record<string, unknown> = structuredClone(nefDump.settings);
  readonly history: string[] = [];
  readonly snapshots = new Map<string, Record<string, unknown>>();
  readonly ignored = new Set<string>();
  /** Export at this long edge instead of the requested one (to exercise the resize). */
  exportLongEdge: number | null = null;
  /** Return this path instead of the file written (to exercise the path check). */
  exportPath: string | null = null;
  exports = 0;
  /** "grey": noise around a level set by exposure (Phase 2); "tonal": the gradient of tonalLevel(). */
  renderModel: "grey" | "tonal" = "grey";
  /** Answer export_preview with this error instead (to exercise failures mid-session). */
  exportError: string | null = null;
  /** The selected photo's file name in get_context (the Phase 3 check asks for each fixture by name). */
  filename = "20260907-_OZ80093.NEF";
  /** The photo's pixel size in get_context (getRawMetadata width/height); a made-up 3:2 size. */
  photoSize = { width: 6000, height: 4000 };
  /**
   * getRawMetadata("croppedDimensions") in get_context: the size after a Lightroom crop, the full
   * size when uncropped [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json
   * crop.master_size, crop.size_after_crop]. The export's aspect follows it, as Lightroom's export
   * follows a crop [handle: docs\reports\phase4\S7.md Numbers, item 3]. undefined: the key is
   * absent, as from a plugin loaded before fix/effective-scale-crop, and the export is 3:2.
   */
  croppedSize: { width: number; height: number } | undefined = { width: 6000, height: 4000 };
  readonly previewDir: string;
  /** White balance the tonal model treats as neutral: the dump's own. */
  private readonly neutralTemperature = Number(nefDump.settings["Temperature"]);

  constructor(previewDir: string) {
    this.previewDir = previewDir;
  }

  install(plugin: FakePlugin): void {
    const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
    const guard = (p: Record<string, unknown>): FakeReply | null =>
      p["target_uuid"] !== undefined && p["target_uuid"] !== this.selected
        ? { ok: false, error: { code: "target_mismatch", message: `The selected photo (${this.selected}) is not the target (${String(p["target_uuid"])})`, recoverable: true } }
        : null;
    plugin.handlers.set("hello", () =>
      ok({ protocol: 1, plugin_version: "0.2.0", lrc_version: "15.5.1", sdk_declared: 13, ports: { receive: plugin.commandPort, send: plugin.eventPort } }),
    );
    plugin.handlers.set("get_context", () =>
      ok({
        uuid: this.selected,
        local_id: 1,
        lrc_version: "15.5.1",
        filename: this.filename,
        file_format: "RAW",
        is_virtual_copy: false,
        width: this.photoSize.width,
        height: this.photoSize.height,
        ...(this.croppedSize ? { cropped_dimensions: this.croppedSize } : {}),
        iso: 64,
        shutter: 0.004,
        aperture: 8,
        focal_length: 35,
        lens: "NIKKOR Z 24-120mm f/4 S",
        camera: "NIKON Z 8",
      }),
    );
    plugin.handlers.set("get_settings", (p) => guard(p) ?? ok({ uuid: this.selected, settings: luaize(this.settings) }));
    plugin.handlers.set("apply_settings", (p) => {
      const refused = guard(p);
      if (refused) return refused;
      this.history.push(String(p["history_name"]));
      for (const [k, v] of Object.entries(p["settings"] as Record<string, unknown>)) {
        if (this.ignored.has(k)) continue;
        if (k === "Look" && (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0)) delete this.settings["Look"];
        else this.settings[k] = structuredClone(v);
      }
      return ok({ uuid: this.selected, apply_ms: 25, read_ms: 300, command_ms: 330, read_back: luaize(this.settings) });
    });
    plugin.handlers.set("create_snapshot", (p) => {
      const refused = guard(p);
      if (refused) return refused;
      const id = `SNAP-${this.snapshots.size + 1}`;
      this.snapshots.set(id, structuredClone(this.settings));
      return ok({ uuid: this.selected, snapshot_id: id, id_global: "G", name: p["name"], same_name_count: 1 });
    });
    plugin.handlers.set("apply_snapshot", (p) => {
      const refused = guard(p);
      if (refused) return refused;
      this.settings = structuredClone(this.snapshots.get(String(p["snapshot_id"])) ?? {});
      return ok({ uuid: this.selected, read_back: luaize(this.settings) });
    });
    plugin.handlers.set("export_preview", async (p, id) => {
      const refused = guard(p);
      if (refused) return refused;
      if (this.exportError) return { ok: false, error: { code: "export_failed", message: this.exportError, recoverable: true } };
      this.exports++;
      const long = this.exportLongEdge ?? Number(p["long_edge"]);
      const aspect = this.croppedSize ? this.croppedSize.height / this.croppedSize.width : 2 / 3;
      const short = Math.round(long * aspect);
      const level = simulatedLevel(Number(this.settings["Exposure2012"]));
      const dir = path.join(this.previewDir, id);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "20260907-_OZ80093.jpg");
      if (this.renderModel === "tonal") {
        await this.tonal(long, short).jpeg({ quality: Number(p["quality"]) }).toFile(file);
        return ok({ uuid: this.selected, path: this.exportPath ?? file, export_ms: 12 });
      }
      // Grey noise around the level: its mean follows exposure, and, unlike a flat image, its JPEG
      // size follows the quality, as a photo's does.
      await sharp({
        create: {
          width: long,
          height: short,
          channels: 3,
          background: { r: level, g: level, b: level },
          noise: { type: "gaussian", mean: level, sigma: 12 },
        },
      })
        .jpeg({ quality: Number(p["quality"]) })
        .toFile(file);
      return ok({ uuid: this.selected, path: this.exportPath ?? file, export_ms: 12 });
    });
  }

  /**
   * The tonal model's image: the top half grey, the bottom half orange (hue 30 degrees), both
   * following tonalLevel() left to right; white balance warms (red up, blue down) as Temperature
   * rises above the dump's value.
   */
  private tonal(width: number, height: number): ReturnType<typeof sharp> {
    const data = new Uint8Array(width * height * 3);
    const warm = (Number(this.settings["Temperature"]) - this.neutralTemperature) / 2000;
    // Saturation -100 turns the orange half grey; 0 leaves it as it is.
    const colour = Math.max(0, 1 + Number(this.settings["Saturation"] ?? 0) / 100);
    const clamp = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
    const rows: Array<[number, number, number]> = [];
    for (let x = 0; x < width; x++) {
      const level = tonalLevel(width === 1 ? 0 : x / (width - 1), this.settings);
      rows.push([level, level, level]);
    }
    for (let y = 0; y < height; y++) {
      const orange = y >= height / 2;
      for (let x = 0; x < width; x++) {
        const level = (rows[x] as [number, number, number])[0];
        const g = orange ? level * (1 - 0.3 * colour) : level;
        const b = orange ? level * (1 - 0.6 * colour) : level;
        const i = (y * width + x) * 3;
        data[i] = clamp(level * (1 + 0.3 * warm));
        data[i + 1] = clamp(g);
        data[i + 2] = clamp(b * (1 - 0.3 * warm));
      }
    }
    return sharp(data, { raw: { width, height, channels: 3 } });
  }
}
