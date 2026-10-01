// `npm run package` (PHASE6_PLAN row 1): the two GitHub Release assets (decision 1), in release\
// (gitignored):
//   - lrc-avg-<version>.tgz: `npm pack` of engine\, kept only when its file list is exactly what
//     package-check.ts expects (the root script empties engine\dist and builds first, so no stale
//     module can ride along);
//   - LrC-AVG.lrplugin-<plugin version>.zip: the plugin folder plus the repo's LICENSE, written by
//     Windows' own tar.exe (bsdtar; `-a` picks the format from the .zip suffix [handle: the
//     zip_check below and docs\reports\phase6\package-smoke\smoke.txt]). Git Bash's `tar` comes
//     first on its PATH and is GNU tar 1.35 [handle: `tar --version` in Git Bash, 2026-10-01], which
//     has no zip format [inference], so the path is given in full. No Python (rule 01).
// Both assets are built from the working tree: package a clean checkout for a release.
// Prints each file's size and SHA-256, for the release notes.

import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PLUGIN_VERSION } from "../bridge/version.js";
import { expectedPackFiles, packProblems } from "./package-check.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const engineDir = path.join(repoRoot, "engine");
const pluginParent = path.join(repoRoot, "plugin");
const PLUGIN_FOLDER = "LrC-AVG.lrplugin";
const releaseDir = path.join(repoRoot, "release");
const tar = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");

const packSchema = z.array(z.object({ filename: z.string(), files: z.array(z.object({ path: z.string() })) })).length(1);

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

/** Files under `root`\`dir`, relative to `root`, with / separators. */
function filesUnder(root: string, dir: string): string[] {
  return readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .map((p) => `${dir}/${p.replaceAll("\\", "/")}`)
    .filter((p) => statSync(path.join(root, p)).isFile());
}

function assetLine(file: string): string {
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  return `${path.basename(file)}  ${statSync(file).size} bytes  sha256 ${sha}`;
}

mkdirSync(releaseDir, { recursive: true });

// 1. The engine package.
const packed = packSchema.safeParse(JSON.parse(execSync(`npm pack --json --pack-destination "${releaseDir}"`, { cwd: engineDir, encoding: "utf8" })) as unknown);
if (!packed.success) fail(`npm pack --json gave an unexpected result: ${packed.error.issues[0]?.message ?? "invalid"}`);
const pack = packed.data[0] as z.infer<typeof packSchema>[number];
const tgz = path.join(releaseDir, pack.filename);
const engineFiles = ["src", "intents", "schemas"].flatMap((dir) => filesUnder(engineDir, dir));
const problems = packProblems(pack.files.map((f) => f.path), expectedPackFiles(engineFiles));
if (problems.length > 0) {
  rmSync(tgz, { force: true });
  fail(`the engine package's file list is not what package-check.ts expects; ${pack.filename} was deleted:\n  ${problems.join("\n  ")}`);
}
console.log(`engine package: ${pack.files.length} files, list as expected`);

// 2. The plugin zip, then its entry list against the folder's files.
const zip = path.join(releaseDir, `${PLUGIN_FOLDER}-${PLUGIN_VERSION}.zip`);
rmSync(zip, { force: true });
execFileSync(tar, ["-a", "-cf", zip, "-C", pluginParent, PLUGIN_FOLDER, "-C", repoRoot, "LICENSE"]);
const entries = execFileSync(tar, ["-tf", zip], { encoding: "utf8" }).split(/\r?\n/).filter((e) => e !== "" && !e.endsWith("/"));
const zipProblems = packProblems(entries, [...filesUnder(pluginParent, PLUGIN_FOLDER), "LICENSE"]);
if (zipProblems.length > 0) {
  rmSync(zip, { force: true });
  fail(`the plugin zip does not hold the plugin folder; ${path.basename(zip)} was deleted:\n  ${zipProblems.join("\n  ")}`);
}
console.log(`plugin zip: ${entries.length} files, list as expected (zip_check)`);

console.log(`Release assets in ${releaseDir}:`);
console.log(`  ${assetLine(tgz)}`);
console.log(`  ${assetLine(zip)}`);
