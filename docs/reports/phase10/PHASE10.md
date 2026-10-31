---
report: PHASE10
phase: "10"
status: observed
authored_by: "Claude Code (Opus 5.5): purpose, acceptance, harness, pre-run findings, 2026-10-30. Observed: Jim's run of npm run phase10:check, 2026-10-31, collected by Claude Code from its results file. Verdict: Jim's."
date: 2026-10-30
---

# Phase 10: Looks (issue #194), acceptance

## Purpose

Is Phase 10 done? Its goal, as re-scoped by the third re-plan (vault `PHASE10_PLAN.md`, "Third re-plan (2026-10-29, after Phase 11 / #207)", R1, approved by Jim on 2026-10-29 [stated: "Go with recommendations"]): "apply a style (a classic method, another photographer's approach, or Jim's own) **adapted to each photo** … every claim that it helps checked by a blind, statistically meaningful evaluation."

Rule 04 ("Phase gating"): a phase is done only when every acceptance line in PHASES.md is checked with a reproducible handle and Jim has confirmed the Lightroom-side lines.

The acceptance lines in PHASES.md were written for the plan of 2026-10-25. The re-plans withdrew parts of them (R1: limits that refuse, D2, and the method file kind, D4; R4: references from a folder or a file path come later). This report proposes them as the third re-plan left them; the vault PHASES.md gets the same lines when this report is accepted.

Jim answers in the PowerShell window running the check (two y/n), as for `crop:check` and `looks:eval`: Claude Code's choice, under Jim's "go with your recommendations" of 2026-10-30 [stated: Jim, 2026-10-30, "Address the open rows, go with your recommendations other than the rerun"].

## Acceptance (third re-plan)

| Line | What | Status before the check | Handle |
|---|---|---|---|
| L-1 | S14 report with Jim's observations; every key a look can write is pinned from a live dump | done | `docs\reports\phase10\S14.md` (status accepted, verdict Go) |
| L-2 | #187 closed: a curve write is taken, and a refused step leaves nothing on the photo | done | `docs\reports\phase10\curve-probe.md` (accepted); issue #187 closed [handle: `gh issue view 187` → CLOSED, 2026-10-30] |
| L-3 | The perceptual measurements are unit-tested on generated images with known values; the time per 1600 px preview is recorded | done | `engine\tests\metrics-perceptual.test.ts`; median 27.7 ms per 1600 px preview [handle: PR #276 description, "Time per 1600 px preview"] |
| L-4 | v3 looks load and validate (set, references, tone_mode, masks, checks); v2 intents still load; a dry run writes nothing | done | `engine\tests\intents.test.ts`, `look-authoring.test.ts`, `look-checks.test.ts`, `session-references.test.ts` "takes references in a schema v3 intent only" |
| L-5 | A look session in Lightroom: `set` written at pass 0; tone modes `adapt` and `auto`; `reference_gap` each pass; `look_checks` reported | done (observed 2026-10-31) | adapt: the 16 arm-B sessions of eval run `20261030-055012` ran with tone_mode adapt and ended accepted [handle: `%TEMP%\LrC-AVG\looks-eval\20261030-055012\logs\*.json` (not committed: Jim's photos), counted 2026-10-30: 16 of 16 `tone_mode` "adapt", `outcome` "accept"]; auto, the History step and look_checks: steps 4-5 below |
| L-6 | References by catalog uuid (a file path and the references folder later, R4) | uuid: observed; collection: simulator only | 16 of 16 arm-B sessions measured their one reference [same logs, `references.measured` length 1]; collection: `engine\tests\session-references.test.ts` "takes the intent's references, here a collection" (simulated Lightroom) [unverified in Lightroom] |
| L-7 | Recipe → look round trip: the look's `set` reproduces on another photo | done (observed 2026-10-31) | Numbers below: 71 of 71 set values |
| L-8 | Looks show as prompts in Claude Desktop, or this is recorded as unsupported, with a handle | done: recorded as unsupported in Claude Desktop | Jim's answer 2 "n" and his note; the engine serves the prompts (Observed) |
| L-9 | Jim's blind evaluation: the look-guided edit preferred on at least 13 of 16 (R6) | done, same shoot only | `docs\reports\phase10\LOOKS-EVAL.md` (accepted: B won 16 of 16, p = 3.1e-5); a run on photos of other shoots was skipped for now [stated: Jim, 2026-10-30, "I want to skip the second evaluation run for now"] |
| L-10 | Default 8 and hard limit 16 passes in the engine, the plugin settings page and the Deck | done | PR #199 (Phase 10 row 3) |
| L-11 | Spike S15 report with Jim's observations | done | `docs\reports\phase10\S15.md` (accepted: no automatic reference picker for now) |

Dropped from the 2026-10-25 lines: "a limit refusal and its lift" (D2 withdrawn, R1); "method checks" as a method file kind (D4 withdrawn; the look's `checks` replace them, row 12, R5); references "from the folder, a path … a raw file refused" (later, R4).

Not built, and tracked outside this phase: best-of-3 candidates per pass (row 12's other half): it needs an eval run to show that it helps, and the next run was skipped for now; tracked in issue #279.

## Harness

`npm run phase10:check`: `engine\src\devtools\phase10-check-cli.ts` (Lightroom side) and `engine\src\devtools\phase10-check.ts` (the pure parts: whether a look's `set` reproduced, the lines and the headline), tested by `engine\tests\phase10-check.test.ts`. Prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does, through the engine's own tool functions as a chat calls them:
1. Takes the engine's instance lock (Claude Desktop must be quit) and reads the selection: ONE photo Jim edited the way he likes, selected in the Library grid. That photo is only read.
2. `lr_save_intent` with `from_photo` and `dry_run` on it, then saves the returned look as the user intent `avg_phase10_check` (deleted at the end). Checks that the look holds settings, `tone_mode` "adapt" and the photo as its reference. Then `from_preset` dry runs on Lightroom's presets, the first 20 at most, until one gives a look with settings.
3. One virtual copy, "AVG phase10-check", reset to as shot (`lr_reset`), selected. A session with the look: pass 0's `set` read back from the copy and compared with the look (within 1 % of each slider's range: Lightroom rounds [inference]) (L-7); the reference measured; the copy still selected after the reference render; one `lr_step`, which must report a `reference_gap`; revert, nothing differing.
4. The same look with `tone_mode` "auto": `auto_tone` applied or unchanged; **question 1** on the History panel; revert.
5. `classic_zone_system`: `look_checks` at begin, each with a measured value; revert.
6. The copy removed (only it, by the uuid `lr_create_virtual_copies` answered), the test look deleted, the photo selected again and compared with the start.
7. After the engine lets go of Lightroom: **question 2**, the look prompts in Claude Desktop (L-8).

It prints one YES/NO line per step and answer, `Phase 10 check: WORKED/FAILED`, `put back: YES/NO`, and saves `%TEMP%\LrC-AVG\phase10-check\phase10_check_<time>.json`.

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit.
2. In Lightroom Classic, File > Plug-in Manager > LrC-AVG > Reload Plug-in.
3. In the Library grid, select ONE photo you edited the way you like (a raw photo; one with a Sky or Subject mask is best).
4. In PowerShell:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   git fetch
   git switch phase-10/check
   git pull
   npm install
   npm run phase10:check
   ```
5. Lightroom switches between Library and Develop by itself. Do not click in Lightroom until a question shows in PowerShell.
6. Question 1: look at the History panel on the left of Develop, answer y or n, press Enter.
7. Question 2: start Claude Desktop, open a new chat, click **+** in the chat box and look for the lrc-avg prompts. Answer y or n in PowerShell, press Enter.
8. You should see `Phase 10 check: WORKED` and `put back: YES`. Tell Claude Code "done".

### If something goes wrong

- If it stops with "select ONE photo", then select exactly one photo in the Library grid and run step 4's last line again.
- If it prints `put back: NO` and names the copy "AVG phase10-check", then select that copy in the Library grid, Photo > Remove Photos…, Remove.
- If it names the test look `avg_phase10_check` as left, then tell Claude Code; it deletes the file.
- If question 2's menu shows no prompts at all, then answer n: the report records L-8 as unsupported in Claude Desktop.

## Pre-run findings (Claude Code)

- **The check against the simulated Lightroom, 2026-10-30.** A throwaway vitest file (not committed) started `engine\tests\probe\harness.ts` with `tests\helpers\develop-sim.ts` and spawned `node engine\dist\devtools\phase10-check-cli.js` against it, answering y to both questions. Every step of 1-5 printed YES. L-7 showed "pass 0 wrote the look's 71 set values on the copy as the look holds them". The NO lines came from the simulator, not the check: it has no `list_presets`, and the temporary file's own `remove_photos` stand-in was wrong [handle: the run's output, `%TEMP%\smoke10.txt` on Claude Code's machine (temp, not kept)]. Lightroom itself: [unverified] until Jim's run.
- `npm run build`, `npm run typecheck`, `npm run arch:check` and the full vitest suite pass on `phase-10/check` (2310 passed, 3 skipped).

## Observed (Jim)

Jim ran `npm run phase10:check` on `phase-10/check` at `8e674f8` on 2026-10-31: Lightroom Classic 15.6, plugin 1.10.0, engine 1.10.0, on 20221008-_DSC2544_DxO.dng [handle: `%TEMP%LrC-AVGphase10-checkphase10_check_2026-10-31T13-37-07-687Z.json` on Jim's machine (not committed: names his photo)].

- Headline `FAILED`, only because of answer 2; `put back: YES` (`copy_left` null, the test look deleted, the photo's settings back).
- Every Lightroom step printed YES (26 of 26), and answer 1 (History panel: an Auto step directly below the AVG pass 0 step) was y.
- Answer 2 was n. Jim: "the \"+\" in Claude Desktop does not list any prompts" [stated: Jim, 2026-10-31]. The question's menu path (the **+** in the chat box) was Claude Code's assumption, not a sourced fact [inference: no handle for it in the repo or the vault].
- The engine does serve them: started the way Claude Desktop starts it (`enginedistmcpmain.js`, the path in the lrc-avg entry of `%LOCALAPPDATA%Claude-Dataclaude_pzs8sxrjxfjjcclaude_desktop_config.json`), `initialize` answered capabilities `{"tools":{},"prompts":{}}` and `prompts/list` answered 28 prompts, `look-classic_zone_system` among them [handle: a stdio probe script in Claude Code's scratchpad (not kept), run by Claude Code on 2026-10-31]. So L-8 is recorded as: the engine offers one prompt per look; Claude Desktop shows no MCP prompts in its **+** menu, and where else it might show them is [unverified]. Claude Desktop's own MCP logs on this machine end on 2026-08-24, so they cannot show whether it asked for `prompts/list` [handle: `%LOCALAPPDATA%Claude-Dataclaude_pzs8sxrjxfjjclogsmcp.log` last modified 2026-08-24].

## Numbers

| What | Result |
|---|---|
| Lightroom steps | 26 YES, 0 NO |
| L-7: set values reproduced on the reset copy | 71 of 71 (`not_reproduced` empty) |
| from_preset (dry run) | the first preset tried, "AI Dreamy Spring Sunrise", gave a look with 53 settings |
| Auto Tone at pass 0 (tone_mode auto) | applied or unchanged: YES; History step: y |
| classic_zone_system look_checks at begin | 2, each with a measured value |
| Reverts (adapt, auto, classic) | nothing differing, 3 of 3 |
| Answer 1 (History) | y |
| Answer 2 (look prompts under + in Claude Desktop) | n |
| put back | YES |

## Verdict

*(Jim decides: Phase 10 done / not done; release or not.)*

## Consequences / open questions

- **Best-of-3 candidates per pass** (row 12's other half): not built. It needs an eval run of "B with candidates" against "B" to show it helps, and that run was skipped for now. Tracked in issue #279.
- **The cross-shoot eval** (photos of other shoots than the look's source): skipped for now [stated: Jim, 2026-10-30]. Until it runs, L-9 holds for the same shoot only.
- **Look prompts in Claude Desktop:** the engine lists them, Claude Desktop shows none in its **+** menu (Observed). Picking a look stays a chat request ("edit this with my look …") or lr_list_intents; nothing in the engine changes.
- **References by collection** in Lightroom: [unverified]; tested against the simulator only.
- **Release:** decided by Jim after this check (row 13). Jim uses the product freely on real photos before any release (standing practice since Phase 7).
