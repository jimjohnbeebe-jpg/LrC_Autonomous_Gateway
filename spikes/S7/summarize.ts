// AVG-S7: collect what plugin/spikes/S7.lrplugin saved in %TEMP%\LrC-AVG\S7\ into
// docs\reports\phase4\S7\ and summarise it, so every number in docs\reports\phase4\S7.md comes from
// one command. Claude Code runs it after Jim says "S7 done"; Jim runs nothing here.
//
// Run (PowerShell, from the repo root):
//   node spikes\S7\summarize.ts [srcDir] [destDir]
//     srcDir  default: $env:TEMP\LrC-AVG\S7   (LrPathUtils "temp" is %TEMP% [handle: LR_SDK_NOTES "Recorded in Phase 1"])
//     destDir default: docs\reports\phase4\S7
//
// - Reads the newest s7_run_*.json, s7_before_*.json and s7_after_*.json (written by S7Run.lua and
//   S7Observe.lua), and, when there is one, the preset-file re-run: the newest s7_xmp_run_*.json
//   (S7XmpRun.lua) with its s7_xmp_before_*.json / s7_xmp_after_*.json.
// - Measures the two exported JPEGs with sharp. They are NOT copied: they are renders of Jim's photo
//   and the repo is public.
// - Copies the JSON files, s7_log.txt and s7_state.txt with the user folder written as %USERPROFILE%.
// - Writes s7_summary.json to destDir and prints it.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "LrC-AVG", "S7"));
const destDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "docs", "reports", "phase4", "S7"));

const Export = z.looseObject({ path: z.string().optional(), error: z.string().optional() });
const Size = z.looseObject({ width: z.unknown().optional(), height: z.unknown().optional(), croppedDimensions: z.unknown().optional(), isCropped: z.unknown().optional() });
const Run = z.looseObject({
  run_at: z.string(),
  crop: z.looseObject({
    worked: z.boolean().optional(),
    error: z.string().optional(),
    crop_written: z.record(z.string(), z.number()).optional(),
    crop_read_back: z.record(z.string(), z.unknown()).optional(),
    master_size: Size.optional(),
    size_before_crop: Size.optional(),
    size_after_crop: Size.optional(),
    size_after_export: Size.optional(),
    export: Export.optional(),
  }),
  unselected: z.looseObject({ worked: z.boolean().optional(), error: z.string().optional(), export: Export.optional() }),
  removal_probe: z.looseObject({ found: z.number() }),
  presets: z.looseObject({
    plugin: z.looseObject({ how: z.string().optional(), error: z.string().optional(), preset: z.looseObject({ parent: z.unknown().optional(), file: z.unknown().optional() }).optional() }),
    xmp: z.looseObject({ path: z.string().optional(), error: z.string().optional() }),
    plugin_apply: z.looseObject({ matches: z.boolean().optional() }).optional(),
  }),
});
const XmpRun = z.looseObject({
  run_at: z.string(),
  presets: z.looseObject({
    xmp: z.looseObject({
      path: z.string().optional(),
      error: z.string().optional(),
      uuid: z.string().optional(),
      reference_uuid: z.unknown().optional(),
      reference_file_uuid: z.string().optional(),
      sdk_uuid_is_file_uuid: z.boolean().optional(),
      uuid_replacements: z.number().optional(),
      name_replacements: z.number().optional(),
    }),
    xmp_listed_as: z.union([z.string(), z.literal(false)]).optional(),
  }),
});
const Jim = z.looseObject({ answered: z.boolean(), saw_reference: z.boolean().optional(), saw_plugin: z.boolean().optional(), saw_xmp: z.boolean().optional() });
const Observe = z.looseObject({
  state: z.looseObject({ run_at: z.string().optional() }),
  jim: Jim,
  found: z.record(z.string(), z.unknown()),
  apply: z.unknown().optional(),
  cleanup: z.unknown().optional(),
  xmp_vs_reference: z.unknown().optional(),
  file_on_disk: z.unknown().optional(),
});
type Crop = z.infer<typeof Run>["crop"];

const newest = (prefix: string): string | null => readdirSync(srcDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().at(-1) ?? null;
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(srcDir, file), "utf8"));
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const round = (v: number): number => Math.round(v * 10000) / 10000;

// The export path as the plugin recorded it, or the same file under srcDir when the folder moved.
function locate(recorded: string | undefined): string | null {
  if (!recorded) return null;
  if (existsSync(recorded)) return recorded;
  const tail = recorded.split(/[\\/]LrC-AVG[\\/]S7[\\/]/)[1];
  const local = tail ? path.join(srcDir, ...tail.split(/[\\/]/)) : null;
  return local && existsSync(local) ? local : null;
}

async function jpegSize(recorded: string | undefined): Promise<{ width: number; height: number } | null> {
  const file = locate(recorded);
  if (!file) return null;
  const meta = await sharp(file).metadata();
  return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
}

// Reasons the crop comparison cannot be read at face value (Greptile, PR #29): the crop fractions
// are taken as fractions of the recorded width x height, which holds for an unrotated photo with no
// angle [inference]. S7Photos.lua writes CropAngle 0 and reads orientation back; the fixture read "AB"
// in S5 [handle: engine\src\params\sdk-keys.lrc15.json "orientation"].
function cropCaveats(crop: Crop, W: number, H: number, exp: { width: number; height: number }): string[] {
  const back = crop.crop_read_back ?? {};
  const reasons: string[] = [];
  if (back["orientation"] !== "AB") reasons.push(`orientation read back ${JSON.stringify(back["orientation"] ?? null)}, not "AB"`);
  if (back["CropAngle"] !== 0) reasons.push(`CropAngle read back ${JSON.stringify(back["CropAngle"] ?? null)}, not 0`);
  if (crop.size_before_crop?.isCropped === true) reasons.push("the copy was already cropped before the harness's crop");
  if (W >= H !== exp.width >= exp.height) reasons.push("the export is portrait where width x height is landscape, or the reverse");
  return reasons;
}

// Item 3: does the export follow the crop, do width/height or croppedDimensions, and what scale
// would the engine report (export long edge / max(width, height), engine\src\mcp\tools-context.ts)?
async function cropFindings(crop: Crop) {
  const W = num(crop.master_size?.width), H = num(crop.master_size?.height);
  const c = crop.crop_written;
  const exp = await jpegSize(crop.export?.path);
  if (W === null || H === null || !c || !exp) return { complete: false, master: { W, H }, export: exp };
  const cw = W * ((c["CropRight"] ?? 1) - (c["CropLeft"] ?? 0)), ch = H * ((c["CropBottom"] ?? 1) - (c["CropTop"] ?? 0));
  const exportLong = Math.max(exp.width, exp.height);
  const after = crop.size_after_crop;
  const metaW = num(after?.width), metaH = num(after?.height);
  const cd = after?.croppedDimensions as { width?: unknown; height?: unknown } | undefined;
  const cdW = num(cd?.width), cdH = num(cd?.height);
  const close = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) <= 1;
  const caveats = cropCaveats(crop, W, H, exp);
  return {
    complete: true,
    conclusive: caveats.length === 0,
    inconclusive_reasons: caveats,
    master: { width: W, height: H },
    expected_cropped: { width: round(cw), height: round(ch), aspect: round(cw / ch) },
    export: { ...exp, aspect: round(exp.width / exp.height) },
    export_follows_crop: Math.abs(exp.width / exp.height - cw / ch) / (cw / ch) < 0.01,
    width_height_after_crop: { width: metaW, height: metaH, follow_crop: close(metaW, cw) && close(metaH, ch), equal_full_size: metaW === W && metaH === H },
    cropped_dimensions_after_crop: { width: cdW, height: cdH, follow_crop: close(cdW, cw) && close(cdH, ch) },
    is_cropped_after_crop: after?.isCropped ?? null,
    scale: {
      true_per_cropped_pixel: round(exportLong / Math.max(cw, ch)),
      engine_from_width_height: metaW !== null && metaH !== null ? round(exportLong / Math.max(metaW, metaH)) : null,
      from_cropped_dimensions: cdW !== null && cdH !== null ? round(exportLong / Math.max(cdW, cdH)) : null,
    },
  };
}

// The newest observation file of this run (its state.run_at equals the run's run_at). Files from
// other runs are counted and left out, so answers from two runs are never merged (Greptile, PR #29).
function observed(prefix: string, runAt: string) {
  const files = readdirSync(srcDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  const mine = files.map((f) => ({ f, o: Observe.parse(readJson(f)) })).filter((x) => x.o.state.run_at === runAt);
  const last = mine.at(-1);
  const ignored = files.length - mine.length;
  if (!last) return { file: null, note: "INCOMPLETE: no observation for this run", other_runs_ignored: ignored };
  const o = last.o;
  const rerun = o.xmp_vs_reference !== undefined || o.file_on_disk !== undefined
    ? { xmp_vs_reference: o.xmp_vs_reference ?? null, file_on_disk: o.file_on_disk ?? null } : {};
  return { file: last.f, other_runs_ignored: ignored, jim: o.jim, lightroom: o.found, apply: o.apply ?? null, cleanup: o.cleanup ?? null, ...rerun };
}

// The preset-file re-run (menu items 4-6), or null when there is none: the newest s7_xmp_run_*.json
// and the observations paired with it by run_at, as for run 1.
function xmpRerun() {
  const file = newest("s7_xmp_run_");
  if (!file) return null;
  const r = XmpRun.parse(readJson(file));
  const x = r.presets.xmp;
  return {
    source: { run: file, run_at: r.run_at },
    written: x.path !== undefined,
    error: x.error ?? null,
    path: x.path ?? null,
    uuid: { sdk_reference: x.reference_uuid ?? null, file_reference: x.reference_file_uuid ?? null, sdk_is_file: x.sdk_uuid_is_file_uuid ?? null, written: x.uuid ?? null },
    replacements: { uuid: x.uuid_replacements ?? null, name: x.name_replacements ?? null },
    listed_right_after_writing: r.presets.xmp_listed_as ?? false,
    before_restart: observed("s7_xmp_before_", r.run_at),
    after_restart: observed("s7_xmp_after_", r.run_at),
  };
}

// The user folder, as written raw, JSON-escaped, and with forward slashes, becomes %USERPROFILE%.
function redact(text: string): string {
  const home = os.homedir();
  const forms = [home, home.replaceAll("\\", "\\\\"), home.replaceAll("\\", "/")];
  let out = text;
  for (const form of forms) out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "%USERPROFILE%");
  return out;
}

function copyRedacted(): string[] {
  mkdirSync(destDir, { recursive: true });
  const copied: string[] = [];
  for (const f of readdirSync(srcDir)) {
    if (!/^s7_.*\.(json|txt)$/.test(f)) continue;
    const text = redact(readFileSync(path.join(srcDir, f), "utf8"));
    if (f.endsWith(".json")) JSON.parse(text); // still valid JSON after redaction
    if (text.toLowerCase().includes(os.homedir().toLowerCase())) throw new Error(`${f}: user folder still present after redaction`);
    writeFileSync(path.join(destDir, f), text);
    copied.push(f);
  }
  return copied;
}

async function main(): Promise<void> {
  const runFile = newest("s7_run_");
  if (!runFile) throw new Error(`no s7_run_*.json in ${srcDir}`);
  const run = Run.parse(readJson(runFile));
  const p = run.presets;
  const before = observed("s7_before_", run.run_at);
  const after = observed("s7_after_", run.run_at);
  const summary = {
    source: { run: runFile, run_at: run.run_at, before: before.file, after: after.file },
    item1_presets: {
      plugin: { created: p.plugin.preset !== undefined, how: p.plugin.how ?? null, error: p.plugin.error ?? null, group: p.plugin.preset?.parent ?? null, has_file: typeof p.plugin.preset?.file === "string" },
      plugin_applied_matches: p.plugin_apply?.matches ?? null,
      xmp: { written: p.xmp.path !== undefined, error: p.xmp.error ?? null },
      before_restart: before,
      after_restart: after,
      xmp_rerun: xmpRerun(),
    },
    item2_removal_probe: { undocumented_removal_names_found: run.removal_probe.found },
    item3_crop: { worked: run.crop.worked ?? false, error: run.crop.error ?? null, ...(await cropFindings(run.crop)) },
    item4_unselected: { worked: run.unselected.worked ?? false, error: run.unselected.error ?? null, export: await jpegSize(run.unselected.export?.path) },
  };
  const copied = copyRedacted();
  const text = redact(JSON.stringify({ ...summary, copied }, null, 2));
  writeFileSync(path.join(destDir, "s7_summary.json"), text + "\n");
  console.log(text);
  console.log(`\nWrote ${path.join(destDir, "s7_summary.json")}; copied ${copied.length} files (JPEGs not copied).`);
}

await main();
