# AVG-S8 — HUD buttons, focus, settings page (Phase 5)

**Questions (PHASE5_PLAN row 1; the S4 leftovers in `docs\reports\phase0\S4.md` "Consequences"):**
1. **Buttons.** Do push buttons in a floating HUD fire, can a click start a task that reads the photo, does a bound `enabled` grey buttons out and back, and does a bound button title change?
2. **Focus.** When the HUD opens by itself, does the keyboard stay with the main window?
3. **Close from code.** Does `LrDialogs.closeFloatingDialogsForPlugin` close the HUD?
4. **Selection.** Does the HUD's `selectionChangeObserver` fire when the selection changes?
5. **Shared state.** Do a menu item, the long-running task started at load, and the Plug-in Manager section see the same module table and `_G`?
6. **Settings page.** Does a Plug-in Manager section save its fields in `LrPrefs`, what does a number field do with a value over its maximum, does the running task see an edit without a restart, and are the values still there after a restart?

## What the harness does (`plugin\spikes\S8.lrplugin`)

The plugin is built like the LrC-AVG plugin: when it loads, it starts a task that keeps running (here the "S8 loop", there the bridge). The menu items leave a request in a file, and the loop acts on it.

- **Menu item 1** asks the loop to open the HUD. **5 seconds later** the loop opens it: a small window **AVG S8 HUD** with a Stage line and Deltas lines that change every second, a "Last click" line, and buttons **Abort**, **Accept**, **Pick A**, **Pick B**, **Pick C** and **Approve**. Pick A-C start greyed out; clicking Approve un-greys them and should change its own label to "Approve pass 2". Every click is recorded, and each one reads the selected photo's Exposure (a read, never a write).
- **Menu item 2** asks the loop to close the HUD from code. When the HUD closes, a window with tick boxes asks what you saw.
- **The S8 section in Plug-in Manager** has five settings fields. They are saved as you change them.
- **Menu items 3 and 4** save the settings, before and after a restart, and ask with tick boxes what the page showed.

**S8 changes no photo and no Lightroom setting**: only its own saved settings, which nothing else uses. Everything is saved automatically to `%TEMP%\LrC-AVG\S8\`; Claude Code collects it with `node spikes\S8\collect.ts`. There is nothing to copy, paste or screenshot.

That is what the harness is written to do. What Lightroom actually does is [unverified] until this run.

## Steps for Jim

**Add the plugin and fill in the settings page**

1. **File > Plug-in Manager**. Click **Add** (bottom left), browse to `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S8.lrplugin`, select the folder itself and click **Select Folder**. Check that **LrC-AVG Spike S8 (HUD buttons, focus, settings page)** shows **Enabled**.
2. Keep Plug-in Manager open. Click **LrC-AVG Spike S8** in the list on the left. On the right, find the section **AVG S8 settings test** (click its triangle if it is closed).
3. **Mode**: choose **approve_each_pass**.
4. **Max passes (1-8)**: click in the field, select what is there, type `6`, press **Tab**.
5. **Highlight clip guardrail (%)**: select what is there, type `0.3`, press **Tab**.
6. **Log folder**: type `C:\S8-test`, press **Tab**. (Nothing is created there; it is only text.)
7. **Max passes (1-8)** again: select what is there, type `12`, press **Tab**. Look at what the field shows now, and whether a message appears. Click **OK** on any message.
8. Click **Done**.
9. **File > Plug-in Extras > AVG S8 - 3. Save the settings (BEFORE restart).** After about 5 seconds a window with tick boxes appears. Tick each statement that is true, click **Save**, then **OK**.

**The HUD**

10. In **Library**, click any photo and press **D** (Develop).
11. **File > Plug-in Extras > AVG S8 - 1. HUD test (the HUD opens by itself after 5 s).** Then **click once on the photo** in the middle of the screen, and take your hands off the mouse and keyboard.
12. About 5 seconds later the **AVG S8 HUD** window appears. **As soon as it appears, without clicking anything, press `\`** (backslash) once. Look whether the main window switched to the Before/After view. If it did, press `\` again to switch it back.
13. In the HUD, click **Abort**.
14. Click **Pick B** (it should look greyed out).
15. Click the button to the right of **Approve:**.
16. Click **Pick B** again.
17. Click **Accept**.
18. In the filmstrip at the bottom of the screen, click another photo, then click the first photo again.
19. **File > Plug-in Extras > AVG S8 - 2. Close the HUD from code.** Watch whether the HUD closes by itself.
20. A window **AVG S8 - what did you see in the HUD?** appears. Tick each statement that is true and click **Save**. A window headed **AVG S8 HUD test: SAVED** lists the clicks it recorded. Click **OK**.

**Restart, and look at the settings again**

21. **File > Exit**. Start Lightroom Classic again and wait until the photos show.
22. **File > Plug-in Manager**, click **LrC-AVG Spike S8** and look at the **AVG S8 settings test** section. Change nothing. Click **Done**.
23. **File > Plug-in Extras > AVG S8 - 4. Save the settings (AFTER restart).** Tick each statement that is true, click **Save**, then **OK**.
24. Tell Claude Code: **"S8 done."**

There is nothing to clean up. Leave the S8 plugin installed, like the other spike plugins (`spikes\README.md`).

## If something goes wrong

- **A window says "NOT STARTED - the S8 loop is not running"** (step 11) or **"NOT SENT"** (step 19): **File > Exit**, start Lightroom Classic again, then do steps 10-20 again.
- **A window says "NOT STARTED - no photo selected"**: click a photo, press **D**, and choose the menu item again.
- **The HUD has not appeared 15 seconds after step 11**: choose the menu item again once. If it still does not appear, tell Claude Code.
- **A button does nothing when you click it**: that is a result, not a failure of the run. Carry on with the next step.
- **The HUD is still open 5 seconds after step 19**: close it with the **X** in its title bar. The tick-box window of step 20 then appears.
- **You clicked Cancel in a tick-box window by mistake**: at step 9 or 23, choose the same menu item again. At step 20, do steps 10-20 again.
- **The AVG S8 settings test section is missing in Plug-in Manager, or looks different**: carry on. The tick boxes record it.
- **A Lightroom error window appears instead**: tell Claude Code its text.
