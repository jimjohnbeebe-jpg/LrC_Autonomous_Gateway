---
report: THROWAWAY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-28, branch phase-11/lua-quality-gate); Jim (Observed, verdict)"
date: 2026-10-28
---

# THROWAWAY: do the live checks refuse a catalog that is not marked as a throwaway one?

## Purpose

GitHub issue #213 (epic #207), Work item 3: "a marker file written by a setup script into a throwaway catalog; `masks:*`, `denoise:check`, `phase*:check` refuse a catalog without it unless `--i-know` is passed." Automaat's live-test kit refuses any catalog without its marker [upstream claim: Automaat/lightroom-mcp `tests/e2e/live/README.md` "Safety rules", at `1040453`].

The questions: **(1) does the plugin report the open catalog's path in hello? (2) does a check refuse the catalog Jim keeps his photos in, writing nothing? (3) does `npm run catalog:throwaway` mark a new catalog so the checks accept it?**

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's): `catalog_path` set in both `throwaway_*.json` files, the denoise check stopped with the refusal and "put back: YES", and `refused_after` null in the second run: the guard works.

## Harness

`npm run catalog:throwaway` (`engine\src\devtools\throwaway-cli.ts`): connects, prints the catalog path from the plugin's hello, asks y/n in the PowerShell window, and on y writes `lrc-avg-throwaway.json` beside the `.lrcat`, then reads the guard back. The guard is `engine\src\devtools\throwaway.ts` (test `engine\tests\throwaway.test.ts`); the path comes from `catalog:getPath()` in `plugin\LrC-AVG.lrplugin\Bridge.lua` `helloPayload`. Results under `%TEMP%\LrC-AVG\throwaway\` (`throwaway_<time>.json`, user folder redacted) and, for step 4, `%TEMP%\LrC-AVG\denoise-check\denoise_check_<time>.json`.

The checks that call the guard: `masks:carry`, `masks:combine`, `masks:kinds`, `masks:crop`, `masks:verify`, `masks:parity`, `denoise:check` (after the bridge connects, before anything is written) and `phase2:check`, `phase3:check`, `phase4:check`, `phase5:check`, `phase8:check` (before the check starts). `-- --i-know` runs any of them on an unmarked catalog.

## Pre-run findings (Claude Code)

- `catalog:getPath()` "Retrieves the file-system location of this catalog, the absolute path of the .lrcat file. First supported in version 3.0 of the Lightroom SDK" [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCatalog.html`]. Whether it yields is not documented; the plugin calls it in a plain pcall, so a failure leaves `catalog_path` out and the checks refuse to run [inference].
- The guard's cases (no marker, a marker naming another catalog, a damaged marker, no `catalog_path`, `--i-know`) pass in `engine\tests\throwaway.test.ts` (`npm test`, 2026-10-28).
- Whether Lightroom restarts when File > New Catalog opens the new catalog is [unverified].

## Steps for Jim

1. In Lightroom, with the catalog you keep your photos in open: **File > Plug-in Manager**, select **LrC-AVG (dev)**, click **Reload Plug-in**, then **Done**.
2. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
3. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run catalog:throwaway
   ```
   It prints your catalog's path and asks whether it is a throwaway catalog. Type `n`, then Enter. You should see `Throwaway catalog: FAILED` and "Nothing was written".
4. Run:
   ```powershell
   npm run denoise:check
   ```
   You should see `Stopped: the open catalog <your catalog>.lrcat is not marked as a throwaway catalog`, `Denoise check: FAILED` and `put back: YES`. Nothing in Lightroom changes.
5. In Lightroom: **File > New Catalog**, make a new folder `D:\LrC-AVG-throwaway`, name the catalog `Checks`, click **Create**. Wait until Lightroom shows the empty catalog.
6. Run:
   ```powershell
   npm run catalog:throwaway
   ```
   It prints `D:\LrC-AVG-throwaway\Checks\Checks.lrcat` (or where Lightroom put it). Type `y`, then Enter. You should see `The checks now run on this catalog: YES` and `Throwaway catalog: WORKED`.
7. In Lightroom: **File > Open Recent**, choose the catalog you keep your photos in.
8. Tell Claude Code "done".

### If something goes wrong

- If step 3 or 6 prints "does not report its catalog: ... Reload Plug-in", do step 1 again (in the catalog that is open), then repeat the step.
- If a step prints "Another LrC-AVG engine ... is using the Lightroom bridge", do step 2 again, then repeat the step.

## Observed (Jim)

_Filled by Jim only._

- Step 3 (`throwaway_*.json`, `catalog_path`, answer n):
- Step 4 (denoise check refused, put back YES/NO):
- Step 5 (did Lightroom restart to open the new catalog? yes/no):
- Step 6 (`throwaway_*.json`, `refused_after`):

## Numbers

| Field | Value |
|---|---|
| `catalog_path` reported (step 3) | |
| denoise check refused, nothing written (step 4) | |
| `refused_after` (step 6) | |

## Verdict

_Jim decides._

## Consequences / open questions

- The checks Jim runs from now on need a throwaway catalog with photos imported, or `-- --i-know`. `catalog:check` keeps its own y/n question about the catalog and does not call the guard.
- `phase1:check`, `phase7:check` (the Deck, `hud\probe`) and `phase9:local` do not call the guard.
