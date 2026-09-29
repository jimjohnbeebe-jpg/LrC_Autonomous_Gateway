// Static checks on the Lua plugins, since no Lua runtime runs in CI (rule 01-stack: Lightroom embeds
// Lua 5.1, so no goto, no //, no utf8 library). luaparse parses each file as Lua 5.1.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import { COMMANDS, PLUGIN_VERSION } from "../src/bridge/index.js";
import { DECAY_MAX_VALUES, LOCK_PORT, PAGE_SPECS } from "../src/settings/index.js";

const pluginRoot = fileURLToPath(new URL("../../plugin/", import.meta.url));
const avgPlugin = path.join(pluginRoot, "LrC-AVG.lrplugin");

function luaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return luaFiles(full);
    return entry.name.endsWith(".lua") ? [full] : [];
  });
}

// Code without comments and string contents, for the token checks below. One left-to-right pass,
// in the order Lua's lexer reads the source, so a "[[" inside a quoted string or a line comment
// does not start a long string. Every string becomes "" and every comment disappears; line breaks
// inside block comments and long strings are kept, so line numbers match the source.
function codeOnly(source: string): string {
  let out = "";
  let i = 0;
  // Level of a long bracket ("[", "="*, "[") starting at `at`, or -1.
  const longBracket = (at: number): number => {
    if (source[at] !== "[") return -1;
    let j = at + 1;
    while (source[j] === "=") j++;
    return source[j] === "[" ? j - at - 1 : -1;
  };
  // Skip the body of a long bracket whose opening ends at `from`; returns the index after its close.
  const skipLong = (from: number, level: number): number => {
    const close = `]${"=".repeat(level)}]`;
    const end = source.indexOf(close, from);
    const stop = end === -1 ? source.length : end + close.length;
    out += source.slice(from, stop).replace(/[^\n]/g, "");
    return stop;
  };
  while (i < source.length) {
    const c = source[i] as string;
    if (c === "-" && source[i + 1] === "-") {
      const level = longBracket(i + 2);
      if (level >= 0) {
        i = skipLong(i + 2 + level + 2, level);
      } else {
        const newline = source.indexOf("\n", i);
        i = newline === -1 ? source.length : newline;
      }
      continue;
    }
    const level = longBracket(i);
    if (level >= 0) {
      out += '""';
      i = skipLong(i + level + 2, level);
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      const end = source[j] === c ? j + 1 : j; // an unterminated string stops at the line break
      // A backslash before a line break continues the string on the next line; keep that break.
      out += `""${source.slice(i, end).replace(/[^\n]/g, "")}`;
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const files = luaFiles(pluginRoot);

describe("lua: every plugin file", () => {
  it("finds the LrC-AVG plugin files", () => {
    const names = files.filter((f) => f.startsWith(avgPlugin)).map((f) => path.basename(f)).sort();
    expect(names).toEqual([
      "Bridge.lua", "Catalog.lua", "Develop.lua", "Dispatch.lua", "Endpoint.lua", "Info.lua", "Json.lua", "Log.lua",
      "MenuStatus.lua", "Photos.lua", "PluginInfoProvider.lua", "PluginInit.lua", "Prefs.lua", "Preview.lua", "Sockets.lua",
    ]);
  });

  it.each(files.map((f) => [path.relative(pluginRoot, f), f]))("%s parses as Lua 5.1", (_name, file) => {
    expect(() => luaparse.parse(readFileSync(file, "utf8"), { luaVersion: "5.1" })).not.toThrow();
  });

  it.each(files.map((f) => [path.relative(pluginRoot, f), f]))("%s does not use the utf8 library", (_name, file) => {
    expect(codeOnly(readFileSync(file, "utf8"))).not.toMatch(/\butf8\s*\./);
  });
});

describe("lua: LrC-AVG.lrplugin", () => {
  const own = new Set(readdirSync(avgPlugin).filter((f) => f.endsWith(".lua")).map((f) => f.slice(0, -4)));

  it("requires only modules in its own folder (a .lrplugin cannot require outside it)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      for (const [, name] of readFileSync(file, "utf8").matchAll(/\brequire\s*\(?\s*['"]([^'"]+)['"]/g)) {
        expect(own.has(name as string), `${path.basename(file)} requires ${name}`).toBe(true);
      }
    }
  });

  it("names every file that Info.lua points at", () => {
    const info = readFileSync(path.join(avgPlugin, "Info.lua"), "utf8");
    const named = [...info.matchAll(/(?:file|LrInitPlugin|LrPluginInfoProvider)\s*=\s*['"]([^'"]+\.lua)['"]/g)].map((m) => m[1] as string);
    expect(named).toContain("PluginInfoProvider.lua");
    for (const file of named) {
      expect(own.has(file.slice(0, -4)), file).toBe(true);
    }
  });

  it("uses LrTasks.pcall, except where a plain pcall is marked as safe (rule 03-lightroom)", () => {
    // Plain pcall cannot cross a yield: in Jim's first Phase 1 run it raised "Yielding is not allowed
    // within a C or metamethod call" around getRawMetadata (docs/reports/phase1/PHASE1.md, run 1).
    // A plain pcall is allowed only with a "-- plain pcall: <why>" comment on the same line.
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      const source = readFileSync(file, "utf8");
      const lines = source.split(/\r?\n/);
      codeOnly(source).split(/\r?\n/).forEach((code, i) => {
        if (/(?<![.\w])pcall\s*\(/.test(code)) {
          expect(lines[i], `${path.basename(file)}:${i + 1}`).toMatch(/--\s*plain pcall: \S/);
        }
      });
    }
  });

  it("strips comments and strings from whole files without moving lines (helper for the checks above)", () => {
    const source = ["local a = 1", "--[[ a block comment", "x = pcall(f)", "]]", "local s = [[", "pcall(", "]]", "y = pcall(g) -- plain pcall: test"].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(8);
    expect(code.slice(0, 7).some((l) => l.includes("pcall"))).toBe(false);
    expect(code[7]).toContain("pcall(g)");
  });

  it("does not let a [[ inside a quoted string or a line comment hide the code after it", () => {
    const source = [
      'local open = "[["',
      "x = pcall(f)",
      "local close = ']]'",
      "-- see [[ here",
      "y = pcall(g)",
      "-- and ]] here",
      'local esc = "a \\" [[ b"',
      "z = pcall(h)",
    ].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(8);
    expect(code[1]).toContain("pcall(f)");
    expect(code[4]).toContain("pcall(g)");
    expect(code[7]).toContain("pcall(h)");
    expect(code.filter((l) => l.includes("[["))).toEqual([]);
  });

  it("keeps line numbers when a quoted string continues over an escaped line break", () => {
    const source = ['local s = "first \\', 'second"', "x = pcall(f)"].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(3);
    expect(code[2]).toContain("pcall(f)");
  });

  it("passes a History name to every applyDevelopSettings call (rule 03-lightroom)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      for (const [call] of codeOnly(readFileSync(file, "utf8")).matchAll(/applyDevelopSettings\s*\(([^)]*)\)/g)) {
        expect(call.split(",").length, `${path.basename(file)}: ${call}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("reports the plugin version the engine's bridge matches, in Bridge.lua and Info.lua", () => {
    const bridge = readFileSync(path.join(avgPlugin, "Bridge.lua"), "utf8");
    expect(bridge.match(/Bridge\.PLUGIN_VERSION = "([^"]+)"/)?.[1]).toBe(PLUGIN_VERSION);
    const info = readFileSync(path.join(avgPlugin, "Info.lua"), "utf8");
    const v = info.match(/VERSION = \{ major = (\d+), minor = (\d+), revision = (\d+)/);
    expect(v?.slice(1, 4).join(".")).toBe(PLUGIN_VERSION);
  });

  it("keeps Prefs.lua's SPECS equal to the engine's PAGE_SPECS: keys, wire names, kinds, defaults, ranges (engine\\src\\settings\\page.ts)", () => {
    const source = readFileSync(path.join(avgPlugin, "Prefs.lua"), "utf8");
    const table = source.match(/Prefs\.SPECS = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const raw = (line: string, name: string): string | undefined => line.match(new RegExp(`\\b${name} = ("[^"]*"|[\\d.]+)`))?.[1];
    const lua = table
      .split(/\r?\n/)
      .filter((line) => line.includes("key = "))
      .map((line) => {
        const value = (name: string): string | number | undefined => {
          const v = raw(line, name);
          return v === undefined ? undefined : v.startsWith('"') ? v.slice(1, -1) : Number(v);
        };
        const choices = line.match(/choices = \{([^}]*)\}/)?.[1]?.match(/"[^"]*"/g)?.map((c) => c.slice(1, -1));
        const spec: Record<string, unknown> = { key: value("key"), wire: value("wire"), kind: value("kind"), default: value("default") };
        if (choices) spec["choices"] = choices;
        if (value("min") !== undefined) Object.assign(spec, { min: value("min"), max: value("max") });
        return spec;
      });
    expect(lua).toHaveLength(PAGE_SPECS.length);
    expect(lua).toEqual(PAGE_SPECS.map((s) => ({ ...s })));
    expect(source).toMatch(new RegExp(`Prefs\\.LOCK_PORT = ${LOCK_PORT}\\b`));
    expect(source).toMatch(new RegExp(`Prefs\\.DECAY_MAX_VALUES = ${DECAY_MAX_VALUES}\\b`));
  });

  it("handles every command the engine sends (engine\\src\\bridge\\protocol.ts COMMANDS)", () => {
    const dispatch = codeOnly(readFileSync(path.join(avgPlugin, "Dispatch.lua"), "utf8"));
    const table = dispatch.match(/local HANDLERS = \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const handled = [...table.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]).sort();
    expect(handled).toEqual(Object.keys(COMMANDS).sort());
  });
});
