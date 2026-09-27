# AVG-S7 — presets, a removal probe, a crop, an unselected photo (Phase 4)

**Questions (PHASE4_PLAN row 4):**
1. Does a preset made through `LrApplication.addDevelopPresetForPlugin`, or a preset file written next to a hand-made one, show in the Develop **Presets** panel before and after a restart? (`lr_create_preset_from_active`, PRD 6.11 / OQ-3; PHASES acceptance: "a preset appears in the Develop Presets panel after Lightroom restart at most".)
2. Is there an undocumented call that removes a photo from the catalog? (D-02, decision 4.)
3. After a crop on a virtual copy, do `getRawMetadata("width"/"height")` follow the crop? (`effective_scale`, PHASES "Inputs from Phase 3".)
4. Can the plugin write to and export a photo it found with `findPhotoByUuid` without selecting it? (`lr_sync_series`, row 8.)

## What the harness does (`plugin\spikes\S7.lrplugin`)

**Menu item 1** first checks that a photo is selected and that a preset named **AVG S7 reference** exists, and stops before changing anything if not. Then it:
- makes a virtual copy **AVG S7 crop**, crops it, reads its size before and after, and exports it (1600 px);
- makes a virtual copy **AVG S7 unselected**, selects the original again, finds the copy by its uuid, writes +0.5 EV to it and exports it, and records whether the selection or the original changed;
- lists the function names it can see on the catalog and on a photo, looking for a removal call. **It never calls one**;
- creates the plugin preset **AVG S7 plugin …**, writes the preset file **AVG S7 xmp …** (Lightroom's own file for AVG S7 reference, with a new name and id), and applies the plugin preset to the unselected copy. The "…" is the date and time of the run (for example `AVG S7 plugin 20260927-143205`), so a second run never replaces the first run's presets. The result window shows the exact names.

**Menu items 2 and 3** list what Lightroom knows about the three presets and ask you, with tick boxes, which names you saw. Item 3 (after the restart) also applies each preset to the copy, then leaves exactly the two S7 copies selected, reads the selection back and says whether removing them is safe.

**Menu items 4-6 re-run the preset file alone** (see "Re-run" below). They need no selected photo, make no copies and change no photo.

Everything is saved automatically to `%TEMP%\LrC-AVG\S7\`; Claude Code collects it with `node spikes\S7\summarize.ts`. There is nothing to copy, paste or screenshot.

That is what the harness is written to do. What Lightroom actually does is [unverified] until this run.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S7.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).
2. In **Library**, click the original `20260907-_OZ80093.NEF` (the one **without** a folded-corner badge) and press **E**.

**Make the reference preset**

3. Press **D** (Develop). In the **Presets** panel on the left, click the **+** at the right of the panel's title, then **Create Preset…**.
4. In **Preset Name** type `AVG S7 reference`. Leave **Group** as **User Presets** and leave the ticks as they are. Click **Create**.

**Run the checks**

5. Press **E** (back to Library, the same photo fills the middle).
6. **File > Plug-in Extras > AVG S7 - 1. Run the checks (select 20260907-_OZ80093.NEF first).** Wait for the result window; it exports two photos first.
7. The window lists five results and, under "Next", which groups to open. Click **OK**.

**Look at the Presets panel, before the restart**

8. Press **D**. In the **Presets** panel, open the groups the window named (click the triangle next to each) and look for the three names it listed: **AVG S7 reference**, **AVG S7 plugin …** and **AVG S7 xmp …** (the last two end in the run's date and time). The tick boxes in the next step show the same names.
9. **File > Plug-in Extras > AVG S7 - 2. What the Presets panel shows (BEFORE restart).** Tick each name you saw, click **Save**, then **OK**.

**Restart, and look again**

10. **File > Exit**. Start Lightroom Classic again and wait until the photos show.
11. Press **D**, open the same groups in **Presets**, and look for the same three names.
12. Press **G** (Library, Grid).
13. **File > Plug-in Extras > AVG S7 - 3. What the Presets panel shows (AFTER restart).** Tick each name you saw, click **Save**. A window says whether both S7 copies are now selected. Click **OK**.

**Clean up**

14. If the window said the copies "are now selected": **Photo > Remove Photos…** and click **Remove**. In S6 this removed only the virtual copies, and the original NEF stayed in Library [stated: Jim, 2026-09-26; handle: `docs\reports\phase0\S6.md` "Observed"]. That it does the same here is [inference]: these are virtual copies too, made the same way.
15. Press **D**. In **Presets**, right-click each preset you can see whose name starts with **AVG S7**, and choose **Delete**.
16. Tell Claude Code: **"S7 done."**

## If something goes wrong

- **The window at step 6 says "stopped before changing anything"**: do what it says (select the photo, or make the reference preset exactly as in steps 3-4), then run step 6 again.
- **The + at step 3 is not there**: use the **Develop** menu > **New Preset…** instead, and carry on with step 4.
- **A result in the step-6 window says FAILED**: that is a result, not a failure of the run. Carry on.
- **You are not sure what you saw at step 9 or 13**: click **Cancel**, look again, and run the same menu item again.
- **The step-13 window says "COULD NOT SELECT …"**: don't remove anything and don't select copies by hand. Skip step 14 and mention it when you tell Claude Code.
- **A preset at step 15 is not in the panel, or will not delete**: leave it and mention it when you tell Claude Code.
- **A Lightroom error window appears instead**: tell Claude Code its text.

## Re-run: the preset file only (menu items 4-6)

**Why.** Run 1 (2026-09-27 11:22) wrote no preset file, because of a harness bug. The harness looked for the uuid that Lightroom reports for "AVG S7 reference" (`221C89F4…3357`) inside the preset's file. The file carries a different uuid (`crs:UUID="94B7E167…6019"`) [handle: `%TEMP%\LrC-AVG\S7\s7_run_2026-09-27T11-22-33.json` `presets.xmp`, and line 7 of `%APPDATA%\Adobe\CameraRaw\Settings\AVG S7 reference.xmp`]. The fix (`fix/s7-xmp`) takes the uuid from the file itself. Run 1's other answers (removal probe, crop, unselected photo, plugin preset) stand; only question 1's preset file is re-run.

**Menu item 4** checks that the preset **AVG S7 reference** exists, then writes **AVG S7 xmp …** next to it: the same file with a new name and uuid. It says whether the file was WRITTEN and whether Lightroom lists it straight away. **Items 5 and 6** ask, with tick boxes, which of the two names you saw before and after a restart. They also record what Lightroom lists, whether the new preset's settings match the reference's, and whether the file is still on disk byte for byte as written. Item 4 keeps a copy of what it wrote in the same temp folder to compare against. Everything saves itself to `%TEMP%\LrC-AVG\S7\` as `s7_xmp_*`; run 1's files are left as they are.

What Lightroom does with a preset file written by a plugin is [unverified] until this re-run.

### Steps for Jim (re-run)

1. If Lightroom Classic is open, **File > Exit**. Start Lightroom Classic again and wait until the photos show. This loads the updated S7 plugin with its three new menu items.
2. **File > Plug-in Extras > AVG S7 - 4. Re-run: write the preset file only.** The window says whether the preset file was **WRITTEN** and gives its name, **AVG S7 xmp** followed by the date and time. Click **OK**.
3. Press **D** (Develop). In the **Presets** panel on the left, open **User Presets** (click the triangle) and look for **AVG S7 reference** and the **AVG S7 xmp …** name from the window.
4. **File > Plug-in Extras > AVG S7 - 5. Re-run: what the Presets panel shows (BEFORE restart).** Tick each name you saw, click **Save**, then **OK**.
5. **File > Exit**. Start Lightroom Classic again and wait until the photos show.
6. Press **D**, open **User Presets** in **Presets** again, and look for the same two names.
7. **File > Plug-in Extras > AVG S7 - 6. Re-run: what the Presets panel shows (AFTER restart).** Tick each name you saw, click **Save**, then **OK**.
8. In **Presets**, right-click each preset you can see whose name starts with **AVG S7**, and choose **Delete**.
9. Tell Claude Code: **"S7 re-run done."**

### If something goes wrong (re-run)

- **File > Plug-in Extras has no "AVG S7 - 4"**: open **File > Plug-in Manager**. If "LrC-AVG Spike S7" is not in the list, add it as in step 1 of the first run. If it is listed but not **Enabled**, click **Enable**. Click **Done**, then do step 1 again.
- **The window at step 2 says "stopped before changing anything"**: the preset AVG S7 reference is gone. In **Library**, click the original `20260907-_OZ80093.NEF` and press **E**, make the preset as in steps 3-4 of the first run, then do step 2 again.
- **The window at step 2 says NOT WRITTEN**: stop there and tell Claude Code (the window says so too).
- **You are not sure what you saw at step 4 or 7**: click **Cancel**, look again, and run the same menu item again.
- **A preset at step 8 will not delete**: leave it and mention it when you tell Claude Code.
- **A Lightroom error window appears instead**: tell Claude Code its text.
