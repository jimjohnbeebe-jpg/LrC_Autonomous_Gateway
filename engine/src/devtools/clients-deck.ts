// The clients check's Deck (issue #155 R6, T2 "the Deck shows client · model"): the Deck from
// `npm run deck:build` (the root `clients:check` script builds it first), installed with its per-user
// NSIS installer run silently, and the installed executable's version read back. Ported from
// hud\probe\kit.ts installer()/install()/stopDeck() (devtools cannot import hud\probe). The Deck stays
// installed afterwards, as after the Phase 7 check: it is the Deck Jim uses [inference: Deck 0.3.6
// replaces 0.3.5 on his machine].

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_NAME_DECK, findHudExe } from "../hud/index.js";
import { HUD_EXE_NAME } from "../hud/launch.js";
import { describeError } from "./phase1-check.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type DeckInstall = { installer: string | null; exe: string | null; version: string | null; ok: boolean; error: string | null };

/** The installer `npm run deck:build` made for hud\package.json's version (older ones stay in the folder; kit.ts installer()). */
export function deckInstaller(repo: string = REPO): string | null {
  const dir = path.join(repo, "hud", "src-tauri", "target", "release", "bundle", "nsis");
  const version = (JSON.parse(readFileSync(path.join(repo, "hud", "package.json"), "utf8")) as { version: string }).version;
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(`_${version}_x64-setup.exe`)) : undefined;
  return file ? path.join(dir, file) : null;
}

/**
 * The executable's ProductVersion, which Tauri takes from tauri.conf.json `version` [inference: Tauri's
 * Windows resource; the check prints what it read, so a wrong reading shows].
 */
export function exeVersion(exe: string): string | null {
  try {
    const ps = `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 30_000 }).trim() || null;
  } catch {
    return null;
  }
}

/** Ends a running Deck, so the installer can replace its executable (kit.ts stopDeck). */
function stopDeck(): void {
  const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${HUD_EXE_NAME}`, "/NH"], { encoding: "utf8" });
  if (out.toLowerCase().includes(HUD_EXE_NAME.toLowerCase())) execFileSync("taskkill", ["/IM", HUD_EXE_NAME, "/F"], { stdio: "ignore" });
}

/** Installs the built Deck (NSIS `/S`, kit.ts install()) and reads its version; ok when that version is AI_NAME_DECK (the Deck that shows the AI's name and model). */
export function installDeck(): DeckInstall {
  const installer = deckInstaller();
  if (!installer) return { installer: null, exe: null, version: null, ok: false, error: "no Deck installer: npm run deck:build did not run or failed" };
  try {
    stopDeck();
    execFileSync(installer, ["/S"], { stdio: "ignore", timeout: 120_000 });
  } catch (err) {
    return { installer, exe: null, version: null, ok: false, error: `the Deck installer failed: ${describeError(err)}` };
  }
  const exe = findHudExe();
  const version = exe ? exeVersion(exe) : null;
  const ok = version !== null && version.startsWith(AI_NAME_DECK);
  return { installer, exe, version, ok, error: ok ? null : `the installed Deck is ${String(version)}, not ${AI_NAME_DECK}` };
}
