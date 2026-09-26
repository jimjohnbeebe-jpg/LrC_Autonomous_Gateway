// A simulated Lightroom behind the fake plugin, for the Phase 2 tool tests. It starts from the live
// S5 NEF dump and imitates the plugin's commands (plugin\LrC-AVG.lrplugin\Develop.lua):
//   - the target_uuid check (C-2): a command naming another photo than the selected one is refused;
//   - apply_settings: History name recorded, values taken, the settings read back;
//   - create_snapshot / apply_snapshot: the settings stored and put back;
//   - export_preview: a grey-noise JPEG whose mean level follows Exposure2012, written into the previews
//     folder (one subfolder per request, like the plugin), path returned.
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
  readonly previewDir: string;

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
        filename: "20260907-_OZ80093.NEF",
        file_format: "RAW",
        is_virtual_copy: false,
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
      this.exports++;
      const long = this.exportLongEdge ?? Number(p["long_edge"]);
      const level = simulatedLevel(Number(this.settings["Exposure2012"]));
      const dir = path.join(this.previewDir, id);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "20260907-_OZ80093.jpg");
      // Grey noise around the level: its mean follows exposure, and, unlike a flat image, its JPEG
      // size follows the quality, as a photo's does.
      await sharp({
        create: {
          width: long,
          height: Math.round((long * 2) / 3),
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
}
