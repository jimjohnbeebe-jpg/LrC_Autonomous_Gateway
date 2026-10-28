// Builds release\lrc-avg-<version>.mcpb (issue #219): a zip of manifest.json (mcpb-manifest.ts) and server\,
// which is the engine package (dist, intents, schemas, package.json) plus its production node_modules,
// installed fresh in a staging folder under the OS temp dir. Nothing is copied into Lightroom's folders:
// the Lua plug-in stays the separate zip / Plug-in Manager step. Windows' tar.exe writes the zip, as
// package-cli.ts does for the plugin. The install needs the npm cache or network [inference].

import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TOOL_DEFS } from "../mcp/index.js";
import { buildManifest, type McpbManifest } from "./mcpb-manifest.js";
import { packProblems } from "./package-check.js";

/** Differences between a manifest's tool names and the server's. */
export function manifestToolProblems(manifest: McpbManifest, names: string[]): string[] {
  return packProblems(manifest.tools.map((t) => t.name), names);
}

export function buildMcpb(engineDir: string, releaseDir: string, tar: string, version: string): string {
  const manifest = buildManifest(version, TOOL_DEFS);
  const stage = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-mcpb-"));
  try {
    const server = path.join(stage, "server");
    mkdirSync(server);
    for (const item of ["dist", "intents", "schemas", "package.json", "THIRD_PARTY_NOTICES.md"]) {
      if (existsSync(path.join(engineDir, item))) cpSync(path.join(engineDir, item), path.join(server, item), { recursive: true });
    }
    cpSync(path.join(engineDir, "..", "LICENSE"), path.join(server, "LICENSE"));
    rmSync(path.join(server, "dist", "devtools"), { recursive: true, force: true });
    execSync("npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline", { cwd: server, stdio: "pipe" });
    writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Read back what is on disk and compare it with the live tool list: the bundle never ships a stale list.
    const onDisk = JSON.parse(readFileSync(path.join(stage, "manifest.json"), "utf8")) as McpbManifest;
    const problems = manifestToolProblems(onDisk, TOOL_DEFS.map((d) => d.name));
    if (problems.length > 0) throw new Error(`manifest tools differ from the server's:\n  ${problems.join("\n  ")}`);
    const out = path.join(releaseDir, `lrc-avg-${version}.mcpb`);
    rmSync(out, { force: true });
    execFileSync(tar, ["--format", "zip", "-cf", out, "-C", stage, "manifest.json", "server"]);
    return out;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
