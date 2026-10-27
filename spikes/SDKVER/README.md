# SDKVER: does the declared `LrSdkVersion` hide Develop keys?

**Question (GitHub issue #209, Info.lua:20-22):** does the `LrSdkVersion` a plugin declares change which keys `photo:getDevelopSettings()` returns? The plugin declares 13.0 today; issue #209 moves it to the latest Lightroom SDK version. The report is `docs\reports\phase11\SDKVER.md`.

## What the check does

`npm run sdkver:check` reads, by uuid, the full develop-settings table of **every photo in the "fixtures" collection** through the running plugin, and saves it together with the version the plugin declares (`hello.sdk_declared`) and Lightroom's version. It selects nothing, writes nothing to a photo and asks nothing. It needs no photo to be selected and no module open.

Run it twice, with a different declared version each time:

- **Run 1: the plugin as Lightroom has it loaded now (13.0).**
- **Run 2: after the plugin that declares the new version is in `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin` and has been reloaded.**

Nobody edits `Info.lua`: the PR for issue #209 changes it, and the reload makes Lightroom read it. The second run finds the first in `%TEMP%\LrC-AVG\sdkver\`, prints the keys only under one version, the keys only under the other, the keys with another type, the values that differ (a photo edited between the runs), and the keys new against `engine\src\params\sdk-keys.lrc15.json`. Don't edit any photo between the two runs.

Results go under `%TEMP%\LrC-AVG\sdkver\` (`sdkver_<declared>_<time>.json`, `dumps\`, a copy of the plugin's log). Claude Code collects them. There is nothing to copy.

## Steps for Jim

### Run 1

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**. Lightroom Classic stays open (any module).
2. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run sdkver:check
   ```

   The window prints `The loaded plugin declares LrSdkVersion 13.0`, one line per photo, then `This is run 1 (declared 13.0).` and ends with **SDKVER: WORKED**.
3. Tell Claude Code **"sdkver run 1 done"**.

### Run 2

Start only after Claude Code says the plugin with the new `LrSdkVersion` is in the plugin folder.

4. In Lightroom Classic, open **File > Plug-in Manager**. In the list on the left, click **LrC-AVG (dev)**, then click **Reload Plug-in**. Click **Done**, then wait 20 seconds.
5. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run `npm run sdkver:check` again. The window prints `The loaded plugin declares LrSdkVersion` followed by the new value, one line per photo, the comparison with run 1, and ends with **SDKVER: WORKED**.
6. Tell Claude Code **"sdkver run 2 done"**.

## If something goes wrong

- **The window says "another LrC-AVG engine is using the Lightroom bridge":** do step 1 again, then run the command again.
- **It says "could not connect to Lightroom":** check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG (dev) as Enabled, then run the command again.
- **It says `Lightroom has no collection named "fixtures"`:** nothing was read. Tell Claude Code.
- **A photo line says "could not be read":** the run is still saved. Tell Claude Code.
- **Step 2 prints a `declares LrSdkVersion` value other than 13.0:** the plugin Lightroom has loaded is not the 13.0 one. Tell Claude Code before doing anything else.
- **Step 5 prints `NOTE: the loaded plugin declares …` or `Every earlier run declared … too`:** Lightroom is still running the old plugin. In Lightroom: **File > Exit**, start Lightroom again, wait 20 seconds, then run step 5 again. If the same line is printed again, tell Claude Code.
- **The window ends with SDKVER: FAILED for any other reason, or a Lightroom error window appears:** click OK and tell Claude Code.

## Sources

1. The question and the declared value: `plugin\LrC-AVG.lrplugin\Info.lua:20-27`; issue #209 "What" and "Facts so far".
2. The pinned file the new keys are measured against: `engine\src\params\sdk-keys.lrc15.json` (the S5 dumps, `spikes\S5\pin.ts`; rule 03).
3. The steps and the diff: `engine\src\devtools\sdkver-check.ts`, `sdkver-diff.ts`, `sdkver-check-cli.ts`; test `engine\tests\sdkver-check.test.ts`. The census it reuses is spike S10's (`engine\src\devtools\s10-census.ts`).
