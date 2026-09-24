# AVG-S6 — virtual copies

**Question (PHASES.md):** does `catalog:createVirtualCopies` on the selected fixture work from **Loupe** and from **Grid**, and are three copies created and addressable by `localIdentifier`?
**Why it matters:** Variants mode (AVG-008) creates copies A/B/C. The SDK call is undocumented and acts on the *selected* photos; an old bug limited it to Grid view, reported fixed in LR6 (LR_SDK_NOTES "LrCatalog" [community]).

## What the harness does (`plugin\spikes\S6.lrplugin\S6Run.lua`)

It remembers the selected photo as the master. Then, for each of **A, B, C**:
1. It re-selects the master, so each call copies the master and not the previous copy.
2. It calls `catalog:createVirtualCopies("AVG S6 <letter>")`, first without a write gate; if that fails, it retries inside `withWriteAccessDo` and logs which worked.
3. It logs what came back (type, count, each copy's `localIdentifier`, copy name, master id) and which photo is active afterwards.

It then checks each copy can be found by `localIdentifier`, via `catalog:getPhotoByLocalId` if that exists and via a full catalog scan. Output: a dialog, plus `%TEMP%\LrC-AVG\s6_log.txt`. The Loupe/Grid label in the log is **the menu item you chose**.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S6.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).

**Loupe run**

2. In **Library**, click `20260907-_OZ80093.NEF` and press **E** (Loupe view: the photo fills the centre).
3. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in LOUPE view).**
4. Screenshot the result dialog (**Win+Shift+S**) as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S6-loupe.png`. Click **OK**.

**Grid run**

5. Press **G** (Grid view). Click the **original** `20260907-_OZ80093.NEF` thumbnail, the one **without** a folded-corner badge (virtual copies have a folded page corner at the bottom left). Make sure it is the only photo selected.
6. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in GRID view).**
7. Screenshot the result dialog as `docs\reports\phase0\S6-grid.png`. Click **OK**.

**Check the copies**

8. In Grid, count the photos named `20260907-_OZ80093` that have the folded-corner badge. The expected total is 6 (3 from each run).
9. Click one of those copies and open the **Metadata** panel on the right. Note the **Copy Name** field; it should read "AVG S6 A", "AVG S6 B" or "AVG S6 C".

**Clean up**

10. In Grid, Ctrl+click to select **only** the virtual copies (all with the folded-corner badge, not the original).
11. **Photo > Remove Photos…** and click **Remove** (not "Delete from Disk"; for virtual copies the dialog offers only Remove). Only the catalog entries of the copies go; the NEF file is untouched.

**Report**

12. Open `docs\reports\phase0\S6.md`. Under **"Observed (Jim)"**, paste the contents of `%TEMP%\LrC-AVG\s6_log.txt` (open it in Notepad: Win+R, paste `%TEMP%\LrC-AVG\s6_log.txt`, Enter), then add the copy count from step 8, the Copy Name from step 9, and the two screenshot paths. Save. Do not commit.
13. Tell Claude Code: **"S6 done."**

## If something goes wrong

- **The dialog says "total copies returned: 0"**: that is a result, not a failure of the run. Carry on with steps 4–13 (skip steps 10–11 if there are no copies).
- **A Lightroom error dialog appears instead**: screenshot it as `S6-error.png`, paste its text into the report, and tell Claude Code.
