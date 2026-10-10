# LrC-AVG — Lightroom Classic Autonomous Vision Gateway

LrC-AVG lets Claude, in Claude Desktop, edit a raw photo in Lightroom Classic the way a photographer does: set a few Develop sliders, look at the result, measure it, adjust again, up to a capped number of passes. It uses only Lightroom's own Develop settings, so every change shows on the sliders, sits in History as a named step, and can be undone. A local engine measures each render (clipping, histogram, pass-to-pass changes) and keeps every pass within clipping limits; Claude's vision makes the aesthetic calls.

It comes in two halves: a Lightroom plugin, and an engine that Claude Desktop starts as an MCP server.

**Prototype: there is no release yet.** The [Install](#install) section below describes the planned 1.0.0 release; its download links do not work yet. To run the prototype, build it from source as in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). From [Your first session](#your-first-session) on, this page describes the prototype as it is. Built and tested on one Windows 11 PC with Lightroom Classic 15.5.1 and 15.6. Where this page states how something behaves, the evidence is listed under [Sources](#sources).

## What you need

- Windows 10 or 11 (tested on Windows 11 only).
- Lightroom Classic 15.0 or later (see [Supported Lightroom versions](#supported-lightroom-versions)).
- Claude Desktop, signed in, and started at least once in this Windows account.
- Node.js 22 or newer, from https://nodejs.org. To check, run `node --version` in PowerShell.
- An internet connection for the install: npm downloads the engine's dependencies. LrC-AVG itself talks to Lightroom only on this computer (127.0.0.1).

## Supported Lightroom versions

LrC-AVG supports Lightroom Classic 15.0 and later, and was tested on 15.6. Earlier versions may work but are untested. On a version older than 15.0 or newer than 15.6, nothing is blocked: the HUD says so once when an edit starts, and Claude sees the same notice when it reads the photo's details. If a newer Lightroom no longer offers a setting LrC-AVG uses, Claude is told which one is not available and the edit stays open. A photo on a process version newer than LrC-AVG knows can be described but not edited.

## Install

Run the commands in PowerShell. They call `npm.cmd` and `lrc-avg-setup.cmd` rather than `npm` and `lrc-avg-setup`: on a new Windows account PowerShell refuses to run `.ps1` scripts, and the plain names can resolve to the `.ps1` versions.

### 1. Install the engine

```powershell
npm.cmd install -g https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/releases/download/v1.0.0/lrc-avg-1.0.0.tgz
```

npm prints `added … packages` when it is done.

### 2. Add the engine to Claude Desktop

```powershell
lrc-avg-setup.cmd
```

It finds Claude Desktop's config file, saves a backup next to it, adds an entry named `lrc-avg`, and reads the file back. Other entries in the file stay as they are. It prints:

```
Claude Desktop config: C:\Users\…\claude_desktop_config.json
MCP servers before: …
Done: add "lrc-avg" (backup of the old file: claude_desktop_config.json.backup-<time>).
MCP servers now: …, lrc-avg
"lrc-avg" runs: C:\Program Files\nodejs\node.exe …\lrc-avg\dist\mcp\main.js
Next: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then start it again.
```

If Claude Desktop had no config file yet, the first line ends in `(new file)` and there is no backup. Do what the last line says. Running `lrc-avg-setup.cmd` a second time changes nothing: it prints `Nothing to change`.

### 3. Install the Lightroom plugin

Download the plugin and unpack it into `%LOCALAPPDATA%\LrC-AVG\plugin`:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/releases/download/v1.0.0/LrC-AVG.lrplugin-1.0.0.zip `
  -OutFile "$env:TEMP\LrC-AVG.lrplugin-1.0.0.zip"
Expand-Archive -Force `
  -LiteralPath "$env:TEMP\LrC-AVG.lrplugin-1.0.0.zip" `
  -DestinationPath "$env:LOCALAPPDATA\LrC-AVG\plugin"
```

Then, in Lightroom Classic:

1. Choose **File > Plug-in Manager**.
2. Click **Add**. In the folder dialog, type `%LOCALAPPDATA%\LrC-AVG\plugin` into the address bar and press Enter, select the `LrC-AVG.lrplugin` folder, and click **Select Folder**.
3. Check that **LrC-AVG (Autonomous Vision Gateway)** is in the list, then click **Done**.
4. Quit Lightroom (**File > Exit**) and start it again.

### 4. Check the connection

In Lightroom, choose **File > Plug-in Extras > LrC-AVG - Bridge status**. The dialog should read **LrC-AVG bridge: RUNNING, engine NOT connected**. That is the normal state outside a chat: the engine connects at Claude's first LrC-AVG tool call and lets go after a minute without one. During a chat it reads **ENGINE CONNECTED**.

### If something goes wrong

- If `lrc-avg-setup.cmd` says **Claude Desktop's folder was not found**, start Claude Desktop once in this Windows account, quit it, then run the command again.
- If it says it **found 2 Claude Desktop config files**, it does not know which one Claude Desktop uses and has changed nothing. It lists both paths: run it again with the one your Claude Desktop uses, `lrc-avg-setup.cmd --config "<that path>"`.
- If PowerShell says **`… cannot be loaded because running scripts is disabled on this system`**, you typed `npm` or `lrc-avg-setup` without `.cmd`. Type the command with `.cmd`.
- If **Bridge status** says **NOT RUNNING**, quit Lightroom and start it again, then choose the menu item again. The dialog also shows the path of the plugin's log.
- If Claude says the LrC-AVG tools are missing, quit Claude Desktop (right-click the Claude icon in the system tray > Quit) and start it again.

## Your first session

1. In Lightroom, select one raw photo (in Library or Develop).
2. In Claude Desktop, start a new chat and type: **Tune the active photo for golden hour landscape.**
3. If Claude Desktop asks whether LrC-AVG may use a tool, allow it.

What happens next:

- The engine saves a Develop snapshot of the photo, named **AVG pre-session …**. Aborting goes back to it.
- The **HUD**, a small floating window, opens in Lightroom and follows the session ([below](#the-hud)).
- **Pass 0** sets the intent's camera profile, lens corrections and starting values. Claude then makes up to 4 more passes (the **Max passes** setting). Before each pass it looks at a fresh render and the engine's measurements. Each pass is one History step, named **AVG \<id\> pass n/N**.
- The engine caps how far each slider moves per pass, and keeps clipping within limits: by default at most 0.5 % of pixels blown out and 1.0 % crushed to black.
- The session ends when Claude accepts the edit, or when you click **Accept** or **Abort** in the HUD.

Claude Desktop shows the renders Claude looks at only inside the tool-call boxes in the chat: click a box to expand it. The photo in Lightroom shows the same edit.

## What else you can ask

- **Other looks.** Eleven intents come with the engine: Black and white; Landscape — blue hour, forest shade, golden hour, midday high contrast, overcast flat light; Neutral technical correction; Night — stars and Milky Way; Pet — fur detail; Portrait — natural light, skin first. Ask "Which intents are there?" to see them, with your own.
- **Variants.** "Make three golden-hour variants of this photo." The engine makes virtual copies **AVG \<intent\> A**, **B** and **C** with different looks and shows them side by side. You pick one, with **Pick A/B/C** in the HUD or in the chat, and the remaining passes go to your pick. Select the original photo, not a virtual copy, before you ask. Every intent except Neutral technical correction has variants.
- **Sync a burst.** After a session you accepted: "Sync this edit to the selected photos." It copies the settings to the photos selected in Lightroom, at most 20 per request. For a burst of the same scene, Claude can instead match each photo's brightness to the edited one, 3 photos per request. Each photo gets its own snapshot **AVG pre-sync …** first.
- **Save a preset.** "Save this photo's settings as a preset called …". It is saved in the group **LrC-AVG**, and Lightroom lists it after a restart.
- **Save your own intent.** Describe the look you want and ask Claude to save it as an intent. Claude shows you the intent first and saves it only after you approve. An intent names one profile for raw photos and one for JPEG, TIFF, PNG and the other rendered photos (`"profile": { "raw": "Adobe Landscape", "rendered": "Color" }`), and keeps white-balance starting values for each in `"priors_by_pipeline"`, because a raw photo's temperature is in Kelvin and a JPEG's is relative. Intent files written for engines before 0.22.0 are skipped with a warning that says how to rewrite them.
- **Find, rate and keyword photos.** "Find my five-star photos from September 7 with the keyword heron", "Which collections do I have?", "Rate the selected photos three stars", "Add the keyword pond to these photos." Claude searches by file name, keywords, star rating, capture date and collection, and sets star ratings and keywords on at most 100 photos per request. Claude tells you which photos will change first. Ratings and keywords are not Develop settings: History and snapshots don't cover them, but Claude can put the earlier values back on request.
- **Keywords in a hierarchy.** "Which keywords do I have under Places?", "Add Places > Europe > Paris to these photos." Claude lists your keyword tree and writes a nested keyword as a path, parent first with `|` between the levels (`Places|Europe|Paris`), creating the levels that are missing. A plain name means the top-level keyword of that name.
- **GPS positions.** "Set the location of these photos to 48.5818, 7.7509", "Remove the GPS position from this photo." Claude sets or removes the latitude and longitude of at most 100 photos per request, with each photo's earlier position in the answer. LrC-AVG does not write the altitude.

- **Collections.** "Create a collection 2026-10-04 in the set 2026 > Trips and put the selected photos in it." Claude creates a collection (and any missing collection sets), and adds photos to it or takes them out, up to 500 per request. Smart collections are refused: Lightroom fills them by their rules. No tool deletes a collection.
- **Export.** "Export the five-star photos of the collection Ella's Wedding to a new folder Ella Wedding Exports on my desktop, as PNG files that fit 2040 x 1080." Claude exports with your edits as JPEG, PNG or TIFF, full size or resized, or the original file. A file of the same name already in the folder gets a new name (`name-2.png`) unless you ask to overwrite or skip it.
- **Import.** "Import the photos on G:\DCIM that are not in the catalog yet, copied into D:\Photos\2026." Claude imports the photo files of a folder, where they are or copied first (never overwriting), and skips files the catalog already holds at that path. A photo imported earlier from another folder is not recognised as the same photo. No tool removes photos from the catalog: use Library > Remove Photo.
- Export and import work for about 40 seconds per request, then Claude goes on with another request until all are done.

Sync, presets, ratings, keywords, GPS positions, collections, exports and imports are not available while a session is open.

## The HUD

The HUD opens by itself when an edit starts (if it is not open already), and from **File > Plug-in Extras > LrC-AVG - Show Vision Gateway HUD**. It takes the keyboard when it opens: click Lightroom's main window before you use keyboard shortcuts.

From top to bottom it shows:

- **The headline:** whose turn it is. **Claude is working. Nothing needed from you.** while Claude works. When something is needed from you it starts with "Your turn": **Your turn: pick a copy, or tell Claude which one.**; **Your turn: approve pass n so Claude can go on.**; **Your turn: Claude thinks the edit is done.**; **Your turn: select the edit's photo again.** After an edit ends: **Done: the edit is kept.** or **Done: the photo is back as it was.**
- **The buttons** (below).
- **A feedback line:** what your last click did (for example "Accept sent; waiting for Claude."), or the plugin's latest note.
- **Photo:** the file name (and copy name).
- **Camera:** ISO, shutter speed, aperture, lens and lens-profile status.
- **Step:** what is happening, for example Setting profile, lens corrections and baseline; Applying pass 2 of 4; Rendering a preview; Measuring the preview; Claude is looking at the result; Waiting for your pick; Waiting for your approval; Claude thinks the edit is done; Accepted; Aborted. From pass 1 on, the label is followed by the pass, for example "(pass 2 of 4)".
- **The selection line:** **Selection: the edit's photo.**, or **Target changed: …** if you select a different photo during the edit.
- **Changes in the latest pass:** a grid with the slider, before, after and change, up to 12 rows. Sliders carry the names Lightroom's Develop panel shows, such as Orange Saturation.
- **The clipping sentence:** **Clipping: within limits.**, or one sentence saying what the guardrails did, for example that a pass was undone, a clipping was corrected, or a slider was held back.
- **The settings** the edit uses (between edits, the settings page's).
- **The connection line:** Connected to Claude., Not connected to Claude., or LrC-AVG is not running in Lightroom.

A line that is too long for the window continues on a second line, and ends with "..." if it still does not fit.

Buttons:

| Button | What it does |
|---|---|
| **Pick A / B / C** | Variants mode, while a pick is awaited: continue on that copy. |
| **Approve pass n** | Approve-each-pass mode, while pass n waits for you ([below](#approve-each-pass)). |
| **Accept** | Ends the session and keeps the edit, once the running step has finished. |
| **Abort** | Stops the running step before its next write, then puts the photo back to the **AVG pre-session …** snapshot. It is the last button. |

The buttons are greyed out while the engine is not connected, and while the HUD checks an edit after a reconnect. After a click they all stay off until the engine answers that click, or for at most 10 s. When an edit ends, the HUD stays open and shows the outcome until you close it or the next edit starts.

## Menu items

Under **File > Plug-in Extras**, in this order:

| Menu item | What it does |
|---|---|
| **LrC-AVG - Bridge status** | Says whether the plugin's bridge runs and whether the engine is connected; shows the ports and the plugin log's path. |
| **LrC-AVG - Show Vision Gateway HUD** | Opens the HUD. |
| **LrC-AVG - Pick A**, **Pick B**, **Pick C** | The HUD's Pick buttons. |
| **LrC-AVG - Approve Pass** | The HUD's Approve pass n. |
| **LrC-AVG - Accept Edit** | The HUD's Accept. |
| **LrC-AVG - Abort Edit** | The HUD's Abort. |

Each of the last five waits up to 20 s for the engine, and for an edit being checked after a reconnect, and reports in the HUD's feedback line. If it cannot send, the line says why, for example "Pick A not sent: no pick is waiting."

There are no keyboard shortcuts.

## Settings

**File > Plug-in Manager**, select **LrC-AVG (Autonomous Vision Gateway)**: the **LrC-AVG settings** section. Values are saved as you change them, and Claude's next session reads them; a session already open keeps its own. Claude can override a value for one session if you ask (for example "use 6 passes"), and an intent's own clipping limits come before the page's.

| Setting | Default | Allowed |
|---|---|---|
| Mode | Autonomous | Autonomous, Approve each pass |
| Max passes per photo | 4 | 1-8, not counting pass 0 |
| Variant count | 3 | 2-3 copies in Variants mode |
| Step decay per pass | 1.0, 0.6, 0.4, 0.25 | 1 to 8 numbers, each above 0 and at most 1: the share of each slider's per-pass maximum that pass 1, 2, 3, … may use |
| Highlight clipping, % of pixels | 0.5 | 0-100; pixels at 253 or above |
| Shadow crushing, % of pixels | 1.0 | 0-100; pixels at 2 or below |
| Preview long edge, pixels | 1600 | 800-1920 |
| Preview JPEG quality | 75 | 60-90 |
| Temp preview folder | `%TEMP%\LrC-AVG\previews` | shown only; cannot be changed |
| Intents folder | blank: `%LOCALAPPDATA%\LrC-AVG\intents` | any folder |
| Log folder | blank: `%LOCALAPPDATA%\LrC-AVG\logs` | any folder |
| Receive port / Send port | 8765 / 8766 | 1024-65535, different from each other and not 8767 (the engine's own); used from the next Lightroom start |

A value that is not valid is not used: the default takes its place, and the bottom of the section lists it with the reason. A changed log folder does not hide older sessions: the engine remembers every log folder it has used.

## Approve each pass

Set **Mode** to **Approve each pass** to see each pass before Claude makes the next one.

- Pass 1 needs no approval.
- From pass 2 on, Claude's next pass waits up to 60 s for **Approve pass n** in the HUD.
- If you have not approved by then, nothing is written, and Claude is told to let you know the pass waits for your approval. Click **Approve pass n** in the HUD, or approve in the chat; Claude then records your approval and goes on.
- In Variants mode, picking a copy approves the pass it was picked at.

In testing, Claude also asked in the chat before each pass on its own.

## Undoing an edit

- **During a session:** Abort, in the HUD or the menu.
- **Afterwards:** in Develop, the **Snapshots** panel has **AVG pre-session …** for each session and **AVG pre-sync …** for each synced photo; the **History** panel has every pass as its own step.
- **Virtual copies** from Variants mode stay in the catalog, including the ones you did not pick. LrC-AVG cannot remove photos: no Lightroom SDK call for it was found. To remove copies yourself, select them in Library, choose **Photo > Remove Photos…**, then **Remove**.

## Where files go

| Folder | What is there |
|---|---|
| `%LOCALAPPDATA%\LrC-AVG\logs` (or the log folder set on the settings page) | `engine-<yyyymmdd>.jsonl`, a record of every tool call; `<yyyymmdd>-<id>.json`, each session's full log; `<yyyymmdd>-<id>.recipe.json`, each accepted session's final settings |
| `%LOCALAPPDATA%\LrC-AVG\intents` (or the intents folder set on the page) | Your own intents, `<id>.json`. One with the id of a bundled intent replaces it. The bundled intents stay inside the installed engine. |
| `%LOCALAPPDATA%\LrC-AVG\plugin` | The plugin, if you installed it as above |
| `%APPDATA%\Adobe\CameraRaw\Settings` | Presets LrC-AVG saves, `<name>.xmp` (Lightroom's own preset folder) |
| `%TEMP%\LrC-AVG` | `previews\`, the renders (deleted when a session ends and when the engine starts); `bridge.log`, the plugin's log; `bridge_status.json` |
| `%USERPROFILE%\.lrc-avg` | `bridge_token` and `bridge_ports.json`, written by the plugin at each Lightroom start; `log_folders.json`, the log folders used |
| Claude Desktop's folder | `claude_desktop_config.json` with the `lrc-avg` entry, and the backups `lrc-avg-setup` made (`claude_desktop_config.json.backup-<time>`) |

## Uninstall

1. Remove the engine from Claude Desktop, then uninstall it, in this order (the second command deletes `lrc-avg-setup`):

   ```powershell
   lrc-avg-setup.cmd --remove
   npm.cmd uninstall -g lrc-avg
   ```

2. Quit Claude Desktop from the tray icon and start it again.
3. In Lightroom: **File > Plug-in Manager**, select **LrC-AVG (Autonomous Vision Gateway)**, click **Remove**, then **Done**. Quit Lightroom.
4. Delete LrC-AVG's folders. This also deletes the session logs and your own intents:

   ```powershell
   Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
     "$env:LOCALAPPDATA\LrC-AVG", "$env:USERPROFILE\.lrc-avg", "$env:TEMP\LrC-AVG"
   ```

Your edits stay in the Lightroom catalog: History steps, snapshots, virtual copies and presets are Lightroom's own, and uninstalling does not touch them.

## Known limitations

- **One PC tested:** Windows 11, Lightroom Classic 15.5.1 and 15.6. Windows only.
- **Process version:** a photo still on an older Lightroom process version is refused. Update the photo to the current process version in Develop first.
- **Missing originals:** a photo whose original file Lightroom cannot find is refused, even when it has a smart preview. Claude tells you the file name and its last known folder. Reconnect the file in Lightroom (Library > Find All Missing Photos), then ask again. A sync skips such a photo and syncs the rest. If the file goes missing during an edit, the HUD says so, and **Abort** still puts the photo back.
- **Global Develop settings only:** no masks or local adjustments, no crop or geometry, no HDR.
- **One session at a time.** Sync, presets, ratings, keywords and GPS positions are not available until it ends.
- **Keep Plug-in Manager closed during a session.** Lightroom pauses the plugin while Plug-in Manager or a menu is open (2.5 to 15 s in testing). The engine waits up to 60 s for the plugin during a session, but a long pause during a session has not been tested.
- **Approve and Claude Desktop:** whether Claude Desktop waits the full 60 s for an Approve has not been tested (in testing, Claude asked in the chat instead of waiting).
- **If the engine disconnects during an edit** (for example, Claude Desktop is quit), the HUD says "Not connected to Claude" and names the **AVG pre-session …** snapshot to apply in Develop > Snapshots. When Claude connects again, the HUD shows "Checking this edit with Claude..."; if Claude no longer has the edit, it says so and the same snapshot line stays.
- **The HUD takes the keyboard when it opens.** Every HUD button has a menu item. Inside the HUD, Tab moves to the first button that is switched on, and Space or Enter clicks it.
- **A long note or clipping sentence can end in "..."** in Lightroom, cut off at the window's right side. A later change fixes it.
- **Renders show only inside the expanded tool-call boxes** in Claude Desktop, not in Claude's answer.
- **Presets:** a new preset shows only after Lightroom restarts. Only the group "LrC-AVG" has been tested. Adobe camera profiles (Adobe Color, Adobe Landscape, …) are left out of presets, as are temperature and tint while white balance is As Shot.
- **Virtual copies** from Variants mode are never removed by LrC-AVG.
- **Sync:** at most 20 photos per request, or 3 when matching brightness.
- **Keywords:** a plain name always means the top-level keyword of that name, for adding and removing alike, even when a nested keyword has the same name; give the path to reach a nested keyword. Upper and lower case count as the same. A keyword removed from photos, and every level created, stays in the Keyword List; delete it there if you no longer want it.
- **Keyword paths and GPS positions** have not yet been tried in Lightroom. Keywords and GPS positions need plugin 0.10.0.

## Development

Building from source, the development install and the project's checks: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Sources

The evidence behind the behaviour this page describes. Paths are in this repository unless they are URLs. Marks as in [`.claude/rules/02-sourcing.md`](.claude/rules/02-sourcing.md): `[handle: …]` can be checked; `[unverified]` has not been observed yet; `[inference]` is reasoning; `[community]` is a user report.

| Section | Claim | Source |
|---|---|---|
| Version | Tested PC and versions | [handle: `docs/reports/phase5/PHASE5.md` "Numbers", "Plugin, engine, connect time": LrC 15.5.1; "Draft for LR_SDK_NOTES": Windows 11]; LrC 15.6 [handle: `docs/reports/phase6/lrc-version-check/check.txt` section 1] |
| Supported Lightroom versions | 15.0 the supported baseline, earlier versions untested; 15.6 the newest tested | [stated: Jim, 2026-10-03, "Set version 15.0 as the baseline, but note that it might work on earlier versions (untested.)"]; [handle: `docs/reports/phase6/lrc-version-check/check.txt` section 1, "Lightroom 15.6"] |
| Supported Lightroom versions | The notice outside 15.0-15.6, once in the HUD and in `lr_get_active_photo_context`; a setting Lightroom no longer reports named as not available, the edit kept open; a newer process version read but not edited | [handle: `engine/src/bridge/lightroom.ts`; `engine/src/mcp/errors.ts` `readbackError`, `featureUnavailable`; `engine/src/params/map.ts` `checkProcessVersion`]; tested against the simulated Lightroom [handle: `engine/tests/lrc-baseline.test.ts`]; in a Lightroom outside 15.0-15.6 [unverified] |
| Version, Install | The whole install from the release on a fresh Windows account (the release URLs, `npm.cmd install -g <URL>`, `Invoke-WebRequest`, the Plug-in Manager steps) | [unverified] until the packaging check (AC-6), now Phase 8 (vault `PHASES.md`). The parts already run: installing the `.tgz` from a file, `lrc-avg-setup.cmd` and `--remove` against scratch configs, the installed engine's tools, and `Expand-Archive` of the zip [handle: `docs/reports/phase6/package-smoke/smoke.txt` sections 1-4] |
| Install | Release asset URL form `/releases/download/<tag>/<asset>` | [handle: https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases, read 2026-10-01]; the tag `v1.0.0` is set when the release is made [unverified] |
| What you need | Node ≥ 22 | [handle: `engine/package.json` `engines`] |
| What you need | The engine connects to Lightroom on 127.0.0.1 only | [handle: `engine/src/bridge/client.ts:52`] |
| What you need, Install | npm downloads dependencies at install | [handle: `smoke.txt` section 1, "added 100 packages"]; that it needs a network connection is [inference] |
| Install | `.cmd` instead of `.ps1`: with no policy set, PowerShell's effective policy on Windows clients is Restricted, which runs no script files | [handle: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies, read 2026-10-01]; npm makes both a `.cmd` and a `.ps1` for each command [handle: `%APPDATA%\npm` listing on the dev PC, 2026-10-01; `smoke.txt:173`]. That the plain name picks the `.ps1` is [community] |
| Install | What `lrc-avg-setup` does and prints; the backup; other entries kept; nothing changed the second time; the two refusals | [handle: `engine/src/setup/apply-config.ts:41-55, 119-125`, `setup-cli.ts:4-6, 15`; `smoke.txt` sections 2a-2f] |
| Install | Lightroom loads the plugin at its start | [handle: `plugin/LrC-AVG.lrplugin/Info.lua` `LrForceInitPlugin`]; restarting after Add is a precaution [inference] |
| Check the connection | Bridge status headlines | [handle: `plugin/LrC-AVG.lrplugin/MenuStatus.lua`] |
| Check the connection | The engine connects at the first tool call and lets go after 60 s without one | [handle: `engine/src/mcp/main.ts:6-7`, `IDLE_RELEASE_MS`; `docs/reports/phase5/PHASE5.md` "Numbers", "Bridge back after each chat"] |
| Your first session | Snapshot name, pass 0, History step names, per-pass caps, clipping limits and defaults | [handle: `engine/src/mcp/defs-session.ts` `lr_begin_session`, `lr_step`]; AC-4 held on every pass of the Phase 5 check [handle: `PHASE5.md` "Numbers", "AC-4"] |
| Your first session | The golden-hour chat ran on six photos | [handle: `PHASE5.md` "Numbers", "The six golden-hour chats"] |
| Your first session | Renders show only inside the expanded tool-call box | [handle: `docs/reports/phase0/S3.md` "Analysis"; stated by Jim there] |
| What else you can ask | The eleven intents and which have variants | [handle: `engine/intents/*.json` `label`, `variants`] |
| What else you can ask | Variants, copy names, the pick | [handle: `defs-session.ts` `lr_begin_session`, `lr_select_variant`]; the HUD pick in Lightroom [handle: `PHASE5.md` "Numbers", "AC-3"] |
| What else you can ask | Sync: limits 20 and 3, snapshots, not during a session | [handle: `engine/src/sync/types.ts:18-19`; `engine/src/mcp/defs-propagation.ts` `lr_sync_series`] |
| What else you can ask, Known limitations | Presets: group, folder, shown after a restart, what is left out; only the "LrC-AVG" group tested | [handle: `defs-propagation.ts` `lr_create_preset_from_active`; `engine/src/presets/folder.ts`; `docs/reports/phase4/S7.md` "Consequences"; `docs/reports/phase4/WB.md`]; groups other than "LrC-AVG" [unverified] |
| What else you can ask | Saving an intent only after approval | [handle: `engine/src/mcp/defs-intents.ts` `lr_save_intent`] |
| What else you can ask | An intent's profile per kind of photo, white balance per kind, older files skipped with a warning | [handle: `engine/src/intents/schema.ts`, `engine/src/intents/loader.ts` `check`; `engine/tests/intents.test.ts` "checks schema v2 per pipeline"; `engine/tests/session-bundled-intents.test.ts`]; Kelvin vs relative [handle: `docs/reports/phase8/S10.md` "Observed"]; on rendered photos in Lightroom [unverified] until the Phase 8 check |
| What else you can ask, Known limitations | Search filters, collections, ratings and keywords: limit 100, before and after values, not during a session, exact names, removed keywords kept | [handle: `engine/src/mcp/defs-catalog.ts`; `engine/src/library/write.ts` `MAX_PHOTOS`; `plugin/LrC-AVG.lrplugin/Library.lua`; `docs/reports/phase6/catalog-tools-smoke/smoke.txt`]; in Lightroom [handle: `docs/reports/phase6/catalog-tools-check/check.txt`] |
| What else you can ask | History and snapshots don't cover ratings and keywords | [inference]: they are catalog metadata, written with `setRawMetadata` and `addKeyword`, not `applyDevelopSettings` (`Library.lua`) |
| What else you can ask, Known limitations | Keyword paths, the `\|` separator, the ambiguity rules, levels created and kept; GPS set or removed, altitude not written, limit 100; neither tried in Lightroom yet | [handle: `engine/src/mcp/defs-catalog.ts` `lr_set_keywords`, `lr_list_keywords`, `lr_set_gps`; `engine/src/library/keywords.ts`; `plugin/LrC-AVG.lrplugin/KeywordTree.lua`, `Library.lua` `setGps`; `engine/tests/catalog-keywords-gps.test.ts`]; the separator [upstream claim: Automaat `KeywordTree.lua:3-6` at `11c0b93`]; in Lightroom [unverified] |
| What else you can ask | Collections, export, import: limits 500, smart collections refused, rename/overwrite/skip, copy without overwriting, skipped by path only, 40 s per request, no delete or remove tool, not during a session | [handle: `engine/src/mcp/defs-files.ts`; `engine/src/library/files.ts`; `plugin/LrC-AVG.lrplugin/Transfer.lua`; `engine/tests/catalog-files.test.ts`]; in Lightroom 15.6 [handle: `docs/reports/phase6/automaat-files-check/check.txt`]; no SDK call removes a photo from the catalog [handle: https://lrc.mcor.dev/modules/LrCatalog.html] |
| The HUD | Window order, headlines, step labels, connection line, click lines, undo line, wrapping onto a second line | [handle: `plugin/LrC-AVG.lrplugin/HudView.lua:200-210`; `HudText.lua:39-96`, `HudText.lua:162-172`]; in Lightroom 15.6 [handle: `docs/reports/phase6/hud-p1-check/check.txt` section 3] |
| The HUD | Greyed buttons, 10 s, 12 rows, the selection line, Pick/Approve titles | [handle: `HudView.lua:134-168`; `HudState.lua:24, 29, 228-237`]; the buttons, the 10 s and the rows in Lightroom [handle: vault `PRD.md` §6.3 "Lines as built"] |
| The HUD | Grid in Lightroom's slider names; the clipping sentence | [handle: `engine/src/params/labels.ts:10, 44`; `engine/src/hud/payload.ts:112-170`; `HudText.lua:75`]; names matched Jim's Develop panel [handle: `labels.ts:2-3`, stated: Jim, 2026-10-03]; the sentences in Lightroom [unverified] |
| The HUD | The ended HUD stays open until closed or the next edit starts | [handle: `plugin/LrC-AVG.lrplugin/Hud.lua:14-16`; stated: Jim, 2026-10-03, `HudState.lua:27-28`]; in Lightroom 15.6 [handle: `docs/reports/phase6/hud-p1-check/check.txt` section 3] |
| The HUD, Known limitations | After a reconnect: "Checking this edit with Claude...", then "no longer open in Claude" with the snapshot to apply; a click for an edit Claude no longer has is answered with how the edit ended | [handle: `HudText.lua:43-44, 72-73`; `HudState.lua:34, 179-182`; `Hud.lua:17-19`; `engine/src/hud/events.ts:9-13`; `publisher.ts:119-127`]; the reconnect lines in Lightroom 15.6 [handle: `docs/reports/phase6/hud-p1-check/check.txt` section 3]; the answer to a click is tested by vitest [handle: `engine/tests/hud-unknown-session.test.ts`] |
| The HUD | Opens by itself; takes the keyboard when it opens | [handle: `PHASE5.md` "Numbers", "HUD opened by itself"; `docs/reports/phase5/S8.md` "Numbers", "Keyboard stayed with the main window"] |
| The HUD | Abort and Accept timing and behaviour | [handle: `PHASE5.md` "Numbers", "AC-2"; vault `PRD.md` §6.3 "Buttons as built"] |
| Menu items | Titles, order (Pick A-C and Approve Pass added); 20 s wait, including for an edit being checked; reports in the HUD | [handle: `Info.lua:25-34`; `HudClick.lua:98, 100-102, 113`]; the first three items and the wait in Lightroom [handle: `PHASE5.md` "Numbers", "Menu items"]; Pick B, Approve Pass and the names Accept Edit / Abort Edit in Lightroom 15.6 [handle: `docs/reports/phase6/hud-p1-check/check.txt` section 3] |
| Menu items, Known limitations | No keyboard shortcuts | [handle: vault `PHASES.md` Phase 8 (was Phase 6) "Carried from Phase 5", hotkeys] |
| Settings | Labels, defaults, ranges, the invalid-value list | [handle: `plugin/LrC-AVG.lrplugin/Prefs.lua:33-46`, `PluginInfoProvider.lua`] |
| Settings | Saved as edited; read by the next session; the mode reached the engine | [handle: `docs/reports/phase5/S8.md` "Consequences"; `PHASE5.md` "Numbers", "Settings page reached the engine"] |
| Settings | Argument > intent > page > default; folders remembered | [handle: `defs-session.ts` `lr_begin_session`; `engine/src/settings/log-folders.ts`] |
| Approve each pass | Pass 1 free, 60 s wait, `AWAITING_APPROVAL`, approval in chat, a pick approves its pass | [handle: `defs-session.ts` `lr_step`, `lr_approve_pass`; `PHASE5.md` "Numbers", "Approve", "Wait in vain"] |
| Approve each pass | Claude asked in the chat before each pass | [handle: `PHASE5.md` "Numbers", "Approve chat"] |
| Undoing an edit | No SDK call that removes a photo was found; **Photo > Remove Photos… > Remove** removed only the copies | [handle: `docs/reports/phase4/S7.md` "Verdict" item 2, 19 names tried; `docs/reports/phase0/S6.md:37`, stated by Jim] |
| Where files go | Log, recipe and tool-log names and folder | [handle: `engine/src/log/tool-log.ts:5-7`, `session-log.ts:4-7`] |
| Where files go | Bundled intents read in place, user intents override | [handle: `engine/src/intents/loader.ts:55-56`; vault `PHASE6_PLAN.md` decision 3] |
| Where files go | `%TEMP%\LrC-AVG`, `%USERPROFILE%\.lrc-avg` contents | [handle: `Prefs.lua:157-158`; `plugin/LrC-AVG.lrplugin/Log.lua:2`; `Endpoint.lua:2-4`; `log-folders.ts:19`]; previews purged at session end and start [handle: vault `PRD.md` NFR-6; `main.ts:10`] |
| Uninstall | `--remove`; the order of the two commands; the Plug-in Manager **Remove** button; edits stay in the catalog | [handle: `smoke.txt` sections 2d-2e]; that `npm uninstall` also deletes `lrc-avg-setup` is [inference] (it is the package's own `bin`, `engine/package.json`); **Remove** [unverified]; edits staying is [inference]: uninstalling writes nothing to the catalog |
| Known limitations | Older process versions refused | [handle: `engine/src/params/canonical.ts:28-33`; `engine/src/mcp/errors.ts:114`] |
| Known limitations | Missing originals refused, sync skips them, the HUD line, Abort still puts back | [handle: `engine/tests/offline-original.test.ts`, against the simulated plugin]; in Lightroom [unverified] until `docs/reports/phase8/offline.md` is observed; the menu item [stated: Jim, 2026-10-09, "a menu item under Library that says 'Find all missing photos'"], its capitals [inference] |
| Known limitations | No masks, crop, HDR | [handle: vault `PRD.md` §3] |
| Known limitations | Plug-in Manager pauses; the 60 s allowance untested; Desktop's hold untested | [handle: `PHASE5.md` "Consequences" item 2]; both [unverified] |
| Known limitations | Undo line after a disconnect; Tab, Space and Enter; a long note cut with "..." | [handle: `HudText.lua:72-73`; `HudView.lua:76-81`]; all three in Lightroom 15.6 [handle: `docs/reports/phase6/hud-p1-check/check.txt` section 3] |

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Jim Beebe.

## NOTICE — third-party code

This project vendors and builds on **Automaat/lightroom-mcp** (npm `@mskalski/lightroom-mcp`):

- Upstream: https://github.com/Automaat/lightroom-mcp
- Vendored commit: `a160e7aa250b3264694d88e51418f7f512f417de` (2026-09-22)
- License: **MIT**, Copyright (c) 2026 Marcin Skalski. The full license text ships unmodified at [`vendor/automaat/LICENSE`](vendor/automaat/LICENSE) (identical copy at `vendor/automaat/server/LICENSE`).
- Vendored as a snapshot, not a GitHub fork: the upstream `.git` was removed and the files are otherwise unmodified; the two upstream Python files under `vendor/automaat/skills/` are excluded from this repository's git (project rule: no Python).
- Code ported from Automaat into `engine/` or `plugin/` will keep Automaat's copyright and permission notice (a `THIRD_PARTY_NOTICES.md` ships with each packaged half), as the MIT license requires.

Details and file-level provenance: [`docs/AUTOMAAT_SURVEY.md`](docs/AUTOMAAT_SURVEY.md) §1–2.

Adobe, Lightroom and Camera Raw are trademarks of Adobe Inc. This project is not affiliated with or endorsed by Adobe or Anthropic.
