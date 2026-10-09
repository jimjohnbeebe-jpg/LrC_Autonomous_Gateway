# LrC-AVG compared with the original Lightroom MCP

*Release-note style comparison for users. Written 2026-10-09 against LrC-AVG engine 0.23.0 / plugin 0.19.0 (a prototype; there is no public release yet) and the original project's code as vendored in this repository.*

## The short version

LrC-AVG started from [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp) (MIT license, by Marcin Skalski), a connector that lets Claude work with your Lightroom Classic catalog. That project is a **remote control**: you tell Claude to change a setting, and the setting changes.

LrC-AVG keeps the idea of connecting Claude to Lightroom, and adds an **editing assistant on top**: Claude edits a photo in several rounds, looking at the photo after each round, with limits that protect your highlights and shadows, and an easy way back at any point.

| | Original (Automaat) | LrC-AVG |
|---|---|---|
| Main idea | Claude controls Lightroom | Claude edits a photo the way a photographer does: adjust, look, refine |
| Does Claude see the photo? | No. Claude works with text and numbers only | Yes. Claude looks at a fresh preview after every round |
| Protection against over-editing | None built in | Limits on how far each slider moves per round, and on blown highlights and crushed shadows |
| Undo | Whatever you do in Lightroom yourself | A snapshot before every edit, a named History step per round, and an **Abort** button that puts the photo back |
| Live view of what Claude is doing | None | A floating window (the HUD, and a separate "Deck" window) |
| Ready-made looks | None | 11 editing styles (landscape, portrait, night sky, black and white, and more) |
| Platforms | Mac and Windows | Windows only (so far) |
| AI apps | Claude Desktop, Claude Code, Codex, Cursor, and others | Claude Desktop |

## What is new in LrC-AVG

### 1. Claude edits in rounds and looks at the result

The original has Claude set sliders directly, with no way to see the outcome. In LrC-AVG, Claude edits in short rounds (up to 4 by default, 1–8 in settings). Before each round it looks at a fresh preview of your photo and at measurements of it, then decides what to change next. The first round, "pass 0", sets the camera profile and lens corrections.

### 2. Guardrails keep the edit in bounds

- Each slider can only move a limited amount per round, and the allowed amount shrinks as the rounds go on, so the edit settles instead of swinging back and forth.
- By default at most 0.5 % of the pixels may be blown out and 1.0 % crushed to black. A round that goes beyond that is corrected or undone.
- Every round you can read what changed, in Lightroom's own slider names.

### 3. Every edit can be undone

- Before each edit, LrC-AVG saves a Develop snapshot named **AVG pre-session …**. **Abort** returns the photo to it.
- Each round is its own named step in History.
- Everything uses Lightroom's normal Develop sliders. There is no hidden layer, nothing is baked into pixels, and your original files are never touched.

The original does not add any of this: its changes are plain writes, with no snapshot and no named History step (see the sources table).

### 4. A live window while Claude works

- **The HUD** is a small floating window inside Lightroom. It says in plain words whose turn it is ("Claude is working. Nothing needed from you." or "Your turn: …"), what changed in the latest round, and offers **Accept** and **Abort**.
- **The Deck** is a separate always-on-top companion window that shows the same information without sitting inside Lightroom.
- Every button also has a menu item under **File > Plug-in Extras**.

### 5. You stay in charge when you want to

- **Approve each pass** mode: Claude waits for your OK before every round after the first.
- **Variants** mode: Claude makes three differently styled copies of a photo, you pick one, and the remaining rounds go to your pick.
- A settings page in **File > Plug-in Manager** for the number of rounds, clipping limits, preview size and more.

### 6. Eleven ready-made looks ("intents")

Black and white; Landscape (blue hour, forest shade, golden hour, midday high contrast, overcast flat light); Neutral technical correction; Night (stars and Milky Way); Pet fur detail; Portrait (natural light, skin first). You can describe your own look and have Claude save it, after you approve it. Looks know the difference between raw photos and JPEG/TIFF/PNG photos, and start each with the right profile and white balance.

### 7. Masks inside an edit

Claude can create, change, list and delete masks during an edit: linear and radial gradients, luminance ranges, and Lightroom's AI masks (sky, subject, people and others). If Lightroom is slow or stuck computing an AI mask, the HUD says so and nothing is written to the photo until Lightroom answers.

### 8. Apply an edit across a series

After you accept an edit, Claude can copy it to the selected photos (up to 20 at a time), or match each photo's brightness to the edited one (3 at a time, for bursts of the same scene). Each photo gets its own **AVG pre-sync …** snapshot first. Photos with a missing original file are skipped and reported.

### 9. More catalog tools

Both projects can search, rate and keyword photos, manage collections, and export and import (the original's export already offers JPEG, PNG, TIFF or the original file, with rename/overwrite/skip choices). LrC-AVG adds:

- Keywords in a hierarchy (`Places|Europe|Paris`) and a keyword-tree listing.
- Setting or removing GPS positions (the original can read GPS, not change it).
- Collection sets, and taking photos out of a collection.
- A "before" value in every answer for ratings, keywords and GPS, so Claude can put them back on request.
- Saving the current settings as a Lightroom preset.

### 10. Honest, readable errors

Claude is told clearly why something was refused: an old process version, a missing original file, a setting your Lightroom does not offer, and so on. It no longer has to guess from a raw error string. A photo that cannot be edited safely is refused up front.

### 11. A record of every edit

Each session writes a log of what was changed and why, and each accepted session also writes a "recipe" file with its final settings. Logs and your own looks live under `%LOCALAPPDATA%\LrC-AVG`.

### 12. Cleaner installation and uninstall

- Installation is explicit: a setup command adds the engine to Claude Desktop, saves a backup of Claude Desktop's config first, and changes nothing if run twice. The original copies its plugin into Lightroom's folder by itself the first time it runs.
- A one-line command removes it again, and an uninstall section lists every folder LrC-AVG uses.
- LrC-AVG talks to Lightroom only on your own computer.

## What the original does that LrC-AVG does not (yet)

| Original feature | In LrC-AVG |
|---|---|
| Mac support | Not supported. Windows only so far |
| Other AI apps (Claude Code, Codex, Cursor, Windsurf, VS Code) | Built and tested for Claude Desktop only |
| One-click Claude Desktop `.mcpb` installer and standalone binaries | Not provided. Install is a few PowerShell commands, and Node.js 22 or newer is needed |
| Apply any saved Lightroom preset to photos directly | Not included. Presets can be saved, but edits go through the guarded rounds |
| Copy Develop settings between photos, no limits | Replaced by the guarded series sync above |
| Write any Develop setting by key name, including tone curves | Replaced by a fixed list of named settings with limits. Tone-curve writing is not included |
| Compare, export and manage versioned preset checkpoints | Not included |
| Full-detail photo metadata including raw setting keys | Replaced by a shorter "active photo" summary in plain names |

## Where LrC-AVG is limited today

- Tested on **one Windows 11 PC** with Lightroom Classic 15.5.1 and 15.6. 15.0 is the supported baseline.
- Global Develop settings and masks only. No crop, geometry or HDR.
- One edit session at a time. Catalog tools (sync, ratings, keywords and so on) wait until the session ends.
- Photos on older Lightroom process versions are refused until you update them in Develop.
- Some features have been tested against a simulated Lightroom but not yet in Lightroom itself (for example keyword paths, GPS and the missing-original check). The sources table marks them.
- There is no packaged release yet: it is built from source.

## Credit

LrC-AVG is built on the original Lightroom MCP by Marcin Skalski, used under the MIT license. The original copyright notice and license text are kept in `vendor/automaat/LICENSE` and the packaged half's `THIRD_PARTY_NOTICES.md`. LrC-AVG is not affiliated with or endorsed by Adobe or Anthropic.

## Sources for the claims above

Paths are in this repository. "Original" means the copy under `vendor/automaat/`, commit `a160e7a` (2026-09-22). The original project may have changed since; I did not compare against its live repository, which was outside this session's access. `[unverified]` means not yet observed in Lightroom.

| Claim | Handle |
|---|---|
| Original has 18 tools; none returns images; no snapshots or virtual copies; apply/copy/set develop writes have no History name | `docs/AUTOMAAT_SURVEY.md` sections 4.5–4.6, 5, 7 |
| Original runs on Mac and Windows with several AI apps, `.mcpb` bundle and binaries | `vendor/automaat/README.md` (top and "Install (other AI tools)"), `vendor/automaat/mcpb/manifest.json` |
| Original copies its plugin into Lightroom's Modules folder on start | `docs/AUTOMAAT_SURVEY.md` section 5 "Auto-install side effect" |
| LrC-AVG exposes 31 tools | `grep -c 'name: "lr_' engine/src/mcp/defs-*.ts` (7+3+4+3+4+2+8) |
| Rounds, guardrails, defaults, snapshot and History names | `README.md` "Your first session", "Settings"; `engine/src/mcp/defs-session.ts` |
| Rounds, clipping limits and Abort worked on the Phase 5 check | `docs/reports/phase5/PHASE5.md` "Numbers" |
| HUD and its buttons, menu items | `README.md` "The HUD", "Menu items"; `plugin/LrC-AVG.lrplugin/Info.lua` |
| The Deck was accepted by Jim | `docs/reports/phase7/PHASE7.md` "Verdict" |
| Eleven intents; per-pipeline profile and white balance | `engine/intents/*.json`; `README.md` "What else you can ask"; `docs/reports/phase8/S10.md`. Behaviour on rendered photos in Lightroom: `[unverified]` |
| Mask tools and their stuck-Lightroom handling | `engine/src/mcp/defs-masks.ts`. The README's "no masks" limitation line is out of date against this file |
| Series sync limits (20 and 3) and per-photo snapshot | `README.md` "What else you can ask"; `engine/src/sync/types.ts:18-19` |
| Keyword paths and GPS set/remove; the original only reads GPS | `engine/src/mcp/defs-catalog.ts`; `vendor/automaat/server/src/tool-contracts.ts:228-241`. Not yet tried in Lightroom: `[unverified]` |
| Missing-original refusal | `engine/tests/offline-original.test.ts` (simulated Lightroom). In Lightroom: `[unverified]` until `docs/reports/phase8/offline.md` is observed |
| Setup backup and no-change rerun; uninstall | `README.md` "Install", "Uninstall"; `docs/reports/phase6/package-smoke/smoke.txt` |
| Windows only, one PC, LrC 15.5.1 and 15.6 | `README.md` "Known limitations" |
