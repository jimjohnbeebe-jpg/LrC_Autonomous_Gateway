# AVG-S1 — preview freshness + latency

**Question (PHASES.md):** after `applyDevelopSettings`, how long until `requestJpegThumbnail(1600)` returns a JPEG, and does that JPEG reflect the change (fresh)? How does one `LrExportSession` JPEG at 1600 px compare?
**Rule:** Go = fresh preview ≤ 1.5 s. Conditional = fresh but > 1.5 s → export fallback becomes primary. No-go = stale → export path only; the pass budget is re-baselined.

## What the harness does (`plugin\spikes\S1.lrplugin\S1Run.lua`)

On the selected photo:
1. `n=0` baseline thumbnail, with no develop change.
2. `n=1..5`: sets `Exposure2012` to current ±1.0 (History step **"AVG S1"**; alternating +1, −1, +1, −1, +1). Then it requests the thumbnail, and **re-requests every 50 ms until Lightroom returns image data** (at most 30 s per step). Run 1 showed that a request made right after a change fails at once with `error loading thumb`. The harness records the number of attempts, the first error, and `ready_ms` (time from the change to the first usable thumbnail).
3. One `LrExportSession` JPEG, 1600 px long edge, timed.
4. Restores the original exposure (History step "AVG S1 restore").

Output goes to `%TEMP%\LrC-AVG\`: `s1_results.csv`, `s1_0.jpg` … `s1_5.jpg`, `s1_export.jpg`. Old S1 files are deleted at the start of each run.

## Run 2 — steps for Jim

Start only after Claude Code has told you that PR `phase-0/s1-thumbnail-retry` is merged; the new harness is then on disk.

1. In Lightroom: **File > Exit**. Wait for Lightroom to close completely, then start it again. This loads the new `S1Run.lua`; the plugin is already installed from run 1.
2. In the **Library** module, click `20260907-_OZ80093.NEF` (the same photo as run 1).
3. Press **D** to open it in **Develop**.
4. **File > Plug-in Extras > AVG S1 - Run preview freshness + latency.**
5. Do not click anything in Lightroom until the **"AVG S1 done"** dialog appears. This takes 15 s to 3 min; an export progress bar in the top-left is normal.
6. Take a screenshot of the dialog: press **Win+Shift+S**, drag around the dialog, click the notification, then **Save as** `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S1-run2-dialog.png`.
7. Click **OK** in the dialog.
8. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S1\measure.ts
   ```
9. Open `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S1.md`. Under the heading **"Run 2 (Jim)"**, paste the entire PowerShell output from step 8, then the line `Screenshot: docs\reports\phase0\S1-run2-dialog.png`. Save the file. Do not commit.
10. Tell Claude Code: **"S1 run 2 done."** Claude Code fills the Run 2 column and commits the report through a PR; you then record the verdict.

## If something goes wrong

- **The menu item is missing** under File > Plug-in Extras: open **File > Plug-in Manager**, select "LrC-AVG Spike S1 (preview freshness)" in the left list, and check that it shows **Enabled**. If it is disabled, click **Enable**, close the Plug-in Manager and repeat from step 4.
- **A Lightroom error dialog appears** (not the "AVG S1 done" dialog): screenshot it as in step 6, saved as `S1-run2-error.png`, click OK, paste the error text into the report under "Run 2 (Jim)", and tell Claude Code. Do not run step 8.
- **The done dialog starts with "ERRORS"**: that is a result, not a failure of the run. Carry on with steps 6–10.
