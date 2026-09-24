# AVG-S1 — preview freshness + latency

**Question (PHASES.md):** after `applyDevelopSettings`, does `requestJpegThumbnail(1600)` return a JPEG that already reflects the change (fresh), and how long does it take? How does one `LrExportSession` JPEG at 1600 px compare?
**Rule:** Go = fresh preview ≤ 1.5 s. Conditional = fresh but > 1.5 s → export fallback becomes primary. No-go = stale → export path only; the pass budget is re-baselined.
**Why it matters:** the community reports that `requestJpegThumbnail` is slow right after develop changes (LR_SDK_NOTES, "Preview latency pothole" [community]). That is exactly the AVG loop condition.

## What the harness does (`plugin\spikes\S1.lrplugin\S1Run.lua`)

On the target (active) photo:
1. `n=0` baseline: `requestJpegThumbnail(1600, nil, cb)` with no develop change.
2. `n=1..5`: read `Exposure2012`, `applyDevelopSettings { Exposure2012 = current ± 1.0 }` with History name **"AVG S1"** (alternating +1, −1, +1, −1, +1), read it back, request the thumbnail. **Every callback** is timed (ms from request to callback) and saved; the harness keeps listening 2 s after the first callback in case Lightroom calls back twice.
3. One `LrExportSession` JPEG, 1600 px long edge, sRGB, timed.
4. Restores the original `Exposure2012` (History "AVG S1 restore").

Files in `$env:TEMP\LrC-AVG\`: `s1_results.csv`, `s1_0.jpg` … `s1_5.jpg` (plus `s1_<n>_cb<k>.jpg` if there were extra callbacks), `s1_export.jpg`. Old S1 files are deleted at the start of each run.

If the SDK rejects a `nil` height, the harness falls back to `(1600, 1600)` and records that in the `size_args` column; it does not hide it.

## Run (Jim)

1. Add `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S1.lrplugin` in Plug-in Manager.
2. Open fixture `20260907-_OZ80093.NEF` in **Develop** (any fixture works; note which one you used). Note whether its previews were already built, e.g. "just imported" vs "viewed in Develop for a while".
3. **File > Plug-in Extras > AVG S1 - Run preview freshness + latency.** Don't touch Lightroom until the "AVG S1 done" dialog appears (roughly 15–60 s). An export progress bar is expected.
4. Screenshot the done dialog (it shows the first-callback ms per step).
5. In PowerShell:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S1\measure.ts            # or: node spikes\S1\measure.ts "<folder the dialog showed>"
   ```
6. Optional but useful: run it a second time on the same photo (warm), and once on a photo you haven't opened yet (cold). Paste each measure output separately.

## What to observe

- Did any error dialog appear? Copy its text.
- During the run, did the Develop view visibly flip brighter/darker? (tells us whether the UI render and the thumbnail render compete)
- Did the photo end at its original exposure? Are there five "AVG S1" steps plus "AVG S1 restore" in History?

## What to paste into `docs\reports\phase0\S1.md`

- The full `measure.ts` output (the table plus the "report fields" block).
- The screenshot path of the done dialog.
- Photo used, and the preview state before the run.
- Your verdict. The script prints a *suggested* verdict from the PHASES.md rule; you confirm or override it.
