// What the clean room checks (vault PHASE9_PLAN.md D9.1): after --park, that nothing LrC-AVG is left in
// this Windows account (CLEAN), and after a product uninstall, that every place the setup writes is
// empty again (GONE). Read-only: nothing here changes a file, a key or Lightroom's preferences.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { clientSpecs, findEntry } from "./cleanroom-entries.js";
import { pathsOf, type Paths, type Sys } from "./cleanroom-sys.js";

export type Check = { check: string; ok: boolean; detail: string };

/** What the product keeps in its install folder after an uninstall (the data; SHARED NAMES of PR 1). */
export const KEPT_DATA = ["logs", "intents", "last-start.json", "setup-result.json", "setup-result.txt", "status.txt"];

export const PLUGIN_STEP = 'in Lightroom choose File > Plug-in Manager, select LrC-AVG, click Remove, quit Lightroom, then run "npm run cleanroom -- --status"';

const list = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

function walk(dir: string, depth: number): string[] {
  const out: string[] = [];
  for (const name of list(dir)) {
    const full = path.join(dir, name);
    out.push(full);
    if (depth > 0) out.push(...walk(full, depth - 1));
  }
  return out;
}

const check = (name: string, found: string[], none = "none"): Check => ({ check: name, ok: found.length === 0, detail: found.length === 0 ? none : found.join("; ") });

export function uninstallKeys(sys: Sys): string[] {
  return sys.uninstallKeys().filter((k) => k.displayName.startsWith("LrC-AVG")).map((k) => `${k.key} (${k.displayName})`);
}

export const modulesCopies = (p: Paths): string[] => list(p.modules).filter((n) => /^lrc-avg.*\.lrplugin$/i.test(n)).map((n) => path.join(p.modules, n));

const shortcuts = (p: Paths): string[] => [...walk(p.startMenu, 3), ...walk(p.desktop, 0)].filter((f) => /lrc-avg/i.test(path.basename(f)));

/** A data folder counts as gone when absent; %TEMP%\LrC-AVG may hold the clean room's own results. */
function dataLeft(p: Paths, folders: string[]): string[] {
  return folders.filter((f) => existsSync(f) && !(f === p.tempData && list(f).every((n) => n === "cleanroom")));
}

/**
 * Lightroom's preferences that name the dev plugin. The .agprefs files are Lua-like text holding the
 * Plug-in Manager's plugin paths [unverified: the format is not documented; observed only as text
 * containing "LrC-AVG.lrplugin", grep -c on Jim's "Lightroom Classic CC 7 Preferences.agprefs",
 * 2026-10-17]. Read only: Lightroom's files are never edited.
 */
function prefsNaming(p: Paths): string[] {
  return list(p.prefs)
    .filter((n) => n.toLowerCase().endsWith(".agprefs"))
    .map((n) => path.join(p.prefs, n))
    .filter((f) => {
      try {
        return readFileSync(f, "latin1").toLowerCase().includes("lrc-avg.lrplugin");
      } catch {
        return false;
      }
    });
}

function entryChecks(sys: Sys, only?: string): Check[] {
  return clientSpecs(sys)
    .filter((s) => only === undefined || s.client === only)
    .map((s) => {
      const f = findEntry(s);
      return { check: `${s.client} entry`, ok: !f.present && f.problem === undefined, detail: f.problem ?? (f.present ? `lrc-avg in ${s.file}` : `none in ${s.file}`) };
    });
}

/** CLEAN: nothing LrC-AVG left in the account. */
export function cleanChecks(sys: Sys): Check[] {
  const p = pathsOf(sys);
  const prefs = prefsNaming(p);
  return [
    check("uninstall keys (HKCU)", uninstallKeys(sys)),
    check("old Deck folder", existsSync(p.oldDeck) ? [p.oldDeck] : []),
    check("Lightroom Modules copies", modulesCopies(p)),
    check("Start menu and Desktop shortcuts", shortcuts(p)),
    ...entryChecks(sys),
    check("data folders", dataLeft(p, p.dataFolders)),
    { check: "dev plugin in Lightroom's preferences", ok: prefs.length === 0, detail: prefs.length === 0 ? "none" : `${prefs.join("; ")} names LrC-AVG.lrplugin: ${PLUGIN_STEP}` },
  ];
}

/** GONE: every place the setup writes, after an uninstall; the data folders only with `expectDataGone`. */
export function goneChecks(sys: Sys, expectDataGone: boolean): Check[] {
  const p = pathsOf(sys);
  const files = list(p.install).filter((n) => expectDataGone || !KEPT_DATA.includes(n)).map((n) => path.join(p.install, n));
  return [
    check(expectDataGone ? "install folder (all of it)" : "install folder (except the kept data)", files),
    check("uninstall keys (HKCU)", uninstallKeys(sys)),
    check("Start menu and Desktop shortcuts", shortcuts(p)),
    check("Lightroom Modules copies", modulesCopies(p)),
    ...entryChecks(sys, "claude-desktop"),
    ...(expectDataGone ? [check("data folders", dataLeft(p, p.dataFolders))] : []),
  ];
}

/** Anything installed: a product or Deck install (uninstall key, program files) or a Modules copy. */
export function installsPresent(sys: Sys): string[] {
  const p = pathsOf(sys);
  const program = ["resources", "uninstall.exe"].map((n) => path.join(p.install, n)).filter((f) => existsSync(f));
  return [...uninstallKeys(sys), ...program, ...modulesCopies(p)];
}

/** The product proper (not a Deck-only dev build): its bundled resources or its Modules plugin. */
export function productPresent(sys: Sys): string[] {
  const p = pathsOf(sys);
  const resources = path.join(p.install, "resources");
  return [...(existsSync(resources) ? [resources] : []), ...modulesCopies(p)];
}
