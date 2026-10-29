// The plugin's kept keyword walk (KeywordTree.paths, 120 s, Jim's decision 2026-10-28 after
// docs\reports\phase11\PERF.md): every keyword write the plugin makes must drop it. No Lua runtime runs in CI, so
// this static check fails a file that writes keywords (createKeyword, addKeyword, removeKeyword, setAttributes)
// unless it is KeywordTree.lua (whose resolve only Library.lua's set_keywords calls) or calls KeywordTree.forget().

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { avgPlugin, codeOnly, luaFiles } from "./helpers/lua-code.js";

const WRITES = /:(createKeyword|addKeyword|removeKeyword|setAttributes)\s*\(/;

describe("lua: the kept keyword walk", () => {
  const files = luaFiles(avgPlugin).map((f) => ({ name: path.basename(f), code: codeOnly(readFileSync(f, "utf8")) }));

  it("is dropped by every file that writes keywords", () => {
    const writers = files.filter((f) => WRITES.test(f.code)).map((f) => f.name).sort();
    expect(writers).toEqual(["KeywordEdit.lua", "KeywordTree.lua", "Library.lua"]);
    for (const f of files.filter((x) => WRITES.test(x.code) && x.name !== "KeywordTree.lua")) expect(f.code, f.name).toMatch(/KeywordTree\.forget\(\)/);
    // An import may bring the file's own keywords into the Keyword List [inference].
    // From plugin 1.9.0 (issue #139) the addPhoto calls sit in a function `add` that the import's write gate runs.
    expect(files.find((f) => f.name === "Transfer.lua")?.code).toMatch(/catalog:addPhoto\(path\)[\s\S]*Gate\.write, catalog, [^\n]*, add\)[^\n]*\n\s*KeywordTree\.forget\(\)/);
  });

  it("is used by list_keywords, with refresh walking again", () => {
    const library = files.find((f) => f.name === "Library.lua")?.code ?? "";
    expect(library).toMatch(/KeywordTree\.paths, LrApplication\.activeCatalog\(\), payload\.refresh == true\)/);
    const tree = files.find((f) => f.name === "KeywordTree.lua")?.code ?? "";
    expect(tree).toMatch(/KeywordTree\.CACHE_SECONDS = 120\b/);
  });
});
