// The clients check's Deck (issue #155 R6, T2 "the Deck shows client · model"): the Deck from
// `npm run deck:build` (the root `clients:check` script builds it first), installed with its per-user
// NSIS installer run silently, and the installed executable's version read back. Ported from
// hud\probe\kit.ts installer()/install()/stopDeck() (devtools cannot import hud\probe). The Deck stays
// installed afterwards, as after the Phase 7 check: it is the Deck Jim uses [inference: Deck 0.3.6
// replaces 0.3.5 on his machine].

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginVersionAtLeast } from "../bridge/index.js";
import { AI_NAME_DECK, findHudExe } from "../hud/index.js";
import { HUD_EXE_NAME } from "../hud/launch.js";
import { describeError } from "./phase1-check.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type DeckInstall = { installer: string | null; exe: string | null; version: string | null; ok: boolean; error: string | null };

/**
 * Above this size an installer in the bundle folder is the full LrC-AVG setup (bundled Node, about 32 MB),
 * not the Deck-only build (about 1.4 MB) [handle: `ls -l hud\src-tauri\target\release\bundle\nsis`, 2026-10-17:
 * LrC-AVG_1.0.0_x64-setup.exe 32,761,698 bytes, LrC-AVG HUD_0.3.6_x64-setup.exe 1,423,736 bytes]. Both builds
 * share one file name, and the full one runs hooks (Modules plugin, Claude Desktop entry).
 * ponytail: a size cut, not a marker; switch to a marker file if the Deck-only build ever nears it.
 */
export const DECK_ONLY_MAX_BYTES = 10_000_000;

/** The Deck-only installer `npm run deck:build` made for hud\package.json's version (older ones stay in the folder; kit.ts installer()), never the full setup. */
export function deckInstaller(repo: string = REPO): string | null {
  const dir = path.join(repo, "hud", "src-tauri", "target", "release", "bundle", "nsis");
  const version = (JSON.parse(readFileSync(path.join(repo, "hud", "package.json"), "utf8")) as { version: string }).version;
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(`_${version}_x64-setup.exe`) && statSync(path.join(dir, f)).size < DECK_ONLY_MAX_BYTES) : undefined;
  return file ? path.join(dir, file) : null;
}

/** The Deck's version is AI_NAME_DECK or later (ProductVersion may carry a fourth part [unverified]). */
export function deckVersionOk(version: string | null): boolean {
  return version !== null && pluginVersionAtLeast(version.split(".").slice(0, 3).join("."), AI_NAME_DECK);
}

/** A product install (its resources\ folder): a Deck-only install over it would replace its hook-carrying uninstall.exe [inference: same identifier and folder]. */
export function productInstalled(localAppData: string | undefined = process.env["LOCALAPPDATA"]): boolean {
  return localAppData !== undefined && existsSync(path.join(localAppData, "LrC-AVG", "resources"));
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

/** Installs the built Deck (NSIS `/S`, kit.ts install()) and reads its version; ok when that version is AI_NAME_DECK or later (the Deck that shows the AI's name and model). */
export function installDeck(): DeckInstall {
  if (productInstalled()) return { installer: null, exe: null, version: null, ok: false, error: "the LrC-AVG product is installed: uninstall it first (Settings > Apps > Installed apps > LrC-AVG)" };
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
  const ok = deckVersionOk(version);
  return { installer, exe, version, ok, error: ok ? null : `the installed Deck is ${String(version)}, not ${AI_NAME_DECK} or later` };
}
