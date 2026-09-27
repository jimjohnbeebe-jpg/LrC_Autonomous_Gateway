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
- creates the plugin preset **AVG S7 plugin …**, writes the preset file **AVG S7 xmp …** (Lightroom's own file for AVG S7 reference, with a new name and id), and applies the plugin preset to the unselected copy. The "…" is the time of the run (for example `AVG S7 plugin 143205`), so a second run never replaces the first run's presets. The result window shows the exact names.

**Menu items 2 and 3** list what Lightroom knows about the three presets and ask you, with tick boxes, which names you saw. Item 3 (after the restart) also applies each preset to the copy, then leaves exactly the two S7 copies selected, reads the selection back and says whether removing them is safe.

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

8. Press **D**. In the **Presets** panel, open the groups the window named (click the triangle next to each) and look for the three names it listed: **AVG S7 reference**, **AVG S7 plugin …** and **AVG S7 xmp …** (the last two end in the run's time). The tick boxes in the next step show the same names.
9. **File > Plug-in Extras > AVG S7 - 2. What the Presets panel shows (BEFORE restart).** Tick each name you saw, click **Save**, then **OK**.

**Restart, and look again**

10. **File > Exit**. Start Lightroom Classic again and wait until the photos show.
11. Press **D**, open the same groups in **Presets**, and look for the same three names.
12. Press **G** (Library, Grid).
13. **File > Plug-in Extras > AVG S7 - 3. What the Presets panel shows (AFTER restart).** Tick each name you saw, click **Save**. A window says whether both S7 copies are now selected. Click **OK**.

**Clean up**

14. If the window said the copies "are now selected": **Photo > Remove Photos…** and click **Remove**. This removes only the two copies' catalog entries; the NEF stays (the same as in S6).
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
