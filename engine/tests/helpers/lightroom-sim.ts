// A simulated Lightroom behind the fake plugin, for the Phase 2 tool tests. It starts from the live
// S5 NEF dump and imitates the plugin's commands (plugin\LrC-AVG.lrplugin\Develop.lua):
//   - the target_uuid check (C-2): a command naming another photo than the selected one is refused;
//   - apply_settings: History name recorded, values taken, the settings read back. WhiteBalance changes
//     only when written: Lightroom kept "As Shot" after a Temperature written alone, and took "Custom"
//     written with it [handle: docs\reports\phase4\WB\wb_check_2026-09-28T12-19-08-508Z.json];
//   - create_snapshot / apply_snapshot: the settings stored and put back;
//   - export_preview: a grey-noise JPEG whose mean level follows Exposure2012, written into the previews
//     folder (one subfolder per request, like the plugin), path returned. With renderModel "tonal"
//     (Phase 3 session tests), a gradient whose ends clip and whose colour responds to the Basic
//     panel and white balance instead (tonalLevel below): a made-up model, only good for testing
//     the engine's rules, not a claim about Lightroom's rendering.
// Keys in `ignored` are dropped silently, as Lightroom drops out-of-range values (PHASE1.md run 3).
// The catalog commands (virtual copies, select_photo, get_selection) are in lightroom-sim-catalog.ts,
// get_prefs's answer in lightroom-sim-prefs.ts, the HUD (hud_update) in lightroom-sim-hud.ts;
// each copy has its own settings. A command works on the selected photo, or, with `photo_uuid`
// (plugin 0.4.0), on the photo with that uuid without selecting it, as the plugin does.

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import { createVirtualCopies, describePhoto, findPhoto, getSelection, selectPhoto, type CopyFault, type SimCopy } from "./lightroom-sim-catalog.js";
import { SimHud } from "./lightroom-sim-hud.js";
import { defaultSimPrefs, type SimPrefs } from "./lightroom-sim-prefs.js";
import { PLUGIN_VERSION } from "../../src/bridge/version.js";

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
  /** The uuid of the photo selected in the simulated Lightroom (the active one); "" for none. */
  selected = "SIM-UUID";
  /** Photos selected besides the active one (get_selection). */
  alsoSelected: string[] = [];
  /** The master's settings; a copy's are in `copies`. */
  settings: Record<string, unknown> = structuredClone(nefDump.settings);
  readonly history: string[] = [];
  /** Each History step with the photo it went to. */
  readonly writes: Array<{ uuid: string; name: string }> = [];
  readonly snapshots = new Map<string, Record<string, unknown>>();
  /** The photo each snapshot was taken of. */
  private readonly snapshotOf = new Map<string, string>();
  /** The plugin version hello reports (plugin\LrC-AVG.lrplugin\Bridge.lua PLUGIN_VERSION). */
  pluginVersion = PLUGIN_VERSION;
  /** get_prefs's answer (lightroom-sim-prefs.ts); null: the command is unknown, as to a plugin before 0.5.0. */
  prefs: SimPrefs | null = defaultSimPrefs();
  /** The HUD (plugin 0.6.0, Hud.lua): the hud_update commands taken, and those not (lightroom-sim-hud.ts). */
  readonly hud = new SimHud();
  /** Virtual copies of the master, by uuid (lightroom-sim-catalog.ts). */
  readonly copies = new Map<string, SimCopy>();
  copyFault: CopyFault | null = null;
  /** Answer select_photo with this select_failed message instead. */
  selectFault: string | null = null;
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

  /** A photo's settings: a copy's own, else the master's (also for a photo the sim does not know). */
  settingsOf(uuid: string): Record<string, unknown> {
    return this.copies.get(uuid)?.settings ?? this.settings;
  }

  private setSettingsOf(uuid: string, settings: Record<string, unknown>): void {
    const copy = this.copies.get(uuid);
    if (copy) copy.settings = settings;
    else this.settings = settings;
  }

  /** The plugin's target_uuid check (C-2): a command naming another photo than the selected one is refused. */
  private guard(p: Record<string, unknown>): FakeReply | null {
    return p["target_uuid"] !== undefined && p["target_uuid"] !== this.selected
      ? { ok: false, error: { code: "target_mismatch", message: `The selected photo (${this.selected}) is not the target (${String(p["target_uuid"])})`, recoverable: true } }
      : null;
  }

  /** The photo a command acts on (Develop.lua target()): `photo_uuid`'s, else the selected one, guarded. */
  private who(p: Record<string, unknown>): string | FakeReply {
    if (p["photo_uuid"] !== undefined) return findPhoto(this, p);
    if (this.selected === "") return { ok: false, error: { code: "no_target_photo", message: "No photo is selected in Lightroom", recoverable: true } };
    return this.guard(p) ?? this.selected;
  }

  install(plugin: FakePlugin): void {
    const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
    // Run `fn` on the photo the command names, or answer with the refusal.
    const on = (p: Record<string, unknown>, fn: (uuid: string) => FakeReply | Promise<FakeReply>): FakeReply | Promise<FakeReply> => {
      const u = this.who(p);
      return typeof u === "string" ? fn(u) : u;
    };
    plugin.handlers.set("hello", () =>
      ok({ protocol: 1, plugin_version: this.pluginVersion, lrc_version: "15.5.1", sdk_declared: 13, ports: { receive: plugin.commandPort, send: plugin.eventPort } }),
    );
    plugin.handlers.set("create_virtual_copies", (p) => createVirtualCopies(this, p));
    plugin.handlers.set("select_photo", (p) => selectPhoto(this, p));
    plugin.handlers.set("get_selection", (p) => getSelection(this, p, this.filename));
    plugin.handlers.set("get_prefs", () =>
      this.prefs ? ok(luaize(this.prefs)) : { ok: false, error: { code: "unknown_command", message: "unknown command get_prefs", recoverable: false } },
    );
    plugin.handlers.set("hud_update", (p) => this.hud.update(p));
    plugin.handlers.set("get_context", (p) => on(p, (u) => this.context(u)));
    plugin.handlers.set("get_settings", (p) => on(p, (u) => ok({ uuid: u, settings: luaize(this.settingsOf(u)) })));
    plugin.handlers.set("apply_settings", (p) =>
      on(p, (u) => {
        this.history.push(String(p["history_name"]));
        this.writes.push({ uuid: u, name: String(p["history_name"]) });
        const settings = this.settingsOf(u);
        const written = p["settings"] as Record<string, unknown>;
        for (const [k, v] of Object.entries(written)) {
          if (this.ignored.has(k)) continue;
          if (k === "Look" && (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0)) delete settings["Look"];
          else settings[k] = structuredClone(v);
        }
        return ok({ uuid: u, apply_ms: 25, read_ms: 300, command_ms: 330, read_back: luaize(settings) });
      }),
    );
    plugin.handlers.set("create_snapshot", (p) =>
      on(p, (u) => {
        const id = `SNAP-${this.snapshots.size + 1}`;
        this.snapshots.set(id, structuredClone(this.settingsOf(u)));
        this.snapshotOf.set(id, u);
        return ok({ uuid: u, snapshot_id: id, id_global: "G", name: p["name"], same_name_count: 1 });
      }),
    );
    plugin.handlers.set("apply_snapshot", (p) =>
      on(p, (u) => {
        const id = String(p["snapshot_id"]);
        this.setSettingsOf(this.snapshotOf.get(id) ?? u, structuredClone(this.snapshots.get(id) ?? {}));
        return ok({ uuid: u, read_back: luaize(this.settingsOf(u)) });
      }),
    );
    plugin.handlers.set("export_preview", (p, id) => on(p, (u) => this.exportPreview(u, p, id)));
  }

  /** get_context of a photo (Develop.lua getContext). */
  private context(uuid: string): FakeReply {
    return {
      ok: true,
      payload: {
        uuid,
        local_id: 1,
        lrc_version: "15.5.1",
        filename: this.filename,
        file_format: "RAW",
        is_virtual_copy: false,
        ...describePhoto(this, uuid),
        width: this.photoSize.width,
        height: this.photoSize.height,
        ...(this.croppedSize ? { cropped_dimensions: this.croppedSize } : {}),
        iso: 64,
        shutter: 0.004,
        aperture: 8,
        focal_length: 35,
        lens: "NIKKOR Z 24-120mm f/4 S",
        camera: "NIKON Z 8",
      },
    };
  }

  /** export_preview: a JPEG of photo `uuid` in the previews folder, one subfolder per request. */
  private async exportPreview(uuid: string, p: Record<string, unknown>, id: string): Promise<FakeReply> {
    if (this.exportError) return { ok: false, error: { code: "export_failed", message: this.exportError, recoverable: true } };
    this.exports++;
    const long = this.exportLongEdge ?? Number(p["long_edge"]);
    // The requested edge goes on the longer side: the plugin asks Lightroom for LR_size_resizeType
    // "longEdge" with both maximums at that edge [handle: plugin\LrC-AVG.lrplugin\Preview.lua:66-70],
    // and a wide crop exported at 1600 x 800 for 1600 [handle: docs\reports\phase4\S7.md Numbers,
    // item 3]. A tall crop's export, height at the edge, is [inference: not observed] (Greptile, PR #32).
    const shape = this.croppedSize ?? { width: 3, height: 2 };
    const [width, height] = shape.width >= shape.height ? [long, Math.round((long * shape.height) / shape.width)] : [Math.round((long * shape.width) / shape.height), long];
    const settings = this.settingsOf(uuid);
    const level = simulatedLevel(Number(settings["Exposure2012"]));
    const dir = path.join(this.previewDir, id);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "20260907-_OZ80093.jpg");
    const done: FakeReply = { ok: true, payload: { uuid, path: this.exportPath ?? file, export_ms: 12 } };
    if (this.renderModel === "tonal") {
      await this.tonal(width, height, settings).jpeg({ quality: Number(p["quality"]) }).toFile(file);
      return done;
    }
    // Grey noise around the level: its mean follows exposure, and, unlike a flat image, its JPEG
    // size follows the quality, as a photo's does.
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: level, g: level, b: level },
        noise: { type: "gaussian", mean: level, sigma: 12 },
      },
    })
      .jpeg({ quality: Number(p["quality"]) })
      .toFile(file);
    return done;
  }

  /**
   * The tonal model's image: the top half grey, the bottom half orange (hue 30 degrees), both
   * following tonalLevel() left to right; white balance warms (red up, blue down) as Temperature
   * rises above the dump's value.
   */
  private tonal(width: number, height: number, settings: Record<string, unknown>): ReturnType<typeof sharp> {
    const data = new Uint8Array(width * height * 3);
    const warm = (Number(settings["Temperature"]) - this.neutralTemperature) / 2000;
    // Saturation -100 turns the orange half grey; 0 leaves it as it is.
    const colour = Math.max(0, 1 + Number(settings["Saturation"] ?? 0) / 100);
    const clamp = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
    const rows: Array<[number, number, number]> = [];
    for (let x = 0; x < width; x++) {
      const level = tonalLevel(width === 1 ? 0 : x / (width - 1), settings);
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
