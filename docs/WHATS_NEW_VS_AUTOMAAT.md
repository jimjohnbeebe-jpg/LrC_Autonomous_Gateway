# LrC-AVG compared with the original Lightroom MCP

*Release-note style comparison for users. Written 2026-10-09 against LrC-AVG engine 0.23.0 / plugin 0.19.0 and the original project as vendored in this repository (commit `a160e7a`). Stale rows corrected 2026-10-27 for LrC-AVG 1.5.0 (61 tools) against the original's live repository at commit `1040453` (68 tools); the sections that describe LrC-AVG's own features are otherwise as written on 2026-10-09. Tool by tool: [`PARITY.md`](PARITY.md). Analysis behind the update: [`reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md`](reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md).*

## The short version

LrC-AVG started from [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp) (MIT license, by Marcin Skalski), a connector that lets Claude work with your Lightroom Classic catalog. That project is a **remote control**: you tell Claude to change a setting, and the setting changes.

LrC-AVG keeps the idea of connecting Claude to Lightroom, and adds an **editing assistant on top**: Claude edits a photo in several rounds, looking at the photo after each round, with limits that protect your highlights and shadows, and an easy way back at any point.

| | Original (Automaat) | LrC-AVG |
|---|---|---|
| Main idea | Claude controls Lightroom | Claude edits a photo the way a photographer does: adjust, look, refine |
| Does Claude see the photo? | On request: `get_photo_preview` and `get_photo_stats` (at `1040453`; the 2026-09-22 snapshot had neither) | Yes. Claude looks at a fresh preview and its measurements after every round |
| Protection against over-editing | None built in | Limits on how far each slider moves per round, and on blown highlights and crushed shadows |
| Undo | Snapshot tools and a global "undo last step" (at `1040453`), used when Claude or you call them | A snapshot before every edit, a named History step per round, and an **Abort** button that puts the photo back |
| Live view of what Claude is doing | None | A floating window (the HUD, and a separate "Deck" window) |
| Ready-made looks | None | 11 editing styles (landscape, portrait, night sky, black and white, and more) |
| Platforms | Mac and Windows | Windows only (so far) |
| AI apps | Claude Desktop, Claude Code, Codex, Cursor, and others | Claude Desktop; Claude Code also tested; set-ups for others in `docs/CLIENTS.md` |
| Tools | 68 (at `1040453`) | 61, under `lr_*` names; 54 of the original's 68 have an equivalent (see `PARITY.md`) |

## What is new in LrC-AVG

### 1. Claude edits in rounds and looks at the result

The original has Claude set sliders directly; since the snapshot LrC-AVG forked from, it can also show Claude a preview on request, and its closed loop is a written skill without pass limits or guardrails (`docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` section 6.1). In LrC-AVG, Claude edits in short rounds (up to 8 by default, 1–16 in settings). Before each round it looks at a fresh preview of your photo and at measurements of it, then decides what to change next. The first round, "pass 0", sets the camera profile and lens corrections.

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

After you accept an edit, Claude can copy it to the selected photos (up to 500, about 40 seconds of work per request), or match each photo's brightness to the edited one (for bursts of the same scene). Each photo gets its own **AVG pre-sync …** snapshot first. Photos with a missing original file are skipped and reported.

### 9. More catalog tools

Both projects can search, rate and keyword photos, manage collections, and export and import (the original's export already offers JPEG, PNG, TIFF or the original file, with rename/overwrite/skip choices). LrC-AVG adds:

- Keywords in a hierarchy (`Places|Europe|Paris`) and a keyword-tree listing.
- Setting or removing GPS positions (the original can read GPS, not change it).
- Collection sets, and taking photos out of a collection.
- A "before" value in every answer for ratings, keywords and GPS, so Claude can put them back on request.
- Saving the current settings as a Lightroom preset.

Since 2026-10-27 (version 1.5.0) LrC-AVG also has the original's newer catalog, preset and Develop tools: search by camera, lens, ISO, focal length, flag, colour label and file type; colour labels; smart collections and deleting collections; renaming keywords and removing a keyword tree; the folder list; IPTC creator, copyright and location; metadata export; Develop presets listed, read, compared, exported and applied; Auto Tone and Auto White Balance; Reset; process version; snapshots; virtual copies; sharpness and statistics for up to 20 photos; fast cached previews. Each write takes a snapshot first or returns the earlier values. These have been tested against a simulated Lightroom only, so far `[unverified]` in Lightroom (`reports/phase11/PARITY-BATCH1-CHECKS.md`).

### 10. Honest, readable errors

Claude is told clearly why something was refused: an old process version, a missing original file, a setting your Lightroom does not offer, and so on. It no longer has to guess from a raw error string. A photo that cannot be edited safely is refused up front.

### 11. A record of every edit

Each session writes a log of what was changed and why, and each accepted session also writes a "recipe" file with its final settings. Logs and your own looks live under `%LOCALAPPDATA%\LrC-AVG`.

### 12. Cleaner installation and uninstall

- Installation is explicit: a setup command adds the engine to Claude Desktop, saves a backup of Claude Desktop's config first, and changes nothing if run twice. The original copies its plugin into Lightroom's folder by itself the first time it runs.
- A one-line command removes it again, and an uninstall section lists every folder LrC-AVG uses.
- LrC-AVG talks to Lightroom only on your own computer.

## What the original does that LrC-AVG does not (yet)

*Updated 2026-10-27; the full list is [`PARITY.md`](PARITY.md).*

| Original feature | In LrC-AVG |
|---|---|
| Mac support | Not supported. Windows only so far (Jim's open decision D4, epic #207) |
| Other AI apps (Claude Code, Codex, Cursor, Windsurf, VS Code) | Claude Desktop and Claude Code tested; the others have set-ups in `docs/CLIENTS.md`, some not tested |
| One-click Claude Desktop `.mcpb` installer and standalone binaries | A Windows setup with its own Node.js (release v1.1.0); `npm run package` also builds a `.mcpb`, not yet installed in Claude Desktop `[unverified]`; no standalone binaries |
| Write any Develop setting by SDK key name | Replaced by named settings with limits, tone curves included since Phase 10. Free key writes wait for Jim's decision D1 |
| Global undo of Lightroom's last step | Not included (decision D2); snapshots and Abort instead |
| Remove photos from the catalog | Not included (decision D3) |
| Mask tone curves, Point Color, one AI mask on many photos, deleting empty masks, brush feather and erase | Planned (issue #217) |
| Rights usage terms, copyright info URL and creator website | Planned (issue #218) |

## Where LrC-AVG is limited today

- Tested on **one Windows 11 PC** with Lightroom Classic 15.5.1 and 15.6. 15.0 is the supported baseline.
- Global Develop settings and masks only. No crop or geometry; HDR photos edit, with exposure limited to ±5.
- One edit session at a time. Catalog tools (sync, ratings, keywords and so on) wait until the session ends.
- Photos on older Lightroom process versions are refused until you update them in Develop, or with `lr_set_process_version` (1.5.0).
- Some features have been tested against a simulated Lightroom but not yet in Lightroom itself (for example keyword paths, GPS, the missing-original check and every tool new in 1.5.0). The sources table marks them.
- Released as a Windows setup from v1.1.0 (2026-10-24); the 1.5.0 tools are not in a release yet.

## Credit

LrC-AVG is built on the original Lightroom MCP by Marcin Skalski, used under the MIT license. The original copyright notice and license text are kept in `vendor/automaat/LICENSE` and the packaged half's `THIRD_PARTY_NOTICES.md`. LrC-AVG is not affiliated with or endorsed by Adobe or Anthropic.

## Sources for the claims above

Paths are in this repository. "Original" means the copy under `vendor/automaat/`, commit `a160e7a` (2026-09-22). The 2026-10-27 corrections compare against the original's live repository at commit `1040453` (2026-10-26), as `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` did. `[unverified]` means not yet observed in Lightroom.

| Claim | Handle |
|---|---|
| Original (at `a160e7a`) has 18 tools; none returns images; no snapshots or virtual copies; apply/copy/set develop writes have no History name | `docs/AUTOMAAT_SURVEY.md` sections 4.5–4.6, 5, 7 |
| Original runs on Mac and Windows with several AI apps, `.mcpb` bundle and binaries | `vendor/automaat/README.md` (top and "Install (other AI tools)"), `vendor/automaat/mcpb/manifest.json` |
| Original copies its plugin into Lightroom's Modules folder on start | `docs/AUTOMAAT_SURVEY.md` section 5 "Auto-install side effect" |
| Original at `1040453` has 68 tools; 54 have an LrC-AVG equivalent; the gaps and their decisions | `docs/parity/upstream-tools-1040453.txt`; `docs/PARITY.md` (45 have, 9 ours+), kept by `engine/tests/parity-map.test.ts`; decisions D1-D7 in GitHub issue #207 |
| LrC-AVG exposes 61 tools (1.5.0) | `TOOL_DEFS` in `engine/src/mcp/server.ts`; `engine/tests/parity-map.test.ts` checks that `docs/PARITY.md` names each |
| Tone curves since Phase 10 | `engine/src/params/canonical.ts:21` (`CurveParam`); `docs/reports/phase10/S14.md` "Verdict" |
| Release v1.1.0, 2026-10-24 | `gh release list`, 2026-10-27: "LrC-AVG v1.1.0, Latest, 2026-10-24T23:09:47Z" |
| Claude Code tested with LrC-AVG | `docs/CLIENTS.md:30`, `docs/reports/phase8.5/clients.md` |
| Original at `1040453`: previews, stats, snapshot tools, undo last step | upstream `server/src/tool-contracts.ts:508` (`get_photo_preview`), `:955` (`undo_last_step`); the snapshot tools in `docs/parity/upstream-tools-1040453.txt` |
| HDR photos edit with exposure ±5 | `README.md` "Known limitations" |
| The 1.5.0 tools are tested against a simulated Lightroom only | `docs/reports/phase11/PARITY-BATCH1-CHECKS.md`; in Lightroom `[unverified]` |
| Rounds, guardrails, defaults, snapshot and History names | `README.md` "Your first session", "Settings"; `engine/src/mcp/defs-session.ts` |
| Rounds, clipping limits and Abort worked on the Phase 5 check | `docs/reports/phase5/PHASE5.md` "Numbers" |
| HUD and its buttons, menu items | `README.md` "The HUD", "Menu items"; `plugin/LrC-AVG.lrplugin/Info.lua` |
| The Deck was accepted by Jim | `docs/reports/phase7/PHASE7.md` "Verdict" |
| Eleven intents; per-pipeline profile and white balance | `engine/intents/*.json`; `README.md` "What else you can ask"; `docs/reports/phase8/S10.md`. Behaviour on rendered photos in Lightroom: `[unverified]` |
| Mask tools and their stuck-Lightroom handling | `engine/src/mcp/defs-masks.ts` |
| Series sync limit (500, 40 s per request) and per-photo snapshot | `README.md` "What else you can ask"; `engine/src/sync/types.ts:18`; `engine/src/library/files.ts:35` |
| Keyword paths and GPS set/remove; the original only reads GPS | `engine/src/mcp/defs-catalog.ts`; `vendor/automaat/server/src/tool-contracts.ts:228-241`. Not yet tried in Lightroom: `[unverified]` |
| Missing-original refusal | `engine/tests/offline-original.test.ts` (simulated Lightroom). In Lightroom: `[unverified]` until `docs/reports/phase8/offline.md` is observed |
| Setup backup and no-change rerun; uninstall | `README.md` "Install", "Uninstall"; `docs/reports/phase6/package-smoke/smoke.txt` |
| Windows only, one PC, LrC 15.5.1 and 15.6 | `README.md` "Known limitations" |
