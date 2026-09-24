# AVG-S6 — virtual copies

**Question (PHASES.md):** does `catalog:createVirtualCopies` on the selected fixture work from **Loupe** and from **Grid**, and are three copies created and addressable by `localIdentifier`?
**Why it matters:** Variants mode (AVG-008) creates copies A/B/C. The SDK call is undocumented and acts on the *selected* photos. An old bug limited it to Grid view, reported fixed in LR6 (LR_SDK_NOTES "LrCatalog" [community]).

## What the harness does (`plugin\spikes\S6.lrplugin\S6Run.lua`)

It remembers the target photo as the master. Then, for each of **A, B, C**:
1. Re-selects the master (`catalog:setSelectedPhotos(master, {master})`), so each call copies the master and not the previous copy.
2. Calls `catalog:createVirtualCopies("AVG S6 <letter>")`, first **outside** a write gate. If that throws, it retries **inside** `withWriteAccessDo` and logs which one worked.
3. Logs the return type and count, and for each returned copy its `localIdentifier`, copy name, `isVirtualCopy` and master id. It also logs what the active photo is after the call.

Then it checks each copy can be found by `localIdentifier`: via `catalog:getPhotoByLocalId` if that function exists (LR_SDK_NOTES [community] says it does; Automaat's `PhotoLookup.lua:37` says there is no such lookup), and via a `getAllPhotos()` scan. The copies are named "AVG S6 A/B/C" (PRD §6.6 naming style) rather than one bare "AVG S6", so they can be told apart.

Output: a dialog plus `$env:TEMP\LrC-AVG\s6_log.txt`. The Loupe/Grid label in the log is **the menu item you chose**; the harness also logs the current module name.

## Run (Jim)

1. Add `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S6.lrplugin` in Plug-in Manager.
2. **Library, Loupe view** (press `E`), `20260907-_OZ80093.NEF` selected → **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in LOUPE view)**. Screenshot the dialog.
3. **Library, Grid view** (press `G`), only the **master** selected → **AVG S6 - … (I am in GRID view)**. Screenshot the dialog.
4. (Optional) The same from the **Develop** module; choose the LOUPE item and say so in the report.
5. In Grid, check: how many new copies exist, what their copy names are (Metadata panel "Copy Name"), and whether they are stacked with the master.
6. **Cleanup:** select only the virtual copies (not the master) > Photo > **Remove Photos…** > Remove. This removes virtual copies from the catalog; the original file is not touched.

## What to paste into `docs\reports\phase0\S6.md`

- Both dialog texts or `s6_log.txt` (Loupe run and Grid run).
- The copy count seen in Grid and the copy names.
- Whether any call needed the write gate, and whether the active photo moved to the new copy after a call.
