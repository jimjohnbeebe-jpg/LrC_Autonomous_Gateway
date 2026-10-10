---
report: PHASE8 — does LrC-AVG edit every image format Lightroom Classic develops?
phase: 8 (row 6, phase-8/check)
status: observed
authored_by: "Template, harness, pre-run findings: Claude Code (Opus 5.5), 2026-10-10 (phase-8/check). Observed: Jim ran npm run phase8:check on 2026-10-10 09:11-09:37 local; Claude Code wrote it up from the result files (docs/phase8-check-results). Verdict: Jim (to come)."
date: 2026-10-10
---

# PHASE8 — does LrC-AVG edit every image format Lightroom Classic develops?

## Purpose

**The question.** Phase 8 made the engine model Lightroom's two develop pipelines (raw and rendered) so that every format Lightroom develops can be edited natively (PHASE8_PLAN, issue #95). This check runs the whole product on every photo of the "fixtures" collection, which spike S10 filled with one photo of each format Jim has or made [handle: `docs\reports\phase8\S10.md` "Observed", run 2 census: 31 photos, 13 raw, 18 rendered].

**PHASES.md Phase 8, quoted:** "Acceptance (from the plan): every format in Adobe's list that Jim can put in the "fixtures" collection completes a full session in `npm run phase8:check`, with a handle per format; no decision from `file_format`; all bundled intents run on both pipelines; process version "11.0" photos edit as they are; raw→rendered sync reports the non-transferable groups; the README's format table carries no [unverified] claim."

**Go rule** (PHASES gives none beyond the acceptance lines; proposed [inference]): **go** when the check's five lines all read YES. **Conditional** when one format fails and the cause is known and outside the engine; it is listed by name. **No-go** otherwise.

**How the check asks Jim:** y/n questions and "press Enter" prompts in the PowerShell window, as in Phases 1-7 (rule 04's choice for this check, 2026-10-10).

**Plan decisions** [stated: Jim, 2026-10-10, "Go" to D1-D4 as recommended]:
- **D1 A:** per photo, a session with two passes, then `lr_end_session` revert (0 settings may differ); after it, the sync and the preset. `lr_sync_series` and `lr_create_preset_from_active` refuse while a session is open [handle: `engine\src\mcp\defs-propagation.ts` descriptions, "Not while a session is open"].
- **D2 A:** the sync target is the next photo of the same pipeline in the collection. The sync's own "AVG pre-sync" snapshot then puts that photo back. No new virtual copies are made.
- **D3 A:** a preset from every photo is checked in its file and then deleted by the check. One kept preset from the JPEG is listed after one restart and applied by one click.
- **D4 A:** every photo of the collection, the virtual copies and the duplicate originals included.

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\phase8-check.ts` (the parts in order, the summary), `phase8-check-cli.ts` (`npm run phase8:check`) |
| Part 1: every photo | `phase8-photos.ts`, `phase8-session.ts`, `phase8-presets.ts` (the preset file's form) |
| Part 2: 11 intents on the JPEG | `phase8-intents.ts` |
| Part 3: raw→rendered sync | `phase8-cross.ts` |
| Part 4: restart and preset click | `phase8-presets.ts` |
| Part 5: Claude Desktop chat | `phase8-chat.ts` |
| Cleanup | `phase8-cleanup.ts` |
| Resume | `phase8-state.ts` (state file `%TEMP%\LrC-AVG\P8\p8_state.json`), `phase8-config.ts` (`holdBack`, `putBack`) |
| Tests | `engine\tests\phase8-check.test.ts`, `engine\tests\helpers\phase8-harness.ts` |
| Dry run | `docs\reports\phase8\check-dryrun\dryrun.txt` |

**What the check does** [handle: `engine\src\devtools\phase8-check.ts` and each module's header]:

1. **Part 1, every photo of "fixtures" (unattended).** The check selects each photo itself and gives Develop 1.5 s to load it, because Lightroom checks writes only on the photo in Develop [handle: `docs\reports\phase8\S10.md` "Observed", run 1]. It takes its own snapshot "AVG P8check before …", recorded in the state, and then:
   - `lr_begin_session` with `portrait_natural_light`;
   - two scripted passes: vibrance and clarity, then temperature (+200 K on raw, +8 on rendered) and vibrance;
   - `lr_end_session` revert, which must leave 0 settings differing;
   - the settings the session changed, synced onto the next photo of the same pipeline and read back there;
   - a preset from that photo, its file checked for the pipeline's form (white balance as `Temperature` on raw and `IncrementalTemperature` on rendered, with `WhiteBalance` "Custom"; a rendered profile as "Default Color"/"Default Monochrome" with `ConvertToGrayscale`), then deleted by the check;
   - that photo put back with the sync's snapshot, 0 settings differing.

   A photo whose original is missing must be refused with `ORIGINAL_MISSING`, or not be selectable at all [handle: `docs\reports\phase8\offline.md` "Observed", runs 2-3].
2. **Part 2, the 11 bundled intents on `DSC_0031.JPG` (Copy 1) (unattended):** pass 0, one pass (clarity), revert with 0 differing.
3. **Part 3, raw→rendered sync (unattended):**
   - a session on `20260907-_OZ80093.NEF`, accepted;
   - its recipe synced onto the JPEG, which must list exactly `camera_profile` and `white_balance` as `not_transferable` and read every other setting back as the recipe has it;
   - a preset from the JPEG, kept for Part 4;
   - both photos put back.
4. **Part 4, a Lightroom restart:**
   - Jim restarts Lightroom and says whether the preset is listed;
   - he clicks it once on the JPEG;
   - every setting it carries must then match;
   - the JPEG is put back.
5. **Part 5, one Claude Desktop chat on the JPEG.** It is judged from the chat engine's tool log and session log: a session on `DSC_0031.JPG`, at least one pass, ended, on the rendered pipeline, by this engine's version. Jim answers three y/n questions. The JPEG is put back.
6. **Cleanup:**
   - Jim deletes row 5's two reference presets and the check's preset in Lightroom; the check confirms by their files;
   - Jim deletes row 5's snapshot "before presets" on the JPEG (y/n).

**Resume.** Run the command again after a stop. It first puts back any photo it had written to and not yet put back, then skips what it has recorded. `-- --new` starts over.

**Results** go to `%TEMP%\LrC-AVG\P8\`, and Claude Code collects them. The files are `p8_check_<time>.json` (one per run), `p8_state.json`, the session logs, the tool log, the chat logs and the plugin log.

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > **Quit**.
2. In Lightroom's **Library** module (press **G**), open the **Collections** panel on the left and click the collection **fixtures**. Then press **D** for the Develop module. The Filmstrip at the bottom now shows the fixtures photos.
3. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run phase8:check
   ```

4. Parts 1-3 run by themselves: the check selects one photo after another. Leave Lightroom alone until the window asks for you. This takes about 20-30 minutes [inference: about 40 s per photo for 31 photos, plus 12 short sessions].
5. Do what the window asks, in order:
   - **Restart Lightroom** (File > Exit, then start it again). After it starts, press **G**, click the collection **fixtures**, press **D**, then press Enter in PowerShell.
   - **Answer** whether the preset is listed (y/n).
   - **Click the preset** once when asked, then press Enter.
   - **Hold the chat** in Claude Desktop as the window describes, then come back and answer its three questions.
   - **Delete** the presets and the snapshot it names.
6. When the window shows `Phase 8 acceptance: WORKED` or `FAILED`, tell Claude Code "done".

### If something goes wrong

- **The window says another LrC-AVG engine is using the bridge:** do step 1, then run the command again.
- **The window or Lightroom closed before the end:** run the same command again. It puts back any photo it left mid-edit and continues where it stopped.
- **A line reads FAILED during Parts 1-3:** let the check go on, and tell Claude Code at the end.
- **The window says "NOT put back" for a photo:** in Lightroom, select that photo, and in the Snapshots panel click the snapshot it names. Then tell Claude Code.

## Pre-run findings (Claude Code)

- `npm run build`, `npm run typecheck` and `npm test` pass on `phase-8/check` [handle: the PR description].
- **The check against the simulated plugin** WORKED with six photos [handle: `engine\tests\phase8-check.test.ts`]:
  - two raw NEFs;
  - `DSC_0031.JPG` on process versions 15.4 and 11.0;
  - its Copy 1;
  - a missing TIFF, refused with `ORIGINAL_MISSING` and never written to.

  A run stopped mid-chat puts the JPEG back first, skips Parts 1-4 and finishes.
- **The dry run** of the built command finished `Phase 8 acceptance: WORKED` [handle: `docs\reports\phase8\check-dryrun\dryrun.txt`]. It used the same six simulated photos, with the real engine as Claude Desktop. The numbers are the simulator's, not Lightroom's.
- **The simulator stands in for things Lightroom has not shown yet**, so these are [unverified] until Jim's run:
  - a click on a rendered preset: the simulator keeps CameraProfile "Embedded" for "Default Color";
  - the raw→rendered sync in Lightroom;
  - Lightroom selecting each of 31 photos by uuid while the fixtures collection is shown.

## Observed (Jim)

**Run 1, 2026-10-10, 09:11:17-09:37:20 local (16:11:17Z-16:37:20Z), plugin 0.19.1, Lightroom Classic 15.6, engine 0.24.0, node v24.11.1: `Phase 8 acceptance: WORKED`** [handle: `docs\reports\phase8\P8\p8_check_2026-10-10T16-11-17-484Z.json` `summary`, `hello`; `p8_state.json` `finished` true, `runs` one]. Jim ran `npm run phase8:check` once, did the restart, the preset click, the chat and the cleanup, and said "done" [stated: Jim, 2026-10-10]. The run did not resume; `errors` is empty.

The files are in `docs\reports\phase8\P8\`:
- `p8_check_….json`, the run's results;
- `p8_state.json`, every photo's and intent's record;
- `sessions\`, the 44 session logs of Parts 1-3;
- `check_tool_log.jsonl`, the check's own tool log;
- `p8_chat_tool_log_…_chat.jsonl`, `p8_desktop_mcp_log_…_chat.txt` and `chat_session_20261010-2f709e.json`, the chat;
- `plugin_log_excerpt.txt`, the plugin log from 09:08:55 to 09:37:20.

The user folder in the copied files reads `%USERPROFILE%`.

**Part 1: every photo of "fixtures" (09:11-09:20).** The collection held 33 photos: 13 raw and 20 rendered, of which 4 were virtual copies [handle: `p8_check_….json` `fixtures`]. Spike S10's census had counted 31 photos; why there are two more is [unverified].
- **The 32 available photos:** each one had a session of 2 passes, and the revert left 0 settings differing.
- **The sync:** its read-back differed in 0 settings on the next photo, which its own snapshot then put back (`undone_by_its_snapshot` true).
- **The preset:** its file had no problems [handle: `p8_state.json` `photos[].summary`: `session.passes` 2, `revert_exact` true, `put_back_differing` [], `sync.read_back_differing` [], `preset.problems` []].
- **The missing TIFF:** `20260907-_OZ80099-Edit.tif` was refused with `ORIGINAL_MISSING` [handle: `p8_state.json` `photos[1].summary.missing`].
- **Process version 11.0 photos:** four photos on 11.0 edited as they are: `_DSC0028.NEF` (raw), `DSC_0031.JPG`, and both `IMG_1595.JPG` entries (rendered) [handle: session logs `20261010-d291b4.json`, `20261010-2ce19e.json`, `20261010-340cdf.json`, `20261010-adcd14.json` `target.process_version` "11.0"].
- **Selection:** the check selected every photo by uuid while the collection was shown, and none failed.

**Part 2: the 11 bundled intents on `DSC_0031.JPG` (Copy 1) (09:19-09:20).** None was overridden by a user intent. Each one made pass 0 and one pass, and its revert was exact, with 0 settings differing when put back [handle: `p8_state.json` `intents`].
- `bw_conversion`'s pass 0 set the profile from "Color" to "Monochrome" on the rendered photo [handle: `sessions\20261010-a1b944.json` `passes[0].changes`].
- The other ten kept "Color".
- `neutral_technical_correction`'s pass 0 changed nothing.

**Part 3: the raw→rendered sync (09:20).** A session on `20260907-_OZ80093.NEF` ran 2 passes and ended with accept. Its recipe was synced onto `DSC_0031.JPG` (Copy 1) [handle: `p8_check_….json` `cross`]:
- **Not transferred:** `not_transferable` listed exactly `white_balance` (temperature, tint: "kelvin units" against "relative units") and `camera_profile` ("\"Adobe Portrait\" is a raw-pipeline profile … it keeps its own profile").
- **Transferred:** the other 62 settings read back as the recipe has them.
- **The kept preset:** the preset "AVG P8check JPEG …" from the JPEG wrote 62 settings, and its file had no problems.
- **Put back:** both photos were put back.

**Part 4: the restart and the preset click (09:28).**
- **The restart:** Jim restarted Lightroom. The plugin's bridge closed at 09:28:27 and started again at 09:28:44; the check reconnected at 09:28:48 (`connects_before` 1, `connects_after` 2) [handle: `plugin_log_excerpt.txt`; `p8_check_….json` `restart`].
- **The preset:** it was listed (Jim: y). One click applied it: 16 settings differed from the preset before the click and 0 after, and the JPEG was then put back with 0 differing [handle: `p8_check_….json` `preset`].

**Part 5: the Claude Desktop chat (09:30-09:31).**
- **The handover:** the check gave up the bridge at 09:30:05, and Claude Desktop's engine 0.24.0 connected at 09:30:39 [handle: `plugin_log_excerpt.txt`; `p8_desktop_mcp_log_…_chat.txt`].
- **The session:** Claude began a session with `portrait_natural_light` on `DSC_0031.JPG` (Copy 1), on the rendered pipeline. It made 3 passes and ended it with accept, in 11 tool calls with 0 invalid records [handle: `p8_check_….json` `chat.evaluation`; `p8_chat_tool_log_…_chat.jsonl`].
- **The edits:** the first pass asked for exposure +0.25, tint -3 and two HSL saturations. Its next rationale opens "Guard capped exposure at +0.…" [handle: `p8_chat_tool_log_…_chat.jsonl`, lr_step lines].
- **Jim's answers:** y, y, y to the three questions.
- **Put back:** the JPEG was put back with 0 differing.
- **The bridge back:** Claude Desktop's engine gave the bridge back after its minute of idle, and the check took it at 09:32:15, 27.6 s into its wait [handle: `p8_check_….json` `bridge_back`].
- **The Deck:** the plugin log shows "hud: Deck connected" at 09:30:47, during the chat.

**Cleanup (09:36-09:37).**
- **Presets:** row 5's two reference presets and the check's preset have no file left (0 files each).
- **Snapshot:** Jim answered that "before presets" is gone (y) [handle: `p8_check_….json` `cleanup`].

**The bridge** [handle: `p8_check_….json` `bridge_stats`; `plugin_log_excerpt.txt`]:
- 4 connects and 9 connect failures (the last ECONNREFUSED on 8765), and 2 drops.
- The last drop reads "heartbeat: no message from the plugin for 6033 ms". It came during the cleanup, between `select_photo` at 09:36:41 and the reconnect at 09:37:10, which took 0.2 s; no command failed.
- That the failures fell in the restart, and that the other drop is the restart, is [inference] from the times.

## Numbers

| Line | Result |
|---|---|
| every photo of "fixtures" (count, by format) | **YES**: 33 of 33. 32 edited (2 passes, revert exact, sync exact, preset file right), 1 missing original refused with `ORIGINAL_MISSING`; 10 format/pipeline groups (table below) |
| every bundled intent on the JPEG (11) | **YES**: 11 of 11, 1 pass each, revert exact; `bw_conversion` set "Monochrome" |
| raw→rendered sync: not_transferable exactly camera_profile, white_balance; the rest read back | **YES**: exactly those two; 62 settings read back with 0 differing |
| preset listed after the restart; applied by a click | **YES**: listed (Jim: y); 16 settings differing before the click, 0 after |
| Claude Desktop chat (engine version, pipeline, Jim's three answers) | **YES**: engine 0.24.0, rendered, 3 passes, accept; Jim y, y, y |
| every photo put back | **YES**: 0 pending at the end, every put-back with 0 differing |
| cleanup: presets removed; "before presets" deleted | **YES**: 3 of 3 presets removed; "before presets" deleted (Jim: y) |
| process version 11.0 photos edit as they are | **YES**: 4 photos, raw and rendered |
| time | 26 min in all; Parts 1-3 took 9 min (the estimate was 20-30 min) |

| Format | Pipeline | Photos | Worked | Handle (`docs\reports\phase8\P8\sessions\`) |
|---|---|---|---|---|
| RAW (NEF) | raw | 11 | 11 | `20261010-21dae4`, `35bc14` (Copy 4), `af9dfd` (Copy 1), `d291b4` (PV 11.0), `d46ba4`, `2d5e5c`, `7f2ed9`, `975eb8`, `0bbf72`, `3ae60c`, `60dbd6` |
| DNG | raw | 3 | 3 | `a902a7`, `42442e` (both `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`), `cff8ae` (`PICT0019.DNG`) |
| DNG | rendered | 2 | 2 | `1bc730`, `d9e843` |
| JPEG | rendered | 6 | 6 | `340cdf`, `adcd14` (both `IMG_1595.JPG`, PV 11.0), `19ca87`, `78ee77`, `2ce19e` (`DSC_0031.JPG` PV 11.0), `683e82` (Copy 1) |
| TIFF (8-bit, 16-bit, 32-bit, CMYK) | rendered | 5 | 5 | `1f0e98`, `73d637` (16-bit), `338637` (32-bit), `3c4487` (CMYK); `20260907-_OZ80099-Edit.tif` refused, original missing (`p8_state.json` `photos[1]`) |
| PSD | rendered | 2 | 2 | `61d706`, `da2d30` |
| PSB | rendered | 1 | 1 | `738ded` |
| AVIF | rendered | 1 | 1 | `2e5d8a` |
| JPEG XL | rendered | 1 | 1 | `287466` |
| PNG | rendered | 1 | 1 | `2c5f28` |

The bit depths and CMYK come from the file names S10 gave them [handle: `docs\reports\phase8\S10.md`]. The session logs do not record them.

## Analysis (Claude Code)

- **The simulator's three stand-ins held in Lightroom** (they were [unverified] in the pre-run findings):
  - a click on the rendered preset applied all 16 differing settings;
  - the raw→rendered sync listed exactly the two groups and moved the rest exactly;
  - Lightroom selected each of the 33 photos by uuid while the collection was shown.
- **The acceptance lines of PHASES.md Phase 8**, checked against this run:
  - every format in the collection completed a full session, with a handle per format (table above);
  - all bundled intents ran on the rendered pipeline here, and on both pipelines in the simulator [handle: `engine\tests\session-bundled-intents.test.ts`];
  - process version 11.0 photos edited as they are;
  - the sync reported the non-transferable groups.

  Two lines are not checked by this run: "no decision from `file_format`" is a code property (PR #105 and earlier), and the README's format table is row 7.
- **Not judged by the check:** the look of the chat's edit. Jim's three answers stand for it.

## Verdict

Suggested by the check: **WORKED** (every line YES).

**Jim's verdict:** *to come.*

## Consequences / open questions

- **What stays after the check:**
  - the check's own snapshots ("AVG P8check before …");
  - the engine's snapshots ("AVG pre-session …", "AVG pre-sync …");
  - the History steps of every session and sync.

  These are on the fixture photos, as after every earlier check. The plugin has no command that deletes a snapshot.
- **A gap in the check's record:** Part 2 writes `pipeline` and `profile` as null for every intent [handle: `p8_check_….json` `intents`, `p8_state.json` `intents[].summary`]. `phase8-intents.ts` reads them from `lr_begin_session`'s answer, which does not carry them. The session logs do carry them (`target.pipeline`, `passes[0].settings_after.camera_profile`), so this report takes them from there. The gap does not change a result.
- **Row 7** (`phase-8/results`) takes this report's per-format table into the README's "Supported formats" table, and closes issue #95.
