# AVG-S4 — floating HUD

**Question (PHASES.md):** does `LrDialogs.presentFloatingDialog` with labels bound to an observable table give a non-modal window that updates live and does not steal focus from Develop?
**Rule:** go / conditional / no-go recorded by Jim. No-go → the HUD becomes a Library-module-side dialog opened on demand.
**Unknowns** [unverified, LR_SDK_NOTES "LrDialogs / LrView"]: focus/refresh behaviour on Windows; whether the call blocks the calling task.

## What the harness does (`plugin\spikes\S4.lrplugin\S4Hud.lua`)

Opens a floating dialog "AVG S4 HUD" with two labels bound (`LrView.bind`) to a property table from `LrBinding.makePropertyTable`, which returns an `LrObservableTable`. A separate task writes both labels once per second for 30 s (`Tick n / 30`, `Clock HH:MM:SS`), then shows "Done". The PHASES.md version drives the labels from a socket message; the directive's timer-driven update tests the same binding path without S2. The harness logs to `$env:TEMP\LrC-AVG\s4_log.txt` whether `presentFloatingDialog` returned immediately or only when the window closed.

## Run (Jim)

1. Add `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S4.lrplugin` in Plug-in Manager.
2. Open any fixture in **Develop**.
3. **File > Plug-in Extras > AVG S4 - Show floating HUD (30 s live update)**.
4. During the 30 s, try each of these and note the result:
   - **Non-modal:** can you drag a Develop slider (e.g. Exposure) while the HUD is open?
   - **Live update:** does "Tick n / 30" advance once a second, including while you drag a slider?
   - **Focus:** after you click into the Develop image, does keyboard input go to Develop (e.g. `\` toggles before/after, arrow keys change photo), or does the HUD grab focus back on each tick?
   - **Z-order:** does the HUD stay above the main window when you click the main window? Can you move it to a second monitor?
   - Does the HUD survive switching modules (Develop → Library → Develop)?
5. Close the HUD with its window close button. Then open `$env:TEMP\LrC-AVG\s4_log.txt`.

## What to paste into `docs\reports\phase0\S4.md`

- Yes/no plus a note for each bullet above.
- A screenshot of the HUD mid-run (path).
- The `s4_log.txt` block, especially the line `presentFloatingDialog returned after X s`.
- Your verdict.
