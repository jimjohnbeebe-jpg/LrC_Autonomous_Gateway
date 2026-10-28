---
report: PRESET-PARITY
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; Observed and Numbers copied from the run files, 2026-10-27); Jim (the run, his four answers, verdict)"
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

### Run 1, 2026-10-27: WORKED

Jim ran `npm run presets:check` and said "done" [stated: Jim, 2026-10-27, "npm run presets:check done"]. The photo was `_OZ80738.NEF` (`2D31DD06`), one of the two virtual copies of the develop check. The results file ends `headline: WORKED` [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`]:

```text
YES lr_list_presets lists Lightroom presets: 398 Lightroom (0 with a file in CameraRaw\Settings), 0 checkpoints
YES both checkpoints listed with scope plugin: 2 listed
YES lr_get_preset reads the checkpoint back: settings {"exposure":0.3,"contrast":10}
YES lr_compare_presets finds exactly the known diff: changes exposure, vibrance; other []
YES lr_export_preset copies once and refuses to replace: ...\presets-check\export_2026-10-28T02-27-54-987Z\AVG presets-check 2026-10-28T02-27-54 v1.lrtemplate; second call: PRESET_EXISTS
YES lr_apply_preset applies the checkpoint, after a snapshot: [...]
YES lr_apply_preset applies "User Presets / AI Dreamy Spring Sunrise": [...]
YES the snapshot puts the photo back: settings and masks as before
YES Jim's answer 1: y
YES Jim's answer 2: y
    finding, history_named_AVG: y
    finding, checkpoint_hidden_from_panel: y
```

- **Jim's answers:** y to "Is Lightroom still in the module it was in before this check, with the same photo selected?" and y to "Does the photo look as it did before the check?". Findings: y to "does the History panel show steps named \"AVG preset ...\"", and y to "is there NO preset named \"AVG presets-check 2026-10-28T02-27-54 v1\"" in Develop's Presets panel [handle: `engine\src\devtools\presets-check-cli.ts:122-127`; `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `passFail`, `findings`].
- **`preset:getSetting()` keys and types:** the checkpoint read back as `Contrast2012` 10, `Exposure2012` 0.3 (numbers) and `ProcessVersion` "15.4" (a string), which are the same names and types as `getDevelopSettings()` [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `checkpoint_read.raw_settings`]. The checkpoint files on disk hold exactly those keys (v2 adds `Vibrance` 15) [handle: the exported `.lrtemplate`, `docs\reports\phase11\PRESET-PARITY\run1\AVG presets-check 2026-10-28T02-27-54 v1.lrtemplate`].
- **`getFile()` for a Lightroom preset:** Jim's "User Presets / AI Dreamy Spring Sunrise" returned `%USERPROFILE%/AppData/Roaming/Adobe/CameraRaw/ImportedSettings/Jim's DreamySpringSunrise.xmp`, in `CameraRaw\ImportedSettings`, not `CameraRaw\Settings`. That is why 0 presets counted as having "a file in CameraRaw\Settings" [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `lightroom_preset_read.file`, `kinds`].
- **Applying the Lightroom preset** changed 27 settings and the camera profile ("Adobe Color" -> "Adobe Standard"), plus `ToneCurveName2012`. It carried no masks (`masks: 0`, `ai_masks: false`), so no `ai_update` [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `lightroom_apply`, `lightroom_preset_read`].
- **New: Temperature and Tint read -999999 after the checkpoint preset.** The checkpoint (v2) holds only `Exposure2012`, `Contrast2012`, `Vibrance` and `ProcessVersion`. Before it, the photo read Temperature 5050 and Tint 21; after it, both read **-999999**, and they still did before the next preset. The Lightroom preset then set them to 5050 and 21 again [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `lightroom_apply.applied[0].before` and the "applies the checkpoint" line]. No engine file contains -999999, so the value is Lightroom's [handle: a search of the repo outside `vendor`, `node_modules` and `docs` found only an unrelated float in `engine\tests\metrics.test.ts`]. The photo was put back with nothing differing, and Jim saw it look as before.

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | LrC 15.6 [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`, the same session 3 minutes earlier; this file does not record it] / plugin 1.5.0 |
| Presets listed: Lightroom / with a file in CameraRaw\Settings / checkpoints | 398 / 0 / 0 (before the check made two) |
| Checkpoint read back (v1 settings) | exposure 0.3, contrast 10 (`ProcessVersion` "15.4" as an other key) |
| Compare v1 → v2: changes / other changes | exposure 0.3 → 0.5, vibrance (none) → 15 / none |
| Export: path; second call | `%TEMP%\LrC-AVG\presets-check\export_2026-10-28T02-27-54-987Z\AVG presets-check 2026-10-28T02-27-54 v1.lrtemplate`; `PRESET_EXISTS` |
| Apply v2: before → after | exposure 0 → 0.5, contrast 0 → 10, vibrance 0 → 15; **temperature 5050 → -999999, tint 21 → -999999** |
| Lightroom preset applied; `ai_update` | "User Presets / AI Dreamy Spring Sunrise", 27 settings and the profile; no `ai_update` (no masks) |
| Put back: differing settings / masks back | none / YES |
| History step name (finding) | y: steps named "AVG preset …" |
| Checkpoint hidden from the Presets panel (finding) | y: hidden |

All from `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`.

## Verdict

**Go** [stated: Jim, 2026-10-27, "Go with recommendations. 5. Agreed"]. The -999999 reading is handled in the fix PR that follows.

## Consequences / open questions

- Settled by run 1: `preset:getSetting()` returns `getDevelopSettings()`'s names and types; History shows "AVG preset …" for `applyDevelopPreset` inside the gate (Jim, y); plugin presets are hidden from the Develop Presets panel on LrC 15.6 too (Jim, y), as on 15.5.1 [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`].
- Still [unverified]: whether `addDevelopPresetForPlugin` replaces an existing checkpoint's file (never tried, the plugin refuses a name in use); `getFile()` for Adobe's built-in presets (only a user preset was read).
- **Open: -999999 for Temperature and Tint** after a preset without white balance on a raw photo. What Lightroom means by it (perhaps "no value" while white balance is unset) is [unverified]. Whether an engine path misreads it is not yet checked: the guardrails' ranges, `lr_compare_presets` and `lr_step`'s `before` values would see a temperature far outside the 2000-50000 range [handle: `engine\src\params\canonical.ts:109`] [inference: what they do with it]. Worth a look before #207 closes; Jim's call.
- **"user" presets:** Jim's own presets live in `CameraRaw\ImportedSettings` [handle: `docs\reports\phase11\PRESET-PARITY\run1\presets_check_2026-10-28T02-27-54-987Z.json`, `lightroom_preset_read.file`], and the "with a file in CameraRaw\Settings" count misses them (0 of 398). Whether `lr_list_presets` should count `ImportedSettings` as user presets is Jim's call.
- The two checkpoints "AVG presets-check 2026-10-28T02-27-54 v1/v2" stay in Lightroom's plugin presets, hidden, as the steps say.
- Out of scope: #113's recipe-to-intent loop.
