---
report: presets-rendered — how Lightroom writes a rendered photo's white balance and profile into a preset
phase: 8 (row 5, phase-8/propagation)
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Fable 5.1), 2026-10-09 (phase-8/propagation). Observed: Jim."
date: 2026-10-09
---

# presets-rendered — how Lightroom writes a rendered photo's white balance and profile into a preset

## Purpose

`lr_create_preset_from_active` writes a Develop preset file in the form of Lightroom's own, pinned from two reference presets Jim made on raw photos in Phase 4 [handle: `engine\tests\fixtures\presets\reference.lrc15.xmp`, `reference-2.lrc15.xmp`]. A rendered photo (JPEG, TIFF, PNG, …) has no Kelvin white balance and no Look: its white balance is `IncrementalTemperature`/`IncrementalTint` with `WhiteBalance` "Custom", and its profile is `CameraProfile` "Embedded" plus `ConvertToGrayscale` false (Color) or true (Monochrome) [handle: `docs\reports\phase8\S10.md` "Observed", run 2 "White balance" and "Profiles"]. How Lightroom writes these into a preset file has not been observed, so the engine leaves them out of a rendered photo's preset and says so in `left_out` [handle: `engine\src\presets\select.ts` leaveOut(), the two "Phase 8 row 5" rules].

**Question:** what does a preset Lightroom writes from a rendered photo contain for the white balance (keys, sign, decimals, the `WhiteBalance` mode) and for the profile (`CameraProfile`, `ConvertToGrayscale` for Color and for Monochrome)?

**PHASE8_PLAN row 5, quoted:** "Sync, presets, Variants on and across pipelines: `not_transferable` groups with reasons; rendered preset format pinned from Jim's reference preset (`npm run preset:capture --rendered`); Variants on a JPEG." Jim: "Makes one reference preset on `DSC_0031` by hand (steps in the row's README)". Two references instead of one [stated: Jim, 2026-10-09, "Go" to the row 5 plan, decision P1 B]: one with Color, one with Monochrome, so the files show ConvertToGrayscale in both forms.

**Go rule:** both captures `WORKED`, and the files show the keys above. The engine's writer is then pinned to them (`npm run preset:pin`) and the two left-outs are lifted. A file that lacks a key is a finding, not a failure: the engine then leaves that key out as Lightroom does, with the reason.

## Harness

- `npm run preset:capture -- --rendered` and `npm run preset:capture -- --rendered-mono` (`engine\src\devtools\preset-capture.ts`, `preset-capture-cli.ts`): read the selected photo through the bridge (nothing is written to Lightroom), check it is a rendered photo with the right profile and a Custom white balance with Temp and Tint above 0 (so the sign form is observed), find the preset's file under `%APPDATA%\Adobe\CameraRaw\Settings\`, check its values against the photo's, and save both as `engine\tests\fixtures\presets\reference-rendered*.lrc15.xmp` / `*-settings.lrc15.json`. The run's report goes to `%TEMP%\LrC-AVG\presets\capture_<time>.json`.
- `--precheck` with either flag only checks the selected photo.
- Tests: `engine\tests\preset-capture.test.ts` (the checks against the S10 dump of `DSC_0031.JPG`).

## Steps for Jim

Before: Lightroom Classic open with the LrC-AVG plugin enabled; Claude Desktop quit (each command takes the engine's instance lock); PowerShell at `D:\Developer\LrC_Autonomous_Gateway` on branch `phase-8/propagation` after `npm run build`.

1. Press **G**, open the **fixtures** collection, click `DSC_0031.JPG` **Copy 1** (the Copy 1 badge is at the bottom left of the thumbnail; the catalog holds two originals of that name, so the copy is the one photo these steps can name), and press **D**.
2. In the **Snapshots** panel on the left, click **+**, type `before presets`, click **Create**.
3. In the **Basic** panel, the **Profile** row must read **Color**. If it reads anything else, open its dropdown and pick **Color**.
4. In the **Basic** panel, drag **Temp** to the right to about **+20** and **Tint** to the right to about **+10**. The WB dropdown now reads **Custom**.
5. Menu **Develop > New Preset…**. Name: `AVG preset reference rendered`. Group: **LrC-AVG**. Click **Check All**. Click **Create**.
6. In PowerShell:
   ```powershell
   npm run preset:capture -- --rendered
   ```
   You should see `Preset capture ("AVG preset reference rendered"): WORKED`.
7. In the **Basic** panel, open the **Profile** dropdown and pick **Monochrome**. Temp and Tint keep their values.
8. Menu **Develop > New Preset…**. Name: `AVG preset reference rendered mono`. Group: **LrC-AVG**. Click **Check All**. Click **Create**.
9. In PowerShell:
   ```powershell
   npm run preset:capture -- --rendered-mono
   ```
   You should see `Preset capture ("AVG preset reference rendered mono"): WORKED`.
10. In the **Snapshots** panel, click **before presets**. The photo is back as it was.
11. Say "presets done".

The two presets stay in Lightroom's preset folder; the Phase 8 check (row 6) removes them, as the Phase 4 check removed the raw references [handle: `docs\reports\phase4\PHASE4.md` "The cleanup includes Jim's two reference presets"].

### If something goes wrong

- If a command prints `problem: the photo is on the raw pipeline`, the selected photo is not the JPEG: redo step 1.
- If a command prints `problem: the white balance must be Custom with Temp and Tint above 0`, redo step 4, then the preset step and the command again (delete the first preset first: right-click it in the **Presets** panel > **Delete**).
- If a command prints `problem: the photo's profile is Color; this reference needs Monochrome`, redo step 7, then steps 8 and 9.
- If a command prints `problem: found 0 preset files named …`, the preset was not created or has another name: redo the **New Preset…** step with the exact name.
- If a command prints `problem: the preset's values differ from the selected photo's`, a slider moved between the preset and the command: delete the preset, redo from step 4 (or step 7).
- If a command prints `FAILED: … not_connected` or hangs, Claude Desktop is using the engine or the plugin is off: quit Claude Desktop, check File > Plug-in Manager, run the command again.

## Pre-run findings (Claude Code)

1. The photo check refuses a raw photo, an As Shot white balance and the wrong profile, and passes the S10 dump of `DSC_0031.JPG` once its white balance is Custom with Temp 20 and Tint 10 [handle: `engine\tests\preset-capture.test.ts` "wants a rendered photo with Custom white balance above 0 and the named profile"].
2. The rendered expected keys are `IncrementalTemperature`, `IncrementalTint`, `WhiteBalance` (white_balance) and `CameraProfile`, `ConvertToGrayscale` (camera_profile) [handle: the same file, "expects the rendered keys of a rendered reference"]. Whether Lightroom writes them into a preset is [unverified] until the capture.
3. The capture itself (the preset file found, compared and saved) is the Phase 4 code path, unchanged [handle: `engine\tests\preset-capture.test.ts` "saves the reference and the photo's settings"].

## Observed (Jim)

**Run 1, 2026-10-10, 13:04-13:07Z** [stated: Jim, "presets done. Both failed, but I followed instructions explicitly."]. Written up from the capture reports by Claude Code [handle: `%TEMP%\LrC-AVG\presets\capture_2026-10-10T13-04-33-995Z.json`, `capture_2026-10-10T13-06-56-214Z.json`]:

- Both captures `FAILED` with the one problem `the preset's values differ from the selected photo's for CameraProfile`. The photo checks passed: `DSC_0031.JPG`, pipeline rendered, process version 15.4, white balance Custom, profile Color (19 non-zero numbers) and then Monochrome (15). Lightroom Classic **15.6** (`lrc_version`), Camera Raw **18.7** (the files' `crs:Version`); the Phase 4 raw references were written by 15.5.1 / 18.5.1.
- Both preset files were found in group `LrC-AVG`, one each. The strict value check compared the file's `CameraProfile` with the photo's "Embedded" and refused to save; every other key matched. The files themselves are the observation, copied by hand into `engine\tests\fixtures\presets\reference-rendered.lrc15.xmp` and `reference-rendered-mono.lrc15.xmp` [handle: `%APPDATA%\Adobe\CameraRaw\Settings\AVG preset reference rendered.xmp`, `AVG preset reference rendered mono.xmp`, 14-16 KB, 2026-10-10 06:04 and 06:06 local].
- What the files hold (both): `crs:WhiteBalance="Custom"`, `crs:IncrementalTemperature="+20"`, `crs:IncrementalTint="+10"`; `crs:ProcessVersion="15.4"`; the envelope of the raw references with `crs:Version="18.7"` instead of `"18.5.1"`, nothing else differing. Color: `crs:ConvertToGrayscale="False"`, `crs:CameraProfile="Default Color"`, no `CameraProfileDigest`, no `Look`. Monochrome: `crs:ConvertToGrayscale="True"`, `crs:CameraProfile="Default Monochrome"`, no `Vibrance`, `Saturation` or HSL keys (the capture lists them under `missing`), and the eight `crs:GrayMixer*` keys at 0, which the engine does not map.
- The `missing` list of the Color capture: `EnableLensCorrections` only, as for the raw references.

**Run 2, 2026-10-10, 13:42Z** [stated: Jim, "presets done"], the steps below, written up from the capture reports by Claude Code [handle: `%TEMP%\LrC-AVG\presets\capture_2026-10-10T13-42-36-316Z.json` (Color), `capture_2026-10-10T13-42-51-361Z.json` (Monochrome)]:

- Both `WORKED`, `differ` empty: every key in each file equals the photo's setting (CameraProfile through the pin). The photo as in run 1: rendered, process version 15.4, white balance Custom, profile Color then Monochrome.
- Saved: `reference-rendered-settings.lrc15.json` and `reference-rendered-mono-settings.lrc15.json` next to the two files (the files themselves unchanged since run 1).
- Findings, as expected from run 1: the Color file lacks `EnableLensCorrections`; the Monochrome file lacks that, `Vibrance`, `Saturation` and the 24 HSL keys.
- The engine's writer, given each photo's settings, writes every attribute, element and curve as Lightroom did in all four files, in Lightroom's order, and leaves out only what it names in `left_out` [handle: `engine\tests\presets-reference.test.ts`, 19 tests over the four references].

## Steps for Jim (the re-run, after the fix is on the branch)

The two presets stay as they are; only the photo's settings must match them again so the capture can save them with the photo's settings. Before: Lightroom open, Claude Desktop quit, PowerShell at the repo root on `phase-8/propagation` after `git pull`.

1. Press **G**, open the **fixtures** collection, click `DSC_0031.JPG` **Copy 1**, press **D**.
2. In the **Basic** panel, pick **Color** in the **Profile** dropdown.
3. Click the number to the right of **Temp**, type `20`, press Enter. Click the number to the right of **Tint**, type `10`, press Enter. WB reads **Custom**.
4. In PowerShell:
   ```powershell
   npm run preset:capture -- --rendered
   ```
   You should see `Preset capture ("AVG preset reference rendered"): WORKED`.
5. In the **Basic** panel, pick **Monochrome** in the **Profile** dropdown.
6. In PowerShell:
   ```powershell
   npm run preset:capture -- --rendered-mono
   ```
   You should see `Preset capture ("AVG preset reference rendered mono"): WORKED`.
7. In the **Snapshots** panel, click **before presets**.
8. Say "presets done".

If a command prints `problem: the preset's values differ from the selected photo's for …`, a slider is not where it was in run 1: the named key says which; set it as the preset has it (Temp 20, Tint 10) and run the command again.

## Numbers

| | Color file | Monochrome file |
|---|---|---|
| `WhiteBalance` | `Custom` | `Custom` |
| `IncrementalTemperature` / `IncrementalTint` | `+20` / `+10` | `+20` / `+10` |
| `CameraProfile` | `Default Color` | `Default Monochrome` |
| `ConvertToGrayscale` | `False` | `True` |
| `Version` (Camera Raw) | `18.7` | `18.7` |
| Envelope against the raw references | `Version` only | `Version` only |
| Keys the file lacks of the expected set | `EnableLensCorrections` | `EnableLensCorrections`, `Vibrance`, `Saturation`, the 24 HSL keys |

## Verdict

**Go** [stated: Jim, 2026-10-10, "go" to the recommendation]. Suggested by Claude Code: **go**. Both files show every key the question asked about; the rendered pipeline's white balance and profile are now written as Lightroom writes them, and the pin carries the newest envelope.

## Consequences / open questions

- Done on the branch after run 1: `npm run preset:pin` takes the four files, the newest Lightroom's envelope first (the references may differ in `crs:Version` alone, and a preset written now says 18.7 [inference: the version that writes it]); `presets\select.ts` writes a rendered photo's white balance as `IncrementalTemperature`/`IncrementalTint` with `WhiteBalance`, and its profile as `CameraProfile` "Default Color" / "Default Monochrome" with `ConvertToGrayscale` (`camera-profiles.lrc15.json` `preset_camera_profile`); the capture compares a rendered photo's `CameraProfile` through that pin, so run 2 can save the fixtures.
- After run 2: `tests\presets-reference.test.ts` runs over four references (it needs the `*-settings.lrc15.json` fixtures run 2 saves); MCP_TOOLS `lr_create_preset_from_active` loses the "rendered" left-out lines.
- A rendered photo with **As Shot** white balance: no reference; the engine leaves temperature and tint out as it does on raw [inference from the two raw references].
- Lightroom 15.6 / Camera Raw 18.7 on Jim's machine: the pinned key dumps (`sdk-keys.lrc15*.json`) were read under 15.5.1 and 15.6 (S10); whether 18.7 changed any key is [unverified] and outside this row.
