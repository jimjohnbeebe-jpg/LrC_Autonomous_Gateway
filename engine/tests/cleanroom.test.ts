// The clean room (src/devtools/cleanroom-*.ts) on a fake Windows account in a temp folder: fake
// registry, process list, Claude Code CLI and uninstallers; nothing real is read or written.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs, runCleanroom } from "../src/devtools/cleanroom-run.js";
import { PLUGIN_STEP } from "../src/devtools/cleanroom-scan.js";
import { parseRegQuery, type Proc, type Sys, type UninstallKey } from "../src/devtools/cleanroom-sys.js";
import { DECK_ONLY_MAX_BYTES, deckVersionOk } from "../src/devtools/clients-deck.js";

let root: string;
const at = (...p: string[]) => path.join(root, ...p);
const put = (file: string, text: string) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, text));
const read = (file: string) => readFileSync(file, "utf8");

const DEV = { command: "C:\\Program Files\\nodejs\\node.exe", args: ["D:\\dev\\engine\\dist\\mcp\\main.js"], env: { LRC_AVG_LOG_DIR: "D:\\dev\\logs" } };
const DESKTOP = JSON.stringify({ mcpServers: { github: { command: "gh" }, "lrc-avg": DEV }, preferences: { x: 1 } }, null, 2) + "\n";
const OPENCODE = `{\n  // keep me\n  "mcp": {\n    "lrc-avg": {\n      "type": "local",\n      "command": ["n", "m"]\n    }\n  }\n}\n`;
const HERMES = "model: x\r\n\nmcp_servers:\n  lrc_avg:\n    command: 'n'\n";
const AGY = JSON.stringify({ mcpServers: { "lrc-avg": DEV } }, null, 2) + "\n";

type World = { sys: Sys; keys: UninstallKey[]; procs: Proc[]; ran: string[] };

function world(): World {
  const keys: UninstallKey[] = [];
  const procs: Proc[] = [];
  const ran: string[] = [];
  let tick = 0;
  const home = at("home");
  const claudeJson = path.join(home, ".claude.json");
  const sys: Sys = {
    env: { LOCALAPPDATA: at("Local"), APPDATA: at("Roaming"), TEMP: at("Temp") },
    home,
    repo: at("repo"),
    uninstallKeys: () => keys,
    processes: () => procs,
    claude: (args) => {
      const cfg = JSON.parse(read(claudeJson)) as { mcpServers: Record<string, unknown> };
      if (args[1] === "remove") delete cfg.mcpServers[args[2] as string];
      else cfg.mcpServers[args[2] as string] = JSON.parse(args[3] as string);
      writeFileSync(claudeJson, JSON.stringify(cfg));
      return { status: 0, output: "" };
    },
    run: (exe, args) => {
      ran.push(`${exe} ${args.join(" ")}`);
      if (path.basename(exe) === "uninstall.exe") {
        rmSync(path.dirname(exe), { recursive: true });
        rmSync(at("Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "LrC-AVG HUD.lnk"), { force: true });
        keys.splice(0, keys.length);
      }
      return 0;
    },
    exeVersion: () => "0.3.6",
    sleep: async () => {},
    now: () => new Date(Date.UTC(2026, 9, 17, 12, 0, tick++)),
  };
  return { sys, keys, procs, ran };
}

/** Jim's development setup, as on 2026-10-17 (vault PHASE9_PLAN.md Found 1, 5, 11). */
function devSetup(w: World): void {
  put(at("Local", "Claude-Data", "claude_x", "claude_desktop_config.json"), DESKTOP);
  put(at("Local", "Packages", "Claude_x", "LocalCache", "Roaming", "Claude", ".user-data-left.claude_x"), "");
  put(at("home", ".config", "opencode", "opencode.jsonc"), OPENCODE);
  put(at("Local", "hermes", "config.yaml"), HERMES);
  put(at("home", ".gemini", "config", "mcp_config.json"), AGY);
  put(at("home", ".claude.json"), JSON.stringify({ mcpServers: { "lrc-avg": DEV }, other: 1 }));
  put(at("Local", "LrC-AVG HUD", "LrC-AVG HUD.exe"), "exe");
  put(at("Local", "LrC-AVG HUD", "uninstall.exe"), "un");
  put(at("Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "LrC-AVG HUD.lnk"), "lnk");
  put(at("Local", "LrC-AVG", "logs", "a.log"), "log");
  put(at("Temp", "LrC-AVG", "bridge.log"), "bridge");
  put(at("home", ".lrc-avg", "bridge_token"), "token");
  put(at("Roaming", "Adobe", "Lightroom", "Preferences", "Lightroom Classic CC 7 Preferences.agprefs"), '\tAgSdkPluginLoader_installedPluginPaths = "t = {\\\n\t[\\"D:\\\\\\\\dev\\\\\\\\plugin\\\\\\\\LrC-AVG.lrplugin\\"] = true,\\\n}\\\n",');
  const dir = at("Local", "LrC-AVG HUD");
  w.keys.push({ key: "HKEY_CURRENT_USER\\...\\LrC-AVG HUD", displayName: "LrC-AVG HUD", installLocation: dir, uninstallString: path.join(dir, "uninstall.exe"), mainBinary: "LrC-AVG HUD.exe" });
}

/** Every file under root (outside the park folder) with its bytes. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (f.startsWith(at("Temp", "LrC-AVG-cleanroom")) || f.startsWith(at("Temp", "LrC-AVG", "cleanroom"))) continue;
      if (statSync(f).isDirectory()) walk(f);
      else out[path.relative(root, f)] = read(f);
    }
  };
  walk(root);
  return out;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "cleanroom-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("cleanroom: park, check, restore", () => {
  it("parks everything, says CLEAN only once the dev plugin is out of Lightroom's preferences, and restores byte for byte", async () => {
    const w = world();
    devSetup(w);
    const before = snapshot();
    const parked = await runCleanroom(w.sys, "--park", false, false);
    expect(parked.ok).toBe(false);
    expect(parked.headline).toBe("CLEAN: NO");
    expect(parked.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["dev plugin on in Lightroom"]);
    expect(parked.checks.find((c) => !c.ok)?.detail).toContain(PLUGIN_STEP);
    expect(w.ran).toEqual([`${at("Local", "LrC-AVG HUD", "uninstall.exe")} /S`]);
    expect(existsSync(at("Local", "LrC-AVG"))).toBe(false);
    expect(existsSync(at("home", ".lrc-avg"))).toBe(false);
    const park = JSON.parse(read(at("Temp", "LrC-AVG-cleanroom", "park.json"))) as { complete: boolean; dir: string };
    expect(park.complete).toBe(true);
    expect(existsSync(path.join(park.dir, "configs"))).toBe(true);
    expect(read(at("home", ".config", "opencode", "opencode.jsonc"))).toBe(`{\n  // keep me\n  "mcp": {\n  }\n}\n`);
    expect(Object.keys(JSON.parse(read(at("Local", "Claude-Data", "claude_x", "claude_desktop_config.json"))).mcpServers)).toEqual(["github"]);
    expect(readdirSync(at("Local", "Claude-Data", "claude_x"))).toEqual(["claude_desktop_config.json"]);

    rmSync(at("Roaming", "Adobe", "Lightroom", "Preferences", "Lightroom Classic CC 7 Preferences.agprefs"));
    const status = await runCleanroom(w.sys, "--status", false, false);
    expect(status.headline).toBe("CLEAN: YES");
    expect((await runCleanroom(w.sys, "--park", false, false)).messages[0]).toMatch(/Already parked/);

    const restored = await runCleanroom(w.sys, "--restore", false, false);
    // No built Deck installer: the Deck is still owed, so NO, and park.json stays for the next restore.
    expect(restored.headline).toBe("RESTORED: NO");
    expect(restored.messages.join("\n")).toMatch(/no built installer was found.*npm run deck:build, then npm run cleanroom -- --restore again/);
    expect(existsSync(at("Temp", "LrC-AVG-cleanroom", "park.json"))).toBe(true);
    const { ["Roaming\\Adobe\\Lightroom\\Preferences\\Lightroom Classic CC 7 Preferences.agprefs"]: _prefs, ...rest } = before;
    const after = snapshot();
    // The uninstalled Deck's folder and shortcut are the only difference.
    for (const [file, text] of Object.entries(rest)) if (!file.includes("LrC-AVG HUD")) expect([file, after[file]]).toEqual([file, text]);

    // Once the installer is built, a second restore reinstalls the Deck only (the entries and data are back already).
    put(at("repo", "hud", "package.json"), JSON.stringify({ version: "1.0.0" }));
    put(at("repo", "hud", "src-tauri", "target", "release", "bundle", "nsis", "LrC-AVG_1.0.0_x64-setup.exe"), "setup");
    const again = await runCleanroom(w.sys, "--restore", false, false);
    expect(again.headline).toBe("RESTORED: YES");
    expect(again.actions.filter((a) => !a.startsWith("deleted the config copies"))).toEqual([expect.stringMatching(/^reinstalled the dev Deck/)]);
    const later = snapshot();
    for (const [file, text] of Object.entries(after)) expect([file, later[file]]).toEqual([file, text]);
    expect(existsSync(at("Temp", "LrC-AVG-cleanroom", "park.json"))).toBe(false);
    expect(existsSync(path.join(park.dir, "configs"))).toBe(false);
  });

  it("marks a park that stopped half way as not complete (setup:install refuses it)", async () => {
    const w = world();
    devSetup(w);
    w.sys.run = () => 1;
    const r = await runCleanroom(w.sys, "--park", false, false);
    expect(r.messages.join("\n")).toMatch(/Stopped: .*exited with 1/);
    expect((JSON.parse(read(at("Temp", "LrC-AVG-cleanroom", "park.json"))) as { complete: boolean }).complete).toBe(false);
  });

  it("merges entries into files that changed while parked, and renames a test's leftovers aside", async () => {
    const w = world();
    devSetup(w);
    rmSync(at("Roaming", "Adobe"), { recursive: true });
    expect((await runCleanroom(w.sys, "--park", false, false)).headline).toBe("CLEAN: YES");
    const desktop = at("Local", "Claude-Data", "claude_x", "claude_desktop_config.json");
    writeFileSync(desktop, JSON.stringify({ mcpServers: { github: { command: "gh" }, newer: { command: "n" } } }));
    const hermes = at("Local", "hermes", "config.yaml");
    writeFileSync(hermes, "# added\r\n" + read(hermes));
    put(at("Local", "LrC-AVG", "logs", "product.log"), "test");
    const restored = await runCleanroom(w.sys, "--restore", false, false);
    expect(restored.headline).toBe("RESTORED: NO"); // only the Deck is owed (no built installer here)
    expect(Object.keys(JSON.parse(read(desktop)).mcpServers)).toEqual(["github", "newer", "lrc-avg"]);
    expect(read(hermes)).toBe("# added\r\n" + HERMES);
    expect(read(at("Local", "LrC-AVG", "logs", "a.log"))).toBe("log");
    expect(restored.messages.join("\n")).toMatch(/cleanroom-residue/);
    expect(readdirSync(at("Local")).some((n) => n.startsWith("LrC-AVG-cleanroom-residue-"))).toBe(true);
  });

  it("reinstalls the dev Deck when its installer is built", async () => {
    const w = world();
    devSetup(w);
    put(at("repo", "hud", "package.json"), JSON.stringify({ version: "1.0.0" }));
    put(at("repo", "hud", "src-tauri", "target", "release", "bundle", "nsis", "LrC-AVG_1.0.0_x64-setup.exe"), "setup");
    await runCleanroom(w.sys, "--park", false, false);
    const restored = await runCleanroom(w.sys, "--restore", false, false);
    expect(restored.ok).toBe(true);
    expect(w.ran.at(-1)).toMatch(/LrC-AVG_1\.0\.0_x64-setup\.exe \/S$/);
  });

  it("never runs the full product setup that setup:build left under the Deck's file name", async () => {
    const w = world();
    devSetup(w);
    put(at("repo", "hud", "package.json"), JSON.stringify({ version: "1.0.0" }));
    const nsis = at("repo", "hud", "src-tauri", "target", "release", "bundle", "nsis");
    mkdirSync(nsis, { recursive: true });
    writeFileSync(path.join(nsis, "LrC-AVG_1.0.0_x64-setup.exe"), Buffer.alloc(DECK_ONLY_MAX_BYTES));
    await runCleanroom(w.sys, "--park", false, false);
    const restored = await runCleanroom(w.sys, "--restore", false, false);
    expect(restored.messages.join("\n")).toMatch(/no built installer was found/);
    expect(w.ran.some((r) => r.includes("x64-setup.exe"))).toBe(false);
  });
});

describe("cleanroom: refusals and dry runs", () => {
  it("refuses while Lightroom or Claude Desktop (by path, not Claude Code) runs", async () => {
    const w = world();
    devSetup(w);
    w.procs.push({ name: "claude", path: "C:\\Users\\j\\.local\\bin\\claude.exe" });
    expect((await runCleanroom(w.sys, "--park", true, false)).headline).toBe("DRY RUN: nothing changed");
    w.procs.push({ name: "Lightroom", path: "C:\\LR\\Lightroom.exe" }, { name: "claude", path: "C:\\Program Files\\WindowsApps\\Claude_2_x64__p\\app\\Claude.exe" });
    const r = await runCleanroom(w.sys, "--park", false, false);
    expect(r.messages[0]).toMatch(/Lightroom Classic; Claude Desktop/);
    expect(existsSync(at("Temp", "LrC-AVG-cleanroom"))).toBe(false);
  });

  it("a dry run lists every action and changes nothing; restore refuses while an install is present", async () => {
    const w = world();
    devSetup(w);
    const before = snapshot();
    const dry = await runCleanroom(w.sys, "--park", true, false);
    expect(dry.actions).toHaveLength(5 + 1 + 3);
    expect(snapshot()).toEqual(before);
    await runCleanroom(w.sys, "--park", false, false);
    put(at("Local", "LrC-AVG", "uninstall.exe"), "product");
    expect((await runCleanroom(w.sys, "--restore", false, false)).messages[0]).toMatch(/uninstall it first/);
    rmSync(at("Local", "LrC-AVG"), { recursive: true });
    const dryRestore = await runCleanroom(w.sys, "--restore", true, false);
    expect(dryRestore.actions.at(-1)).toMatch(/would delete .*park\.json/);
    expect(existsSync(at("Temp", "LrC-AVG-cleanroom", "park.json"))).toBe(true);
  });
});

describe("cleanroom: --verify-gone and arguments", () => {
  it("passes with only the kept data left, and fails on program files or, with --expect-data-gone, on data", async () => {
    const w = world();
    put(at("Local", "LrC-AVG", "logs", "a.log"), "log");
    put(at("Local", "LrC-AVG", "last-start.json"), "{}");
    expect((await runCleanroom(w.sys, "--verify-gone", false, false)).headline).toBe("GONE: YES");
    expect((await runCleanroom(w.sys, "--verify-gone", false, true)).headline).toBe("GONE: NO");
    put(at("Local", "LrC-AVG", "resources", "node", "node.exe"), "n");
    put(at("Roaming", "Adobe", "Lightroom", "Modules", "LrC-AVG.lrplugin", "Info.lua"), "x");
    const r = await runCleanroom(w.sys, "--verify-gone", false, false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["install folder (except the kept data)", "Lightroom Modules copies"]);
  });

  it("clients:check takes the 1.0.0 Deck as AI_NAME_DECK (0.3.6) or later", () => {
    expect(["1.0.0", "1.0.0.0", "0.3.6", "0.3.5", null].map(deckVersionOk)).toEqual([true, true, true, false, false]);
  });

  it("parses the commands and reg query output", () => {
    expect(parseArgs(["--park", "--dry-run"])).toEqual({ command: "--park", dryRun: true, expectDataGone: false });
    expect(parseArgs(["--status", "--dry-run"])).toMatch(/--dry-run goes with/);
    expect(parseArgs(["--park", "--restore"])).toMatch(/^Usage/);
    const reg = "\r\nHKEY_CURRENT_USER\\X\\LrC-AVG HUD\r\n    MainBinaryName    REG_SZ    LrC-AVG HUD.exe\r\n    DisplayName    REG_SZ    LrC-AVG HUD\r\n    InstallLocation    REG_SZ    \"C:\\L\\LrC-AVG HUD\"\r\n    UninstallString    REG_SZ    \"C:\\L\\LrC-AVG HUD\\uninstall.exe\"\r\n\r\nHKEY_CURRENT_USER\\X\\NoName\r\n    Foo    REG_SZ    bar\r\n";
    expect(parseRegQuery(reg)).toEqual([{ key: "HKEY_CURRENT_USER\\X\\LrC-AVG HUD", displayName: "LrC-AVG HUD", installLocation: "C:\\L\\LrC-AVG HUD", uninstallString: "C:\\L\\LrC-AVG HUD\\uninstall.exe", mainBinary: "LrC-AVG HUD.exe" }]);
  });
});
