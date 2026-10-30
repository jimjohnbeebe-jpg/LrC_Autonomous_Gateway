---
report: LOOKS-EVAL
phase: "10"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Observed, Numbers and Verdict: blank, for Jim's run."
date: 2026-10-29
---

# LOOKS-EVAL: blind evaluation of two editing arms (Phase 10 row 6)

## Purpose

Does editing with a look (arm B) give photos Jim prefers over editing without one (arm A), when he does not know which is which? Phase 10's third re-plan makes this evaluation the gate for every look feature: "R2: the evaluation harness comes first." and "R6: evaluation of 16 photos; the look needs 13 wins (p ≈ 0.02)." [stated: Jim, 2026-10-29, "Go with recommendations", vault `PHASE10_PLAN.md` "Third re-plan"]. The plan also says: "After each row, `looks:eval` reruns; a feature that does not win ships switched off or is removed."

The acceptance line it serves, as proposed for PHASES.md (vault `PHASE10_PLAN.md` "Acceptance"): "**L-9.** Jim's blind evaluation: the look-guided edit preferred on at least N of M photos (Jim sets N and M at row 10)." Until Jim sets N and M, R6 is the rule this report reads against: **go** for a look when the run says `conclusive: YES` and B won at least 13 of 16; **no-go** when it is conclusive the other way; otherwise **not conclusive** [inference from R6; the verdict is Jim's].

The first run (vault plan, row 6): row 5's whole-edit look (`lr_save_intent` `from_photo` of an edit Jim likes) as arm B against no intent as arm A.

**How the check asks Jim:** L / R / T (tie), and y / n for the look, in the PowerShell window running it (`.claude\rules\04-workflow.md` "Steps for Jim": Jim may choose this per check), chosen for this check by Claude Code on 2026-10-29 while Jim was away, **pending Jim's confirmation**. Reason [inference]: the pairs are large side-by-side images, which a Lightroom dialog cannot show; they open in Windows' default image viewer and the answer goes in the window beside it.

## Harness

| What | Files |
|---|---|
| Pure parts: run file schema, arm draw, prompt, sign test, tally, headline, arguments | `engine\src\devtools\looks-eval.ts` |
| Selection, copies, unattended edits, masters read back, cleanup | `engine\src\devtools\looks-eval-run.ts` |
| Renders, side-by-side pairs, L / R / T, reveal | `engine\src\devtools\looks-eval-judge.ts` |
| `--look-from`: a look saved without a chat | `engine\src\devtools\looks-eval-look.ts` |
| The command (`npm run looks:eval`) | `engine\src\devtools\looks-eval-cli.ts` |
| Tests (no Lightroom) | `engine\tests\looks-eval.test.ts` |
| Reused: the headless client launch | `engine\src\devtools\clients-run.ts` `runClient` (now with a per-run timeout), `clients-launch.ts`, `clients-config.ts`, `clients-judge.ts` |

How a run goes:

1. **Preflight.** No other LrC-AVG engine running (its HUD endpoint file, as `clients:check` checks), the harness takes the Lightroom bridge, plugin 1.7.0 or later (`lr_remove_photos`, `engine\src\mcp\tools-develop.ts` `DECISIONS_PLUGIN`), Claude Code installed (`clients-launch.ts` `findClient`), the settings page's Mode "Autonomous" (asked for, as `clients:check` does), and each arm's intent found in the bundled or default user intents folder.
2. **Photos.** The photos selected in Lightroom: 4 to 24, masters only (a virtual copy is refused). Each master's Develop settings are read and kept in the run file.
3. **Copies.** Two virtual copies per photo, named `AVG eval <run> <nn> P` and `... Q`, through `lr_create_virtual_copies`' own code. For each photo a coin from `node:crypto` `randomInt` decides which arm edits P; Q gets the other. The draw is only in `%TEMP%\LrC-AVG\looks-eval\<run>\run.json` and is never printed before the reveal.
4. **Edits.** One copy at a time: the harness selects the copy, gives up its bridge, and starts headless Claude Code (`claude -p`, stream-json, `--strict-mcp-config`, `--mcp-config` with this repo's `engine\dist\mcp\main.js`, `--allowedTools mcp__lrc-avg`) with the prompt from `looks-eval.ts` `editPrompt`: check the selected photo's uuid, one converge session (`mode "converge"`) with the arm's `intent_id` (or none), passes until the photo looks its best or the pass limit, then `lr_end_session` `accept`. An arm's tone mode is passed as text only ("if lr_begin_session has a tone_mode argument"), since that argument comes in the row 9+10 PR. Each edit is ended after 20 min (`-- --timeout-min`). From the engine's tool log (`clients-judge.ts` `judgeRun`) and Claude Code's last stream-json `result` line the run file records the session id, passes, how it ended, the client's exit and turns. The window shows only "OK / NOT accepted", the session id and passes, never the arm.
5. **Masters.** Every master is read again after the edits and after the judging; any setting that differs from the start is listed, and the headline says `masters untouched: YES/NO`.
6. **Judging.** For each pair whose two edits were accepted: both copies rendered by uuid at 1600 px through the engine's `PreviewService`, put side by side with sharp (`preview\composite.ts`, labelled L and R; which copy is left is drawn again per pair), saved as `pair-NN.jpg` and opened with `cmd /c start "" <file>`. Jim types L, R or T. Each answer is saved at once.
7. **Reveal.** Only once every pair was edited (or on `-- --judge`, below) are the arms named. The reveal's time is kept in the run file: after it no pair is judged and `-- --resume` refuses the run, since a pair judged then would not be blind (`looks-eval.ts` `mayReveal`). The run file is tallied: wins per arm, ties, and the exact two-sided binomial sign test with ties dropped (`looks-eval.ts` `signTest`). Headline lines: `Looks eval: WORKED/FAILED` (WORKED when every edit was accepted, every pair judged and the masters are untouched), `B won x of n (ties t), p = ...`, `conclusive: YES/NO` (YES when at least 16 non-tie pairs and p < 0.05), `masters untouched: YES/NO`, then one line per photo.
8. **Copies stay** for Jim to look at. `-- --cleanup last` removes the run's copies with `lr_remove_photos`' own code: only uuids the run file lists as copies, each first checked to carry its `AVG eval <run> <nn> P/Q` name, never a master's uuid.

`-- --resume last` continues after a stop: missing copies are made, edits not accepted are tried again, then the judging; while an edit is not accepted the arms stay hidden. `-- --judge last` judges the pairs left and reveals, leaving out the pairs whose edits were not accepted. `last` is the newest run folder; a run id works too.

`-- --look-from selected --look-id <id>` saves the one selected photo's whole global edit as a v3 user intent through `lr_save_intent`'s own code (`engine\src\mcp\tools-intents.ts`): `from_photo` with `dry_run` first (from_photo works only with a dry run), a summary and a y/n here, then the returned intent saved unchanged with `confirmed: true`. An id that already exists is refused, not replaced.

Results: `%TEMP%\LrC-AVG\looks-eval\<run>\`: `run.json` (the state, arms included: do not open it before the reveal), `claude-code_<nn><P|Q>_<time>_stdout.txt` and `_stderr.txt` per edit, `logs\` (the headless engines' tool and session logs), `pair-NN.jpg`, and `looks_eval_<time>.json` per command.

### Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Lightroom stays open.
2. In Lightroom's Library grid, click the ONE photo whose edit you want as the look.
3. In PowerShell, from the repo root, run:
   ```powershell
   npm run looks:eval -- --look-from selected --look-id jim_look_1
   ```
   Read the summary, type `y`, Enter. It says `Saved: ...`.
4. In the Library grid, select 16 master photos that have no edit yet and that are not the photo of step 2 (click the first, Ctrl+click the others).
5. Run:
   ```powershell
   npm run looks:eval -- --b-intent jim_look_1
   ```
   If it asks you to set the Mode, do what it says, then press Enter. It makes 32 copies, then edits them one at a time; this takes hours [inference: 32 sessions of up to 20 min each]. Leave Lightroom alone, and do not look at the copies, the Deck or the History panel until the first pair opens.
6. Each pair opens in your image viewer. Look at it, then type `L`, `R` or `T` (no preference) in the PowerShell window, Enter. Close the viewer or leave it; the next pair opens by itself.
7. After the last pair it prints the result lines and `Results saved automatically: ...`. Tell Claude Code "done".
8. When you have looked at the copies in Lightroom, run:
   ```powershell
   npm run looks:eval -- --cleanup last
   ```

### If something goes wrong

- If it says `another LrC-AVG engine is running`, quit Claude Desktop from the tray (step 1) and close every other AI client that uses LrC-AVG, then run the same command again.
- If it says `select 4 to 24 photos` or `is a virtual copy`, fix the selection as it says and run the same command again. Nothing was written.
- If it says `the intent ... not found`, run step 3 first.
- If the edits stop, or the PC restarts, run `npm run looks:eval -- --resume last`.
- If the judging stops, run `npm run looks:eval -- --judge last`.
- If an image does not open, the file is `pair-NN.jpg` in the folder it names; tell Claude Code.

## Pre-run findings (Claude Code)

- The sign test gives 13 of 16 p = 0.0213, 12 of 16 p = 0.0768 and 3 of 3 p = 0.25, and refuses impossible counts [handle: `engine\tests\looks-eval.test.ts` "signTest", `npx vitest run tests/looks-eval.test.ts` in `engine\`, 2026-10-29: 16 tests passed].
- The tally, the headline lines, the arm draw, the prompt text, Claude Code's stream-json `result` line and the arguments are unit-tested on fixtures in the same file [handle: same run].
- Build, all engine tests, typecheck and `arch:check` pass on the branch [handle: the PR's description, "Checks"].
- Nothing was run against Lightroom or a headless client: those results are Jim's.

## Observed (Jim)

*(Jim fills this in. Raw output and the results file path.)*

- Run id:
- Look id and source photo:
- Photos selected:
- Edits accepted / not accepted:
- Time for the edits:
- `Looks eval:` line:
- `B won ... of ... (ties ...), p = ...` line:
- `conclusive:` line:
- `masters untouched:` line:
- PowerShell L / R / T questions instead of a Lightroom dialog: confirmed? (y/n)
- Notes on the pairs (what made one better):

## Numbers

| Field | Value |
|---|---|
| Photos | |
| Pairs judged | |
| B wins | |
| A wins | |
| Ties | |
| Non-tie pairs (n) | |
| Sign-test p (two-sided, ties dropped) | |
| Conclusive (n >= 16 and p < 0.05) | |
| Masters untouched | |
| Edits not accepted | |
| Median minutes per edit | |

## Verdict

*(Jim decides: go / conditional / no-go. The script's headline is a suggestion only.)*

## Consequences / open questions

- If the look wins (conclusive, B at least 13 of 16), rows 7+8 and 9+10 build on it; if not, the plan says a feature that does not win ships switched off or is removed (vault `PHASE10_PLAN.md` "Third re-plan").
- The PowerShell questions instead of a Lightroom dialog are Claude Code's choice, pending Jim's confirmation (Purpose).
- `[unverified]`: that headless Claude Code (`claude -p`) runs a whole converge session of up to 8 passes within 20 min and looks at the previews it returns; `clients:check` ran one pass (`clients-run.ts` `EDIT_PROMPT`).
- `[unverified]`: that a killed edit's open session is reverted by the next engine's recovery before that copy is edited again on `--resume` (`clients-judge.ts` `recovered`, `clients:check` T7).
- `[inference]`: the headless engines read the settings page's intents folder; the harness checks the arms' intents in the default user folder, so a look saved by `--look-from` is found by both only when the page names no other folder.
- `[inference]`: blindness holds only if Jim does not watch the copies, the Deck or the History panel during the edits; the window and the copy names never name an arm.
- `tone_mode` reaches the session only after the row 9+10 PR adds the begin argument; until then an arm's tone mode is text in the prompt.
