---
report: mask-combine
phase: "8.5"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps, observed transcribed from the saved results, numbers); Jim (the y/n answers, verdict)"
date: 2026-10-12
---

# Masks of several parts: which forms Lightroom takes (issue #131, fix/issues-131-136-139)

## Purpose

Issue #131 asks for a mask made of several parts, for example a radial with the AI sky subtracted from it. The engine now builds a second part of any kind it makes (linear, radial, luminance, the AI kinds) in mode add, subtract or intersect, and edits one part of a mask (reshape, invert, change its mode, remove it) [handle: `engine\src\params\mask-combine.ts` `editParts`, `engine\src\mcp\defs-masks.ts` `combine`, `part`, `remove_part`]. It writes a form only when `VERIFIED_FORMS` lists it [handle: `engine\src\params\mask-combine.ts` `VERIFIED_FORMS`, `checkForm`]. Before this run that list held only the three combinations Jim made by hand in the mask-carry run: a linear, then a radial added, subtracted or intersected [handle: `docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json` `table_before[0..2]`, `shapes`]. Every other form is refused with `MASK_OP_NOT_CAPTURED`, which names the form.

Question: for each candidate form below, written by the engine's own code, does Lightroom read it back as written, and is the brightened area where the engine means it to be (Jim's eye)?

Go / no-go, from the plan Jim approved for this PR (D1 = C: radial plus AI parts plus per-part editing, gated by `VERIFIED_FORMS` and this probe, run on the branch before the merge) [stated: Jim, 2026-10-11]:
- A form **verifies** when both reads match what was written (the engine's `verifyTable`), an AI part computed, and Jim answered **y**. Stage 2 of this PR adds exactly the forms that verified to `VERIFIED_FORMS`, from the committed results JSON. The tool text names the list itself (`defs-masks.ts`), so it changes with it.
- A form that **failed** stays refused. It is listed under "Consequences" here and on issue #131.
- The headline **WORKED** means every candidate verified and the photo was put back. **FAILED** with some forms verified is still useful: those forms go in, the others stay out.

Jim answers y/n in the PowerShell window, as for `npm run masks:carry` [stated: Jim, 2026-10-11, "go" to the ai:probe plan's decision 4] (rule 04, "Steps for Jim").

## Harness

- `npm run masks:combine`. The pure parts are in `engine\src\devtools\mask-combine-probe.ts`; the command is `engine\src\devtools\mask-combine-probe-cli.ts`. It reuses the mask-carry kit (`mask-carry-probe.ts`: `putBack`, `readPending`, `diffEntries`, `ask`). It needs Lightroom in Develop on one virtual copy of a photo with sky, plugin 0.21.0 loaded, and Claude Desktop quit. It uses existing bridge commands only: `get_selection`, `get_settings`, `create_snapshot`, `apply_settings`, `update_ai_settings`, `select_photo`, `apply_snapshot`.
  1. It refuses, and writes nothing, unless the plugin is 0.21.0 or later and exactly one photo is selected.
  2. It takes a snapshot "AVG masks:combine before" and saves its id to disk.
  3. It goes through the 10 candidates one at a time. For each, it writes the photo's masks as read plus one mask, "AVG combine <id>", with local Exposure +2 so its area shows (History "AVG masks:combine <n>"). Each candidate replaces the one before it. The mask is built by `applyOp` and `editParts`, with the allow-list opened for that build only: the probe runs in its own process, not in the MCP server.
  4. If the mask has an AI part, it sends `update_ai_settings` with the plugin's guard over every AI part. It then reads the table until the AI part has a digest or an ErrorReason, for up to 3 minutes.
  5. It checks every entry in the write's own read-back and in a fresh read (`verifyTable`; the fields Lightroom recomputes or settles are left out).
  6. It asks Jim the candidate's question, for example "Is a large oval over the upper two-thirds bright, except the sky inside it, which looks as before?".
  7. It puts the photo back from the snapshot and checks it as the engine's revert does.
  8. It prints one line per form (`YES` / `NO` and why), then **Mask combine probe: WORKED** or **FAILED (why)**, then **put back: YES/NO**.
- The candidates (`CANDIDATES`; the form names are the ones `VERIFIED_FORMS` takes):

  | # | Form | What Jim should see |
  |---|---|---|
  | 1 | `radial, add sky` | the sky, and an oval in the lower middle |
  | 2 | `radial, subtract sky` | a large oval over the upper two-thirds, without the sky inside it |
  | 3 | `radial, intersect sky` | only the sky inside that oval |
  | 4 | `sky, add radial` | the sky, and an oval in the lower middle |
  | 5 | `linear, subtract linear` | the top of the photo, right half only |
  | 6 | `radial, subtract radial` | a large central oval with a small unchanged hole |
  | 7 | `radial, intersect luminance` | only the light parts inside a large central oval |
  | 8 | `radial, subtract radial: reshape part 2` | the same oval, its hole moved towards the left |
  | 9 | `radial, subtract radial: part 2 to intersect` | only a small oval in the middle |
  | 10 | `radial, subtract radial: remove part 2` | the whole large oval, no hole |

- If an AI part gives no result within 3 minutes, the run stops: Lightroom refuses writes to the photo until the part has one (`Pending.lua`). A form whose AI part answers an ErrorReason (no sky found) fails, and the run goes on.
- If the command stops after a write and before the put-back, the next `npm run masks:combine` puts the photo back first.
- Results go under `%TEMP%\LrC-AVG\masks-combine\`: `mask_combine_<time>.json`, `mask_combine_bridge_log_<time>.txt` (the plugin's log, user folder redacted), and `state.json` (only while a put-back is still owed). The JSON holds the table before, each form's mask as written, read back and read again, the problems found, the AI result, Jim's answer, and the put-back. Claude Code collects them into `docs\reports\phase8.5\mask-combine\`.

## Pre-run findings (Claude Code)

- Lightroom stores a mode's fields on the second part, and MaskValue differs by mode too, not only MaskBlendMode and MaskInverted. The radial parts of Jim's three masks [handle: `node -e` over `docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json` `table_before[0..2]`, run by Claude Code 2026-10-11]:

  | Mode | MaskBlendMode | MaskInverted | MaskValue | Flipped |
  |---|---|---|---|---|
  | Add | 0 | false | 1 | true |
  | Subtract | 1 | false | 0 | true |
  | Intersect | 1 | true | 0 | false |

  The engine writes all four from the mode (`mask-combine.ts` `modeFields`). Every other field of a new part is what the engine already writes for that kind as a mask's first part (`mask-build.ts` `newComponent`). The radial's field names match the captured part's exactly [handle: `engine\tests\mask-combine.test.ts` "builds the radial part with exactly the captured fields"].
- The engine's checks against made-up tables and the Lightroom sim [handle: in `engine\`, 2026-10-11]:
  - `npx vitest run tests/mask-combine.test.ts`: "Tests 9 passed (9)". It covers the builder against the captured entries, a refusal naming each unverified form (radial first, an AI part, luminance, an AI first part, three parts, each part edit), argument refusals, a part edit allowed once the form is listed, and the AI part found in any position.
  - `npx vitest run tests/session-masks-combine.test.ts`: "Tests 6 passed (6)". It covers combine, list, a slider edit on the combined mask, and the other mask carried; an unverified form refused with nothing written; a part edit refused, then allowed once the table lists it; an AI part computed, with the guard's `watch` naming every AI part; nothing found for part 2 puts the mask back; and plugin 0.20.0 refused for an AI part.
  - `npx vitest run tests/mask-combine-probe.test.ts`: "Tests 5 passed (5)". It covers each candidate built in its form beside the photo's masks, the allow-list unchanged after each build, judging and the verdict, and the AI wait.
  - The whole engine suite, `npx vitest run`: "Test Files 110 passed (110)", "Tests 1367 passed | 3 skipped (1370)".
- The sim is not Lightroom. That Lightroom takes a radial first part, an AI part, two linears, a luminance part, or a part edit is [unverified] until this run.
- Plugin 0.21.0's guard waits for every AI part of a watched mask (`plugin\LrC-AVG.lrplugin\Pending.lua` `computing`, `isAi`). Plugin 0.20.0 read only the first part. A radial there never shows a digest, so that plugin would refuse every write to the photo until a restart [inference: Pending.lua 0.20.0 `computing`]. That is why the engine refuses an AI part on a plugin before 0.21.0 (`engine\src\session\mask-parts.ts` `checkAiPartPlugin`), and why the probe does too.
- The menu paths in the steps come from the mask-carry run's steps and Lightroom Classic as Claude Code knows it. Claude Desktop's **File > Exit** is from this PR's plan. Neither has been checked on Jim's PC for this run [unverified].
- Before the run, the command had not been run against Lightroom.

## Steps for Jim

1. In Lightroom's **Library** (press **G**), click one raw photo with plenty of sky and both light and dark areas. Then **Photo > Create Virtual Copy**. The copy is selected; the probe works on the copy, not on your original.
2. Press **D** to open **Develop** on the copy.
3. Reload the plugin: **File > Plug-in Manager**, click **LrC-AVG** in the list on the left, click **Reload Plug-in**, then **Done**.
4. Quit Claude Desktop: in Claude Desktop, **File > Exit**.
5. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run masks:combine
   ```

6. The window goes through 10 forms. For each it prints `n/10 "<form>": writing it. Do not click in Lightroom.` For forms with sky it also prints `Lightroom's AI part: computed (… s)`, which can take a minute. Then it asks a question about the photo, such as "Is a large oval over the upper two-thirds bright, except the sky inside it, which looks as before?".
7. Look at the photo in Lightroom: the probe's mask brightens its area by about two stops. Answer the question in the PowerShell window: **y** or **n**, then **Enter**. Do this for each of the 10 questions.
8. The window lists every form with **YES** or **NO**, then **Mask combine probe: WORKED** or **Mask combine probe: FAILED (…)**, then **put back: YES** or **put back: NO**. The probe's mask is gone again. Tell Claude Code "done".

### If something goes wrong

- If the window says `FAILED (reload the LrC-AVG plugin 0.21.0 …)`: do step 3 again, then run the command again.
- If the window says `FAILED (select one photo …)`: click just the virtual copy in Develop, then run the command again.
- If the window says `FAILED (… Another LrC-AVG engine …)`: Claude Desktop is still running. Quit it as in step 4, then run the command again.
- If the window says `FAILED (…)` with `plugin` or `bridge` in it: do step 3, then run the command again.
- If a dialog opens in Lightroom while the window waits for the AI part: click **OK** in the dialog. The window then goes on or stops by itself.
- If the window says `Lightroom's AI part: ErrorReason 1`: Lightroom found no sky in this photo. Let the run finish, tell Claude Code "done", and Claude Code will say whether to run it again on another photo.
- If the window says `put back: NO`: in Develop, on the copy, open the **Snapshots** panel (left side, under Navigator) and click **AVG masks:combine before**. Then run `npm run masks:combine` again: it puts the photo back first. If that says `put back: NO` again after an AI part showed `no result within 180 s`, restart Lightroom (**File > Exit**, then start it again), open the copy in Develop and run the command again.

## Observed (Jim)

One run on 2026-10-12, 04:29:26-04:30:27 UTC (21:29:26-21:30:27 on Jim's clock, 2026-10-11), transcribed by Claude Code from the saved results [handle: `docs\reports\phase8.5\mask-combine\mask_combine_2026-10-12T04-29-26-642Z.json`, copied from `%TEMP%\LrC-AVG\masks-combine\`; the plugin's log for the run window is `docs\reports\phase8.5\mask-combine\bridge_log_excerpt.txt`, 56 lines, no warning or error]. Jim said "done" [stated: Jim, 2026-10-12].

- Photo: a virtual copy of `20260923-_OZ80256.NEF` (uuid `CD4D3C23-195D-4699-84C3-645BE97C613B`). Engine 0.30.0, plugin 0.21.0, Node v24.11.1.
- Each of the 10 forms was written, read back and read again with no problem (`forms[*].problems` is empty), and Jim answered **y**.
- The four sky parts computed in 3.8 s, 2.6 s, 2.6 s and 2.8 s (`forms[0..3].ai.ms`).
- Headline: **Mask combine probe: WORKED**; put back: **YES** ("settings and masks as before").
- The run took 61 s for 10 forms and 10 answers (`started`; the excerpt's first and last lines).

## Numbers

| # | Form | read back as written (both reads) | AI part | Jim | Verified |
|---|---|---|---|---|---|
| 1 | radial, add sky | yes | computed, 3.8 s | y | **yes** |
| 2 | radial, subtract sky | yes | computed, 2.6 s | y | **yes** |
| 3 | radial, intersect sky | yes | computed, 2.6 s | y | **yes** |
| 4 | sky, add radial | yes | computed, 2.8 s | y | **yes** |
| 5 | linear, subtract linear | yes | — | y | **yes** |
| 6 | radial, subtract radial | yes | — | y | **yes** |
| 7 | radial, intersect luminance | yes | — | y | **yes** |
| 8 | radial, subtract radial: reshape part 2 | yes | — | y | **yes** |
| 9 | radial, subtract radial: part 2 to intersect | yes | — | y | **yes** |
| 10 | radial, subtract radial: remove part 2 | yes | — | y | **yes** |

- Headline: WORKED, 10 of 10 forms verified [handle: the results JSON above, `headline`, `form_lines`].
- put back: YES [handle: the same file, `put_back`].

## Verdict

Suggested by the probe: **go**, all 10 forms verified. Jim's verdict:

## Consequences / open questions

- Stage 2 is done. `VERIFIED_FORMS` lists Lightroom's own three forms and the 10 verified here, with this report's results JSON as its handle (`engine\src\params\mask-combine.ts`). A part edit's form is listed with its mask's form: `uncaptured` refuses any edit of a mask whose form is not listed, before the part edit's own check.
- No form failed.
- Only sky was probed. A sky form stands for every AI kind in the same place: subject, background, the landscape and the people parts (`mask-combine.ts` `listed`) [stated: Jim, 2026-10-12, "Every AI kind, same modes"; inference: every AI kind writes the same `Mask/Image` component apart from MaskSubType and MaskSubCategoryID, `mask-build.ts` `newComponent`]. The other kinds are unprobed, and the tool text says so (`engine\src\mcp\defs-masks.ts`).
- Still refused, by name: other kinds or orders of parts (for example a radial added to a radial, or a sky first with a radial subtracted), three or more parts, and the part edits not run here (part 2 inverted on its own, any edit on another form).
- Not offered, and not tested here: one person's kinds as a part (they need Lightroom to find the person first, `session\person-masks.ts`), and LrDevelopController for a part.
