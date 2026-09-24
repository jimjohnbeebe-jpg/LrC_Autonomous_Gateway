# AVG-S3 — vision in Claude Desktop (and Claude Code)

**Question (PHASES.md):** when an MCP tool returns a 1600 px q75 JPEG as an `image` content block, does Claude Desktop display it, and can Claude describe it? Does Claude Code CLI do the same?
**Rule:** Go = Desktop renders. No-go = re-decide the runtime client (AVG-002).

## Pre-run finding: sharp cannot decode the fixtures, so a JPEG export is needed

Checked here by `node spikes\S3\probe-decoders.ts` (full output in `docs\reports\phase0\S3.md`):
- All 5 NEFs: `Input file contains unsupported image format` (sharp 0.35.4 / libvips 8.18.6).
- The DxO DNG: only its 258×172 IFD0 thumbnail decodes. The 8256×5504 SubIFD decodes as all-black (libtiff tile errors).

Per the directive (no other decoder), **please export one JPEG from Lightroom into `fixtures\`**:
- Select `20260907-_OZ80093.NEF` > File > Export: **JPEG**, **sRGB**, quality 90, **Resize to Fit: Long Edge 2048 px** (anything ≥ 1600 works), file name `20260907-_OZ80093`, destination `D:\Developer\LrC_Autonomous_Gateway\fixtures\`.
- `fixtures\*.jpg` is gitignored.

## The server

`spikes\S3\server.ts` is a minimal stdio MCP server with one tool, `get_fixture_preview { name }`. It renders `fixtures\<name>` with sharp to 1600 px long edge at q75 and returns an **image** block (`image/jpeg`, base64) plus a **text** block with the byte size, dimensions and render ms.

Optional plumbing check, no Claude involved:
```powershell
cd D:\Developer\LrC_Autonomous_Gateway
node spikes\S3\smoke-client.ts 20260907-_OZ80093.jpg
```
It should print `image block: mimeType=image/jpeg … jpeg_soi=true`.

## Run in Claude Desktop (Jim)

1. Claude Desktop > Settings > Developer > **Edit Config**. On this machine that opens `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`. Add the entry from `spikes\S3\claude_desktop_config.snippet.json` inside `"mcpServers"`, next to `filesystem`, `github` and `graphify-autodocweb`:
   ```json
   "lrc-avg-spike-s3": {
     "command": "C:\\Program Files\\nodejs\\node.exe",
     "args": ["D:\\Developer\\LrC_Autonomous_Gateway\\spikes\\S3\\server.ts"]
   }
   ```
2. Fully quit Claude Desktop (tray icon > Quit) and reopen it. Check that the tool `get_fixture_preview` is listed under the connectors/tools menu.
3. New chat: *"Call get_fixture_preview with name 20260907-_OZ80093.jpg, then describe the photo: subject, light, colours, and anything technically wrong."*
4. Observe and screenshot: is the image **displayed** inline in the tool result? Does Claude's description match the photo (your judgement)? Any error, truncation or size warning? Does the text block's `jpeg_bytes` show?
5. Server logs, if needed: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-lrc-avg-spike-s3.log` (that folder already holds `mcp.log` and `mcp-server-graphify-autodocweb.log`, checked 2026-09-23; the new file name follows that pattern [inference]).
6. Afterwards, remove the entry again (or keep it until Phase 2; your call).

## Run in Claude Code CLI (Jim)

One-off, without touching your saved config:
```powershell
cd D:\Developer\LrC_Autonomous_Gateway
claude --mcp-config spikes\S3\claude-code.mcp.json
```
Then ask the same question. Observe whether Claude Code shows or describes the image (the terminal cannot display it inline; what matters is whether Claude *sees* it).

## What to paste into `docs\reports\phase0\S3.md`

- Desktop: screenshot path(s), displayed yes/no, Claude's description (copy it), your accuracy judgement, `jpeg_bytes` from the text block.
- Claude Code: the same three answers.
- Any errors from the MCP log.
