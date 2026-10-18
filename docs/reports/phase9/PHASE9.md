---
report: PHASE9 — does the LrC-AVG setup downloaded from GitHub install, run and uninstall cleanly, SmartScreen included?
phase: 9 (PR 3, phase-9/check; plan row 5, "Jim run 2")
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-18 (phase-9/check). Observed: Jim (blank). Verdict: Jim (blank)."
date: 2026-10-18
---

# PHASE9 — does the LrC-AVG setup downloaded from GitHub install, run and uninstall cleanly, SmartScreen included?

## Purpose

**The question.** Run 1 installed a setup built on Jim's PC (`docs\reports\phase9\local-install.md`, verdict go). A photographer gets a different file: the one GitHub's release workflow builds from the tag, downloaded in a browser, so Windows marks it as coming from the internet and SmartScreen checks it [inference: PHASE9_PLAN "How to apply": a local build carries no Mark of the Web]. 1.0.0 ships unsigned (PHASE9_PLAN, D6 changed 2026-10-17). This run answers:

1. Does the `v1.0.0-rc.1` pre-release carry the setup and `SHA256SUMS.txt`, and does the downloaded setup match its listed SHA-256?
2. Does the downloaded file carry the Mark of the Web (`Zone.Identifier`, `ZoneId=3`)?
3. Does SmartScreen show "Windows protected your PC", and does "More info > Run anyway" start the wizard, as the README's "Why the setup is not signed" says?
4. With that file, do install, Lightroom's Plug-in Manager and Status dialog, the first Claude Desktop chat, the uninstall (**GONE: YES**) and the restore (**RESTORED: YES**) pass as in run 1?
5. Does the same setup pass in a disposable Windows (`npm run sandbox:check`, run by Claude Code)?

**Scope decided by Jim** [stated: Jim, 2026-10-18, "go" to the PR 3 plan's decisions A/A/A]:
- No upgrade from an earlier pre-release (none exists). Run 1's upgrade over a running install is the upgrade evidence; the NSIS script is unchanged since (PR #175 changed the plugin only) [handle: `git diff 78b4917 5070467 --stat -- hud/src-tauri tools/setup` prints nothing].
- Smart App Control is not tested: PHASE9_PLAN tied it to a signed setup, and an unsigned one is expected to be blocked while it is on [inference].
- Jim publishes the draft pre-release.

**Go rule** (PHASES.md gives none for this check; proposed [inference]): **go** when the headline reads `WORKED`, `put back: YES`, and the Sandbox run reads `SANDBOX: PASS`; then `v1.0.0` is tagged from the same commit. **Conditional** when one check fails, its cause is known, and the fix does not touch the setup. **No-go** otherwise, or whenever `put back` reads NO.

**How the check asks Jim:** y/n questions and "press Enter" prompts in the PowerShell window, as in run 1 [handle: `docs\reports\phase9\local-install.md` "Purpose"].

## Harness

| What | Files |
|---|---|
| The check (`npm run phase9:local -- --download`) | `engine\src\devtools\phase9-download.ts` (the download and install steps, the Mark of the Web and SHA-256 checks), wired in `phase9-local-cli.ts`; the other steps are run 1's (`phase9-local-steps.ts`, `phase9-local-upgrade.ts`) |
| The release | `.github\workflows\release.yml` (a `v*` tag builds the setup and drafts the release) |
| Disposable Windows (Claude Code) | `npm run sandbox:check` on `release\LrC-AVG-Setup-1.0.0.exe`, fetched with `gh release download v1.0.0-rc.1 -D release` |
| Tests | `engine\tests\phase9-local.test.ts` ("phase9:local --download") |

**Steps of `npm run phase9:local -- --download`** (state in `%TEMP%\LrC-AVG-phase9\download-state.json`, separate from run 1's; `--new` starts over):

| # | Step | Jim does | The harness checks itself |
|---|---|---|---|
| 1 | download | downloads the two files from the release page in the browser | the setup is in Downloads; `ZoneId=3`; SHA-256 equals `SHA256SUMS.txt` |
| 2 | park | as run 1 | CLEAN: YES |
| 3 | install | double-clicks the downloaded setup, More info > Run anyway, wizard | SmartScreen y/n; installed files, Deck version 1.0.0, `setup-result.json` |
| 4 | lightroom | as run 1 | Status dialog text |
| 5 | chat | as run 1 | `last-start.json`: Claude Desktop, engine 1.0.0, bundled node |
| 6 | upgrade | skipped (`--download`) | — |
| 7 | uninstall_keep | as run 1 | GONE: YES |
| 8 | reinstall_clear | skipped (`--download`) | — |
| 9 | restore | as run 1 | RESTORED: YES |

## Steps for Jim

1. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   git switch phase-9/check
   npm run phase9:local -- --download
   ```

2. **Do what the window asks, in order.** In short:
   - **Step 1:** open https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/releases, click "LrC-AVG v1.0.0-rc.1", and under Assets click `LrC-AVG-Setup-1.0.0.exe`, then `SHA256SUMS.txt`. If the browser warns about the file, choose Keep (Edge: the three dots next to the file > Keep > Show more > Keep anyway). Do not open the setup yet.
   - **Step 2:** quit Lightroom (File > Exit) and Claude Desktop (tray icon > Quit); remove the dev plugin when the window asks.
   - **Step 3:** double-click `LrC-AVG-Setup-1.0.0.exe` in your Downloads folder. On the blue box "Windows protected your PC", click **More info**, then **Run anyway**. Click through the wizard with the defaults.
   - **Steps 4, 5, 7, 9:** as in run 1: Plug-in Manager and Status; one chat line in Claude Desktop; uninstall with "Delete the application data" unticked; restore, then re-add the dev plugin.
3. When the window shows `WORKED` or `FAILED` and `put back: YES`, tell Claude Code "done".

### If something goes wrong

- **Step 1 says the setup is not in Downloads:** if your browser saves somewhere else, move both files into `%USERPROFILE%\Downloads`, then press Enter on a rerun (`npm run phase9:local -- --download`).
- **The file name has " (1)" in it:** delete both files from Downloads, then download them again.
- **No blue box appeared:** answer `n`; the run goes on. Tell Claude Code at the end.
- **The window says `STOPPED`, or you want to give up:** as in run 1 (`docs\reports\phase9\local-install.md` "If something goes wrong"), with `-- --download` added to the command.

## Pre-run findings (Claude Code)

1. **Node reads the Mark of the Web on this PC.** `zoneId()` read `ZoneId=3` back from a `Zone.Identifier` stream written to a file in `%TEMP%` [handle: `npx vitest run --root engine tests/phase9-local.test.ts`, 2026-10-18: 21 passed, including "zoneId reads the Mark of the Web from the Zone.Identifier stream"]. That a browser download writes `ZoneId=3` is [unverified] until step 1.
2. **The release workflow's draft** (assets, pre-release flag): *(filled after the tag)*.
3. **Sandbox run on the downloaded setup:** *(filled after the tag)*.

## Observed (Jim)

*(Filled from the saved results file and Jim's answers.)*

## Numbers

| Line | Result |
|---|---|
| Pre-release `v1.0.0-rc.1`: setup and `SHA256SUMS.txt` attached | |
| Downloaded setup: SHA-256 matches | |
| Mark of the Web (`ZoneId`) | |
| SmartScreen box shown; Run anyway started the wizard | |
| Wizard finished; installed files; Deck 1.0.0 | |
| Plug-in Manager lists the plugin, enabled; Status text right | |
| First chat: Claude Desktop client, engine 1.0.0, bundled node | |
| Uninstall, data box unticked: GONE YES/NO | |
| Restore: RESTORED YES/NO; dev plugin works again | |
| Headline, `put back` | |
| Sandbox: SANDBOX PASS/FAIL | |

## Verdict

*(Jim decides. The run's headline is a suggestion, not the verdict.)*

- Verdict:
- Decided by Jim on:
- Reason:

## Consequences / open questions

- On go: tag `v1.0.0` on the commit `v1.0.0-rc.1` points at, Jim publishes it as the full release, and the vault close-out in PHASE9_PLAN "Vault updates at the Phase 9 close" follows (plan row 6).
- Run 1's report said the upgrade and the ticked uninstall would run again "on the signed build in PR 3". Both are out of scope now: 1.0.0 is unsigned (D6 changed) and Jim chose run 1 as the upgrade evidence (Purpose).
- Still [unverified] after this run: Smart App Control with the unsigned setup; signing (issue #171).
- After Jim's verdict: copy the final report to the vault `Reports\Phase9\` folder and update `LrC_AVG_STATE.md` "Next action".
