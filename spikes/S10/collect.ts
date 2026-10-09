// AVG-S10: collect what `npm run s10:check` and plugin\spikes\S10.lrplugin saved in
// %TEMP%\LrC-AVG\S10\ into docs\reports\phase8\S10\ and summarise it, so every number in
// docs\reports\phase8\S10.md comes from one command. Claude Code runs it after Jim says "S10 done";
// Jim runs nothing here.
//
// Run (PowerShell, from the repo root):
//   node spikes\S10\collect.ts [srcDir] [destDir]
//     srcDir  default: $env:TEMP\LrC-AVG\S10   (LrPathUtils "temp" is %TEMP% [handle: LR_SDK_NOTES "Recorded in Phase 1"])
//     destDir default: docs\reports\phase8\S10
//
// - Copies every .json and .txt under srcDir (census\ and run1\ included) with the user folder
//   written as %USERPROFILE%.
// - Reads the newest s10_check_*.json and writes its summary, the census per photo and the recorded
//   pairs to s10_summary.json in destDir, and prints it.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "LrC-AVG", "S10"));
const destDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "docs", "reports", "phase8", "S10"));
const home = os.homedir();
const redact = (text: string): string => text.split(home).join("%USERPROFILE%").split(home.replace(/\\/g, "\\\\")).join("%USERPROFILE%").split(home.replace(/\\/g, "/")).join("%USERPROFILE%");

const Check = z.looseObject({
  check: z.literal("s10"),
  started_at: z.string(),
  finished_at: z.string().optional(),
  census_only: z.boolean().optional(),
  errors: z.array(z.string()),
  summary: z.looseObject({ suggestion: z.string() }).optional(),
  census: z.looseObject({ pipelines: z.record(z.string(), z.number()).optional(), photos: z.array(z.looseObject({ filename: z.string(), copy_name: z.string().nullable(), file_format: z.string().nullable(), pipeline: z.string(), process_version: z.string().nullable(), key_count: z.number(), extra_keys: z.array(z.string()), missing_pinned_keys: z.array(z.string()) })).optional() }).optional(),
  recorder: z.looseObject({ file: z.string().nullable(), pairs: z.array(z.looseObject({ name: z.string(), camera_profile: z.string(), look_uuid: z.string().nullable(), recorded_on: z.string() })), problems: z.array(z.string()) }).optional(),
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(json|txt)$/.test(name) ? [full] : [];
  });
}

const files = walk(srcDir);
for (const file of files) {
  const dest = path.join(destDir, path.relative(srcDir, file));
  mkdirSync(path.dirname(dest), { recursive: true });
  if (file.endsWith(".json") || file.endsWith(".txt")) writeFileSync(dest, redact(readFileSync(file, "utf8")));
  else copyFileSync(file, dest);
}
console.log(`copied ${files.length} files from ${redact(srcDir)} to ${redact(destDir)}`);

const checks = files.filter((f) => /s10_check_.*\.json$/.test(path.basename(f))).sort();
const newest = checks[checks.length - 1];
if (!newest) {
  console.log("no s10_check_*.json found: run `npm run s10:check` first");
  process.exit(1);
}
const check = Check.parse(JSON.parse(readFileSync(newest, "utf8")));
const summary = {
  from: path.basename(newest),
  runs: checks.map((f) => path.basename(f)),
  started_at: check.started_at,
  finished_at: check.finished_at ?? null,
  census_only: check.census_only ?? false,
  suggestion: check.summary?.suggestion ?? null,
  errors: check.errors,
  pipelines: check.census?.pipelines ?? null,
  photos: check.census?.photos?.map((p) => ({ photo: p.copy_name ? `${p.filename} (${p.copy_name})` : p.filename, file_format: p.file_format, pipeline: p.pipeline, process_version: p.process_version, key_count: p.key_count, extra_keys: p.extra_keys, missing_pinned_keys: p.missing_pinned_keys })) ?? [],
  recorded_pairs: check.recorder?.pairs ?? [],
  recorder_problems: check.recorder?.problems ?? [],
  summary: check.summary ?? null,
};
writeFileSync(path.join(destDir, "s10_summary.json"), `${redact(JSON.stringify(summary, null, 2))}\n`);
console.log(redact(JSON.stringify(summary, null, 2)));
