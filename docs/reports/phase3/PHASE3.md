---
report: Phase 3 — Session loop, metrics engine, guardrails, intents
phase: 3
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-26. Observed: Jim ran npm run phase3:check on 2026-09-27 and answered its questions; Claude Code collected the files and wrote the analysis, Numbers and Consequences. Verdict and decisions: Jim (Phase 3 accepted, conditional on AC-4; all doc proposals accepted; 2026-09-27)."
date: 2026-09-27 (run 1)
---

# Phase 3 — Session loop, metrics engine, guardrails, intents

## Purpose

Can the engine run an editing session on a real photo: pass 0 from an intent, passes that respect decay and the clipping guardrails, a provenance log and recipe that reproduce the result, and a revert that restores the photo? And can Claude run one from Claude Desktop?

PHASES.md, quoted (`PHASES.md:90-96`):
- "Full `lr_begin_session` / `lr_step` / `lr_end_session`, pass 0, decay, two-stage guardrails, convergence-by-metrics, selection-change guard, provenance log + recipe."
- "Metrics engine complete (percentiles, per-channel, HSV, regions, deltas), `lr_set_regions`, `lr_probe`."
- "Intent library loader, bundled starter set (11 intents), user-folder override, `lr_list_intents` / `lr_get_intent` / `lr_save_intent`."
- "Unit tests on golden JPEGs of the six fixtures."
- "Acceptance: AC-1, AC-2 (via `lr_end_session(revert)`), AC-4, AC-5 from the PRD, on all six fixtures, with logs in `logs/`."

PRD section 10, quoted:
- "AC-1 From Claude Desktop chat: "tune the active photo for golden hour landscape" produces ≤ 4 passes, each visible as a History step, with the HUD tracking stages, and ends with settings visible on the Develop sliders. Reproducible on all six fixtures."
- "AC-2 Abort from the HUD mid-session restores the pre-session snapshot within 1 s."
- "AC-4 No pass leaves highlight clip > 0.5 % or shadow crush > 1 % unless the intent overrides."
- "AC-5 Session log JSON validates against the schema and reproduces the final settings when replayed through `lr_sync_series` onto a virtual copy of the same photo (round-trip test)."

PHASES.md gives Phase 3 no go / conditional / no-go rule beyond its acceptance line.

**Jim's decisions on the plan (2026-09-26)** [stated: "go with recommendations", on the plan Claude Code offered]:
1. **AC-5 in Phase 3:**
   - the session log validates against its schema;
   - the recipe, replayed onto the same photo after the pre-session snapshot, reads back as the final settings.
   - The replay through `lr_sync_series` onto a virtual copy moves to Phase 4's acceptance.
2. **AC-1 in Phase 3:**
   - a scripted session on all six fixtures;
   - one Claude Desktop chat on one fixture.
   - AC-1's HUD part and its six-fixture chat part close in Phase 5.
3. **Golden JPEGs stay on disk** (gitignored); only their hashes and expected metrics are committed.
4. **Jim clicks each fixture** when the check asks, so the plugin needs no change.
5. **How the check asks Jim:** y/n questions in PowerShell, as in Phases 1 and 2 (rule 04 lets Jim choose this per check).

Assumptions accepted with the plan, in `engine\src\session\rules.ts` [inference]:
- `lr_step` numbers are changes, capped at the base maximum × decay. Sharpening and noise are capped at 30 per pass, the sharpening radius at 0.5.
- Camera profile, lens switches and curves are set as absolute values.
- Minimum step: 0.05 EV, 50 K, 0.1 for the radius, otherwise 1.
- Guardrail corrections: at most 3 per pass, then `guardrail_unmet`.

## Harness

| Part | Files |
|---|---|
| Metrics (PR #21) | `engine\src\metrics\compute.ts` (the PRD 6.7 set), `regions.ts`; `engine\src\preview\crop.ts`, `composite.ts`, `font.ts` |
| Intents (PR #22) | `engine\src\intents\` (schema, loader), `engine\intents\*.json` (the 11 starters), `engine\schemas\intent.schema.json` |
| Session loop (PR #23) | `engine\src\session\manager.ts` (the six session tools), `plan.ts` (decay, limits, the projected guardrail, corrections, convergence), `rules.ts` (the numbers); `engine\src\log\session-log.ts` (log and recipe schemas); `engine\src\mcp\tools.ts`, `server.ts` |
| The check (PR D) | `engine\src\devtools\phase3-check.ts` (the steps), `phase3-check-cli.ts`; run with `npm run phase3:check`. Golden JPEGs: `goldens.ts`, `goldens-cli.ts` (`npm run goldens`), `engine\tests\golden.test.ts` |

**What `npm run phase3:check` is written to do.** This describes the code [handle: `engine\src\devtools\phase3-check.ts` header and `runPhase3Check`]. It has run only against the simulated plugin (see "Pre-run findings"); against Lightroom it is [unverified] until Jim's run.

*Part 1*, scripted, through the same `Tools` class the MCP server uses. For each of the six fixtures, in turn:
1. Jim clicks the photo; the check reads its context and saves a golden JPEG of it as it is (1600 px).
2. **Session A**, `landscape_golden_hour`:
   - pass 0 (the intent's profile, lens corrections and priors, then the clipping baseline);
   - up to four scripted passes: exposure +0.3 and shadows +15; whites +40 and exposure +0.5 (pushes the highlights, to exercise the guardrails); vibrance +10 and clarity +5; exposure +0.02 (too small to move the metrics: convergence);
   - accept.
   - Checked: History names; AC-4 on every pass; the log and the recipe against their schemas.
   - Then AC-5: the pre-session snapshot, then the recipe written as one step (`AVG P3check replay`), read back and compared with the recipe.
   - Then the snapshot again, so the photo is as it was.
3. **Session B**, `neutral_technical_correction`: a probe of exposure and whites, one pass (shadows +10), revert. Checked: AC-2, the revert's time (≤ 1 s) and exactness.
4. On the first photo only:
   - a region crop (the middle fifth at 800 px), recording the export size, `effective_scale` and the context's width/height;
   - the selection guard: Jim clicks another photo, a pass is attempted and must be refused (`TARGET_CHANGED`), then he clicks the photo again.

Then two y/n questions.

*Part 2*, AC-1's chat:
1. Jim starts Claude Desktop and sends `Tune the active photo for golden hour landscape.` on `20260907-_OZ80093.NEF`.
2. The check reads the engine's tool log: a session on `landscape_golden_hour`, on that photo, 1-4 passes, accepted.
3. Three y/n questions; then Jim clicks the session's snapshot to put the photo back, and a sixth question.

The headline `Phase 3 acceptance: WORKED / FAILED` covers:
- all six photos;
- AC-1: the scripted sessions, and the chat's session, which must be on `20260907-_OZ80093.NEF`;
- AC-2, AC-4, AC-5;
- the other checks the harness runs: the probes, the region crop, the selection guard;
- the photos put back, and Jim's answers.

The check compares settings (the recipe replay, the photo put back after each session, the revert's differences) with `differingSettings`, within the same tolerance (1e-6) the engine's `apply_settings` writes are read back with (`verifyReadback`); the snapshot applies themselves are checked only through those comparisons [handle: `engine\src\params\map.ts` `READBACK_TOLERANCE`, `verifyReadback`, `differingSettings`; `engine\src\devtools\phase3-check.ts` `runFixture`; tests `engine\tests\params-map.test.ts` "passes a read-back equal to what was written" (0.83 vs 0.8300000000000001) and "ignores float noise within READBACK_TOLERANCE"]. The question "does it look like a golden-hour edit" is recorded but does not decide it. A separate line reports the pass budget (~3.5 s), a measurement.

Results go to `%TEMP%\LrC-AVG\P3\`:
- `p3_check_<time>.json`;
- `p3_sessions_<time>\` (the session logs and recipes);
- `golden_<time>\` (this run's golden JPEGs; each run has its own folder, so an earlier complete set is never deleted);
- `p3_desktop_mcp_log_<time>.txt`, `p3_chat_tool_log_<time>.jsonl`;
- `p3_check_tools_<time>\`, `p3_bridge_log_<time>.txt`.

Claude Code collects them. `npm run goldens` takes the newest run that captured all six photos and copies its golden JPEGs, hash checked, to `tests\golden\`, on disk only (decision 3), and writes `tests\golden\golden.json` (their hashes and the metrics the engine measures on them), which is committed; `engine\tests\golden.test.ts` then checks the engine against it.

### Steps for Jim

Do these after Claude Code says PR D is merged. Allow about 10 minutes for Part 1 [inference: the check's dry run made 73 exports for the six photos, about 12 per photo (Claude Code, 2026-09-26, `logs\scratch-p3-dryrun.mjs` export count); at the ~2.6 s per export Phase 2 measured (`docs\reports\phase2\PHASE2.md` "Numbers") that is 3-4 minutes of exports, plus the writes and your clicks; Lightroom's time is unmeasured until this run].

1. Right-click the Claude icon in the Windows system tray → **Quit**.
2. In Lightroom Classic, make sure all six test photos are in the catalog: choose **File > Import Photos and Video**. Under **Source** (left side), go to `D:\Developer\LrC_Autonomous_Gateway\fixtures`. At the top, click **Add** (not Copy or Move). Click **Import**. If Lightroom says there is nothing to import, all six are already in the catalog; that is fine. (How Lightroom shows photos already in the catalog is [unverified]; **Add** leaves the files where they are.)
3. In the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so the six photos show in the Filmstrip at the bottom. Press **D** to open the Develop module.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase3:check
   ```

   You should see `Connected (… ms, plugin 0.2.0)` (the line the check prints once the plugin answers; plugin 0.2.0 is the version installed for Phase 2, `plugin\LrC-AVG.lrplugin\Bridge.lua` PLUGIN_VERSION).
5. For each of the six photos, the command says `Photo n of 6: <name>` and asks you to click it. Click that photo in the Filmstrip, then press Enter in the terminal. The photo changes several times while its sessions run; the check is written to leave it as it started, and confirms that by reading its settings back (in the dry runs only so far; in Lightroom [unverified] until this run). On the **first** photo, the command also asks you to click any **other** photo and press Enter, then to click the first photo again and press Enter.
6. The command asks two questions. Type `y` or `n` and press Enter for each:
   1. In the **History** panel (left side) of the photo on screen, are there steps named like `AVG 1a2b3c pass 1/4`, `… pass 2/4`?
   2. Click through the six photos in the Filmstrip. Does each look as it did before the check?
7. The command prints the Part 2 steps. Do them:
   1. Click `20260907-_OZ80093.NEF` in the Filmstrip.
   2. Start Claude Desktop (Start menu > Claude).
   3. Open a new chat, type this sentence and press Enter:
      `Tune the active photo for golden hour landscape.`
   4. If Claude Desktop asks whether Claude may use an lrc-avg tool, choose **Always allow**.
   5. Wait until Claude says it has finished and has ended the session. Then go back to the terminal and press Enter.
8. The command asks three questions. Type `y` or `n` and press Enter for each:
   1. While Claude worked, did steps named like `AVG … pass 1/4` appear in the History panel?
   2. Are Claude's changes visible on the Develop sliders (for example Exposure or Highlights in the Basic panel)?
   3. Does the result look like a sensible golden-hour landscape edit to you?
9. The command says `Last step`: in the **Snapshots** panel (left side of Develop), click the snapshot it names (`AVG pre-session …`). That puts the photo back as it was before the chat. Then answer its sixth question with `y` or `n`.
10. The last lines say `Phase 3 acceptance: WORKED` or `FAILED`, `Pass budget: …`, and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If the command prints `another LrC-AVG engine is using the Lightroom bridge`, Claude Desktop is still running: do step 1 again, then step 4.
- If it prints `could not connect to Lightroom`, check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG as **Enabled**, then run step 4 again. If it still fails, choose **File > Plug-in Extras > LrC-AVG - Bridge status** and tell Claude Code what the dialog title says.
- If it says `The selected photo is …, not …`, click the photo it names and press Enter again.
- If a photo it names is not in the Filmstrip, do step 2 and step 3 again; if it is still missing, type `skip` and press Enter, and tell Claude Code which one.
- If it prints `FAILED: <photo>: …`, let the command carry on, and tell Claude Code what the line says. The command is written to put that photo back before it goes to the next: it ends an open session with revert, and after session A it applies the session's snapshot whatever failed. This ran in the dry runs only [handle: `engine\tests\phase3-check.test.ts` "puts the photo back when the recipe replay fails after session A was accepted"; in Lightroom [unverified]].
- If it prints `The photo was NOT put back` or `The photo is NOT as before the check`, click the snapshot it names in that photo's **Snapshots** panel, and tell Claude Code.
- If step 6's second answer is `n`, don't change the photos, and tell Claude Code which photo looks different. Each session's snapshot `AVG pre-session …` is in that photo's **Snapshots** panel.
- If in step 7 Claude says it has no Lightroom or lrc-avg tools, finish the steps (answer `n`) and tell Claude Code; it reads Claude Desktop's log itself.
- If Lightroom shows an error dialog, click OK and tell Claude Code.
- If a Windows Firewall window appears, click **Cancel** and tell Claude Code. The engine only uses connections inside this computer (127.0.0.1).

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-26, before Jim's run. None of them involves Lightroom.

- **Engine tests: 329 pass, 1 skipped** on the PR D branch [handle: `npm test`, "Tests 329 passed | 1 skipped (330)"]; the skipped one is the golden-JPEG test, waiting for `golden.json` from Jim's run. `npm run build` and `npm run typecheck` pass too. They run against the fake plugin and a **simulated Lightroom** (`engine\tests\helpers\lightroom-sim.ts`). Its "tonal" model is a gradient whose ends clip and whose colour follows white balance and saturation. It is made up for testing the engine's rules: **Node numbers, not Lightroom's.**
  - `metrics.test.ts`, `preview-composite.test.ts`: the metrics, regions, crops and composites (PR #21).
  - `intents.test.ts`: the loader, the 11 starters, saving, the generated schemas (PR #22).
  - `session-plan.test.ts`, `session.test.ts`, `mcp-tools.test.ts`, `mcp-server.test.ts`: the session loop (PR #23).
  - `phase3-check.test.ts`: **the whole check**, all six fixtures and the chat (a second engine standing in for Claude Desktop's). It printed `Phase 3 acceptance: WORKED`, left the simulated photo as it started, and found the selection guard refusing the pass.
- **Dry run of `npm run phase3:check` itself** (the built CLI, its prompts answered by a script), against a scratch plugin on ports 18765-18767 with its own token file, so Jim's Lightroom was not touched; the real `engine\dist\mcp\main.js` played Claude Desktop in Part 2 (list intents, begin, one step, accept). It printed `Phase 3 acceptance: WORKED`, 6 of 6 photos, and exited 0 [handle: Claude Code, 2026-09-26, `logs\scratch-p3-dryrun.mjs` (gitignored); scratch timings, not Lightroom's]. Its output was deleted afterwards so Jim's run starts clean.
- **Metrics timing:** 53-62 ms per 1600×1066 preview with one region, decode included [handle: PR #21 description; `measureImage` on `fixtures\20260907-_OZ80093.jpg` resized to 1600 px q75, 5 runs]. Phase 2's basic metrics took ~40 ms [handle: `docs\reports\phase2\PHASE2.md` "Numbers"].
- **Found by the check's dry run and fixed before Jim's run** (in PR D):
  - after a probe, its slope rightly refused session B's exposure pass, so session B now moves shadows;
  - a session left open by an error blocked every later fixture, so the check now ends it with revert.
- **Not yet run inside Lightroom** [unverified until Jim's run]:
  - the session loop against real renders: pass 0, the baseline, both guardrails, convergence;
  - `apply_snapshot` within 1 s (AC-2);
  - the recipe replay (AC-5);
  - exports up to 4096 px for region crops, and what the context's width/height are (sensor or cropped size);
  - the probe on real renders;
  - Claude running a session from the golden-hour prompt.

## Observed (Jim)

Jim ran the steps on 2026-09-27 and said "done" [stated]. The check saved its files to `%TEMP%\LrC-AVG\P3\`. Claude Code copied them to `docs\reports\phase3\P3\` with the user folder redacted to `%USERPROFILE%` (checked: 25 files, none holds the user name or the bridge token). The copies are:
- the results `p3_check_2026-09-27T14-00-37-507Z.json`;
- the 12 session logs and 6 recipes, in `p3_sessions_…\`;
- the check's tool log;
- the chat's tool log and Claude Desktop's MCP log excerpt;
- the bridge log;
- the chat's own session log and recipe (from the repo's `logs\`), in `p3_chat_session\`.

The golden JPEGs stayed on disk (decision 3): `npm run goldens` copied them to `tests\golden\` (gitignored) and wrote `tests\golden\golden.json` [handle: Claude Code, 2026-09-27, `npm run goldens` output "From p3_check_2026-09-27T14-00-37-507Z.json: … Wrote …\tests\golden\golden.json (6 entries)"; `git status` showed only `golden.json` as new; the six hashes match the run's `fixtures[*].golden.preview_hash`]. Times are local (UTC−7) unless marked Z. "The run" is `P3\p3_check_2026-09-27T14-00-37-507Z.json`.

### Run 1 (07:00 → 07:12): FAILED on AC-4 only

- **Connected** in 518 ms: plugin 0.2.0, protocol 1, LrC 15.5.1 [handle: the run `connect_ms`, `hello`].
- **Part 1** took 07:00:37 → 07:08:07. All six photos were done, none skipped, and no error line [handle: the run `started_at` 14:00:37Z; the last session log `P3\p3_sessions_…\20260927-b9d5c7.json` written 07:08:07; `summary.fixtures_done` 6, `fixtures_skipped` [], `errors` []].
  - The selection guard worked on the first photo. With another photo selected, the pass came back `TARGET_CHANGED` and nothing was written [handle: the run `fixtures[0].session_b.selection_guard`; bridge log 07:02:00.859 `get_settings failed: target_mismatch`].
  - Jim answered y to both questions: the History steps were seen, and the six photos look as before [stated, via the check's questions].
- **Part 2**, the chat, took 07:09:31 → 07:10:49 on `20260907-_OZ80093.NEF` [handle: `P3\p3_chat_tool_log_…jsonl`]. Claude:
  - called `lr_list_intents`;
  - began `landscape_golden_hour`;
  - set two regions (sky, rocks; not preserved);
  - made three passes with rationales drawn from the metrics (pass 1: "Rocks are dark (p50 25) and bluish (rb 0.83) for a golden-hour look; sky right p95 249 near clip. Warm WB, open shadows/blacks…");
  - called `lr_get_metrics` and `lr_get_preview`;
  - ended with accept.
  - No step was refused or corrected. Jim answered y to all four questions: History steps seen, settings on the sliders, looks golden-hour, photo put back after the chat.
- **The headline: `Phase 3 acceptance: FAILED`.** Every item was YES except AC-4 (`summary.ac4_clipping: false`).

**AC-4, what happened.** Every pass that ended over a limit was on `20260907-_OZ80099.NEF`, and every one was shadow crush [handle: the session logs in `P3\p3_sessions_…\`, `passes[*].metrics_after`, `guardrail_actions`]:

| Session | Pass | clip_low after the pass | History | What the guardrail did |
|---|---|---|---|---|
| A, `landscape_golden_hour` (`…c92f59`) | 0 | 2.2294 % | pass 0/4, baseline 1-3 | 9.98 % → 6.24 % → 2.57 % → 2.23 %, then `unmet` |
| B, `neutral_technical_correction` (`…b9d5c7`) | 0 | 5.5416 % | pass 0/4, baseline 1-3 | three baseline corrections, then `unmet` |
| B | 1 | 1.1604 % | pass 1/4, guard 1-3 | three corrections, then `unmet` |

- As the check found it, this photo had 16.24 % of its pixels at or below 2 in all channels, and a mean luma of 29.1 [handle: the run `fixtures[5].golden.metrics`].
- Each fixed correction lowered the crush. Three per pass were not enough. In session A, pass 1 (shadows +15, then one guard correction) brought it to 0.92 %, and it stayed under the limit afterwards.
- The check's own AC-4 counted session A only, so it reported one breach. Session B's two breaches are in its logs, and AC-4 says "no pass".
- The other five photos, and the chat's session, stayed within 0.5 % / 1.0 % on every pass.

## Numbers

| Field | Value | Source field in `p3_check_*.json` |
|---|---|---|
| Connected, time to connect, plugin version | yes, 518 ms, plugin 0.2.0, protocol 1, LrC 15.5.1 | `connect_ms`, `hello` |
| Photos done / skipped | 6 / none | `summary.fixtures_done`, `summary.fixtures_skipped` |
| Per photo: process version, profile, context width × height | all 15.4; Camera Standard (`OZ81430`, `Z8A0173`), Adobe Color (the DxO DNG), Camera Neutral (`OZ80005`, `OZ80093`, `OZ80099`); all 8256 × 5504 | `fixtures[*].photo` |
| Per photo: golden JPEG size, mean luma, clip high / low | `OZ81430` 342,694 B, 106.5, 3.42 / 0.17 %; DNG 136,243 B, 39.4, 0 / 2.20 %; `Z8A0173` 439,214 B, 118.5, 4.09 / 0 %; `OZ80005` 455,479 B, 123.4, 0.001 / 0 %; `OZ80093` 653,719 B, 91.5, 19.33 / 0.16 %; `OZ80099` 269,323 B, 29.1, 4.41 / 16.24 %. All 1600 × 1067 | `fixtures[*].golden` |
| Session A, pass 0: baseline actions | `OZ81430` clip high: 1 correction; DNG clip low: 1; `OZ80099` clip low: 3, then unmet; the others none | `fixtures[*].session_a.pass0` |
| Session A: passes; guardrail actions; convergence | 4 passes on every photo. Pass 2 (whites +40, exposure +0.5) was pulled back by the actual guardrail on 5 of 6 (the DNG did not clip). Pass 1 was corrected on `OZ81430` and `OZ80099`, pass 3 on `OZ80099`. No refusals. Converged by metrics on pass 4 on 5 of 6 (not `OZ80005`) | `fixtures[*].session_a.passes` |
| AC-4: every pass within 0.5 % / 1.0 % | **no**: 3 passes over, all on `OZ80099` (table above); the check's own figure covered session A only | `fixtures[*].ac4`; session logs |
| AC-5: log valid, recipe valid, replay | yes on all 6: both valid, the replay reads back with 0 settings differing | `fixtures[*].ac5` |
| Photos put back after session A | yes on all 6, 0 settings differing | `fixtures[*].put_back` |
| Probe: metric change per unit | exposure: luma +12.6 to +51.2 per EV, clip high 0 to +4.80 % per EV; whites: luma +0.03 to +0.17 per unit. Whole probe 3.5-6.7 s | `fixtures[*].session_b.probe` |
| AC-2: revert time and differing settings | **yes**: 377-492 ms (median 402), 0 differing, on all 6 | `fixtures[*].ac2` |
| Selection guard (first photo) | refused with `TARGET_CHANGED`, nothing written | `fixtures[0].session_b.selection_guard` |
| Region crop (first photo) | export 4000 px in 3,084 ms, metrics 291 ms; crop 800 × 535 at scale 1; effective scale 0.4845 (4000 / 8256); context size 8256 × 5504 | `fixtures[0].region` |
| Pass time | 24 scripted passes: median 3,155 ms; 14 within ~3.5 s. A plain pass took 2.1-3.7 s on the NEFs and ~1.5 s on the DNG; each guardrail correction added a render, so corrected passes took 6.2-9.4 s | `summary.pass_ms`; session logs `passes[*].duration_ms` |
| Jim, part 1 | History steps seen: y; photos as before: y | `jim_part1` |
| Chat | session begun on `landscape_golden_hour`, on `20260907-_OZ80093.NEF`; 3 passes (3.7, 3.7, 6.3 s); ended accept; clipping at most 0.091 % high / 0.145 % low on every pass | `chat`; `P3\p3_chat_session\20260927-d096a8.json` |
| Jim, part 2 | History steps y; sliders y; looks golden-hour y; photo put back y | `jim_part2` |
| Log paths | `P3\p3_desktop_mcp_log_…txt`, `P3\p3_chat_tool_log_…jsonl`, `P3\p3_chat_session\`, `P3\p3_sessions_…\`, `P3\p3_bridge_log_…txt` | `chat.*.saved_as` |
| Golden JPEGs | 6, hashes as recorded; `engine\tests\golden.test.ts` passes on them (10 tests) | `tests\golden\golden.json` |

## Verdict

**Phase 3 accepted, conditional on AC-4** (Jim, 2026-09-27, chosen from the options Claude Code offered, which recommended fixing first and running again) [stated: "Conditional accept now"]. The check's suggestion was **FAILED**, on AC-4 only (see "Observed").

The acceptance line (`PHASES.md:96`) against run 1:
- **AC-1 (Phase 3 scope, decision 2):** met. Scripted sessions ran on all six fixtures, each with ≤ 4 passes and named History steps (Jim: y). The Claude Desktop chat ran a golden-hour session on `20260907-_OZ80093.NEF`, with 3 passes, accepted, and settings on the sliders (Jim: y).
- **AC-2 (via `lr_end_session(revert)`):** met. Reverts were exact in 377-492 ms on all six.
- **AC-4:** **not met on one photo.** Three passes on `20260907-_OZ80099.NEF` ended with shadow crush of 1.16-5.54 %. Five photos and the chat stayed within the limits on every pass.
- **AC-5 (Phase 3 scope, decision 1):** met. Logs and recipes are valid, and the recipe replay was exact on all six.
- Logs: `docs\reports\phase3\P3\`.

**The condition:** the AC-4 fix is the first Phase 4 PR, and Phase 4's check verifies it:
- the pass-0 baseline keeps correcting until the photo is within the limits (PRD 6.5, "until under"), with a render cap;
- the check counts AC-4 on every session.

Jim's decision on the proposals below, the same day: **"Accept all"** [stated]. They go into the vault docs after this PR merges, each marked "Phase 3".

## Consequences / open questions

Proposed by Claude Code; **Jim decided both on 2026-09-27** [stated]: decision 1 as "Conditional accept now" (not the recommended fix-first), decision 2 as "Accept all". Each item follows from the handles above; the recommendations were [inference].

**Decisions for Jim:**
1. **AC-4.** The guardrail corrected in fixed steps, at most three per pass (an assumption accepted with the plan). That was too few for a photo starting with 16 % crushed shadows. PRD 6.5 says the pass-0 baseline runs "until under".
   - **Recommended:** fix first, then run the check again (~12 minutes).
     - The pass-0 baseline keeps stepping (blacks, shadows, exposure, repeating) until the photo is within the limits or no slider can move, at most 8 renders.
     - The per-step corrections keep their cap of 3.
     - The check counts AC-4 on every session (A, B and the chat), not only A.
   - Or: accept Phase 3 now as conditional, with the fix as the first Phase 4 PR, verified by Phase 4's check.
2. **The proposals below**, each marked "Phase 3" when applied to the vault:
   - **MCP_TOOLS:**
     - the Phase 3 error codes: `SESSION_NOT_ACTIVE`, `SESSION_ALREADY_ACTIVE`, `CONVERGED`, `CAP_REACHED`, `GUARDRAIL_REFUSED`, `NO_CHANGE`, `PROBE_NOT_ALLOWED`, `PROBE_NOT_PUT_BACK`, `SESSION_NOT_FOUND`, `INVALID_INTENT`, `INTENT_EXISTS`, `NOT_CONFIRMED`;
     - `lr_save_intent` gains `replace`;
     - `lr_step` gains `refused[].by` and `metrics_refreshed`;
     - `lr_get_preview` gains `region` / `effective_scale` / `export_retried`;
     - **a number in an intent's `priors` is an offset added to the photo's value** (the choice PR #22 flagged).
   - **ARCHITECTURE section 4:** the numbers the docs left open (`engine\src\session\rules.ts`): base maxima for sharpening and noise, minimum steps, slider precision, the fixed corrections and their cap, and region preservation read as 8 points.
   - **PHASES.md:** Phase 4's acceptance takes AC-5's replay through `lr_sync_series` onto a virtual copy (decision 1). Phase 5's takes AC-1's HUD part and the six-fixture chat (decision 2).
   - **ARCHITECTURE section 6 / PRD NFR-2:** keep ~3.5 s for a plain pass; add that each guardrail correction costs one more render (~3 s).
   - **LR_SDK_NOTES "Recorded in Phase 3"** (LrC 15.5.1):
     - `apply_snapshot` restored exactly in 377-492 ms;
     - a 4000 px export took 3.1 s;
     - `getRawMetadata("width"/"height")` gave 8256 × 5504, the Z8's full size, on all six fixtures (whether it follows a crop is untested: none of the six is cropped [unverified]);
     - the DxO DNG's passes took ~1.5 s against 2.1-3.7 s for the NEFs.

**Still open:** whether the context's width/height follow a Lightroom crop [unverified]; `effective_scale` depends on it.
