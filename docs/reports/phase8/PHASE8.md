---
report: PHASE8 — does LrC-AVG edit every image format Lightroom Classic develops?
phase: 8 (row 6, phase-8/check)
status: template
authored_by: "Template, harness, pre-run findings: Claude Code (Opus 5.5), 2026-10-10 (phase-8/check). Observed: Jim (to come). Verdict: Jim (to come)."
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

*To be filled from Jim's run.*

## Numbers

| Line | Result |
|---|---|
| every photo of "fixtures" (count, by format) | |
| every bundled intent on the JPEG (11) | |
| raw→rendered sync: not_transferable exactly camera_profile, white_balance; the rest read back | |
| preset listed after the restart; applied by a click | |
| Claude Desktop chat (engine version, pipeline, Jim's three answers) | |
| every photo put back | |
| cleanup: presets removed; "before presets" deleted | |

| Format | Pipeline | Photos | Worked | Handle |
|---|---|---|---|---|
| | | | | |

## Verdict

*Jim's, after the run.*

## Consequences / open questions

- **What stays after the check:**
  - the check's own snapshots ("AVG P8check before …");
  - the engine's snapshots ("AVG pre-session …", "AVG pre-sync …");
  - the History steps of every session and sync.

  These are on the fixture photos, as after every earlier check. The plugin has no command that deletes a snapshot.
- **Row 7** (`phase-8/results`) takes this report's per-format table into the README's "Supported formats" table, and closes issue #95.
