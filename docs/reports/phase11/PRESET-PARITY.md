---
report: PRESET-PARITY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim); Jim (Observed, verdict)"
date: 2026-10-27
---

# PRESET-PARITY: do the Develop preset tools work in Lightroom?

## Purpose

GitHub issue #215 (epic #207) brings Automaat's preset tools [upstream claim: Automaat `HandlerDevelop.lua` at `1040453`, README "Iterative preset workflow"] into LrC-AVG through its safety layer: `lr_list_presets`, `lr_get_preset`, `lr_compare_presets`, `lr_export_preset` (read Lightroom's presets and LrC-AVG checkpoints; the export writes a new file only), `lr_apply_preset` (snapshot, "AVG preset …" History step, before and after, AI masks recomputed per photo, refused while a session is open) and `lr_create_checkpoint` (a versioned plugin preset through `LrApplication.addDevelopPresetForPlugin`, beside `lr_create_preset_from_active`'s file route).

The question: **in Lightroom, does each tool do what it says, does the snapshot undo `lr_apply_preset`, and does the Develop Presets panel keep checkpoints hidden?**

Acceptance (issue #215): "Six read/apply/export tools with tests; Jim's Lightroom check: list shows built-in, user and checkpoint presets; apply and undo via snapshot; compare of two known presets matches a manual diff. Report under `docs/reports/`."

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's):

- **Go:** the check ends `Presets check: WORKED` and `put back: YES`.
- **Conditional:** WORKED, but a finding differs from what the code assumes (History shows only the preset's name; a checkpoint shows in the panel). The tool descriptions are then corrected; no code is at fault.
- **No-go:** a row is NO, or `put back: NO`.

## Harness

`npm run presets:check`. Files: `engine\src\devtools\presets-check-cli.ts` (drives Lightroom through the engine's own `Tools`, so the six tools themselves run), `engine\src\devtools\presets-check.ts` (the checkpoints' settings, the expected diff, the verdict); test `engine\tests\presets-check.test.ts`. The plugin side is `plugin\LrC-AVG.lrplugin\Presets.lua` (bridge commands `list_presets`, `get_preset`, `apply_preset`, `create_checkpoint`); the AI recompute is the existing `update_ai_settings` (`Masks.lua`).

What a run does, on the ONE photo selected:

1. `lr_list_presets`: counts Lightroom presets, those whose file is in `CameraRaw\Settings` (user presets [handle: vault LR_SDK_NOTES "Recorded in Phase 4"]), and checkpoints.
2. `lr_create_checkpoint` twice, from canonical settings: `AVG presets-check <time> v1` {exposure 0.3, contrast 10} and `v2` {exposure 0.5, contrast 10, vibrance 15}; both must be listed with scope "plugin".
3. `lr_get_preset` on v1 must read exposure 0.3 and contrast 10 back.
4. `lr_compare_presets` v1 → v2 must find exactly exposure and vibrance (the known, manual diff).
5. `lr_export_preset` copies v1's file to `%TEMP%\LrC-AVG\presets-check\export_<time>\`; a second call must be refused (PRESET_EXISTS).
6. `lr_apply_preset` applies v2 to the photo (the photo must then read exposure 0.5, vibrance 15), then one Lightroom preset: an "Adaptive" sky preset when one is listed, so the AI recompute runs, else the first listed.
7. Asks whether the module and selection are unchanged; puts the photo back from the first snapshot (waiting while Lightroom computes an AI mask) and compares its settings and masks with how it started; asks about History, the Presets panel and the photo's look.

The two checkpoints stay in `%APPDATA%\Adobe\Lightroom\Plugin Develop Presets\` (hidden from the panel): no SDK call deletes a plugin preset [inference: none in `API Reference\modules\LrApplication.html`]. The photo keeps two snapshots "AVG pre-preset …".

## Pre-run findings (Claude Code)

- Engine tests against a fake plugin (no Lightroom): `engine\tests\presets-lightroom.test.ts` (list, get, ambiguity, compare, export), `presets-apply.test.ts` (snapshot before the write, History name, before/after, AI update in its own command and never as `applyDevelopPreset`'s argument, budget, session refusal, checkpoint versioning), `presets-check.test.ts` [handle: `npm test` on branch `phase-11/preset-parity`, see the PR].
- Static checks on `Presets.lua`: parses as Lua 5.1, requires only the plugin's own files, uses `LrTasks.pcall`, and does not call `updateAISettings` (only `Masks.lua` does, behind `Needs.lua`'s 13.3 gate) [handle: `engine\tests\lua-plugin.test.ts`, `sdk-version-gate.test.ts`].
- Issue #182 (MSIX redirection): checkpoints are written by the plugin inside Lightroom, so the redirection does not reach them [inference]; `lr_export_preset` copies from the engine and says so in its result when the folder is under AppData.

## Steps for Jim

1. Quit Claude Desktop (File > Exit, and its tray icon > Quit).
2. Start Lightroom Classic. In File > Plug-in Manager, select LrC-AVG and click **Reload Plug-in** (it loads `Presets.lua`).
3. In the Library grid, select ONE photo: a virtual copy is safest (Photo > Create Virtual Copy, then select the copy).
4. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run presets:check
   ```

5. Do not click in Lightroom while it runs. You see a YES or NO line for each step.
6. Answer each question with `y` or `n` and Enter:
   - "Is Lightroom still in the module it was in before this check, with the same photo selected?"
   - (after "Putting the photo back …") "Open the photo in Develop: does the History panel (left) show steps named "AVG preset ..."?"
   - "In Develop's Presets panel (left), is there NO preset named "AVG presets-check … v1"?" (type the name's start into the panel's search box)
   - "Does the photo look as it did before the check?"
7. You see `Presets check: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says `Stopped: … unknown_command` or "this LrC-AVG plugin does not know it": do step 2 again, then step 4.
- If it says "select ONE photo": select one photo in the Library grid, then step 4.
- If it says the bridge is not connected: check that Lightroom is open and LrC-AVG is enabled in Plug-in Manager, then step 4.
- If `put back: NO`: in Develop, with the photo selected, open the Snapshots panel (left) and click the first "AVG pre-preset …" snapshot.

## Observed (Jim)

<!-- Jim fills this in: the window's lines, the four answers. Claude Code collects %TEMP%\LrC-AVG\presets-check\presets_check_<time>.json. -->

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | |
| Presets listed: Lightroom / with a file in CameraRaw\Settings / checkpoints | |
| Checkpoint read back (v1 settings) | |
| Compare v1 → v2: changes / other changes | |
| Export: path; second call | |
| Apply v2: before → after | |
| Lightroom preset applied; `ai_update` | |
| Put back: differing settings / masks back | |
| History step name (finding) | |
| Checkpoint hidden from the Presets panel (finding) | |

## Verdict

<!-- Jim: go / conditional / no-go. The window's WORKED/FAILED is a suggestion. -->

## Consequences / open questions

- [unverified] until this run: the keys and value types `preset:getSetting()` returns (the reader in `engine\src\params\preset-read.ts` assumes `getDevelopSettings()`'s); the History name Lightroom shows for `applyDevelopPreset` inside a gate named "AVG preset …"; whether `addDevelopPresetForPlugin` replaces an existing checkpoint's file (the plugin refuses a name in use, so it is never tried); `getFile()` for built-in presets.
- [upstream claim]: plugin presets are hidden from the Develop Presets panel (`docs\AUTOMAAT_SURVEY.md` §4.5); observed once on LrC 15.5.1 [handle: vault LR_SDK_NOTES "Recorded in Phase 4", `jim.saw_plugin` false], re-tested here.
- Out of scope: #113's recipe-to-intent loop.
