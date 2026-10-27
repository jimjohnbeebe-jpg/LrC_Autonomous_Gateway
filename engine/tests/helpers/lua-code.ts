// Helpers of the static Lua checks (lua-plugin.test.ts, sdk-version-gate.test.ts): no Lua runtime runs in CI.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = fileURLToPath(new URL("../../../plugin/", import.meta.url));
export const avgPlugin = path.join(pluginRoot, "LrC-AVG.lrplugin");

export function luaFiles(dir: string): string[] {
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
export function codeOnly(source: string): string {
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
