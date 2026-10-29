---
report: BATCH-1.7.0-CHECKS
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): the list, its order and the steps, 2026-10-28. Jim: the runs; his results go in each linked report."
date: 2026-10-28
---

# The Lightroom checks of version 1.7.0, in order

## Purpose

`main` `1768ad6` (PRs #246-#250, engine and plugin 1.7.0) is tested against the simulated Lightroom only. These checks are the Lightroom side [stated: CLAUDE.md, "Lightroom-side results are Jim's observations"]. Every step is written out here; each check's own report keeps its Observed, Numbers and Verdict.

| # | Check | Report (all in `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase11\`) | Catalog | Photo |
|---|---|---|---|---|
| 1 | `npm run perf:check -- --label after-cache` | `PERF.md` (measures the 1.7.0 keyword cache) | your usual one | the 4,608 photos selected on 2026-10-28 |
| 2 | `npm run catalog:throwaway` and `npm run denoise:check` | `THROWAWAY.md` | your usual one, then a new empty one | none |
| 3 | `npm run masks:verify -- --part person --i-know` | `MASKS-VERIFY.md` | your usual one | a photo of two or more people |
| 4 | `npm run masks:parity -- --i-know` | `MASK-PARITY.md` and `MASK-CONTROLLER.md` | your usual one | `_DSC0091.NEF` (this also checks it is no longer flipped) |
| 5 | `npm run develop-catalog:check` | `DEVELOP-CATALOG-D123.md` | your usual one | one raw photo on process Version 6 |
| 6 | #211 section 6, in Claude Desktop | `SHARED-CONNECTION-DESIGN.md` section 6 | your usual one | any one photo |

Why `--i-know` on checks 3 and 4: since #247 the mask checks refuse a catalog not marked as a throwaway one, and the photos these two need (people, `_DSC0091.NEF`) are in your usual catalog. Each writes behind a snapshot and puts the photo back [handle: `docs\DEVELOPMENT.md` "Live checks on a throwaway catalog"; `engine\src\devtools\throwaway.ts:14`].

Why `_DSC0091.NEF` in check 4: in the last `masks:verify` run its flip-back read "BA" (mirrored), so `put back` was NO [handle: `MASKS-VERIFY.md` "Observed", run 2]. Whether you flipped it back since is not recorded. Check 4 reads its orientation before writing anything and stops on a mirrored photo [handle: `engine\src\devtools\masks-verify-cli.ts:134-137`], so it tells us.

## Steps for Jim

Each "done" lets Claude Code collect that check's results and fill its report for you to confirm.

### Before you start

1. Do not use LrC-AVG in any Claude Desktop chat until check 6. Claude Desktop itself may stay open: an engine holds the Lightroom bridge only during a tool call and for 60 s after it [handle: `engine\src\mcp\main.ts:56` `IDLE_RELEASE_MS = 60000`, `engine\src\mcp\bridge-gate.ts:1-6`]. Check 6 quits and restarts Claude Desktop, so run it from a Claude Code session in a terminal, not in Claude Desktop.
2. Start Lightroom Classic with the catalog you keep your photos in.
3. In Lightroom: **File > Plug-in Manager**, click **LrC-AVG (dev)** in the list on the left, click **Reload Plug-in**, check that the right side shows version **1.7.0** (Lightroom may show it as 1.7.0.0 [unverified]), then click **Done**.
4. In PowerShell:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   ```
   Every command below runs in that window.

### Check 1: timings with the keyword cache (about 2 minutes, nothing is written)

5. In Lightroom, press **G** for the Library grid. Open the folder or collection you used for the timing run this morning (it had 4,608 photos) and press **Ctrl+A**.
6. Run:
   ```powershell
   npm run perf:check -- --label after-cache
   ```
   You should see one line per call with `p50` and `p95`, then `Perf check: WORKED` and `put back: YES`. Say **done**.

### Check 2: the throwaway-catalog guard (about 5 minutes)

7. Run:
   ```powershell
   npm run catalog:throwaway
   ```
   It prints your catalog's path and asks whether it is a throwaway catalog. Type `n`, then Enter. You should see `Throwaway catalog: FAILED` and "Nothing was written".
8. Run:
   ```powershell
   npm run denoise:check
   ```
   You should see `Stopped: the open catalog ... is not marked as a throwaway catalog`, `Denoise check: FAILED` and `put back: YES`. Nothing in Lightroom changes.
9. In Lightroom: **File > New Catalog**. In the window that opens, go to `D:\`, make a new folder `LrC-AVG-throwaway`, open it, type `Checks` as the file name, click **Create**. Wait until Lightroom shows the empty catalog.
10. Run:
    ```powershell
    npm run catalog:throwaway
    ```
    It prints the new catalog's path (`D:\LrC-AVG-throwaway\Checks\Checks.lrcat` or close to it). Type `y`, then Enter. You should see `The checks now run on this catalog: YES` and `Throwaway catalog: WORKED`.
11. In Lightroom: **File > Open Recent**, choose the catalog you keep your photos in. Say **done**, and say whether Lightroom restarted at step 9 or 11.

### Check 3: one-person masks (about 5 minutes)

12. In Lightroom, find a photo of two or more people standing apart, faces visible. Click it, then **Photo > Create Virtual Copy** (Ctrl+'). Then **Edit > Select None**, click the copy once so only it is highlighted, and press **D** for Develop. (Right after Create Virtual Copy two photos can be selected, and the check then stops with "2 photo(s) selected, not 1" [handle: `%TEMP%\LrC-AVG\masks-verify\mask_verify_2026-10-29T00-32-30-557Z.json`].)
13. Run:
    ```powershell
    npm run masks:verify -- --part person --i-know
    ```
14. When it asks, click the copy in the Filmstrip (bottom of the window), type `y`, then Enter.
15. For each question, look at the photo in Lightroom, then type `y` or `n` and Enter. Each mask takes a few seconds for Lightroom to compute.
16. You should see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Say **done**.

### Check 4: brush, inverted copy, mask curves and Point Color, on `_DSC0091.NEF` (about 10 minutes)

17. In Lightroom, press **G**. In the left panel click **Catalog > All Photographs**. Press **\\** (backslash) to show the filter bar above the grid, click **Text**, choose **Filename** and **Contains**, and type `_DSC0091`. Click the photo, then press **D** for Develop.
18. Run:
    ```powershell
    npm run masks:parity -- --i-know
    ```
19. When it asks, click `_DSC0091.NEF` in the Filmstrip, type `y`, then Enter.
20. If the next line says `flipped (BA): nothing written`: in Lightroom choose **Photo > Flip Horizontal** once, then run step 18 again. (If the Develop Photo menu has no Flip Horizontal: press **G**, choose **Photo > Flip Horizontal**, press **D**.)
21. For each brush question, look at the photo in Lightroom, then type `y` or `n` and Enter.
22. At the curve step: in the Masking panel (right) keep **AVG parity brush** selected, open its **Curve** section, drag the middle of the curve up a little, then type `y` and Enter.
23. The controller part follows. When it asks, click `_DSC0091.NEF` in the Filmstrip again, type `y`, then Enter.
24. For each curve question: in the Masking panel click **AVG controller radial**, open its **Curve** section (for the red question, choose the **Red** channel there), look at the photo and the curve, then type `y` or `n` and Enter.
25. For the Point Color question: with **AVG controller radial** selected, open its **Point Color** section, click the one swatch, read the **Hue**, **Saturation**, **Luminance** and **Range** sliders, then type `y` or `n` and Enter.
26. You should see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Say **done**.

### Check 5: `lr_set_develop_settings`, `lr_undo_last_step`, `lr_remove_photos` (about 3 minutes)

27. In Lightroom, press **G**, press **\\** and click **None** in the filter bar to clear the filter. Click one raw photo (`.NEF`), press **D**, and look at the top of the **Calibration** panel (right, last panel): it must say **Process: Version 6**. If it does not, pick another raw photo. Then press **G**, with only that photo selected.
28. Run:
    ```powershell
    npm run develop-catalog:check
    ```
    Lightroom switches between Develop and the Library grid several times. Do not click in Lightroom until the window asks a question.
29. Answer each question with `y` or `n`, then Enter.
30. You should see `Develop and catalog decisions check: WORKED` and `put back: YES`. Say **done**.

### Check 6: two Claude Desktop windows on one Lightroom (#211, about 5 minutes)

31. In Lightroom, press **G** and click one photo, only that one.
32. Start Claude Desktop. Open a **new chat** and type exactly:
    `Call lr_get_selected_photos and show me the result.`
    A tool result shows (your photo or an error; either is fine). Say **done**.
33. In Claude Desktop, open **Cowork** (or **Code**) and start a new task. Type the same sentence exactly. Say **done**.
34. Within one minute, go back to the chat from step 32 and type the same sentence again. Say **done**.
35. In the Cowork or Code task, type exactly:
    `Call lr_begin_session on the selected photo, then call lr_end_session with outcome revert.`
    Say **done**.
36. Quit Claude Desktop (tray icon > **Quit**). Say **done**.

### If something goes wrong

- If a check says "reload the LrC-AVG plugin", "does not report its catalog" or answers `unknown_command`: do step 3 again, then that check's command again.
- If a check says "Another LrC-AVG engine ... is using the Lightroom bridge": wait one minute, then run that check's command again. If it says so again, tell Claude Code the process number it names.
- If check 3 says "Lightroom found 1 person(s)" or 0: choose a photo where the people do not overlap, then go on from step 12.
- If check 3 or 4 says "photo(s) selected, not 1": click one photo in the Filmstrip, then run the check's command again.
- If check 3 or 4 first says a photo "is still owed its orientation": do the one menu action each question names, type `y` and Enter, until it goes on.
- If check 4's `delete_empty_masks` line names an unknown command: do step 3, then step 18.
- If check 4's mask has no Curve section: type `n` at the curve step and go on.
- If check 5 says "select ONE raw photo": select exactly one raw photo in the Library grid, then step 28 again.
- If check 5 shows a Lightroom dialog asking to confirm removing photos: click **Remove**, let the run finish, answer `n` to questions 1 and 2, then say **done**.
- If check 6 shows no Cowork or Code tab: say **no Cowork** at step 33; Claude Code records it and check 6 stops there.
- If check 6 asks to allow an lrc-avg tool: click **Allow**, then go on.
- If check 6 shows "Couldn't start" for lrc-avg: say **done** anyway; that message is the finding.
- If a check ends with `put back: NO`:
  - checks 3 and 4: in Develop, select the photo the line names, open the **Snapshots** panel (left) and click **AVG masks:verify before**;
  - check 5: in the Library grid (All Photographs) select the copies named "AVG develop-catalog-check A", "B" and "C", choose **Photo > Remove Photos...**, then **Remove**.

  Then go on with the next check.
- If a check stops with any other message: tell Claude Code the check's number, then go on with the next one.

## Results, 2026-10-29

Each check's own report has the details and the files:

| # | Result | Report |
|---|---|---|
| 1 | WORKED; `list_keywords` 10.7 s to about 1.5 ms at p50 | `PERF.md` |
| 2 | as designed: your catalog refused, the new one accepted | `THROWAWAY.md` |
| 3 | not tested: Lightroom gave the person probe no boxes (0 people) | `MASKS-VERIFY.md` run 4 |
| 4 | controller part all YES; brush steps y but read back different | `MASK-PARITY.md` run 2, `MASK-CONTROLLER.md` |
| 5 | FAILED: the undo left the write in place; the removal did not select the copies | `DEVELOP-CATALOG-D123.md` |
| 6 | #211 reproduced: the Cowork window got `ENGINE_BUSY` | `SHARED-CONNECTION-DESIGN.md` section 6 |

## Reruns after the fix PR (version 1.7.1)

These run once the fix PR for this batch is merged. Claude Code pulls `main` into `D:\Developer\LrC_Autonomous_Gateway` first.

1. In Lightroom: **File > Plug-in Manager**, click **LrC-AVG (dev)**, click **Reload Plug-in**, check that it shows version **1.7.1**, then click **Done**.
2. Do not use LrC-AVG in any Claude Desktop chat while these run.
3. Check 3 again: press **G**, **Edit > Select None**, click the virtual copy of `PICT0019.DNG` once, press **D**. Run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run masks:verify -- --part person --i-know
   ```
   When it asks, type `y` and Enter without clicking anything else. Answer each question. Say **done**.
4. Check 4's brush part again: in Develop, click `_DSC0091.NEF` in the Filmstrip. Run:
   ```powershell
   npm run masks:verify -- --part parity --i-know
   ```
   Do steps 19, 21 and 22 above. Say **done**.
5. Check 5 again: press **G**, click `20250413-_OZ81430.NEF` once (only it), then run:
   ```powershell
   npm run develop-catalog:check
   ```
   Do steps 29 and 30 above. Say **done**.

### Results of the 1.7.1 reruns, 2026-10-29

| # | Result | File in `%TEMP%\LrC-AVG\` |
|---|---|---|
| 3 | computed, but Lightroom rewrote the probe (MaskSubType 0 / MaskSubCategoryID 20036 read back 3 / 13, no InstanceBounds), so no people could be counted | `masks-verify\mask_verify_2026-10-29T02-45-05-667Z.json` |
| 4 | brush writes took (y); Lightroom read the strokes back compressed (`MaskBrushTable`, `BrushTable_<hash>`, no `Masks` list), which the comparator did not accept | `masks-verify\mask_verify_2026-10-29T02-47-46-629Z.json` |
| 5 | removal FIXED (3 removed, gone, selection back); undo still left the write in place | `develop-catalog-check\develop_catalog_check_2026-10-29T02-49-24-274Z.json` |

Fixed in version 1.7.2 [stated: Jim, 2026-10-29, "1. Go with recommendations. 2. Go with recommendation."]:
- `lr_undo_last_step` puts the photo back from the last write's "AVG pre-set" snapshot (`via: "snapshot"`); Edit > Undo only when no write is known.
- The mask read-back check takes a brush stored compressed; every other field must still match.
- The person part passes on a computed person mask plus your y; it no longer counts people or masks a second person.

## Reruns after 1.7.2

1. In Lightroom: **File > Plug-in Manager**, click **LrC-AVG (dev)**, click **Reload Plug-in**, check that it shows version **1.7.2**, then click **Done**.
2. Do not use LrC-AVG in any Claude Desktop chat while these run.
3. Check 3: press **G**, **Edit > Select None**, click the virtual copy of `PICT0019.DNG` once, press **D**. Run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run masks:verify -- --part person --i-know
   ```
   Answer the question. Say **done**.
4. Check 4's brush part: in Develop, click `_DSC0091.NEF` in the Filmstrip. Run:
   ```powershell
   npm run masks:verify -- --part parity --i-know
   ```
   Do steps 19, 21 and 22 above. Say **done**.
5. Check 5: press **G**, click `20250413-_OZ81430.NEF` once (only it), then run:
   ```powershell
   npm run develop-catalog:check
   ```
   Do steps 29 and 30 above. Say **done**.
