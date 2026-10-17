---
report: PHASE9 local install — does the local, unsigned LrC-AVG setup install, run, upgrade and uninstall cleanly on Jim's PC?
phase: 9 (PR 1, phase-9/installer; plan "Jim run 1")
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Sonnet 5.5, workflow agent for D2+D3), 2026-10-17 (phase-9/installer). Observed: Jim (blank until he runs it). Verdict: Jim (blank)."
date: 2026-10-17
---

# PHASE9 local install — does the local, unsigned LrC-AVG setup install, run, upgrade and uninstall cleanly on Jim's PC?

## Purpose

**The question.** Phase 9 replaces the install in `README.md` (Node.js, `npm.cmd install -g`, `lrc-avg-setup.cmd`, a plugin zip, a separate Deck) with one Windows setup `.exe` [handle: vault `PHASE9_PLAN.md` D1; issue #54]. PR 1 builds that setup unsigned. This run is the first time it meets a real Lightroom Classic and a real Claude Desktop. It answers the plan's open questions about the product on Jim's PC (signing, Smart App Control and the GitHub download are PR 2 and PR 3, so **no Azure account is needed for this report**):

1. Does a plugin copied into `%APPDATA%\Adobe\Lightroom\Modules\` appear in Plug-in Manager, and does it start enabled, on Lightroom Classic 15.6 [handle: plan "Still [unverified]" 1]?
2. Do the NSIS hooks do their work: the Modules copy, Claude Desktop's entry (pointing at the bundled Node), `setup-result.json`, the uninstall's removal of both [handle: `hud\src-tauri\windows\hooks.nsh`; plan D3, D4, D5]?
3. Does the first Claude Desktop chat start the bundled engine, and does `last-start.json` name Claude Desktop [handle: plan D4]?
4. Does 1.0.0 install over a running 0.99.0 (Lightroom, Claude Desktop, the Deck and the engine open) without a stale or missing file, and does Windows Restart Manager close only LrC-AVG's engine [handle: plan "Still [unverified]" 3; #54's 0.3.4 case]?
5. After an uninstall with the "Delete the application data" box unticked, is everything gone except the documented kept data (**GONE: YES**)? Can a `POSTUNINSTALL` hook read the box, so that ticking it removes the data folders too [handle: plan "Still [unverified]" 2; D5]?
6. Is the development setup put back exactly (**RESTORED: YES**), and does the dev plugin work again after Jim re-adds it?

**Go rule** (PHASES.md gives Phase 9 none for this check; proposed [inference]): **go** when the headline reads `WORKED` and `put back: YES`. **Conditional** when one check fails, its cause is known, and it is a fix for PR 2 (listed by name). **No-go** otherwise, or whenever `put back` reads NO.

**How the check asks Jim:** y/n questions and "press Enter" prompts in the PowerShell window, as in every check since Phase 1 [handle: `docs\reports\phase1\PHASE1.md:17`; `.claude\rules\04-workflow.md` "Steps for Jim"]. Where a file can answer (Status text, setup result, last start), the harness reads it and Jim is not asked. If Jim chooses Lightroom dialogs instead, his choice and the date are recorded here.

## Harness

| What | Files |
|---|---|
| The check (`npm run phase9:local`) | `engine\src\devtools\phase9-local-cli.ts` (entry, terminal, wiring), `phase9-local.ts` (runner, headline, results), `phase9-local-state.ts` (resume), `phase9-local-checks.ts` (what is read off the PC), `phase9-local-steps.ts` (steps 1-5), `phase9-local-upgrade.ts` (steps 6-9) |
| The clean room it drives | `cleanroom-run.ts` and the modules it uses (`--park`, `--status`, `--verify-gone`, `--restore`) |
| The setups | `tools\setup\build.ts` (`npm run setup:build`, `-- --version 0.99.0` for the test build), `tools\setup\install.ts` (`npm run setup:install`) |
| Disposable Windows (`npm run sandbox:check`, run by Claude Code) | `sandbox-cli.ts`, `sandbox-model.ts` (the .wsb, the verdict), `sandbox-guest.ps1` (PowerShell inside the Sandbox) |
| Tests | `engine\tests\phase9-local.test.ts`, `engine\tests\sandbox.test.ts` |

**Steps of `npm run phase9:local`** (resumable: state in `%TEMP%\LrC-AVG-phase9\local-state.json`; `-- --new` starts over):

| # | Step | Jim does | The harness checks itself |
|---|---|---|---|
| 1 | build | nothing (first build takes several minutes [unverified]) | builds `release\LrC-AVG-Setup-0.99.0.exe` and `-1.0.0.exe` when missing; keeps both (a build clears `release\` of older setups) |
| 2 | park | quits Lightroom and Claude Desktop; removes the dev plugin in Plug-in Manager when told | `cleanroom --park`, then `--status` until **CLEAN: YES** |
| 3 | install | double-clicks the 0.99.0 setup, clicks through the wizard | Deck version, key files, `resources\` against the staged tree, Modules copy, one uninstall key, `setup-result.json` outcome `added`, the Claude Desktop entry names the bundled node and engine |
| 4 | lightroom | starts Lightroom; y/n "listed", y/n "Installed and running"; opens File > Plug-in Extras > LrC-AVG - Status | `status.txt` from the dialog: headline, plugin version, "Modules (installed)" |
| 5 | chat | starts Claude Desktop and sends one line; y/n "Claude answered" | `last-start.json` (also in the Store build's redirected copy): client name has "claude", engine version, bundled `node.exe` and `main.js` |
| 6 | upgrade | double-clicks the 1.0.0 setup with Lightroom, Claude Desktop, the Deck and the engine running; answers the boxes; restarts Lightroom, opens Status | what is running before and after; the install checks of step 3 at 1.0.0 (outcome `added` or `unchanged`); `status.txt` after the restart |
| 7 | uninstall_keep | Settings > Apps > Installed apps > LrC-AVG > Uninstall, data box UNticked | `cleanroom --verify-gone` (**GONE: YES**); some of the kept data is still there |
| 8 | reinstall_clear | Settings > Apps > Installed apps > LrC-AVG > Uninstall, data box TICKED | `npm run setup:install` (silent install, **INSTALLED: YES**), install checks, then `--verify-gone --expect-data-gone` |
| 9 | restore | re-adds the dev plugin in Plug-in Manager; y/n "Installed and running" | `cleanroom --restore` until **RESTORED: YES**; `park.json` gone |

The 0.99.0 test build carries the same engine and plugin as 1.0.0: `--version` only changes the Tauri version overlay, so the setup and the Deck are numbered 0.99.0 and the engine is 1.0.0 [handle: `tools\setup\build.ts` `tauriBuild()`, `stageResources()` take no version]. Step 5 therefore expects engine 1.0.0.

**Results** go to `%TEMP%\LrC-AVG-phase9\`, and Claude Code collects them: `local-state.json`, `local_<time>.json` (the headline, every check and every answer, user folder redacted) and, from the clean room, `%TEMP%\LrC-AVG\cleanroom\*.json`.

**The Sandbox check** (`npm run sandbox:check`, Claude Code runs it, Jim does not): starts Windows Sandbox with no network, `release\` read-only and a writable results folder. A PowerShell script inside installs `LrC-AVG-Setup-<version>.exe /S`, checks the files, the HKCU uninstall key, `setup-result.json` (expected `not_found`: no Claude Desktop in a clean Windows), the Modules copy and the bundled `node.exe --version`. It then seeds a Claude Desktop config and runs `setup-cli --installer` (expected `added`), starts the bundled engine over stdio (initialize, tools/list), uninstalls, and lists the leftovers. It prints `SANDBOX: PASS` or `FAIL` with each check and saves `%TEMP%\LrC-AVG-phase9\sandbox_<time>.json`. No Lightroom is in the Sandbox, so the plugin and the Status dialog are tested only here, in `phase9:local`.

## Steps for Jim

1. **Enable Windows Sandbox, once.** This PC's `WindowsSandbox.exe` is missing [handle: Pre-run findings 6], so this step is required.
   1. Press the Windows key, type PowerShell, right-click **Windows PowerShell**, choose **Run as administrator**, click **Yes**.
   2. In that window run:

      ```powershell
      Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All
      ```

   3. When it asks to restart the computer, type `Y` and press Enter.
   4. After the restart, tell Claude Code "sandbox enabled". Claude Code runs `npm run sandbox:check` and tells you the result. [unverified] The command is Microsoft's documented route as remembered; it has not been run on this PC.
2. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run phase9:local
   ```

3. **Do what the window asks, in order.** Each step prints its numbered instructions and waits for Enter. In short:
   - **Step 1 builds** (nothing to do, several minutes the first time).
   - **Step 2 parks** your development setup: quit Lightroom (File > Exit) and Claude Desktop (right-click the Claude icon in the Windows system tray, bottom right > Quit). If the window lists "dev plugin in Lightroom's preferences", in Lightroom choose File > Plug-in Manager, select LrC-AVG, click **Remove**, quit Lightroom, press Enter.
   - **Step 3** double-click `D:\Developer\LrC_Autonomous_Gateway\release\LrC-AVG-Setup-0.99.0.exe` and click through the wizard. If a blue box "Windows protected your PC" appears, click **More info**, then **Run anyway**.
   - **Step 4** start Lightroom, open File > Plug-in Manager, answer two y/n questions, then File > Plug-in Extras > LrC-AVG - Status and click OK.
   - **Step 5** select one photo in Lightroom, start Claude Desktop, send the one line the window prints.
   - **Step 6** with Lightroom, Claude Desktop and the Deck open, double-click `LrC-AVG-Setup-1.0.0.exe`. A box "Please close: ..." with Retry, Ignore and Abort: click **Ignore**. A box "The LrC-AVG engine is running ...": click **OK**. Then restart Lightroom and open the Status dialog again.
   - **Step 7** quit Lightroom and Claude Desktop, then Settings > Apps > Installed apps > LrC-AVG > Uninstall with "Delete the application data" **unticked**.
   - **Step 8** the check reinstalls 1.0.0 by itself; uninstall again with the box **ticked**. Do not start Lightroom or Claude Desktop.
   - **Step 9** the check puts your development setup back; start Lightroom, File > Plug-in Manager > Add, pick `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin`, click Done.
4. When the window shows `Phase 9 local install: WORKED` or `FAILED` and `put back: YES`, tell Claude Code "done". About 30-45 minutes after the build [inference: nine steps with two wizards and two uninstalls; not measured].

### If something goes wrong

- **The window or Lightroom closed before the end:** run `npm run phase9:local` again. It continues at the step that stopped.
- **The window says `STOPPED` at a step:** read its FAILED lines, tell Claude Code, then run the same command again to repeat that step.
- **A line reads FAILED but the run goes on:** let it go on, and tell Claude Code at the end. Only a step marked `STOPPED` ends the run.
- **You want to give up and have your setup back:**
  1. If LrC-AVG is listed in Settings > Apps > Installed apps, uninstall it there.
  2. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

     ```powershell
     npm run cleanroom -- --restore
     ```

  3. In Lightroom choose File > Plug-in Manager > Add and pick `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin`.
- **The window says `setup:build` is not a script:** tell Claude Code (the root `package.json` lacks the PR's scripts).
- **Step 9 says RESTORED: NO:** do what its lines say (usually: uninstall LrC-AVG first), press Enter to retry; after three tries tell Claude Code.

## Pre-run findings (Claude Code)

Checks Claude Code ran itself before Jim's run, each with its handle. Add the rest before the run.

1. **Unit tests** of the state machine, the runner on fake steps, the checks on a fake Windows account, the .wsb text, the guest results parser and the verdict: `npx vitest run tests/sandbox.test.ts tests/phase9-local.test.ts` from `engine\` printed `Test Files 2 passed (2)`, `Tests 28 passed (28)`, 2026-10-17. These are pure logic and temp folders; none of them proves what Lightroom, Claude Desktop, NSIS or Windows Sandbox do.
2. **`sandbox-guest.ps1` parses** in Windows PowerShell 5.1 (the parser test in `sandbox.test.ts`, same run). Its helpers (`Check`, `Save`, `EngineTools`) were run in Windows PowerShell 5.1 against a stub MCP server (initialize, tools/list over stdio): `results.json` was written and `EngineTools` returned 3 tools [unverified: Claude Code's smoke run, 2026-10-17; the script and its output were not kept]. That run found a defect that is fixed: PowerShell 5.1 starts a redirected stdin with a byte order mark, so Node saw `BOM{...}` and `SyntaxError: Unexpected token` at the first message; the guest now sets `[Console]::InputEncoding` to UTF-8 without BOM and writes raw bytes.
3. **The real bundled engine over stdio in the Sandbox is not yet observed.** The smoke run used a stub, because a second engine on this PC could contend with the engine Claude Desktop is running. [unverified] until `npm run sandbox:check` runs.
4. **`npx tsc -p engine/tsconfig.json --noEmit`** printed nothing, and **`npx tsc -p engine/tsconfig.test.json --noEmit`** printed nothing, 2026-10-17. **`npx depcruise engine/src --config .dependency-cruiser.cjs --ignore-known`** printed `no dependency violations found (284 modules, 1503 dependencies cruised)`. **`npx vitest run tests/module-size.test.ts`**: 3 passed. The new phase9-local and sandbox files are 71-178 lines each.
5. **Dry run of `npm run sandbox:check`'s first branch** (the built script, compiled to a scratch folder and run): it printed the enable instructions and `SANDBOX: NOT RUN (Windows Sandbox is not enabled)`, exit code 2.
6. **`C:\Windows\System32\WindowsSandbox.exe` is missing on this PC** [handle: item 5's run; plan "Found" 9: `Test-Path`, 2026-10-17].
7. **Sandbox result:** *(blank until Claude Code runs `npm run sandbox:check`: paste `SANDBOX: PASS` or `FAIL` with the failing checks, and the saved file path)*.
8. **`npm run phase9:local` against a real PC has not been run by Claude Code**, by design: it quits and moves Jim's setup. Everything in "Harness" that touches Lightroom, Claude Desktop, NSIS wizards and the registry is [unverified] until Jim's run.
9. **Plug-in Manager wording** in the instructions ("green dot", "Installed and running", "Enable" button) is from memory of Lightroom's dialog [unverified], and so are the Windows wordings ("Windows protected your PC", "More info", "Run anyway", Settings > Apps > Installed apps, the three dots > Uninstall) [unverified]; Jim's answer to the y/n questions is what counts, and he may report different wording.
10. **The clean room does not park or check the Store build's redirected data copy** (`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Local\LrC-AVG\`): `MenuStatus.lua` reads `last-start.json` there, so the engine started by the Store build of Claude Desktop probably writes its data there too [handle: `plugin\LrC-AVG.lrplugin\MenuStatus.lua` `lastStart()` comment; LR_SDK_NOTES "MSIX"; the redirect itself is [inference]]. Step 5 reads both places; `--verify-gone` does not look in the second. Open point for the clean room's owner.

## Observed (Jim)

*(Filled by Jim only. Raw answers and pasted output. The harness saves every answer and check to `%TEMP%\LrC-AVG-phase9\local_<time>.json`; Claude Code collects it.)*

**Run 1, date and time:**

- Plugin version, Lightroom Classic version, Claude Desktop version, Windows build:
- Step 1 (build): minutes taken, size of `release\LrC-AVG-Setup-1.0.0.exe`:
- Step 2 (park): CLEAN: YES/NO, what was listed:
- Step 3 (install 0.99.0): boxes the wizard showed, errors:
- Step 4 (Lightroom): listed y/n, "Installed and running" y/n, Status headline:
- Step 5 (chat): Claude's answer in one line, `last-start.json` client:
- Step 6 (upgrade over running): boxes shown, what closed by itself, errors, Status headline after the restart:
- Step 7 (uninstall, box unticked): the uninstaller's pages, GONE: YES/NO and the LEFT lines:
- Step 8 (reinstall, box ticked): INSTALLED: YES/NO, GONE: YES/NO and the LEFT lines:
- Step 9 (restore): RESTORED: YES/NO, dev plugin "Installed and running" y/n:
- Anything else you saw:

## Numbers

Filled from the Observed section and the saved results file.

| Line | Result |
|---|---|
| Plugin in Modules listed in Plug-in Manager (Lightroom 15.6) | |
| It starts enabled ("Installed and running") | |
| Status headline at first start | |
| Wizard 0.99.0: finished, `setup-result.json` outcome, entry names the bundled node | |
| First chat: client has "claude", engine version, `node.exe` and `main.js` inside the install folder | |
| Upgrade over a running install: boxes shown, finished, no missing or stale file, one uninstall key | |
| Status after the Lightroom restart | |
| Uninstall, data box unticked: GONE YES/NO; kept data present | |
| Silent reinstall INSTALLED YES/NO; uninstall with the box ticked: GONE YES/NO with the data folders | |
| Restore: RESTORED YES/NO; dev plugin works again | |
| Headline of the run, `put back` | |
| Total time after the build | |

## Verdict

*(Jim decides. A script's suggestion is labelled as one: the run's headline is `WORKED` / `FAILED` / `NOT FINISHED` and is a suggestion, not the verdict.)*

- Verdict: go / conditional / no-go
- Decided by Jim on:
- Reason:

## Consequences / open questions

- A failed check here is fixed in PR 2 (`phase-9/release`) [handle: plan "Approved and consolidated", PR 2]; this report names each by its check.
- The run settles plan questions 1, 2 and 3 of "Still [unverified]" (Modules enabled, the data checkbox, Restart Manager). It does **not** settle "whether Claude Desktop rewrites its config while running": step 6 runs the hook while Claude Desktop is open, but the entry already exists then, so no write is forced. That question stays open for PR 2.
- Not covered by this report, and in later rows of the plan: the signed setup, SmartScreen and Smart App Control, the download from GitHub, and the Azure account (needed before the `v1.0.0-rc.1` tag, not before this run) [handle: plan "Approved and consolidated"].
- After Jim's verdict: copy the final report to the vault `Reports\` folder (rule 04 "Reports") and update `LrC_AVG_STATE.md` "Next action".
