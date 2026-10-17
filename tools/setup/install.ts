// `npm run setup:install` (Phase 9 PR 1; issue #54 comment, the `deck:install` slice): installs
// release\LrC-AVG-Setup-<engine version>.exe silently (NSIS /S), then prints INSTALLED: YES/NO with the
// installed Deck's version. Only inside the clean room: it refuses unless `npm run cleanroom -- --park`
// has parked Jim's development setup (%TEMP%\LrC-AVG-cleanroom\park.json, plan D9).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const park = path.join(tmpdir(), "LrC-AVG-cleanroom", "park.json");
if (!existsSync(park)) {
  console.log(`INSTALLED: NO\nRefused: ${park} is missing. Run npm run cleanroom -- --park first, so the setup does not mix with the development setup.`);
  process.exit(1);
}

const version = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(REPO, "engine", "package.json"), "utf8"))).version;
const setup = path.join(REPO, "release", `LrC-AVG-Setup-${version}.exe`);
if (!existsSync(setup)) {
  console.log(`INSTALLED: NO\n${setup} is missing. Run npm run setup:build first.`);
  process.exit(1);
}

console.log(`Installing ${path.basename(setup)} silently ...`);
execFileSync(setup, ["/S"], { stdio: "inherit", timeout: 300_000 });

// Tauri writes the app version into the exe's version resource [unverified until the first build; this line checks it].
const exe = path.join(process.env["LOCALAPPDATA"] ?? "", "LrC-AVG", "LrC-AVG Deck.exe");
const installed = existsSync(exe)
  ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath $env:LRC_AVG_EXE).VersionInfo.ProductVersion"], {
      encoding: "utf8",
      env: { ...process.env, LRC_AVG_EXE: exe },
    }).trim()
  : null;
const ok = installed !== null && installed.startsWith(version);
console.log(`INSTALLED: ${ok ? "YES" : "NO"}  ${exe}: ${installed === null ? "missing" : `version ${installed}`} (expected ${version})`);
process.exit(ok ? 0 : 1);
