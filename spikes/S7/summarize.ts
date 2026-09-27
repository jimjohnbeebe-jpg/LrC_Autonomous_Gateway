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
//   S7Observe.lua).
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
  crop: z.looseObject({
    worked: z.boolean().optional(),
    error: z.string().optional(),
    crop_written: z.record(z.string(), z.number()).optional(),
    master_size: Size.optional(),
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
const Jim = z.looseObject({ answered: z.boolean(), saw_reference: z.boolean().optional(), saw_plugin: z.boolean().optional(), saw_xmp: z.boolean().optional() });
const Observe = z.looseObject({ jim: Jim, found: z.looseObject({ by_name: z.record(z.string(), z.unknown()) }), apply: z.unknown().optional(), cleanup: z.unknown().optional() });

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

// Item 3: does the export follow the crop, do width/height or croppedDimensions, and what scale
// would the engine report (export long edge / max(width, height), engine\src\mcp\tools-context.ts)?
async function cropFindings(crop: z.infer<typeof Run>["crop"]) {
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
  return {
    complete: true,
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

function observeFindings(file: string | null) {
  if (!file) return { file: null };
  const o = Observe.parse(readJson(file));
  return { file, jim: o.jim, lightroom_lists: o.found.by_name, apply: o.apply ?? null, cleanup: o.cleanup ?? null };
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
  const summary = {
    source: { run: runFile, before: newest("s7_before_"), after: newest("s7_after_") },
    item1_presets: {
      plugin: { created: p.plugin.preset !== undefined, how: p.plugin.how ?? null, error: p.plugin.error ?? null, group: p.plugin.preset?.parent ?? null, has_file: typeof p.plugin.preset?.file === "string" },
      plugin_applied_matches: p.plugin_apply?.matches ?? null,
      xmp: { written: p.xmp.path !== undefined, error: p.xmp.error ?? null },
      before_restart: observeFindings(newest("s7_before_")),
      after_restart: observeFindings(newest("s7_after_")),
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
