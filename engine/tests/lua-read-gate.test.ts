// Rule 03 (.claude\rules\03-lightroom.md): yielding catalog queries stay outside the read gate. Issue #212
// moved the photo descriptions to batch reads, outside any gate (Photos.lua describePage); this static check
// (no Lua runtime runs in CI) fails any of these calls written directly inside a function passed to
// withReadAccessDo. A call reached through another function is not seen.

import { readFileSync } from "node:fs";
import path from "node:path";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import { avgPlugin, luaFiles } from "./helpers/lua-code.js";

// Catalog queries the plugin keeps outside the gate, and the batch reads that issue #212 put outside it.
const OUTSIDE = new Set([
  "findPhotos", "findPhotoByUuid", "findPhotoByPath", "getTargetPhoto", "getTargetPhotos", "setSelectedPhotos",
  "getAllPhotos", "getFolderByPath", "getCollectionByLocalIdentifier", "batchGetRawMetadata", "batchGetFormattedMetadata",
]);

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

const children = (n: Node): Node[] =>
  Object.values(n).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string");

const calledName = (n: Node): string | null => {
  if (n.type !== "CallExpression" && n.type !== "TableCallExpression" && n.type !== "StringCallExpression") return null;
  const base = n["base"] as Node;
  return base.type === "MemberExpression" ? ((base["identifier"] as Node)["name"] as string) : null;
};

/** Each `name (line)` of an OUTSIDE call inside a withReadAccessDo argument, anywhere in `n`. */
function insideGate(n: Node, inGate = false, out: string[] = []): string[] {
  const name = calledName(n);
  if (inGate && name !== null && OUTSIDE.has(name)) out.push(`${name} (line ${n.loc?.start.line})`);
  if (name === "withReadAccessDo") {
    insideGate(n["base"] as Node, inGate, out);
    for (const arg of n["arguments"] as Node[]) insideGate(arg, true, out);
    return out;
  }
  for (const c of children(n)) insideGate(c, inGate, out);
  return out;
}

describe("lua: rule 03, yielding catalog queries outside the read gate", () => {
  it.each(luaFiles(avgPlugin).map((f) => [path.basename(f), f]))("%s calls none inside withReadAccessDo", (_name, file) => {
    const ast = luaparse.parse(readFileSync(file, "utf8"), { luaVersion: "5.1", locations: true }) as unknown as Node;
    expect(insideGate(ast)).toEqual([]);
  });

  it("sees such a call inside a gate, and not one after it", () => {
    const parse = (src: string) => luaparse.parse(src, { luaVersion: "5.1", locations: true }) as unknown as Node;
    expect(insideGate(parse("catalog:withReadAccessDo(function()\n  local p = catalog:findPhotos { searchDesc = d }\nend)"))).toEqual(["findPhotos (line 2)"]);
    expect(insideGate(parse("catalog:withReadAccessDo(function() x = 1 end)\nlocal r = catalog:batchGetRawMetadata(ps, k)"))).toEqual([]);
  });
});
