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
