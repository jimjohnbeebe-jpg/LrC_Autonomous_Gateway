# AVG-S4 — floating HUD

**Question (PHASES.md):** does `LrDialogs.presentFloatingDialog` with labels bound to an observable table give a non-modal window that updates live and does not steal focus from Develop?
**Rule:** go / conditional / no-go recorded by Jim. No-go → the HUD becomes a Library-module-side dialog opened on demand.
**Unknowns** [unverified, LR_SDK_NOTES "LrDialogs / LrView"]: focus and refresh behaviour on Windows; whether the call blocks the calling task.

## What the harness does (`plugin\spikes\S4.lrplugin\S4Hud.lua`)

Opens a floating window "AVG S4 HUD" with two labels bound to a property table (an `LrObservableTable`). A separate task rewrites both labels once per second for 30 s (`Tick n / 30`, `Clock HH:MM:SS`) and then shows "Done". The harness logs to `%TEMP%\LrC-AVG\s4_log.txt` whether `presentFloatingDialog` returned immediately or only when the window closed.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S4.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).
2. In **Library**, select `20260907-_OZ80093.NEF` and press **D** for Develop.
3. **File > Plug-in Extras > AVG S4 - Show floating HUD (30 s live update).** The "AVG S4 HUD" window appears. You have 30 seconds for steps 4–8, so read them first.
4. Take a screenshot of Lightroom with the HUD visible (**Win+Shift+S**, full screen) and save it as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S4-hud.png`.
5. Drag the **Exposure** slider in Develop. Did the slider move (yes/no)? Did "Tick n / 30" keep counting while you dragged (yes/no)?
6. Click once on the photo in the centre of Develop, then press **\\** (backslash, which toggles Before/After). Did the view toggle (yes/no)? Press **\\** again to toggle back.
7. Click on the Lightroom main window, away from the HUD. Does the HUD stay in front of Lightroom (yes/no)?
8. Press **G** (switches to Library Grid), then **D** (back to Develop). Is the HUD still there and still counting or showing "Done" (yes/no)?
9. When the HUD shows "Done: 30 ticks", close it with the **X** in its title bar.
10. Press **Ctrl+Z** to undo your Exposure drag from step 5.
11. Open `%TEMP%\LrC-AVG\s4_log.txt` in Notepad (Win+R, paste `%TEMP%\LrC-AVG\s4_log.txt`, Enter) and copy its contents.
12. Open `docs\reports\phase0\S4.md`. Under **"Observed (Jim)"**, write the five yes/no answers from steps 5–8, paste the log contents from step 11, and add the line `Screenshot: docs\reports\phase0\S4-hud.png`. Save. Do not commit.
13. Tell Claude Code: **"S4 done."**

## If something goes wrong

- **No HUD window appears**: check whether a Lightroom error dialog appeared. Screenshot it as `S4-error.png`, paste its text into the report, and tell Claude Code.
- **Ctrl+Z in step 10 undoes something else**: open the **History** panel (left side of Develop) and click the entry just above your Exposure change.
