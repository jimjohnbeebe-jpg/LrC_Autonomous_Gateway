// Static checks on the Lua plugins, since no Lua runtime runs in CI (rule 01-stack: Lightroom embeds
// Lua 5.1, so no goto, no //, no utf8 library). luaparse parses each file as Lua 5.1.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";

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
      out += '""';
      i = source[j] === c ? j + 1 : j; // an unterminated string stops at the line break
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
    expect(names).toEqual(["Bridge.lua", "Develop.lua", "Info.lua", "Json.lua", "Log.lua", "MenuStatus.lua", "PluginInit.lua"]);
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
    for (const [, file] of info.matchAll(/(?:file|LrInitPlugin)\s*=\s*['"]([^'"]+\.lua)['"]/g)) {
      expect(own.has((file as string).slice(0, -4)), file).toBe(true);
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

  it("passes a History name to every applyDevelopSettings call (rule 03-lightroom)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      for (const [call] of codeOnly(readFileSync(file, "utf8")).matchAll(/applyDevelopSettings\s*\(([^)]*)\)/g)) {
        expect(call.split(",").length, `${path.basename(file)}: ${call}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
