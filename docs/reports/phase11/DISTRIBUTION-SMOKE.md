---
report: DISTRIBUTION-SMOKE
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings: the package run and the asset smoke, 2026-10-29); Jim (Observed, Verdict)"
date: 2026-10-29
---

# DISTRIBUTION-SMOKE: the three release assets of 1.8.0, started and read without Lightroom

## Purpose

GitHub issue #219 and issue #172 (epic #207). `docs\reports\phase11\DISTRIBUTION.md` smoked the `.mcpb` of 1.4.0 with a throwaway script; nothing committed showed that the assets of the current version start. This report records, for the assets `npm run package` writes at branch `fix/distribution-artefacts`:

1. the npm package (`lrc-avg-<v>.tgz`), installed as a user would, short of publishing, and its `lrc-avg` bin started over stdio;
2. the Claude Desktop extension bundle (`lrc-avg-<v>.mcpb`), extracted and its server started;
3. the plugin zip (`LrC-AVG.lrplugin-<v>.zip`), which from this branch on carries the product's ID and name, as the setup installs it (issue #172: "the product ID is required").

There is no PHASES.md go rule for this report; the success line of the workflow plan of 2026-10-29 for PR `fix/distribution-artefacts` (issues #219, #172) is: every asset starts or reads back, lists every tool and both prompts, and the zip's `Info.lua` declares `com.lrcavg.gateway` [stated: Jim, 2026-10-29, "Go on all."].

## Harness

- `npm run package` (`engine\src\devtools\package-cli.ts`). Step 2 now copies `plugin\LrC-AVG.lrplugin` to a `mkdtemp` folder under `os.tmpdir()`, rewrites its `Info.lua` with `productInfoLua` (`engine\src\setup\plugin-id.ts`, moved from `tools\setup\plugin-id.ts` with its content unchanged, so the setup staging in `tools\setup\stage.ts` and the release zip use one function), zips that folder plus `LICENSE`, checks the zip's entries against the staged files, and deletes the staged folder.
- A smoke driver in the session scratchpad, copied verbatim in the appendix (scratch `.ts` files are not committed, as in `docs\reports\phase6\package-smoke\smoke.txt`). It runs the engine with scratch `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, `TEMP`/`TMP`, scratch `LRC_AVG_LOG_DIR`, `LRC_AVG_INTENTS_DIR` and `LRC_AVG_PRESET_DIR`, bridge ports 18765/18766 (lock 18767) and a missing token file (`engine\src\mcp\dev-overrides.ts`; the same overrides as `engine\tests\probe\harness.ts`), so it never met Jim's plugin, his Claude Desktop config or his data. It speaks MCP with the repo's `@modelcontextprotocol/client`, and takes the expected tool count from the built `TOOL_DEFS`.

Commands (PowerShell; `$s` = the session scratchpad, `$w` = the worktree of the branch):

```powershell
npm run package
node "$s\smoke-dist.ts" $w "$s\run"
```

## Pre-run findings (Claude Code)

Run by Claude Code on 2026-10-29 on Jim's PC, in a worktree at commit `b03324e` with a clean tree (`git status --porcelain` printed nothing before and after). Node v24.11.1 (the driver's first line), npm 11.19.1 (`npm --version`), `C:\Windows\System32\tar.exe` = bsdtar 3.8.9 (`tar.exe --version`). Both commands exited 0.

### `npm run package`

```text
engine package: 233 files, list as expected
plugin zip: 58 files, list as expected (zip_check), Info.lua as com.lrcavg.gateway
mcpb bundle: manifest tools equal the server's tool list
Release assets in <worktree>\release:
  lrc-avg-1.8.0.tgz  448905 bytes  sha256 4d00dd0dbfc44283db91fa510ad12c5888e2c34e4ca5c7c35704cf3c83d17a16
  LrC-AVG.lrplugin-1.8.0.zip  162777 bytes  sha256 44dfef4d738aeebe967a3932e4d0619778140f382eb21e94b89451e099c0b5c4
  lrc-avg-1.8.0.mcpb  13195751 bytes  sha256 48c0cd53aea1d02ad8385ef6851b3fce60603e3ca1ce531d9f15cbdae93f6e18
```

The `.tgz` hash was the same in an earlier package run of this session at `0102a00`; the `.mcpb` hash was not (`54393c3b…`), with the same engine files. The file times a zip stores are the likely reason [inference], as the Phase 6 smoke found for the plugin zip: compare these assets by their contents, not by their hash.

### The smoke driver

```text
node v24.11.1; engine 1.8.0; plugin 1.8.0; scratch $s\run
added 10 packages in 1m
PASS  tgz: package.json bin lrc-avg = dist/mcp/main.js
PASS  tgz: initialize -> lrc-avg 1.8.0
PASS  tgz: tools/list -> 65 tools (TOOL_DEFS.length 65)
PASS  tgz: prompts/list -> lrc-avg-edit,lrc-avg-help
PASS  mcpb: manifest version 1.8.0
PASS  mcpb: initialize -> lrc-avg 1.8.0
PASS  mcpb: tools/list -> 65 tools (TOOL_DEFS.length 65)
PASS  mcpb: prompts/list -> lrc-avg-edit,lrc-avg-help
PASS  mcpb: manifest tools (65) equal tools/list (65)
PASS  zip: 58 entries = 57 plugin files + LICENSE
PASS  zip: Info.lua declares LrToolkitIdentifier = 'com.lrcavg.gateway' 1x (LrToolkitIdentifier 1x)
PASS  zip: Info.lua holds the dev ID 0x, the dev name 0x
PASS  zip: Info.lua LrPluginName = "LrC-AVG (Autonomous Vision Gateway)"
WORKED: every check passed
```

The first driver run of the session failed one check, "Info.lua holds com.lrcavg.gateway 2x": the second occurrence was the header comment of `plugin\LrC-AVG.lrplugin\Info.lua`, which says the setup ships the plugin as `com.lrcavg.gateway`. The check was narrowed to the `LrToolkitIdentifier` declaration, and the comment was updated to name the new `plugin-id.ts` path (commit `b03324e`).

What the run shows and does not show:

- Both servers started from a clean install: `npm install` of the tarball pulled its production dependencies from the registry (`npm run setup:lock-check` printed "lock-check: OK (9 production packages for the engine in package-lock.json)", 2026-10-29; with the package itself that is the "added 10 packages" line [inference]), and the extracted `.mcpb` used its bundled `node_modules`. `dist\mcp\main.js` imports `sharp` statically (through `mcp\server.ts:49` -> `mcp\image-cap.ts:15`, and `preview\service.ts:24`), so a server that answers `initialize` has loaded sharp's native module [inference: sharp loads its binding when it is imported; no tool that renders was called].
- 65 is the engine's tool count at `b03324e`: the README says 62 (`README.md:102`) [handle: the driver's `tools/list` lines above]. The client probe's self-check now expects `TOOL_DEFS.length` (`engine\tests\probe\harness.ts`): `LRC_AVG_PROBE_CLIENTS=none npx vitest run --config vitest.probe.config.ts` in `engine\` passed 7 of 7, with `self_checks.b_engine.tools` 65, `ok` true [handle: that run, 2026-10-29T12:41:15Z; its report files were put back with `git checkout`, not committed]. It expected 37 before (`TOOL_COUNT = 37`).
- Not tested: a tool call against Lightroom, Claude Desktop installing this `.mcpb`, the `Tool profile` setting of the bundle, Lightroom loading the zipped plugin, and any of it on a PC without Node.

## Steps for Jim

One Claude Desktop sitting; no Lightroom edit. Lightroom open with the LrC-AVG plug-in enabled.

1. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, on an up-to-date `main` after this PR merges, run:

   ```powershell
   npm run package
   ```

   You should see `plugin zip: 58 files, list as expected (zip_check), Info.lua as com.lrcavg.gateway` and three lines under `Release assets`.
2. Quit Claude Desktop (tray icon > Quit), then open it again.
3. In Claude Desktop, open Settings > Extensions and install `D:\Developer\LrC_Autonomous_Gateway\release\lrc-avg-1.8.0.mcpb` (the route Jim used on 2026-10-27, DISTRIBUTION.md Run 1).
4. In the extension's settings, set "Tool profile" to `edit`.
5. In a new chat, type: `Call lr_help and tell me the tool_profile`. Write down the profile it names and how many tools it lists.
6. Remove the extension in Settings > Extensions, so it does not run beside the setup's `lrc-avg` entry.

### If something goes wrong

- If step 3 shows an error, write down its text and stop there.
- If step 5 names `full`, write that down: the setting did not reach the engine.

## Observed (Jim)

### Run 1, date:

- Step 1 output (the three asset lines):
- Step 3, installed (y/n):
- Step 5, tool_profile named:
- Step 5, tools listed:
- Step 6, removed (y/n):

## Numbers

| Field | Value |
|---|---|
| Tools in `tools/list` (tgz / mcpb) | 65 / 65 (pre-run, Claude Code) |
| Prompts | `lrc-avg-edit`, `lrc-avg-help` (pre-run, Claude Code) |
| Zip `LrToolkitIdentifier` | `com.lrcavg.gateway` (pre-run, Claude Code) |
| `.mcpb` profile `edit` in Claude Desktop | (from Observed) |

## Verdict

Suggested by Claude Code: Go for the three assets starting and listing every tool and both prompts. Jim decides; blank until he does.

## Consequences / open questions

- The release zip is now the product (`com.lrcavg.gateway`, "LrC-AVG (Autonomous Vision Gateway)"), not the dev copy. A PC that has the setup's plugin installed and also adds this zip would hold two plugins with one ID; what Lightroom does then is `[unverified]`. The README should tell `.mcpb` users not to add the zip when the setup is installed (PR `fix/distribution-docs`).
- `README.md:102` says 62 tools and `docs/CLIENTS.md:44` follows it; the engine lists 65 at `b03324e`.
- `[unverified]` until Jim's run: the `.mcpb` "Tool profile" setting reaching the engine as `LRC_AVG_TOOLS` (`engine\src\devtools\mcpb-manifest.ts:48`), and the `.mcpb` on a PC without Node (Jim's PC has Node 24).

## Appendix: smoke-dist.ts (verbatim)

```ts
// Distribution smoke (issue #219, issue #172): the three assets `npm run package` wrote to <repo>\release,
// each started or read without Lightroom. Usage: node smoke-dist.ts <repo> <scratch>
// The engine runs with scratch USERPROFILE/LOCALAPPDATA/APPDATA/TEMP, scratch log/intents/preset
// folders, bridge ports 18765/18766 (lock 18767) and a missing token file, so it never meets
// Jim's plugin, his Claude Desktop config or his data (engine\src\mcp\dev-overrides.ts,
// engine\tests\probe\harness.ts overrides).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repo, scratch] = process.argv.slice(2) as [string, string];
const req = createRequire(path.join(repo, "package.json"));
const { Client } = req("@modelcontextprotocol/client") as typeof import("@modelcontextprotocol/client");
const { StdioClientTransport } = req("@modelcontextprotocol/client/stdio") as typeof import("@modelcontextprotocol/client/stdio");
const { TOOL_DEFS, ENGINE_VERSION } = (await import(pathToFileURL(path.join(repo, "engine", "dist", "mcp", "index.js")).href)) as { TOOL_DEFS: { name: string }[]; ENGINE_VERSION: string };
const { PLUGIN_VERSION } = (await import(pathToFileURL(path.join(repo, "engine", "dist", "bridge", "version.js")).href)) as { PLUGIN_VERSION: string };
const tar = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
const release = path.join(repo, "release");
let failed = 0;
const check = (ok: boolean, what: string): void => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};

rmSync(scratch, { recursive: true, force: true });
const dir = (...p: string[]): string => {
  const d = path.join(scratch, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};
const temp = dir("temp");
const env: Record<string, string> = {
  SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
  PATH: process.env["PATH"] ?? "",
  LRC_AVG_COMMAND_PORT: "18765",
  LRC_AVG_EVENT_PORT: "18766",
  LRC_AVG_TOKEN_FILE: path.join(scratch, "no-token"),
  LRC_AVG_LOG_DIR: dir("logs"),
  LRC_AVG_INTENTS_DIR: dir("intents"),
  LRC_AVG_PRESET_DIR: dir("presets"),
  LRC_AVG_HUD_EXE: path.join(scratch, "no-deck.exe"),
  TEMP: temp,
  TMP: temp,
  USERPROFILE: dir("home"),
  LOCALAPPDATA: dir("local"),
  APPDATA: dir("roaming"),
};

/** initialize, tools/list, prompts/list against `main` started with this node.exe. */
async function serve(label: string, main: string): Promise<string[]> {
  const client = new Client({ name: "lrc-avg-dist-smoke", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [main], env, stderr: "ignore" }));
  try {
    const server = client.getServerVersion();
    check(server?.name === "lrc-avg" && server.version === ENGINE_VERSION, `${label}: initialize -> ${server?.name} ${server?.version}`);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    check(tools.length === TOOL_DEFS.length, `${label}: tools/list -> ${tools.length} tools (TOOL_DEFS.length ${TOOL_DEFS.length})`);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    check(prompts.join(",") === "lrc-avg-edit,lrc-avg-help", `${label}: prompts/list -> ${prompts.join(",")}`);
    return tools;
  } finally {
    await client.close();
  }
}

console.log(`node ${process.version}; engine ${ENGINE_VERSION}; plugin ${PLUGIN_VERSION}; scratch ${scratch}`);

// (a) The npm package, installed as a user would install it, short of publishing.
const tgz = path.join(release, `lrc-avg-${ENGINE_VERSION}.tgz`);
const prefix = dir("npm");
console.log(execFileSync("cmd.exe", ["/d", "/c", "npm", "install", "--prefix", prefix, "--no-audit", "--no-fund", tgz], { encoding: "utf8" }).trim());
const pkg = path.join(prefix, "node_modules", "lrc-avg");
const bin = (JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8")) as { bin: Record<string, string> }).bin["lrc-avg"] ?? "";
check(bin === "dist/mcp/main.js", `tgz: package.json bin lrc-avg = ${bin}`);
await serve("tgz", path.join(pkg, bin));

// (b) The Claude Desktop extension bundle, extracted.
const mcpb = path.join(release, `lrc-avg-${ENGINE_VERSION}.mcpb`);
const ext = dir("mcpb");
execFileSync(tar, ["-xf", mcpb, "-C", ext]);
const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8")) as { version: string; tools: { name: string }[] };
check(manifest.version === ENGINE_VERSION, `mcpb: manifest version ${manifest.version}`);
const listed = await serve("mcpb", path.join(ext, "server", "dist", "mcp", "main.js"));
const names = manifest.tools.map((t) => t.name);
check(JSON.stringify([...names].sort()) === JSON.stringify([...listed].sort()), `mcpb: manifest tools (${names.length}) equal tools/list (${listed.length})`);

// (c) The plugin zip.
const zip = path.join(release, `LrC-AVG.lrplugin-${PLUGIN_VERSION}.zip`);
const entries = execFileSync(tar, ["-tf", zip], { encoding: "utf8" }).split(/\r?\n/).filter((e) => e !== "" && !e.endsWith("/"));
const repoFiles = readdirSync(path.join(repo, "plugin", "LrC-AVG.lrplugin"), { recursive: true, encoding: "utf8" }).filter((p) => statSync(path.join(repo, "plugin", "LrC-AVG.lrplugin", p)).isFile());
check(entries.length === repoFiles.length + 1 && entries.includes("LICENSE"), `zip: ${entries.length} entries = ${repoFiles.length} plugin files + LICENSE`);
const info = execFileSync(tar, ["-xOf", zip, "LrC-AVG.lrplugin/Info.lua"], { encoding: "utf8" });
const count = (s: string): number => info.split(s).length - 1;
// The ID also appears once in the header comment ("ships it as com.lrcavg.gateway"); the check is on the declaration.
check(count("LrToolkitIdentifier") === 1 && count("LrToolkitIdentifier = 'com.lrcavg.gateway'") === 1, `zip: Info.lua declares LrToolkitIdentifier = 'com.lrcavg.gateway' ${count("LrToolkitIdentifier = 'com.lrcavg.gateway'")}x (LrToolkitIdentifier ${count("LrToolkitIdentifier")}x)`);
check(count("com.lrcavg.gateway.dev") === 0 && count("LrC-AVG (dev)") === 0, `zip: Info.lua holds the dev ID ${count("com.lrcavg.gateway.dev")}x, the dev name ${count("LrC-AVG (dev)")}x`);
check(count('LrPluginName = "LrC-AVG (Autonomous Vision Gateway)"') === 1, `zip: Info.lua LrPluginName = "LrC-AVG (Autonomous Vision Gateway)"`);

rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failed === 0 ? "WORKED: every check passed" : `FAILED: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
```
