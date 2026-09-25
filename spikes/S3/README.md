# AVG-S3 — vision in Claude Desktop (and Claude Code)

**Question (PHASES.md):** when an MCP tool returns a 1600 px q75 JPEG as an `image` content block, does Claude Desktop display it, and can Claude describe it? Does Claude Code CLI do the same?
**Rule:** Go = Desktop renders. No-go = re-decide the runtime client (AVG-002).

## Why a JPEG export is needed

sharp cannot decode the fixtures: all 5 NEFs fail with "unsupported image format", and the DxO DNG yields only a 258×172 thumbnail [handle: `node spikes\S3\probe-decoders.ts`, output in `docs\reports\phase0\S3.md`]. So the test photo has to come out of Lightroom as a JPEG.

## What is prepared for you

- `spikes\S3\server.ts`: a small MCP server with one tool, `get_fixture_preview`, which returns a photo from `fixtures\` as a 1600 px JPEG image.
- `spikes\S3\install-desktop-config.ts`: adds that server to Claude Desktop's settings file for you, after saving a backup of the file. There is no JSON to edit by hand.

## Steps for Jim

1. **Export the test JPEG.** In Lightroom **Library**, select `20260907-_OZ80093.NEF`, then **File > Export…** with:
   - Export To: **Specific folder** → **Choose…** → `D:\Developer\LrC_Autonomous_Gateway\fixtures`
   - Put in Subfolder: **unticked**
   - File Naming: **Rename To: Filename** (the file becomes `20260907-_OZ80093.jpg`)
   - Image Format: **JPEG**, Quality **90**, Color Space **sRGB**
   - Image Sizing: **Resize to Fit** ticked, **Long Edge**, **2048** pixels

   Click **Export** and wait for the progress bar to finish.
2. **Connect the server to Claude Desktop.** In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S3\install-desktop-config.ts
   ```
   It ends with "Added …" (or "already set up").
3. **Restart Claude Desktop.** Right-click the Claude icon in the Windows system tray → **Quit**, then start Claude Desktop again.
4. **Ask Claude.** In Claude Desktop, start a new chat and send exactly:
   `Call get_fixture_preview with name 20260907-_OZ80093.jpg, then describe the photo: subject, light, colours, and anything technically wrong.`
5. **Tell Claude Code** (here in the chat) two things: was the **image shown** in Claude Desktop's answer (yes / no), and was the **description right** (yes / no / partly)?

## Claude Code's own steps (not Jim's)

After step 1, Claude Code runs the plumbing check `node spikes\S3\smoke-client.ts 20260907-_OZ80093.jpg` (expects an `image/jpeg` block). After step 5, it runs the same question through Claude Code CLI itself, using `spikes\S3\claude-code.mcp.json`, and records both results in `docs\reports\phase0\S3.md`.

## If something goes wrong

- **Step 2 prints "FAILED: …"**: nothing was changed. Tell Claude Code what it says.
- **In step 4, Claude says it has no `get_fixture_preview` tool**: tell Claude Code; it will read Claude Desktop's server log itself.
