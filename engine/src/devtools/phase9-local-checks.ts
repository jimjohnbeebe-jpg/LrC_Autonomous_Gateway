// What the Phase 9 local-install check reads off this PC after an install (phase9-local-steps.ts,
// phase9-local-upgrade.ts): the files, the Lightroom Modules copy, the uninstall key, setup-result.json,
// the Claude Desktop entry, last-start.json and status.txt. Paths are those of cleanroom-sys.ts pathsOf().
// Files and processes are read here; the judgements are pure functions (tests\phase9-local.test.ts).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { lastStartSchema, type LastStart } from "../log/last-start.js";
import { setupResultSchema, type SetupResult } from "../setup/setup-result.js";
import { uninstallKeys } from "./cleanroom-scan.js";
import { pathsOf, type Proc, type Sys } from "./cleanroom-sys.js";
import type { Ctx } from "./phase9-local.js";

export const DECK_EXE = "LrC-AVG Deck.exe";

/** Paths inside the product's install folder. */
export function installPaths(sys: Sys) {
  const p = pathsOf(sys);
  const resources = path.join(p.install, "resources");
  return {
    dir: p.install,
    deck: path.join(p.install, DECK_EXE),
    uninstall: path.join(p.install, "uninstall.exe"),
    resources,
    node: path.join(resources, "node", "node.exe"),
    mainJs: path.join(resources, "engine", "dist", "mcp", "main.js"),
    plugin: path.join(resources, "plugin", "LrC-AVG.lrplugin"),
    modulesPlugin: path.join(p.modules, "LrC-AVG.lrplugin"),
    setupResult: path.join(p.install, "setup-result.json"),
    status: path.join(p.install, "status.txt"),
    staged: path.join(sys.repo, "build", "setup", "resources"),
  };
}

/** Every file under `dir`, relative, with forward slashes, sorted; [] when `dir` is absent. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) (e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : out.push(`${rel}${e.name}`));
  };
  walk(dir, "");
  return out.sort();
}

/** The files only one side has: `missing` are staged but not installed (or the reverse for `extra`). */
export function treeDiff(installed: readonly string[], staged: readonly string[]): { missing: string[]; extra: string[] } {
  const have = new Set(installed.map((f) => f.toLowerCase()));
  const want = new Set(staged.map((f) => f.toLowerCase()));
  return { missing: staged.filter((f) => !have.has(f.toLowerCase())), extra: installed.filter((f) => !want.has(f.toLowerCase())) };
}

const sample = (files: readonly string[]): string => (files.length <= 5 ? files.join(", ") : `${files.slice(0, 5).join(", ")} and ${files.length - 5} more`);

const entrySchema = z.looseObject({ mcpServers: z.record(z.string(), z.looseObject({ command: z.string().optional(), args: z.array(z.string()).optional() })) });

/** Null when Claude Desktop's config starts the bundled engine with the bundled Node; else what is wrong. */
export function entryProblem(config: unknown, nodeExe: string, mainJs: string): string | null {
  const parsed = entrySchema.safeParse(config);
  if (!parsed.success) return "the config has no mcpServers";
  const entry = parsed.data.mcpServers["lrc-avg"];
  if (!entry) return "there is no lrc-avg entry";
  const same = (a: string | undefined, b: string): boolean => (a ?? "").toLowerCase() === b.toLowerCase();
  if (!same(entry.command, nodeExe)) return `command is ${String(entry.command)}, not ${nodeExe}`;
  if (!same(entry.args?.[0], mainJs)) return `args[0] is ${String(entry.args?.[0])}, not ${mainJs}`;
  return null;
}

/** What is wrong with a status.txt written by the plugin's Status dialog (plugin\LrC-AVG.lrplugin\MenuStatus.lua); [] when nothing. */
export function statusProblems(text: string, version: string): string[] {
  const headline = text.split(/\r?\n/)[0] ?? "";
  const problems: string[] = [];
  if (!headline.startsWith("LrC-AVG status:")) problems.push(`the first line is "${headline}", not a status headline`);
  if (/BRIDGE NOT RUNNING/i.test(headline)) problems.push("the bridge is not running");
  if (/RESTART LIGHTROOM/i.test(headline)) problems.push("the Status dialog asks for a Lightroom restart");
  if (!text.includes(`Plugin: ${version},`)) problems.push(`the plugin line does not say version ${version}`);
  if (!text.includes("Modules (installed)")) problems.push("the plugin was not loaded from Lightroom's Modules folder");
  return problems;
}

/** Which of Lightroom, Claude Desktop, the Deck and the product's engine are running (Claude Desktop by path: Claude Code is also named "claude"; plan "Found" 7). */
export function running(procs: readonly Proc[], nodeExe: string): { lightroom: boolean; claudeDesktop: boolean; deck: boolean; engine: boolean } {
  const lower = (s: string | null): string => (s ?? "").toLowerCase();
  return {
    lightroom: procs.some((p) => lower(p.name) === "lightroom"),
    claudeDesktop: procs.some((p) => /\\windowsapps\\claude_|\\anthropicclaude\\/.test(lower(p.path))),
    deck: procs.some((p) => lower(p.name) === "lrc-avg deck"),
    engine: procs.some((p) => lower(p.name) === "node" && lower(p.path) === nodeExe.toLowerCase()),
  };
}

export const sayRunning = (r: ReturnType<typeof running>): string =>
  `Lightroom ${r.lightroom ? "yes" : "NO"}, Claude Desktop ${r.claudeDesktop ? "yes" : "NO"}, the Deck ${r.deck ? "yes" : "NO"}, the engine (bundled node.exe) ${r.engine ? "yes" : "NO"}`;

function readJson<T>(file: string, schema: z.ZodType<T>): T | string {
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")));
  } catch (err) {
    return err instanceof Error ? err.message.split("\n")[0] ?? "unreadable" : "unreadable";
  }
}

/** The newest last-start.json at or after `since`: in the data folder, and in the Microsoft Store Claude Desktop's redirected copy (MenuStatus.lua lastStart(), LR_SDK_NOTES "MSIX"). */
export function newestLastStart(sys: Sys, since: Date): { start: LastStart; file: string } | null {
  const local = sys.env["LOCALAPPDATA"] ?? path.join(sys.home, "AppData", "Local");
  const files = [path.join(local, "LrC-AVG", "last-start.json")];
  try {
    for (const pkg of readdirSync(path.join(local, "Packages")).filter((n) => n.toLowerCase().startsWith("claude_"))) {
      files.push(path.join(local, "Packages", pkg, "LocalCache", "Local", "LrC-AVG", "last-start.json"));
    }
  } catch {
    // no Packages folder
  }
  let best: { start: LastStart; file: string } | null = null;
  for (const file of files.filter((f) => existsSync(f))) {
    const start = readJson(file, lastStartSchema);
    if (typeof start === "string" || Date.parse(start.time) < since.getTime() - 2000) continue;
    if (!best || start.time > best.start.time) best = { start, file };
  }
  return best;
}

/**
 * The checks every install has to pass, after the wizard or a silent install: the Deck's version, the
 * key files, the resources against the staged tree (no stale or missing file), the Modules copy, one
 * uninstall key, setup-result.json from this step, the Claude Desktop entry.
 */
export function installChecks(ctx: Ctx, deckVersion: string, outcomes: readonly string[]): SetupResult | null {
  const ip = installPaths(ctx.sys);
  const version = existsSync(ip.deck) ? ctx.sys.exeVersion(ip.deck) : null;
  ctx.check("the Deck is installed at the expected version", (version ?? "").startsWith(deckVersion), `${ip.deck}: ${version ?? "missing"}, expected ${deckVersion}`);
  const keyFiles = [ip.uninstall, ip.node, ip.mainJs, path.join(ip.resources, "engine", "dist", "setup", "setup-cli.js"), path.join(ip.plugin, "Info.lua"), path.join(ip.resources, "THIRD_PARTY_NOTICES.txt"), path.join(ip.resources, "LICENSE.txt")];
  const absent = keyFiles.filter((f) => !existsSync(f));
  ctx.check("the key files are installed", absent.length === 0, absent.length === 0 ? `${keyFiles.length} found` : `missing: ${absent.map((f) => path.relative(ip.dir, f)).join(", ")}`);
  if (existsSync(ip.staged)) {
    const diff = treeDiff(listFiles(ip.resources), listFiles(ip.staged));
    ctx.check("resources\\ holds exactly the staged files (none missing, none stale)", diff.missing.length + diff.extra.length === 0, `missing ${diff.missing.length}${diff.missing.length ? ` (${sample(diff.missing)})` : ""}; extra ${diff.extra.length}${diff.extra.length ? ` (${sample(diff.extra)})` : ""}`);
  } else {
    ctx.note(`${ip.staged} is not there (npm run setup:build was run in an earlier session), so the file list was not compared.`);
  }
  const infoLua = (dir: string): string | null => (existsSync(path.join(dir, "Info.lua")) ? readFileSync(path.join(dir, "Info.lua"), "utf8") : null);
  const inModules = infoLua(ip.modulesPlugin);
  ctx.check("the plugin is in Lightroom's Modules folder, the same as the installed one", inModules !== null && inModules === infoLua(ip.plugin), inModules === null ? `${ip.modulesPlugin}\\Info.lua is missing` : ip.modulesPlugin);
  const keys = uninstallKeys(ctx.sys);
  ctx.check("exactly one LrC-AVG uninstall key (HKCU)", keys.length === 1, keys.join("; ") || "none");
  return resultChecks(ctx, ip, outcomes);
}

function resultChecks(ctx: Ctx, ip: ReturnType<typeof installPaths>, outcomes: readonly string[]): SetupResult | null {
  const result = readJson(ip.setupResult, setupResultSchema);
  if (typeof result === "string") {
    ctx.check("setup-result.json was written", false, `${ip.setupResult}: ${result}`);
    return null;
  }
  ctx.check("setup-result.json is from this step and says the entry was set up", Date.parse(result.time) >= ctx.since.getTime() - 2000 && result.action === "add" && outcomes.includes(result.outcome), `${result.action} ${result.outcome} at ${result.time}: ${result.message}`);
  ctx.check("setup-result.json carries the product's version", result.version === ctx.version, `${result.version}, expected ${ctx.version}`);
  if (result.config_path === null) {
    ctx.check("Claude Desktop's config names the bundled engine", false, "setup-result.json has no config_path (Claude Desktop not found or not chosen)");
  } else {
    let config: unknown = null;
    try {
      config = JSON.parse(readFileSync(result.config_path, "utf8").replace(/^﻿/, ""));
    } catch {
      // entryProblem reports it
    }
    const problem = entryProblem(config, ip.node, ip.mainJs);
    ctx.check("Claude Desktop's config names the bundled engine", problem === null, problem ?? result.config_path);
  }
  return result;
}

export const mtimeMs = (file: string): number => (existsSync(file) ? statSync(file).mtimeMs : 0);
