# Third-party notices: LrC-AVG Lightroom plugin

Parts of this plugin are derived from **Automaat/lightroom-mcp** (https://github.com/Automaat/lightroom-mcp), commit `a160e7aa250b3264694d88e51418f7f512f417de`, vendored read-only in the repository at `vendor\automaat\`. The repo survey is `docs\AUTOMAAT_SURVEY.md`.

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `Json.lua` | `plugin/LightroomMCP.lrplugin/JSON.lua` | The encoder/decoder structure, the UTF-8 code-point and surrogate handling. Escaping, number output and error handling changed; see the file header. |
| `Bridge.lua` | `plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua` (lines 384-589) | The dual `LrSocket` pattern: callbacks set flags and a monitor loop acts on them, the generation-guarded rebind of a socket, and the rebind of the send socket on a new receive-side client. |
| `PluginInit.lua` | `plugin/LightroomMCP.lrplugin/PluginInit.lua` | Starting the server in its own function context from the init script. |

The engine's derived files are listed in `engine\THIRD_PARTY_NOTICES.md`.

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
