---
name: lrc-avg-checks
description: LrC-AVG acceptance checks, probes, spike runs, Deck builds and the Phase 9 setup/clean-room/sandbox commands, with what each needs (Lightroom in Develop, Claude Desktop quit, plugin version) and its report path. Use before running, writing or explaining any `npm run phase<n>:check`, `*:probe`, `deck:*`, `masks:*`, `setup:*`, `cleanroom`, `sandbox:check`, `goldens` or `preset:*` command, and before writing or editing any report under `docs\reports\`.
---

# LrC-AVG checks and probes (PowerShell, repo root)

Moved out of `CLAUDE.md` so it loads only when needed. The everyday commands (install, build, test, typecheck, arch:check/graph, schemas, package, desktop:install) stay in `CLAUDE.md`.

```powershell
node spikes\S1\measure.ts   # spike scripts run directly (Node type stripping)
npm run phase1:check        # Phase 1 acceptance check against Lightroom (docs\reports\phase1\PHASE1.md)
npm run phase2:check        # Phase 2 acceptance check: Lightroom + the Claude Desktop chat (docs\reports\phase2\PHASE2.md)
npm run phase3:check        # Phase 3 acceptance check: six fixtures + one Claude Desktop chat (docs\reports\phase3\PHASE3.md)
npm run goldens             # after the check: golden JPEGs to tests\golden\ (gitignored) + golden.json (committed)
npm run phase4:check        # Phase 4 acceptance check: one photo, a Lightroom restart, one Claude Desktop chat, cleanup (docs\reports\phase4\PHASE4.md)
npm run preset:capture      # Lightroom's own reference preset + its photo's settings -> engine\tests\fixtures\presets\ (--precheck, --second)
npm run preset:pin          # regenerate engine\src\params\preset-format.lrc15.json from those references (a test fails when stale)
npm run phase5:check        # Phase 5 acceptance check: HUD sessions on one photo, an approve chat, six Claude Desktop chats; resumes after a stop (-- --new starts over) (docs\reports\phase5\PHASE5.md)
npm run s9:build -w spikes  # Phase 7 spike S9: build the Tauri HUD (rustup MSVC needed; spikes\S9\prereqs.ps1 checks)
node spikes\S9\measure.ts   # spike S9 run: Lightroom in Develop and Claude Desktop open (docs\reports\phase7\S9.md)
npm run deck:build          # the Deck: engine\dist, then hud\ui-dist + the Tauri build + NSIS installer (hud\src-tauri\target\release\bundle\nsis\)
npm run deck:probe          # row 4b probe: Lightroom in Develop, Claude Desktop quit; installs, checks, uninstalls the Deck (docs\reports\phase7\deck-shell.md)
npm run deck:states         # row 4c probe: the Deck's states, clicks and keys; keeps the Deck installed only when all YES (docs\reports\phase7\deck-ui.md)
npm run deck:menu           # row 5 probe: the menu items with the Deck, two real edits on the selected photo, put back; plugin 0.18.0 (docs\reports\phase7\plugin-menu.md)
npm run phase7:check        # Phase 7 acceptance on the Deck: five edits, two Claude Desktop chats, no-Deck fallback, Lightroom quit; resumes (-- --new, -- --redo E1,E2,E3) (docs\reports\phase7\PHASE7.md)
npm run offline:check       # missing-original check: plugin 0.19.1, the "fixtures" collection open, Claude Desktop quit (docs\reports\phase8\offline.md)
npm run phase8:check        # Phase 8 acceptance: every "fixtures" photo, 11 intents on the JPEG, raw->rendered sync, a preset click, one Claude Desktop chat; resumes (-- --new) (docs\reports\phase8\PHASE8.md)
npm run ai:probe            # issue #123 probe: three AI masks (Mountains, Vegetation with and without reads) on one photo in Develop, Claude Desktop quit; resumes after a Lightroom restart (-- --new) (docs\reports\phase8.5\ai-vegetation.md)
npm run ai:probe -- --new --kind landscape_water --repeat 10 --sky-first   # issue #181 repro: one AI kind n times (any kind that needs no point), each after an AI Sky mask with --sky-first, each waiting up to the engine's 5 minutes; summary line (runs, completed, stuck, median/max ms); a run that computes asks nothing (docs\reports\phase9\issue181.md)
npm run masks:carry         # issue #121 probe: the five hand-made masks (Add, Subtract, Intersect, Brush, Color) written back beside one new radial, on one photo in Develop, Claude Desktop quit; puts the photo back, first if an earlier run stopped (docs\reports\phase8.5\mask-carry.md)
npm run masks:combine       # issue #131 probe: ten two-part mask forms and part edits written one at a time on one virtual copy in Develop, y/n each, Claude Desktop quit; puts the photo back (docs\reports\phase8.5\mask-combine.md)
npm run masks:crop          # issue #179 probe: radials at three preview points and the issue's foreground gradient on two photos selected in Develop (one cropped landscape, one portrait), at their own crop and at CropAngle 10, measured with sharp, asks nothing, Claude Desktop quit; puts both back (docs\reports\phase9\issue179.md)
npm run effects:probe       # issue #125 probe: post-crop vignette and grain limits on a raw and a rendered "fixtures" photo, Lightroom in Develop, Claude Desktop quit; puts both back (docs\reports\phase8.5\effects.md)
npm run s14:check           # Phase 10 row 1 spike: tone curve (#187), grading wheels, HSL bands, B&W mixer and calibration keys on the "fixtures" NEF and JPEG plus two sharp-made charts (imported into "LrC-AVG S14 charts"), Lightroom in Develop, two y/n, plugin 0.17.0, Claude Desktop quit; puts all four back (spikes\S14\README.md, docs\reports\phase10\S14.md)
npm run curve:probe         # issue #187 / Phase 10 row 2 probe on 20220828-_DSC1159-HDR.dng selected in Develop (in the open collection): #187's lr_step through a real engine session (taken or refused, and if refused whether the photo is back at its pre-step settings), the same curve written straight through the bridge, then a 3-point lift and one y/n on the Point Curve view; Claude Desktop quit; puts the photo back (docs\reports\phase10\curve-probe.md)
npm run sdkver:check        # issue #209: the full getDevelopSettings() keys of every "fixtures" photo, read only, stamped with the LrSdkVersion the loaded plugin declares; run twice, before and after the plugin declares another version (Reload Plug-in between), the second run diffs the two and lists keys new against the pinned file; Lightroom open, plugin enabled, Claude Desktop quit (spikes\SDKVER\README.md, docs\reports\phase11\SDKVER.md)
npm run stall:check         # issue #174: Lightroom quit and restarted, 2 min plugin disabled, 2 min enabled, y/n each, then (issue #176) Reload Plug-in, both listeners back within 40 s (netstat), then Disable must stop the bridge; Claude Desktop quit (docs\reports\phase9\stall-174.md, docs\reports\phase9\upstream-ports.md)
npm run masks:kinds         # issue #190: one colour range, brush and depth range mask written one at a time on one virtual copy in Develop, y/n each (depth skipped on a photo without depth data), plugin 0.16.0, Claude Desktop quit; puts the photo back (docs\reports\phase9\upstream-ports.md)
npm run denoise:check       # issue #190: AI Denoise 30 / 30 / 50 on two raw virtual copies selected in Library, the selection and module put back, a preview by uuid, the snapshots undo Denoise, two y/n; LrC 15, plugin 1.1.0, Claude Desktop quit (docs\reports\phase9\upstream-ports.md)
npm run intents:check       # issue #180: after Claude Desktop (running this branch's engine) saved the test intent avg_check_180, run in PowerShell: is it in <Documents>\LrC-AVG\intents; lists the new and both old folders, painted_hills_crimson_gold, the migration marker; WORKED/FAILED; deletes the test file and its marker line; with -- --restore it puts Claude Desktop's lrc-avg entry back from the desktop:install backup, "put back: YES/NO" (docs\reports\phase9\issue180.md)
npm run clients:probe       # issue #155 R5: each installed AI client CLI headless against the built engine and the Lightroom simulator; no Lightroom, run by Claude Code (docs\reports\phase8.5\clients-probe.md)
npm run clients:check       # issue #155 R6: Deck build, then each installed client CLI (not Codex) edits the selected photo in Lightroom, T2-T7 y/n, one Claude Desktop chat; resumes (-- --new) (docs\reports\phase8.5\clients.md)
npm run setup:build         # Phase 9: the unsigned setup: clean engine build, pinned Node + engine (lockfile production packages) + plugin staged in build\setup\resources\, notices, Tauri build with tauri.setup.conf.json -> release\LrC-AVG-Setup-<v>.exe + release\SHA256SUMS.txt (-- --version 0.99.0 for a test build)
npm run setup:install       # clean room only (needs %TEMP%\LrC-AVG-cleanroom\park.json): installs release\LrC-AVG-Setup-<engine version>.exe /S, prints INSTALLED: YES/NO
npm run setup:lock-check    # self-check of the lockfile resolver used by setup:build
npm run cleanroom -- --park # clean room: parks Jim's dev setup (client lrc-avg entries, dev Deck, %LOCALAPPDATA%\LrC-AVG, %TEMP%\LrC-AVG) into %TEMP%\LrC-AVG-cleanroom\, CLEAN: YES/NO; also --status, --verify-gone [--expect-data-gone], --restore; --dry-run; Lightroom and Claude Desktop quit first
npm run sandbox:check       # Phase 9: the unsigned setup in Windows Sandbox (network on, for the WebView2 download): install, files, entry, bundled engine over stdio, uninstall; SANDBOX: PASS/FAIL; run by Claude Code (docs\reports\phase9\local-install.md)
npm run phase9:local        # Phase 9 local-install check: 0.99.0 + 1.0.0 setups, park, install, Lightroom y/n, a Claude Desktop chat, upgrade, uninstall twice, restore; stops loudly on a failed step; resumes (-- --new; -- --quick skips the upgrade and the second uninstall) (docs\reports\phase9\local-install.md)
npm run phase9:local -- --download   # Phase 9 run 2: the setup Jim downloads from the GitHub release instead of the local builds; checks the Mark of the Web and SHA256SUMS.txt, asks about SmartScreen; skips the upgrades; state download-state.json (docs\reports\phase9\PHASE9.md)
```

## Reports

Moved out of `.claude\rules\02-sourcing.md` and `04-workflow.md` so it loads only when needed. The sourcing markers in `02-sourcing.md` apply to every line of a report.

- The repo copy lives at `docs\reports\<phase>\<id>.md`, where Jim fills in "Observed". When a report is final, copy it to the vault `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\Reports\` (same file name, under a phase subfolder) and keep both identical. If they ever differ, the vault copy wins.
- Sections, in order:
  1. Front matter: `report`, `phase`, `status` (`template` | `observed` | `accepted`), `authored_by` (who wrote each part), `date`.
  2. **Purpose**: the question the spike or phase answers, and the PHASES.md go/conditional/no-go rule, quoted.
  3. **Harness**: the files involved and how to run them (link the README).
  4. **Pre-run findings (Claude Code)**: checks Claude Code ran itself, each with its handle.
  5. **Observed (Jim)**: filled by Jim only; raw numbers and pasted output, screenshot paths.
  6. **Numbers**: the report fields the directive asks for, filled from the Observed section.
  7. **Verdict**: go / conditional / no-go, decided by Jim; a script's suggested verdict is labelled as a suggestion.
  8. **Consequences / open questions**: which decisions (AVG-0xx) or docs change, and what stays `[unverified]`.
