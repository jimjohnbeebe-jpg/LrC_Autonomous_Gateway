# AVG-S10 — the rendered pipeline recorded (Phase 8, row 1)

**Questions (vault `PHASE8_PLAN.md` row 1; the facts the engine needs before it can edit JPEG, PNG, TIFF, PSD, PSB, HEIC, AVIF, JPEG XL and CMYK files the way it edits raw files):**
1. **Pipeline per format.** Which develop pipeline does Lightroom put each file type on, read from the photo's own settings: raw (Kelvin `Temperature`) or rendered (`IncrementalTemperature`, profile "Embedded")? The 2026-10-08 probes saw every non-raw format on the rendered one; this run records it for every format in the collection, the ones you make included.
2. **The rendered keys.** What do the two keys beyond the raw pin take on a write: which values, and where do they clamp?
3. **Profiles.** What does Lightroom store when you pick Color and Monochrome on a JPEG, and does writing that back take? Does writing a raw profile to a JPEG take (the probes say no)?
4. **Process version 11.0.** Do writes to a "Version 5" photo behave as on 15.4?
5. **Lens corrections and white balance** on a rendered photo: do the lens switches and a Custom white balance take?
6. **Virtual copies** of a JPEG: are they made, and do they start as the master?
7. **Exports.** Does every format, HDR ones included, come through the session's preview path and into sharp?
8. **Put back.** Does the snapshot put every photo back exactly, format by format?

## What the harness does

- **`npm run s10:check -- --fixtures`** (engine, no clicks) puts the fixture photos into your "fixtures" collection by file name, then reads every photo there by uuid and prints one line per photo: its format, its pipeline, its process version and the keys it carries beyond the raw pin. It saves one settings dump per photo. Nothing is selected and nothing is written.
- **The S10 plugin** (`plugin\spikes\S10.lrplugin`) is the S5 profile recorder with its own folder: while it runs, every profile you click on the selected photo is recorded (a message in the middle of the screen confirms each one).
- **`npm run s10:check`** (engine) does the census again, then, **on every photo in the collection, behind a Develop snapshot**: selects the photo (Lightroom checks a write only on the photo loaded in Develop: run 1), writes every numeric slider to its limits and 1 % beyond (as the Phase 1 check did on the NEF), writes the rendered keys seven values, a Custom white balance, the lens switches off and on, and each recorded profile pair plus the raw "Adobe Color" pair as a control; reads every write back; then applies the snapshot and compares every setting with the start: **PUT BACK YES/NO** per photo. The Filmstrip selection jumps from photo to photo while it runs and is put back to your photo at the end. It then makes two virtual copies of your selected JPEG original and exports every photo through the engine's preview path. It asks you four y/n questions about your selected photo, in the PowerShell window.
- Everything is saved to `%TEMP%\LrC-AVG\S10\`; Claude Code collects it with `node spikes\S10\collect.ts`. There is nothing to copy, paste or screenshot.

Each photo in the collection gets about twenty History steps named `AVG S10 …` and is put back from its snapshot (`AVG S10 before …`); the snapshot stays in its Snapshots panel. That is what the harness is written to do; what Lightroom does with each write is [unverified] until this run.

## Steps for Jim

**Part A: the files your catalog lacks (PSB, 16-bit TIFF, 32-bit TIFF, CMYK TIFF, JPEG XL).** Adobe's list of formats Lightroom Classic imports also names these [handle: https://helpx.adobe.com/lightroom-classic/help/supported-file-formats.html]; the census found none in your catalog. Each is made from the raw fixture in Photoshop and saved into one new folder.

1. In Windows, make the folder `D:\Developer\LrC_Autonomous_Gateway\fixtures\S10` (it is ignored by git).
2. In Lightroom, press **G**, click `20260907-_OZ80093.NEF`, then **Photo > Edit In > Edit in Adobe Photoshop 2026** (the first entry; the year may differ). If a window asks "Edit a Copy with Lightroom Adjustments", click that, then **Edit**. Photoshop opens the photo.
3. In Photoshop: **File > Save As**. Set the folder to `D:\Developer\LrC_Autonomous_Gateway\fixtures\S10`, the file name to `S10-tiff16`, the format to **TIFF**, click **Save**; in the TIFF Options window keep the defaults and click **OK**. (Lightroom sends Photoshop a 16-bit file, so this is the 16-bit TIFF.)
4. **File > Save As** again: file name `S10-psb`, format **Large Document Format (*.PSB)**, **Save**; if a window asks about compatibility, click **OK**.
5. **Image > Mode > 32 Bits/Channel**. If a window asks about merging or flattening, click **Merge** (or **OK**). Then **File > Save As**: file name `S10-tiff32`, format **TIFF**, **Save**; in the TIFF Options window keep the defaults and click **OK**.
6. **Edit > Undo** until the title bar no longer shows "32 bit" (or **Image > Mode > 16 Bits/Channel**, and in the HDR Toning window click **OK**). Then **Image > Mode > CMYK Color**; if a window asks about the profile conversion, click **OK**. **File > Save As**: file name `S10-cmyk`, format **TIFF**, **Save**, **OK**.
7. **File > Save a Copy**. In the format list, look for **JPEG XL**. If it is there: file name `S10-jxl`, **Save**, and click **OK** in its options window. If it is not there: skip this step and tell Claude Code "no JPEG XL in Photoshop" when you are done (the format then stays [unverified] by name in the report).
8. Close Photoshop (**File > Exit**; click **Don't Save** if asked).
9. Back in Lightroom: **File > Import Photos and Video…**. In the Source panel on the left, open `D:\Developer\LrC_Autonomous_Gateway\fixtures\S10`. At the top, choose **Add**. Click **Import** (bottom right). The S10 files appear in the Library.

**Part B: the collection.**

10. Open PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`. Quit Claude Desktop first: right-click the Claude icon in the Windows system tray > **Quit**. Then run:

    ```powershell
    npm run s10:check -- --fixtures
    ```

    It prints "found" or "not in the catalog" for each fixture name, then one line per photo in the collection, and ends with `Spike S10: WORKED`. If any `S10-` file you made is reported "not in the catalog", tell Claude Code.

**Part C: the profile recorder.**

11. In Lightroom: **File > Plug-in Manager**. Click **Add** (bottom left), browse to `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S10.lrplugin`, select the folder itself and click **Select Folder**. Check that **LrC-AVG Spike S10 (rendered profiles)** shows **Enabled**. Click **Done**.
12. Press **G**, click `DSC_0031.JPG` **Copy 1** (the Copy 1 badge is at the bottom left of the thumbnail; the catalog holds two originals of that name, so the copy is the one photo this step can name), and press **D**.
13. **File > Plug-in Extras > AVG S10 - 1. Start profile recorder.** A message "profile recorder started" appears, then "Recorded 1: Embedded".
14. In the **Basic** panel, open the Profile Browser (the four-squares icon at the right end of the **Profile** row). In the **Basic** group at the top, click **Monochrome**, wait for the message in the middle of the screen ("Recorded 2: Embedded + B&W"), then click **Color**, wait for the message ("Already recorded: Embedded"). Close the Profile Browser (click **Close** at the top right of it). Check that the **Profile** row reads **Color** before going on.
15. **File > Plug-in Extras > AVG S10 - 2. Stop profile recorder.** A window lists what was recorded, two lines. Click **OK**.

**Part D: the check.**

16. Press **G**, click `_OZ80660.JPG` (an original JPEG; the copies step needs an original, and this name is unique), and press **D**. In PowerShell run:

    ```powershell
    npm run s10:check
    ```

    It prints the census, then works through every photo in the collection (a few minutes; the selection jumps from photo to photo). It asks four questions about `_OZ80660.JPG` when its turn comes, each ending "Type y or n, then Enter:": look at the Basic panel and answer. It ends with `Spike S10: WORKED` or `FAILED` and a `PUT BACK` line per photo, with `_OZ80660.JPG` selected again.
17. In Lightroom, press **G**. Two new virtual copies of `_OZ80660.JPG` named `AVG S10 copy A` and `AVG S10 copy B` are in the Filmstrip next to it. Click the first, Ctrl+click the second, press **Backspace**, and in the window click **Remove**.
18. Tell Claude Code: **"S10 done."**

## If something goes wrong

- **Step 10 or 16 says "another LrC-AVG engine is using the Lightroom bridge"**: Claude Desktop is still running. Quit it from the system tray and run the command again.
- **Step 10 or 16 says "could not connect to Lightroom"**: check that Lightroom is open and that File > Plug-in Manager lists **LrC-AVG** as Enabled, then run the command again.
- **Step 16 ends with a `PUT BACK: NO` line for a photo**: don't change that photo. The results name the snapshot `AVG S10 before …` in its Snapshots panel. Tell Claude Code first.
- **Step 16 prints "the bridge did not come back within 30 s"**: the plugin's connection dropped (it did once in run 1, on the last photo) and did not return. Check File > Plug-in Manager lists LrC-AVG as Enabled, then tell Claude Code; the results say which photos were put back.
- **A step 14 click shows no message within about 2 seconds**: click the other profile, then the one you wanted again.
- **Step 13 says "the profile recorder is already running"**: run step 15 (stop), then step 13 again.
- **Step 2's Edit In menu shows no Photoshop**: tell Claude Code; Part A then waits.
- **A Lightroom or Photoshop error window appears**: take a screenshot (**Win+Shift+S**), save it as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase8\S10-error.png`, click OK, and tell Claude Code.

## Files

| Part | Files |
|---|---|
| Fixtures, census, writes, copies, exports | `engine\src\devtools\s10-fixtures.ts`, `s10-census.ts`, `s10-probe.ts`, `s10-profiles.ts`, `s10-writes.ts`, `s10-extras.ts`, `s10-check.ts` (the steps), `s10-check-cli.ts` (`npm run s10:check`), `s10-config.ts` (the plan, the pipeline rule) |
| Recorder | `plugin\spikes\S10.lrplugin\{Info,S10Common,S10Recorder,S10RecordStart,S10RecordStop,SpikeJson}.lua` |
| Tests | `engine\tests\s10-check.test.ts` against the simulated plugin with a rendered photo (`engine\tests\fixtures\s10-rendered-dsc0031.json`) |
| Collector | `spikes\S10\collect.ts` → `docs\reports\phase8\S10\`, `s10_summary.json` |
| Report | `docs\reports\phase8\S10.md` |
