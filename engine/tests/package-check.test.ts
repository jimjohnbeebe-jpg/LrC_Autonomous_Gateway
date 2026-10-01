// The engine package's file list (src/devtools/package-check.ts; `npm run package` applies it to the
// real `npm pack --json` list) and the package.json fields it relies on (PHASE6_PLAN row 1).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectedPackFiles, packProblems } from "../src/devtools/package-check.js";

const engineFiles = [
  "src/mcp/main.ts",
  "src/setup/setup-cli.ts",
  "src/params/sdk-keys.lrc15.json",
  "src/session/.gitkeep",
  "src/devtools/package-cli.ts",
  "intents/bw_conversion.json",
  "schemas/intent.schema.json",
];
const expected = expectedPackFiles(engineFiles);

describe("package: the engine's file list", () => {
  it("ships the built modules, the param JSON, intents, schemas, licence and notices; no devtools or sources", () => {
    expect(expected).toEqual([
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "dist/mcp/main.js",
      "dist/params/sdk-keys.lrc15.json",
      "dist/setup/setup-cli.js",
      "intents/bw_conversion.json",
      "package.json",
      "schemas/intent.schema.json",
    ]);
    expect(packProblems([...expected].reverse(), expected)).toEqual([]);
  });

  it("names every extra file (devtools, source maps, sources, stale modules) and every missing one", () => {
    const packed = [...expected.filter((f) => f !== "dist/setup/setup-cli.js"), "dist/devtools/package-cli.js", "dist/mcp/main.js.map", "src/mcp/main.ts", "dist/old/gone.js"];
    expect(packProblems(packed, expected)).toEqual([
      "extra: dist/devtools/package-cli.js",
      "extra: dist/mcp/main.js.map",
      "extra: dist/old/gone.js",
      "extra: src/mcp/main.ts",
      "missing: dist/setup/setup-cli.js",
    ]);
  });

  it("is a public package with both commands, the files list and the repo's licence", () => {
    const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
    const pkg = JSON.parse(read("../package.json")) as Record<string, unknown>;
    expect(pkg["private"]).toBeUndefined();
    expect(pkg["license"]).toBe("MIT");
    expect(pkg["bin"]).toEqual({ "lrc-avg": "dist/mcp/main.js", "lrc-avg-setup": "dist/setup/setup-cli.js" });
    expect(pkg["files"]).toEqual(["dist", "!dist/devtools", "!dist/**/*.map", "intents", "schemas", "THIRD_PARTY_NOTICES.md"]);
    expect(read("../LICENSE")).toBe(read("../../LICENSE"));
    expect(read("../src/setup/setup-cli.ts").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
