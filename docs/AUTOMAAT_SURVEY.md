---
document_type: survey
project: LrC_Autonomous_Gateway
subject: Automaat/lightroom-mcp (vendored reference)
authored_by: Claude Code (Opus 5.5), Phase 0 session 2026-09-23
---

# Automaat/lightroom-mcp — repo survey

> Written by Claude Code in the Phase 0 session of 2026-09-23 by reading the vendored source. Every structural claim cites `path:line` relative to `vendor\automaat\` at the upstream commit below. Statements about *Lightroom runtime behaviour* that come from Automaat's own comments are tagged **[upstream claim]**: Automaat's authors observed them, we have not. Anything else unconfirmed is tagged **[unverified]**.

## 1. Provenance

| Field | Value |
|---|---|
| Upstream | https://github.com/Automaat/lightroom-mcp |
| Commit vendored | `a160e7aa250b3264694d88e51418f7f512f417de` (branch `main`) |
| Commit date / subject | 2026-09-22 02:51:01 +0000 — "chore(deps): update dependency typescript-eslint to v8.70.1 (#232)" |
| History depth at clone | 190 commits |
| Vendoring method | plain `git clone`, then `vendor\automaat\.git` deleted (frozen snapshot, not a submodule). Command handle: `git clone https://github.com/Automaat/lightroom-mcp vendor/automaat` + `git log -1 --format=%H` → `a160e7aa…17de`. |
| Package | npm `@mskalski/lightroom-mcp` v0.15.0 (`server/package.json:2-3`) |

`vendor\automaat\` is read-only reference. New code goes in `engine\` and `plugin\`.

## 2. License

- **Type: MIT.** `LICENSE:1` ("MIT License"), `LICENSE:3` ("Copyright (c) 2026 Marcin Skalski"). `server/LICENSE` is byte-identical (`diff LICENSE server/LICENSE` → no output). `server/package.json:40` declares `"license": "MIT"`.
- **What it permits:** use, copy, modify, merge, publish, distribute, sublicense, sell (`LICENSE:5-9`). Fork + redistribution as a separate package is permitted. **No STOP condition.**
- **What it requires:** "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." (`LICENSE:12-13`).
- **Our obligation:** any file in `engine\` or `plugin\` that is ported from or substantially derived from Automaat must ship with Automaat's copyright + permission notice. Plan: a `THIRD_PARTY_NOTICES.md` at the package root of each shipped half (engine npm package, `.lrplugin`) that reproduces `LICENSE` verbatim and lists the derived files. Not needed yet — no code has been ported in Phase 0.
- `plugin/LightroomMCP.lrplugin/JSON.lua` has no separate license header (`JSON.lua:1` "Simple JSON encoder/decoder for Lightroom"; `grep -i "license|copyright"` → no hits), so it falls under the repo MIT license.

## 3. Repo layout

103 tracked files at the vendored commit (`git ls-files | wc -l` before `.git` removal).

```
vendor\automaat\
  plugin\LightroomMCP.lrplugin\   Lua plugin (15 files, see §4)
  plugin\spec\                    busted unit specs for the Lua plugin (13 files)
  server\src\                     TypeScript MCP server (17 files, see §5)
  server\tests\                   Jest tests (18 files)
  mcpb\manifest.json              Claude Desktop .mcpb bundle manifest
  scripts\                        build-binary / build-mcpb / bump-version (.mjs)
  skills\raw-photo-lightroom-preset\  agent skill incl. a Python script (see §8)
  tests\e2e\                      e2e plan + MCP runner (.mjs)
  manual-test.mjs                 raw TCP probe that bypasses MCP
  lightroom.yml, selene.toml, .busted   Lua lint/test config
  .mise.toml                      toolchain pins + task runner
  CLAUDE.md, AGENTS.md, README.md, README.zh-TW.md
```

Upstream's own layout statement: `CLAUDE.md:5-9`.

## 4. Lua plugin structure (`plugin/LightroomMCP.lrplugin/`)

### 4.1 Info.lua
- `LrSdkVersion = 8.0`, `LrSdkMinimumVersion = 8.0` — `Info.lua:2-3`.
- `LrToolkitIdentifier = 'com.lightroom.mcp'` — `Info.lua:5`.
- `LrPluginInfoProvider = 'PluginInfoProvider.lua'`, `LrInitPlugin = 'PluginInit.lua'` — `Info.lua:12-13`.
- `LrForceInitPlugin = true` (eager load; comment says it only works if at least one menu item exists) — `Info.lua:14-17`.
- **Menu items:** exactly one, under `LrLibraryMenuItems`: "Lightroom MCP — Show Status" → `MenuShowStatus.lua` — `Info.lua:19-24`. No `LrExportMenuItems`, no Develop-module items.

### 4.2 Startup (PluginInit.lua)
- Calls `PluginInfoProvider.resetForReload()` on every load/reload — `PluginInit.lua:15`.
- `autoStartServer` pref defaults to `true` — `PluginInit.lua:17-22`.
- Auto-start via `LrFunctionContext.postAsyncTaskWithContext` (not `LrTasks.startAsyncTask`, because the init script's context is torn down when it returns — **[upstream claim]**, issue #128) — `PluginInit.lua:25-31`; `LrTasks.sleep(0.5)` before binding so a prior instance can release ports — `PluginInit.lua:34`; `LrTasks.pcall(PluginInfoProvider.startServer)` with logged failure — `PluginInit.lua:40-46`.

### 4.3 Transport — LrSocket dual socket (PluginInfoProvider.lua)
- Default ports: request `58763`, response `58764` — `PluginInfoProvider.lua:22-23`; overridable via `LrPrefs` `requestPort`/`responsePort` — `PluginInfoProvider.lua:37-44`.
- Request socket: `LrSocket.bind { mode = "receive", port = requestPort, … }` — `PluginInfoProvider.lua:384-446`.
- Response socket: `LrSocket.bind { mode = "send", port = responsePort, … }` — `PluginInfoProvider.lua:468-500`.
- Both are bound inside one `postAsyncTaskWithContext("LightroomMCPServer", …)` whose cleanup handler closes both sockets — `PluginInfoProvider.lua:361-382`, binds at `:505-509`.
- `onMessage` is treated as **non-yielding**: it only decodes/authenticates (`consumeMessage`, `:292-322`) and hands off to `LrTasks.startAsyncTask(function() dispatchAction(request) end)` — `PluginInfoProvider.lua:419-426`. **[upstream claim]** `CLAUDE.md` (vendored) states "`onMessage` runs in non-yielding context".
- Responses are written by `sendResponse`, which waits up to 25 s for `sendConnected`, then `responseSocket:send(payload .. "\n")` — `PluginInfoProvider.lua:166, 205-236`.
- **Framing:** newline-terminated JSON both ways — plugin appends `"\n"` at `PluginInfoProvider.lua:234`; server splits on `\n` at `server/src/plugin-socket.ts:53-62` and appends `"\n"` at `server/src/plugin-socket.ts:93`.
- **Auth:** per-plugin-start 256-bit token (two UUIDs, `:103-108`) written to `~/.config/lightroom-mcp/token` (`:87-93, 110-127`); every request must carry `hello = <token>` or it is silently dropped (`:313-319`). Server reads the same file — `server/src/token.ts:5-26`, sends it as `hello` — `server/src/dispatcher.ts:88`.
- **Monitor loop** (not a poll of work — a supervision loop): runs every 0.2 s (`LrTasks.sleep(0.2)` at `PluginInfoProvider.lua:583`), handles request reconnect (`:512-515`), response rebind with a generation counter (`:519-541`), full restart on stale connection (`:547-557`), and stale detection (`:568-582`).
- **Heartbeat:** plugin-side interval constant 30 s, stale after 3 missed (90 s), hard cap +30 s while a request is in flight — `PluginInfoProvider.lua:181-190`; `ping` action returns `{pong=true}` — `:137`.
- **Windows-specific socket potholes [upstream claim]:** send-mode socket does not reliably notice client disconnect on Windows (`PluginInfoProvider.lua:410-415`); `onClosed` not reliably fired on Windows when the remote process exits, issue #134 (`:558-560`); listener can end up "bound-but-clientless", issue #110 (`:167-173`); `LrSocket.bind` in receive mode fires `onError` ("timeout"/"failed to open") while no client is attached (`:25-31`); do not call `:reconnect()` synchronously from `onError` — set a flag and act in the loop (vendored `CLAUDE.md` Architecture section).

### 4.4 Dispatch table
`DISPATCH` maps action name → handler — `PluginInfoProvider.lua:129-159`. Unknown action → error response (`:265-270`). Handlers run under `LrTasks.pcall` (xpcall/debug.traceback not reliably available in the LR sandbox **[upstream claim]**) — `:272-284`.

### 4.5 Catalog access patterns
- **Reads** in `catalog:withReadAccessDo` — e.g. `HandlerMetadata.lua:55`, `HandlerCollections.lua:18`, `HandlerSelection.lua:44`.
- **Yielding catalog queries are kept OUTSIDE the read gate** (`getTargetPhotos`, `findPhotos`): nesting them deadlocks on Windows **[upstream claim]**, issues #124/#134 — `HandlerSelection.lua:30-38`, `HandlerSearch.lua:102-114`; `setSelectedPhotos` likewise outside — `HandlerSelection.lua:96-99`.
- **Writes** in named `catalog:withWriteAccessDo(name, fn)` — `HandlerDevelop.lua:673, 734, 770`; `HandlerOrganization.lua:53, 122`; `HandlerCollections.lua:80, 154`; import uses one short write gate *per photo* to bound hold time — `HandlerImport.lua:57-67`.
- **Photo resolution** by `localIdentifier` or path via one `catalog:getAllPhotos()` scan — `PhotoLookup.lua:20-79`. Comment: "LrCatalog has no findPhotoByLocalIdentifier" — `PhotoLookup.lua:37`. ⚠ This conflicts with LR_SDK_NOTES' [community] mention of `catalog:getPhotoByLocalId`; **[unverified]** which is right on LrC 15.5.1 — resolve when Phase 1 needs target lookup.
- **Develop reads:** `photo:getDevelopSettings()` inside a read gate — `HandlerMetadata.lua:72`, `HandlerDevelop.lua:580, 717`.
- **Develop writes:** `photo:applyDevelopSettings(settings)` with **no History name argument** — `HandlerDevelop.lua:737, 771`. (Our FR-4.4 requires a named step per pass.)
- **No `LrTasks.yield()` anywhere** in batch loops (grep over `*.lua` for `LrTasks.yield` → no hits). Our NFR-1 requires yields between photos.
- **Export:** `LrExportSession { photosToExport, exportSettings }` + `doExportOnCurrentTask()`, with the read gate released before rendering — `HandlerExport.lua:41-56, 107-113`. Settings used: `LR_export_destinationType='specificFolder'`, `LR_export_destinationPathPrefix`, `LR_export_useSubfolder=false`, `LR_jpeg_quality`, `LR_collisionHandling` (never `ask`, which opens a blocking modal **[upstream claim]**), long-edge sizing via `LR_size_doConstrain/maxWidth/maxHeight/resizeType='longEdge'`, `LR_format='JPEG'`, `LR_export_colorSpace='sRGB'` — `HandlerExport.lua:11-21, 71-104`. **This is the direct template for our S1 export timing and the `export_preview` fallback.**
- **Presets:** `LrApplication.developPresetFolders()` (`HandlerDevelop.lua:330`), `LrApplication.getDevelopPresetsForPlugin(_PLUGIN)` (`:336-337`), `LrApplication.addDevelopPresetForPlugin(_PLUGIN, name, settings)` (`:593`) — which Automaat reports as `visible_in_develop = false` (`:600`), and `photo:applyDevelopPreset(preset[, _PLUGIN])` (`:677-679`). Relevant to PRD OQ-3: the API route yields a *plugin-managed* preset that Automaat says is hidden from the Develop panel **[upstream claim]**, which argues for the XMP-file route for PRD §6.11 **[inference]**.
- **Logging:** own file sink at `Documents\LrClassicLogs\LightroomMCP.log` because `LrLogger:enable("logfile")` alone was unreliable on Windows **[upstream claim]**, issue #134 — `Log.lua:3-9, 34-46`; 5 MB rotation — `Log.lua:53-60`.

### 4.6 SDK features Automaat does NOT use
Grep over `plugin/LightroomMCP.lrplugin/*.lua` for `requestJpegThumbnail|createVirtualCopies|createDevelopSnapshot|LrDevelopController|presentFloatingDialog|LrObservableTable` → **no hits**. Everything LrC-AVG needs for previews, virtual copies, snapshots and the HUD is new work (Phase 0 spikes S1, S4, S6).

### 4.7 Settings page
`PluginInfoProvider.sectionsForTopOfDialog` — status text, auto-start checkbox, request/response port fields bound to `LrPrefs`, Start/Stop/Show Status buttons — `PluginInfoProvider.lua:678-805`. Push-button titles cannot be bound **[upstream claim]** — `:760-765`. Pattern reusable for the PRD §6.2 settings page (Phase 5).

## 5. Node MCP server structure (`server/src/`)

- **Transport:** stdio only — `new StdioServerTransport()` + `server.connect(transport)` — `index.ts:5, 191-192`. Exits on stdin end/close so an orphaned bridge doesn't hold the single-client plugin sockets — `index.ts:194-206`.
- **MCP server object:** low-level `Server` from `@modelcontextprotocol/sdk/server/index.js`, capabilities `{ tools: {} }` — `create-server.ts:1, 18-22`; `ListToolsRequestSchema` and `CallToolRequestSchema` handlers — `create-server.ts:24-32`.
- **Tool registry:** a single `TOOL_CONTRACTS: ToolContract[]` array (name, description, luaHandler, JSON-Schema `inputSchema`) — `tool-contracts.ts:5-10, 190-523`; exposed via `list-tools-handler.ts:4-14`; arguments validated with Ajv against the same schemas before dispatch — `validate-args.ts:12-16, 32-40`, called at `tool-handler.ts:22-28`. Adding a tool = contract entry + `DISPATCH` entry in Lua (vendored `CLAUDE.md` Conventions).
- **Tool call path:** `tool-handler.ts:21-56` → `Dispatcher.call(action, params)` which writes `{hello, id, action, params}` to the request socket and awaits the id-matched response line — `dispatcher.ts:65-100`, correlation at `:46-63`.
- **Plugin sockets:** `PluginSocket` is a TCP *client* to `127.0.0.1` with 1 s reconnect — `plugin-socket.ts:30-39, 41-89`; request socket connects first, response socket 200 ms after — `index.ts:124-157, 33`.
- **Timeouts:** 30 s default, 300 s for `export_photos`/`import_photos`, 10 s ping — `index.ts:25-28, 32, 44-48`.
- **Heartbeat:** `ping` every 30 s — `index.ts:31`, `heartbeat.ts:23-35`; liveness probe on connect (5 s) and "shadow bridge" detection — `index.ts:37-38, 102-123`, `plugin-liveness.ts:19, 26`.
- **Single-instance lock:** `~/.config/lightroom-mcp/bridge-<req>-<res>.lock` with PID liveness check — `instance-lock.ts:28-56`.
- **Auto-install side effect:** on every start, if no plugin is installed anywhere, copies the bundled `.lrplugin` into `%APPDATA%\Adobe\Lightroom\Modules` — `index.ts:91`, `install-plugin.ts:22-24, 119-132`. (We should not inherit an implicit write into the user's Lightroom folder; make install explicit.)
- **Image handling:** **none.** Tool results are text-only: `ToolResponse.content: Array<{ type: "text"; text: string }>` — `tool-handler.ts:11-15`; success path returns `JSON.stringify(resp.result, null, 2)` as text — `tool-handler.ts:47-49`. No `sharp`, no `image` content blocks. The whole preview/vision path is new (S1, S3).
- **Errors:** returned as `{ isError: true, content: [text] }` with the plugin's raw error string — `tool-handler.ts:41-45, 50-54` (our NFR-7 wants structured `{code, message, recoverable}`).

## 6. HTTP polling — where the 3 s interval lived

**There is no HTTP polling at the vendored commit.** LR_SDK_NOTES' statement (via lobehub) that Automaat "uses HTTP polling every 3 s" and that "LrSocket does not support server sockets" is **stale**:

- The 3 s interval lived in `plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua` at upstream commit `83880fb` ("Refactor plugin architecture with HTTP polling model.", 2026-02-07): `local POLL_INTERVAL = 3 -- seconds` (line 26) and `LrTasks.sleep(POLL_INTERVAL)` (line 197). Handle: https://github.com/Automaat/lightroom-mcp/blob/83880fbd60c9f5a5792796a46fb21c33862bb27f/plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua#L26 (observed via `git grep -n POLL 83880fb` before `.git` was removed).
- It was removed by upstream commit `3ef5d7274e0fd9ed155d8ebe004a20e8dcd35b46` "feat(transport): switch to LrSocket dual-port (#21)", 2026-05-06. Its message: "The HTTP polling transport … was a fallback from a misdiagnosis. The previous attempt assumed `LrSocket` couldn't bind a server socket, but `mode='receive'` does exactly that — verified against MIDI2LR source (`rsjaffe/MIDI2LR` `src/plugin/Client.lua`)". Handle: https://github.com/Automaat/lightroom-mcp/commit/3ef5d7274e0fd9ed155d8ebe004a20e8dcd35b46.
- Current dual-socket implementation: §4.3 above.

**Consequence for AVG-004 / spike S2** [inference]: the dual-socket topology in ARCHITECTURE §1 (plugin listens `receive` for commands, `send` for responses/events; engine connects to both) is the same topology Automaat has shipped since May 2026, so the "HTTP polling fallback" is unlikely to be needed. S2 is still required to measure *our* numbers on Jim's machine — RTT and the maximum single-line message size, which Automaat never exercises (its payloads are small JSON).

## 7. MCP tools exposed — keep / rewrite / drop against PRD §7

**18 MCP tools** are published in `TOOL_CONTRACTS` (`tool-contracts.ts:190-523`; `name:` entries at lines 192, 216, 229, 243, 256, 270, 284, 299, 318, 339, 372, 382, 389, 404, 431, 456, 477, 502 — counted with `grep -n '^    name: "'`). The Lua `DISPATCH` table additionally has `ping` (heartbeat, `PluginInfoProvider.lua:137`) and test-only `set_selection` with no MCP contract (`:148-150`). Contract-line citations below point at each entry's opening `{` (one line above its `name:`).

| # | Tool | Contract | Lua handler | Recommendation | Reason |
|---|---|---|---|---|---|
| 1 | `search_photos` | `tool-contracts.ts:191-214` | `HandlerSearch.searchPhotos` (`PluginInfoProvider.lua:138`) | **Keep** | Catalog read; PRD §7 "retained: catalog/collection/metadata read tools". |
| 2 | `get_selected_photos` | `:215-227` | `HandlerSelection.getSelectedPhotos` (`:147`) | **Keep** | Read; its outside-the-gate `getTargetPhotos` pattern (`HandlerSelection.lua:30-38`) is what `lr_get_active_photo_context` needs. |
| 3 | `get_photo_metadata` | `:228-241` | `HandlerMetadata.getPhotoMetadata` (`:142`) | **Rewrite** | EXIF/IPTC part is reusable for `lr_get_active_photo_context`, but it returns raw SDK develop keys (`HandlerMetadata.lua:72`); our rule is canonical names only via the params map. |
| 4 | `list_collections` | `:242-254` | `HandlerCollections.listCollections` (`:139`) | **Keep** | Read; supports `lr_sync_series targets: "collection:<id>"`. |
| 5 | `create_collection` | `:255-268` | `HandlerCollections.createCollection` (`:140`) | **Drop (v1)** | Catalog write not in PRD §7; trivial to re-add. |
| 6 | `add_to_collection` | `:269-282` | `HandlerCollections.addToCollection` (`:141`) | **Drop (v1)** | Same as 5. |
| 7 | `set_keywords` | `:283-297` | `HandlerOrganization.setKeywords` (`:143`) | **Keep** | MCP_TOOLS "Retained Automaat tools" lists keyword tools as candidates; not a develop write. |
| 8 | `set_rating` | `:298-316` | `HandlerOrganization.setRating` (`:144`) | **Keep** | MCP_TOOLS lists metadata write as a candidate; not a develop write. |
| 9 | `import_photos` | `:317-337` | `HandlerImport.importPhotos` (`:145`) | **Drop** | Out of LrC-AVG scope. |
| 10 | `export_photos` | `:338-370` | `HandlerExport.exportPhotos` (`:146`) | **Drop as a tool; reuse the pattern** | Not in PRD §7; `HandlerExport.lua:71-113` is the template for the internal `export_preview` fallback and S1 export timing. |
| 11 | `list_develop_presets` | `:371-380` | `HandlerDevelop.listDevelopPresets` (`:151`) | **Defer to Phase 4** | Read-only; useful input to `lr_create_preset_from_active`. |
| 12 | `get_develop_preset` | `:381-387` | `HandlerDevelop.getDevelopPreset` (`:152`) | **Defer to Phase 4** | Same as 11. |
| 13 | `compare_develop_presets` | `:388-402` | `HandlerDevelop.compareDevelopPresets` (`:153`) | **Drop** | No PRD requirement. |
| 14 | `create_develop_preset` ⚠ develop-write | `:403-429` | `HandlerDevelop.createDevelopPreset` (`:154`, impl `HandlerDevelop.lua:558-604`) | **Rewrite (Phase 4)** | Becomes `lr_create_preset_from_active`; mechanism (plugin API vs XMP) decided by the Phase 4 spike — see §4.5 presets note. |
| 15 | `export_develop_preset` | `:430-454` | `HandlerDevelop.exportDevelopPreset` (`:155`) | **Defer to Phase 4** | File copy of a preset backing file; possible part of the XMP route. |
| 16 | `apply_develop_preset` ⚠ develop-write | `:455-475` | `HandlerDevelop.applyDevelopPreset` (`:156`, impl `HandlerDevelop.lua:658-702`) | **Drop** | Unguarded develop write; no v1 requirement. If ever needed, route through session guardrails. |
| 17 | `copy_develop_settings` ⚠ develop-write | `:476-500` | `HandlerDevelop.copyDevelopSettings` (`:157`, impl `HandlerDevelop.lua:704-756`) | **Rewrite → `lr_sync_series`** | Needs canonical parameter mask, named History step, `LrTasks.yield()` between photos, adaptive exposure. |
| 18 | `set_develop_settings` ⚠ develop-write | `:501-522` | `HandlerDevelop.setDevelopSettings` (`:158`, impl `HandlerDevelop.lua:758-781`) | **Rewrite → `lr_step`** (and the Phase 2 temporary `lr_set_settings`) | Must go through canonical names, clamping, guardrails, session target check and a named History step; Automaat's version does none of these (`HandlerDevelop.lua:770-773`). |

Tally (18): keep 5 (rows 1, 2, 4, 7, 8), rewrite 4 (3, 14, 17, 18), defer to Phase 4 3 (11, 12, 15), drop 6 (5, 6, 9, 10, 13, 16 — row 10's `LrExportSession` pattern is reused internally).

**Develop-write tools (all rewrite-or-drop):** `create_develop_preset`, `apply_develop_preset`, `copy_develop_settings`, `set_develop_settings` (rows 14, 16, 17, 18).

**Develop-key allowlist:** Automaat hand-maintains the same 82-key list twice — `tool-contracts.ts:22-102` (78 literals + 4 point-curve keys spread in at `:68`) and `HandlerDevelop.lua:20-103` (82 literals). It includes `LensProfileEnable` (`tool-contracts.ts:81`) but not `CameraProfile`, `EnableLensCorrections`, `ProcessVersion`, `AutoLateralCA`, or any color-grading key. Per `.claude\rules\03-lightroom.md` we do **not** copy these names; our map is generated from the S5 `getDevelopSettings()` dump. The list is only a cross-check. ⚠ Note the `LensProfileEnable` (Automaat) vs `EnableLensCorrections` (LR_SDK_NOTES, directive S5) naming — both may exist with different meanings **[unverified]**; the S5 harness reads back both.

## 8. Node version, toolchain and dependencies

- `engines.node: ">=18"` — `server/package.json:50-52`. (LR_SDK_NOTES' "requires Node.js 22+" via lobehub is not what `package.json` states at this commit.)
- Toolchain pins: `node = "24.21.0"`, `bun = "1.4.2"`, `lua = "5.5.1"`, selene `0.31.0` — `.mise.toml:2-7`. CI uses Node `24.21.0` — `.github/workflows/ci.yml:33, 69`.
- TypeScript config: ES2022, `module`/`moduleResolution` NodeNext, `strict: true` — `server/tsconfig.json:3-5, 10`.
- Runtime dependencies — `server/package.json:53-56`:
  - `@modelcontextprotocol/sdk` `^1.29.0`
  - `ajv` `^8.20.0`
- Dev dependencies — `server/package.json:57-67`: `@types/jest ^30.0.0`, `@types/node ^25.6.0`, `@typescript/native` (`npm:typescript@^7.0.2`), `eslint ^10.4.0`, `eslint-plugin-unused-imports ^4.4.1`, `jest ^30.0.0`, `ts-jest ^29.2.5`, `typescript` (`npm:@typescript/typescript6@^6.0.2`), `typescript-eslint ^8.59.3`.
- Test runners: Jest for TS (`server/package.json:23`), busted for Lua (`.mise.toml:45-48`).
- **Python in the upstream snapshot:** `skills/raw-photo-lightroom-preset/scripts/generate_xmp_preset.py` and its unittest (`.mise.toml:37-39` runs it with `python3 -m unittest`). Stack rule: these files stay on disk unmodified (vendor is reference-only) but are excluded from our git by `.gitignore` (`vendor/automaat/**/*.py`). Nothing in LrC-AVG imports or runs them. The skill is **Dropped**.

## 9. What to carry into LrC-AVG (summary)

| Carry | Source | Into |
|---|---|---|
| Dual-socket bind + generation-counted rebind + monitor loop | `PluginInfoProvider.lua:324-589` | `plugin\LrC-AVG.lrplugin\Bridge.lua` (Phase 1), after S2 |
| `onMessage` → `LrTasks.startAsyncTask` dispatch | `PluginInfoProvider.lua:419-426` | Bridge.lua |
| Init via `postAsyncTaskWithContext` + 0.5 s settle | `PluginInit.lua:31-47` | Info/Init (Phase 1) |
| Yielding queries outside read gate | `HandlerSelection.lua:30-38` | Develop.lua / context |
| LrExportSession JPEG settings, no-prompt collisions | `HandlerExport.lua:71-113` | Preview.lua export fallback; S1 |
| Newline-framed TCP client with reconnect | `server/src/plugin-socket.ts` | `engine\src\bridge\` |
| id-correlated dispatcher with per-action timeouts | `server/src/dispatcher.ts` | `engine\src\bridge\` |
| stdin-EOF exit, instance lock | `server/src/index.ts:194-206`, `instance-lock.ts` | `engine\src\mcp\` |
| Own log-file sink (Windows) | `Log.lua` | plugin Log.lua |

Differences we must introduce: named History steps, `LrTasks.yield()` in batches, canonical parameter map, image content blocks, structured errors, explicit (not implicit) plugin install, ports 8765/8766 per PRD §6.2 (Automaat uses 58763/58764 — no clash if both plugins are installed).
