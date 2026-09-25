# AVG-S4 — floating HUD

**Question (PHASES.md):** does `LrDialogs.presentFloatingDialog` with labels bound to an observable table give a non-modal window that updates live and does not steal focus from Develop?
**Rule:** go / conditional / no-go recorded by Jim. No-go → the HUD becomes a Library-module-side dialog opened on demand.
**Unknowns** [unverified, LR_SDK_NOTES "LrDialogs / LrView"]: focus and refresh behaviour on Windows; whether the call blocks the calling task.

## What the harness does (`plugin\spikes\S4.lrplugin\S4Hud.lua`)

It opens a small floating window, "AVG S4 HUD", whose two lines update once per second for 30 s. When you close it, the harness:
- puts the photo's **Exposure back** to where it was before the test (you drag the slider during the test), and checks it;
- asks you **five yes/no questions** about what you saw, as tick boxes;
- saves your answers and its own timings automatically to `%TEMP%\LrC-AVG\S4\`. Claude Code collects them; there is nothing to copy, paste or screenshot.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S4.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).
2. In **Library**, click `20260907-_OZ80093.NEF` and press **D** (Develop).
3. Read steps 5–8 now; you'll do them during the 30 seconds.
4. **File > Plug-in Extras > AVG S4 - Show floating HUD (30 s live update).** The "AVG S4 HUD" window appears and starts counting.
5. Drag the **Exposure** slider a little. Watch whether the HUD's "Tick" number keeps counting while you drag.
6. Click once on the photo in the middle of Develop, then press **\\** (backslash) twice (it switches Before/After and back).
7. Click on the main Lightroom window, away from the HUD. Notice whether the HUD stays in front.
8. Press **G** (Library), then **D** (back to Develop). Notice whether the HUD is still there.
9. When the HUD says "Done", close it with the **X** in its title bar.
10. A window with five statements appears. Tick every statement that was true, then click **Save**.
11. A message confirms "Exposure put back … YES". Click **OK**.
12. Tell Claude Code: **"S4 done."**

## If something goes wrong

- **No HUD window appears after step 4**: tell Claude Code what you see instead (for example, an error window's text).
- **The message in step 11 says "Exposure put back: NO"**: open the **History** panel (left side of Develop) and click the entry just below your first Exposure change, then tell Claude Code.
