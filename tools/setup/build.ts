// `npm run setup:build` (Phase 9 PR 1, plan D1/D2): the unsigned LrC-AVG setup,
// release\LrC-AVG-Setup-<version>.exe, and release\SHA256SUMS.txt.
//   1. the engine is built from clean (engine\dist), as `npm run package` does;
//   2. pinned Node, engine (npm pack + lockfile production packages), plugin -> build\setup\resources\;
//   3. THIRD_PARTY_NOTICES.txt and LICENSE.txt beside them;
//   4. the Deck's UI, then `tauri build` with hud\src-tauri\tauri.setup.conf.json merged (resources and
//      the hooks in hud\src-tauri\windows\hooks.nsh), plus a version overlay for --version;
//   5. Tauri's NSIS output moved to release\, older LrC-AVG-Setup-* files removed first. Moved, not
//      copied: the Deck-only build writes the same file name into the bundle folder, and the dev probes
//      and the clean room's restore install the Deck from there (hud\probe\kit.ts installer(),
//      engine\src\devtools\clients-deck.ts deckInstaller()).
// Usage: node tools/setup/build.ts [--version 0.99.0]   (a test build under another version number)
// Needs: npm ci done, Rust (rustup MSVC) as for `npm run deck:build`.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { writeNotices } from "./notices.ts";
import { fetchPinned, REPO, SETUP, sha256, stageResources } from "./stage.ts";

const { values } = parseArgs({ options: { version: { type: "string" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("node tools/setup/build.ts [--version <x.y.z>]: builds release\\LrC-AVG-Setup-<version>.exe (unsigned).");
  process.exit(0);
}

const versionOf = (file: string): string => z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(REPO, file), "utf8"))).version;
const HUD = path.join(REPO, "hud");
const TAURI_DIR = path.join(HUD, "src-tauri");

/** Engine, Deck and plugin carry one version (plan D10); the setup takes it unless --version is given. */
function productVersion(): string {
  const engine = versionOf(path.join("engine", "package.json"));
  const deck = versionOf(path.join("hud", "src-tauri", "tauri.conf.json"));
  const hud = versionOf(path.join("hud", "package.json"));
  const crate = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(TAURI_DIR, "Cargo.toml"), "utf8"))?.[1] ?? "(not found)";
  const info = readFileSync(path.join(REPO, "plugin", "LrC-AVG.lrplugin", "Info.lua"), "utf8");
  const m = /VERSION\s*=\s*\{\s*major\s*=\s*(\d+),\s*minor\s*=\s*(\d+),\s*revision\s*=\s*(\d+)/.exec(info);
  const plugin = m ? `${m[1]}.${m[2]}.${m[3]}` : "(not found)";
  if ([deck, hud, crate, plugin].some((v) => v !== engine)) throw new Error(`versions differ: engine ${engine}, Deck ${deck} (hud package.json ${hud}, Cargo.toml ${crate}), plugin ${plugin}`);
  return engine;
}

function run(command: string, cwd = REPO): void {
  console.log(`> ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

/** Runs the Tauri CLI from the repo's node_modules, in hud\src-tauri, with the setup overlay(s). */
function tauriBuild(version: string | undefined): void {
  const configs = ["--config", "tauri.setup.conf.json"];
  if (version) {
    const overlay = path.join(SETUP, "version.conf.json");
    writeFileSync(overlay, JSON.stringify({ version }));
    configs.push("--config", overlay);
  }
  const cli = path.join(REPO, "node_modules", "@tauri-apps", "cli", "tauri.js");
  console.log(`> tauri build --bundles nsis ${configs.join(" ")}`);
  execFileSync(process.execPath, [cli, "build", "--bundles", "nsis", ...configs], { cwd: TAURI_DIR, stdio: "inherit" });
}

/** Tauri's installer for `version`: <productName>_<version>_x64-setup.exe (hud\probe\kit.ts installer()). */
function nsisOutput(version: string): string {
  const dir = path.join(TAURI_DIR, "target", "release", "bundle", "nsis");
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f === `LrC-AVG_${version}_x64-setup.exe`) : undefined;
  if (!file) throw new Error(`no LrC-AVG_${version}_x64-setup.exe in ${dir}`);
  return path.join(dir, file);
}

async function main(): Promise<void> {
  const product = productVersion();
  const version = values.version ?? product;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`--version ${version} is not x.y.z`);
  run("npm run clean -w engine");
  run("npm run build");
  const pinned = await fetchPinned();
  const packages = stageResources(pinned.files.get("node.exe") ?? "");
  writeNotices(version, pinned.nodeVersion, packages, pinned.files);
  run("node build-ui.ts", HUD);
  tauriBuild(values.version);

  const release = path.join(REPO, "release");
  mkdirSync(release, { recursive: true });
  for (const f of readdirSync(release)) if (f.startsWith("LrC-AVG-Setup-") || f === "SHA256SUMS.txt") rmSync(path.join(release, f));
  const name = `LrC-AVG-Setup-${version}.exe`;
  const out = path.join(release, name);
  renameSync(nsisOutput(version), out); // one volume: both are in the repo
  writeFileSync(path.join(release, "SHA256SUMS.txt"), `${sha256(out)}  ${name}\n`); // sha256sum's format
  console.log(`\nBUILT: ${out} (unsigned)\n${readFileSync(path.join(release, "SHA256SUMS.txt"), "utf8")}`);
}

main().catch((err: unknown) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
