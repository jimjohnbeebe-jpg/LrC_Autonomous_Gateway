# AVG-S5 — develop-key dump, camera profiles, write/readback

**Question (PHASES.md):** what does `getDevelopSettings()` actually return on LrC 15.5.1 for a Z8 NEF and for the DxO DNG? What are the `CameraProfile` strings for each Adobe and Nikon profile? Are `CameraProfile` and the lens-correction toggle writable through `applyDevelopSettings`?
**Why it matters:** the canonical parameter map must be generated from a live dump, never copied from docs, which contain typos (LR_SDK_NOTES; `.claude\rules\03-lightroom.md`). AVG-010 (camera profile as pass zero) depends on the profile being writable.

## Menu items (`plugin\spikes\S5.lrplugin`)

- **AVG S5 - Dump develop settings of target photo** writes `%TEMP%\LrC-AVG\s5_<filename>.json` and appends one line to `%TEMP%\LrC-AVG\s5_profiles.log` (the process version plus every key whose name contains "Profile"). Each dump of the same photo overwrites its JSON; the log keeps every line.
- **AVG S5 - Write test (CameraProfile + EnableLensCorrections)** asks for a profile string, applies `{ CameraProfile = <string>, EnableLensCorrections = true }` (History "AVG S5 write test"), reads it back, and writes `s5_writetest_<filename>.json`.
- **AVG S5 - Write test B (LensProfileEnable = 1)** applies `{ LensProfileEnable = 1 }` and reads it back (`s5_writetestB_<filename>.json`). It settles which lens key is which: Automaat uses `LensProfileEnable` (`vendor\automaat\server\src\tool-contracts.ts:81`), while our docs say `EnableLensCorrections`.

Known limit: `Info.lua` declares `LrSdkVersion = 13.0`. If Lightroom hides keys newer than a plugin's declared SDK level [unverified], keys from SDK 14/15 would be missing; the dump's `meta.declared_sdk_version` records the level used.

## Steps for Jim

**A. Install**

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S5.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).

**B. Key dumps**

2. In **Library**, click `20260907-_OZ80093.NEF`. **File > Plug-in Extras > AVG S5 - Dump develop settings of target photo.** A dialog shows the key count and `CameraProfile`. Click **OK**.
3. Click `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`. Run the same menu item. Click **OK**.
4. In PowerShell, run this block exactly. It pins the keys and copies the two raw dumps into the repo as evidence:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S5\pin.ts `
     "$env:TEMP\LrC-AVG\s5_20260907-_OZ80093.NEF.json" `
     "$env:TEMP\LrC-AVG\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json"
   New-Item -ItemType Directory -Force docs\reports\phase0\S5 | Out-Null
   Copy-Item "$env:TEMP\LrC-AVG\s5_20260907-_OZ80093.NEF.json" docs\reports\phase0\S5\
   Copy-Item "$env:TEMP\LrC-AVG\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json" docs\reports\phase0\S5\
   ```
   Keep the PowerShell output; you paste it in step 18.

**C. Camera-profile strings: NEF**

5. Click `20260907-_OZ80093.NEF` and press **D** for Develop.
6. In the **Basic** panel, click the **Profile** drop-down → **Browse…**. The Profile Browser opens.
7. Click the first profile in the **Adobe Raw** group.
8. **File > Plug-in Extras > AVG S5 - Dump develop settings of target photo**, then click **OK**.
9. Repeat steps 7–8 for every other profile in the **Adobe Raw** group, then for every profile in the **Camera Matching** group. Skip all other groups (Artistic, B&W, Modern, Vintage, Legacy). Each dump adds one line to `s5_profiles.log`.
10. Click **Adobe Color** again, so the photo ends on its default profile.

**D. Camera-profile strings: DNG**

11. Press **G** for Grid, click `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`, and press **D**. Repeat steps 6–9 for this file: every profile in **Adobe Raw**, and every profile in **Camera Matching** if the browser shows that group for the DNG. If it doesn't, write `DNG: no Camera Matching group` in the report in step 17.

**E. Write tests on the NEF**

12. Click `20260907-_OZ80093.NEF` again (it shows Adobe Color from step 10).
13. Open `%TEMP%\LrC-AVG\s5_profiles.log` in Notepad (Win+R, paste `%TEMP%\LrC-AVG\s5_profiles.log`, Enter). Find the NEF line recorded while **Adobe Landscape** was selected. Copy the text after `CameraProfile=` up to the next gap (tab).
14. **File > Plug-in Extras > AVG S5 - Write test (CameraProfile + EnableLensCorrections).** In the dialog's text box, delete the current text, paste the text from step 13, and click **Apply**. Screenshot the result dialog as `docs\reports\phase0\S5-writetest.png`, then click **OK**.
15. In Develop, expand the **Basic** and **Lens Corrections** panels. Screenshot both (**Win+Shift+S**) as `docs\reports\phase0\S5-develop-after-write.png`.
16. **File > Plug-in Extras > AVG S5 - Write test B (LensProfileEnable = 1).** Screenshot the result dialog as `docs\reports\phase0\S5-writetestB.png`, then click **OK**.
17. In the **History** panel (left side of Develop, newest entry at the top), click the entry directly **below** "AVG S5 write test". That is the state before both tests, and it restores the photo.

**F. Report**

18. Open `docs\reports\phase0\S5.md`. Under **"Observed (Jim)"**, paste the PowerShell output from step 4 and the entire contents of `s5_profiles.log`, then add the three screenshot paths from steps 14–16. Save. Do not commit.
19. Tell Claude Code: **"S5 done."** Claude Code reads the write-test JSON files from `%TEMP%\LrC-AVG` itself and fills the tables.

## If something goes wrong

- **`pin.ts` prints `Key "…" has type … but …`**: the NEF and DNG disagree on a key's type. Paste the message into the report and tell Claude Code; do not continue to step C until it answers.
- **`pin.ts` says a file is not found**: the dump in step 2 or 3 did not run on that photo. Redo that step and then step 4.
