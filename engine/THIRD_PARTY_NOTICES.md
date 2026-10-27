# Third-party notices: LrC-AVG engine

Parts of the engine are derived from **Automaat/lightroom-mcp** (https://github.com/Automaat/lightroom-mcp), commit `a160e7aa250b3264694d88e51418f7f512f417de`, vendored read-only in the repository at `vendor\automaat\`. The repo survey is `docs\AUTOMAAT_SURVEY.md`.

| File in the engine | Derived from | What was taken |
|---|---|---|
| `src/bridge/client.ts` | `server/src/plugin-socket.ts`, `server/src/dispatcher.ts` | The TCP client to the plugin's two listeners, with reconnect; the id-correlated table of pending requests, with per-request timeouts. |
| `src/mcp/main.ts` | `server/src/index.ts` | Exiting when stdin ends, so an orphaned engine does not keep the plugin's sockets. |

The plugin's derived files are listed in `plugin\LrC-AVG.lrplugin\THIRD_PARTY_NOTICES.md`.

### Later upstream commits (engine 0.15.0, plugin 0.10.0)

Three commits made upstream after the snapshot were rewritten into this project's patterns (photos by uuid, `lr_` tools, zod-checked arguments, before/after read-back) for GitHub issue #60 [stated: Jim, 2026-10-03, "Keyword hierarchy, set_gps, MCP SDK 1.32.0" plus the bind-failure log line]. No upstream file was copied; `vendor\automaat\` stays at `a160e7a`. Same MIT licence and copyright as below.

| Upstream commit | What was taken | Files here |
|---|---|---|
| `11c0b9332cc9547e3cafcfdfc52ab8931c11ec2d` (#246, "address keywords by hierarchy path") | Keywords named by a `\|`-separated path, missing levels created one write gate per depth, names compared case aside, a sorted depth-first listing of the tree | `src/library/keywords.ts`, `src/mcp/tools-catalog.ts`, `src/mcp/defs-catalog.ts` (`lr_set_keywords`, `lr_list_keywords`); plugin `KeywordTree.lua`, `Library.lua` |
| `9ba2ed613bfef1a1c76b89404694632bde04deaa` (#247, "add set_gps tool") | Writing a photo's position with `setRawMetadata("gps", { latitude, longitude })`, range-checked | `src/mcp/tools-catalog.ts`, `src/mcp/defs-catalog.ts` (`lr_set_gps`), `src/library/write.ts`; plugin `Library.lua` |
| `923f27d29a61f66b4690ee82a2a8373d01544a9d` (#236, "diagnose hijacked plugin ports"), the plugin half only | Logging a socket's "failed to open", throttled to once per 10 s per socket, naming the port and the likely holder | plugin `Sockets.lua` |
| `92b0b555629868e28e245844bdc0d5cab5ca60f3` (#192, "Lightroom round-trip v2") as of `1040453a5db79e42d44dbd33d1ca9dd549f2bde0`, and `efce08f7715f6024e3ec7a170237f20909b30e3f` (#313, "recompute AI masks on preset or copy"), for GitHub issue #215 | Listing presets with plugin checkpoints as their own scope, choosing one by uuid (aliases of one uuid as one preset) or by an unambiguous name, comparing two without the mask ids renewed on every read, a checkpoint through `addDevelopPresetForPlugin` refused over an existing name, exporting a preset's file without overwriting and with its extension, and the AI-mask recompute in a write gate of its own, never through `applyDevelopPreset`'s argument | `src/presets/lightroom.ts`, `apply.ts`, `checkpoint.ts`, `export.ts`, `src/params/preset-read.ts`, `src/mcp/tools-presets.ts`, `src/mcp/defs-presets.ts`; plugin `Presets.lua` |

### Develop parity (GitHub issue #214, epic #207)

Rewritten from upstream at `1040453` (2026-10-26; PRs #405, #407, #410, #411, #412), not copied; same MIT licence and copyright as below.

| Upstream | What was taken | Files here |
|---|---|---|
| `server/src/tool-contracts.ts` `apply_auto_adjustments`, `reset_develop_adjustments`, `set_process_version`, `list/create/apply/delete_develop_snapshot`, `create_virtual_copies` | The tools' scope: Auto Tone / Auto WB, Reset with `confirm`, Version 1-6 with masked downgrades refused, snapshots by id, up to 25 virtual copies with an optional name, per-photo outcomes within a time budget | `src/mcp/tools-develop.ts`, `src/mcp/tools-snapshots.ts`, `src/mcp/defs-develop.ts`; plugin `DevelopTools.lua`, `Snapshots.lua`, `Copies.lua` |
| `plugin/LightroomMCP.lrplugin/DevelopSession.lua` | One photo at a time in Develop, the view (module, sources, selection) put back | plugin `DevelopSession.lua` (out of `Denoise.lua`, which ported PR #288 for issue #190) |

npm dependencies keep their own licences; they are listed with their versions in `docs\DEPENDENCIES.md`.

## Automaat/lightroom-mcp licence

```
MIT License

Copyright (c) 2026 Marcin Skalski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
