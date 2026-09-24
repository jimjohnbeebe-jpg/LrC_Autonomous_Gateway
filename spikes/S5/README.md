# AVG-S5 — develop-key dump, camera profiles, write/readback

**Question (PHASES.md):** what does `getDevelopSettings()` actually return on LrC 15.5.1 for a Z8 NEF and for the DxO DNG? What are the `CameraProfile` strings for each Adobe and Nikon profile? Are `CameraProfile` and the lens-correction toggle writable through `applyDevelopSettings`?
**Why it matters:** the canonical parameter map must be generated from a live dump, never copied from docs, which contain typos (LR_SDK_NOTES; `.claude\rules\03-lightroom.md`). AVG-010 (camera profile as pass zero) depends on the profile being writable.

## Menu items (`plugin\spikes\S5.lrplugin`)

- **AVG S5 - Dump develop settings of target photo** → `$env:TEMP\LrC-AVG\s5_<filename>.json` (`{ meta, settings }`), plus one line appended to `s5_profiles.log` holding `ProcessVersion` and every key whose name contains "Profile". The JSON is overwritten by each dump of the same file; the log keeps every line.
- **AVG S5 - Write test (CameraProfile + EnableLensCorrections)** → asks for a profile string, applies `{ CameraProfile = <string>, EnableLensCorrections = true }` (History "AVG S5 write test"), reads back, and writes `s5_writetest_<filename>.json` with before/requested/after for `CameraProfile`, `EnableLensCorrections`, `LensProfileEnable`, plus **every key that changed**.
- **AVG S5 - Optional write test B (LensProfileEnable = 1)**: Automaat allowlists `LensProfileEnable` (`vendor\automaat\server\src\tool-contracts.ts:81`), but the directive and LR_SDK_NOTES use `EnableLensCorrections`. Test B shows what the other key does. Run it only if test A leaves the question open.

Known limits: `Info.lua` declares `LrSdkVersion = 13.0`. If Lightroom hides keys newer than a plugin's declared SDK level [unverified], keys from SDK 14/15 would be missing; `meta.declared_sdk_version` records the level used. Empty Lua tables are written as `[]`.

## Run (Jim), in this order

1. Add `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S5.lrplugin` in Plug-in Manager.
2. **Key dumps** (profiles as they are now):
   - Select `20260907-_OZ80093.NEF` → *AVG S5 - Dump* → `s5_20260907-_OZ80093.NEF.json`
   - Select `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng` → *AVG S5 - Dump* → `s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json`
3. **Pin the keys right away**, before the profile cycling below overwrites the JSONs:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S5\pin.ts `
     "$env:TEMP\LrC-AVG\s5_20260907-_OZ80093.NEF.json" `
     "$env:TEMP\LrC-AVG\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json"
   ```
   This writes `engine\src\params\sdk-keys.lrc15.json` (key, type, sample value, seen_in). Also copy the two raw dumps to `docs\reports\phase0\S5\` so the pin has a checked-in handle.
4. **Profile strings:** on the NEF, open Develop > Basic > Profile browser. For **each Adobe profile** (Adobe Color, Adobe Landscape, Adobe Neutral, Adobe Portrait, Adobe Standard, Adobe Vivid, Adobe Monochrome, whatever is listed) and **each Camera Matching (Nikon) profile** listed for the Z8: select it, then run *AVG S5 - Dump*. Repeat for whatever the DxO DNG offers. Every selection adds a line to `$env:TEMP\LrC-AVG\s5_profiles.log`.
5. **Write test:** on the NEF, run *AVG S5 - Write test*, paste a profile string from `s5_profiles.log` that **differs** from the current one (e.g. the Adobe Landscape line), then click Apply. Check the Develop panel: does the Profile show the new one? What does the Lens Corrections panel show?
6. (Optional) *AVG S5 - Optional write test B*.
7. Revert the test steps in the History panel if you want the photo back as it was.

## What to paste into `docs\reports\phase0\S5.md`

- Both dialog texts (key count, CameraProfile, ProcessVersion) and the `pin.ts` console output.
- The whole `s5_profiles.log`.
- The write-test dialog text and `s5_writetest_*.json` (the `watched` and `changed_keys` parts), plus a screenshot of the Develop panel after the write.
- The Lightroom SDK version shipped with 15.5.1, if you have the SDK download (LR_SDK_NOTES asks for it).
