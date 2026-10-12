# AVG-S11: catalog metadata the engine has no tool for yet (Phase 8.5, PR-4)

**Questions** (issues #111, #112, #139 gaps 2 and 4; report `docs\reports\phase8.5\S11.md`):
1. **Pick flags (#111).** Does `setRawMetadata("pickStatus", 1 | -1 | 0)` take, and does it read back?
2. **Title, caption, headline (#112).** Do the three IPTC fields take a write and read back?
3. **Altitude (#139 gap 3).** What do `gps` and `gpsAltitude` read on a photo?
4. **Folders (#139 gap 2).** Does `catalog:getFolderByPath` + `folder:getPhotos` find the photo's folder? Which `findPhotos` "folder" searches find the photo, and how long does each take?
5. **Stacks (#111, #139 gap 4).** SDK 15.2 can read stack state, but it can write a stack only at import (`catalog:addPhoto(path, stackWithPhoto, position)`) [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCatalog.html` addPhoto, `modules\LrPhoto.html`, `modules\LrSelection.html`]. Does a stack made that way show up when the stack state is read back?

## What the harness does

The S11 plugin (`plugin\spikes\S11.lrplugin`) has one menu item. It runs on the photo you select, which must be in the "fixtures" collection.

1. **Put back first.** If an earlier run stopped before putting its photo back, it puts that photo back.
2. **Remember the photo's values.** It saves the photo's pick flag, title, caption and headline in the plugin's preferences, so a stopped run can be put back.
3. **Write each value and read it back.** It writes Pick, then Reject, then no flag. Then it writes "AVG S11 title", "AVG S11 caption" and "AVG S11 headline". Each write has its own Undo entry, "AVG S11 …".
4. **Put the photo back.** It writes back every value it saved and reads each one back: **put back YES/NO**.
5. **Read only, nothing written:**
   - the photo's GPS, altitude and stack state;
   - its folder, found by path and by six `findPhotos` searches, each one timed.
6. **Make a stack at import.** It copies the photo's file twice into `D:\Developer\LrC_Autonomous_Gateway\fixtures\S11\` as `S11-stack-a` and `S11-stack-b` (that folder is ignored by git). It adds both to the catalog, the second stacked with the first, and reads their stack state back.
   - You remove these two copies by hand (step 5 below). The SDK's only removal call, `LrSelection.removeFromCatalog()`, removes whatever is selected [handle: `modules\LrSelection.html`], so the spike does not use it.
7. **Show the result.** A dialog shows **WORKED** or **FAILED**, **put back: YES/NO**, and one line per question. Everything is saved to `%TEMP%\LrC-AVG\S11\s11_<time>.json`, and Claude Code collects it. There is nothing to copy, paste or screenshot.

What Lightroom does with each call is [unverified] until this run.

## Steps for Jim

The S11 plugin does not use the bridge. Claude Desktop can stay open.

1. In Lightroom: **File > Plug-in Manager…**, click **Add**, select the folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S11.lrplugin`, click **Select Folder**, then **Done**.
2. Press **G**. In the Collections panel, click **fixtures**. Click one `20260907-_OZ80093.NEF`. The collection holds two originals of that name; either one works.
3. **File > Plug-in Extras > AVG S11 - Run on the selected photo.** After a few seconds (it copies the raw file twice), a dialog starts with **AVG S11: WORKED** or **FAILED**.
4. Click **OK**.
5. Remove the two copies:
   1. In the Folders panel on the left, click the folder named **S11** (the run added it: `D:\Developer\LrC_Autonomous_Gateway\fixtures\S11`).
   2. Choose **Photo > Stacking > Expand All Stacks** [unverified: the menu path, from memory].
   3. Press **Ctrl+A**, then **Delete**. In the window, click **Remove**, not "Delete from Disk".
   4. Right-click the folder **S11** > **Remove**.
6. Tell Claude Code "S11 done".

## If something goes wrong

- If the dialog says **NOT STARTED**, the selected photo is not in "fixtures", or more than one photo is selected. Do step 2 again, then step 3.
- If the dialog's "Stack made at import" line says the copies are **still in the catalog from an earlier run**, do step 5, then step 3 again.
- If the dialog says **put back: NO** and names another catalog, open that catalog (**File > Open Catalog**), then do step 3 again.
- If the dialog says **put back: NO** and names no catalog, tell Claude Code. The next run (step 3) puts the photo back first.
- If the dialog says **a run is still going**, click **OK** and wait for the first run's dialog.
- If **File > Plug-in Extras** has no "AVG S11" item, open **File > Plug-in Manager…**, click "LrC-AVG Spike S11", make sure it says **Enabled**, then click **Reload Plug-in**.
