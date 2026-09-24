# AVG-S3 — vision in Claude Desktop (and Claude Code)

**Question (PHASES.md):** when an MCP tool returns a 1600 px q75 JPEG as an `image` content block, does Claude Desktop display it, and can Claude describe it? Does Claude Code CLI do the same?
**Rule:** Go = Desktop renders. No-go = re-decide the runtime client (AVG-002).

## Why a JPEG export is needed

sharp cannot decode the fixtures. Handle: `node spikes\S3\probe-decoders.ts`; the full output is in `docs\reports\phase0\S3.md`. All 5 NEFs fail with "unsupported image format", and the DxO DNG yields only a 258×172 thumbnail (the full-size image decodes as black). So the test photo has to come out of Lightroom as a JPEG.

## The server

`spikes\S3\server.ts` is a minimal stdio MCP server with one tool, `get_fixture_preview { name }`. It renders `fixtures\<name>` to 1600 px long edge at q75 and returns an **image** block (`image/jpeg`) plus a **text** block with the byte size, dimensions and render time.

## Steps for Jim

**A. Export the test JPEG from Lightroom**

1. In Lightroom **Library**, select `20260907-_OZ80093.NEF`.
2. **File > Export…** and set:
   - Export To: **Specific folder** → **Choose…** → `D:\Developer\LrC_Autonomous_Gateway\fixtures`
   - Put in Subfolder: **unticked**
   - File Naming: **Rename To: Filename** (the file becomes `20260907-_OZ80093.jpg`)
   - Image Format: **JPEG**, Quality **90**, Color Space **sRGB**
   - Image Sizing: **Resize to Fit** ticked, **Long Edge**, **2048** pixels
3. Click **Export** and wait for the progress bar to finish.

**B. Check the server can read it**

4. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S3\smoke-client.ts 20260907-_OZ80093.jpg
   ```
   Expected: a line starting `image block: mimeType=image/jpeg` that ends with `jpeg_soi=true`. If you see `isError: true` instead, stop and tell Claude Code.

**C. Claude Desktop**

5. In Claude Desktop, open **Settings > Developer > Edit Config**. This opens the folder containing `claude_desktop_config.json`; open that file in a text editor.
6. Inside `"mcpServers": { … }`, after the `graphify-autodocweb` entry, add a comma and then this entry (it is also in `spikes\S3\claude_desktop_config.snippet.json`):
   ```json
   "lrc-avg-spike-s3": {
     "command": "C:\\Program Files\\nodejs\\node.exe",
     "args": ["D:\\Developer\\LrC_Autonomous_Gateway\\spikes\\S3\\server.ts"]
   }
   ```
   Save the file.
7. Quit Claude Desktop completely: right-click its icon in the Windows system tray → **Quit**. Then start it again.
8. Start a new chat and send exactly:
   `Call get_fixture_preview with name 20260907-_OZ80093.jpg, then describe the photo: subject, light, colours, and anything technically wrong.`
9. Screenshot the whole reply, including the tool result (**Win+Shift+S**), and save it as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S3-desktop.png`.
10. Write down three answers: (a) was the image **shown** in the tool result, yes/no; (b) does Claude's description match the photo, yes/no/partly; (c) the `jpeg_bytes=` number from the tool's text result.

**D. Claude Code CLI**

11. In a **new** PowerShell window, run:
    ```powershell
    cd D:\Developer\LrC_Autonomous_Gateway
    claude --mcp-config spikes\S3\claude-code.mcp.json
    ```
12. Send the same message as in step 8.
13. Write down: (a) did Claude Code call the tool, yes/no; (b) does its description match the photo, yes/no/partly. Then type `/exit`.

**E. Report**

14. Open `docs\reports\phase0\S3.md`. Under **"Observed (Jim)"**, paste Claude Desktop's description verbatim, your step 10 answers, your step 13 answers, and the line `Screenshot: docs\reports\phase0\S3-desktop.png`. Save. Do not commit.
15. Tell Claude Code: **"S3 done."** Leave the `lrc-avg-spike-s3` entry in the Desktop config; Phase 2 builds on it.

## If something goes wrong

- **Claude says it has no `get_fixture_preview` tool**: open `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-lrc-avg-spike-s3.log` (that folder holds the other `mcp-server-*.log` files), copy its last 30 lines into the report, and tell Claude Code.
- **Claude Desktop shows a config error on start**: the JSON from step 6 has a missing or extra comma. Tell Claude Code and paste the error text.
