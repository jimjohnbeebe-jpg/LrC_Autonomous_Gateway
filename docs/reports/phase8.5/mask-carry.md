---
report: mask-carry
phase: "8.5"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (observed, verdict)"
date: 2026-10-11
---

# Hand-made masks in a whole-table write (issue #121, with #131's shapes; fix/mask-carry-probe)

## Purpose

The mask tools refuse every create, edit and delete on a photo whose mask table holds one mask with several components, a MaskBlendMode other than 0, a brush, or a colour range (`MASKS_UNCAPTURED_KIND`) [handle: `engine\src\params\mask-table.ts:269` `uncaptured`, `:250` `untrusted`; `engine\src\session\masks.ts:105` `refuseUncaptured`, called at `:133`]. They write the whole table (`MaskGroupBasedCorrections`) on every pass, and such entries were never written back in any capture, so the engine does not know whether they survive [handle: `mask-table.ts:7-11`; `docs\reports\phase6\masks-capture.md` "Numbers"]. Issue #121 hit it twice in real chats [handle: GitHub issue #121 and its comment, `logs\engine-20261010.jsonl` session fe0800cc].

Questions:
1. Written back verbatim beside one new radial, do hand-made masks read back unchanged: masks combined with Add, Subtract and Intersect, a Brush mask, and a Color Range mask?
2. Do they look unchanged in Lightroom (Jim's eye)?
3. For #131 (mask combine): which MaskBlendMode and MaskInverted does Lightroom store for each component of an Add, a Subtract and an Intersect? Today that mapping is [unverified]; the S10 census only suggests that a subtracted part is MaskBlendMode 1 with MaskInverted true [inference from "Cloudsx", see below].

Go / no-go, from the plan Jim approved for this batch [stated: Jim, 2026-10-11, batch triage answers]:
- **WORKED** (every original entry reads back unchanged by the engine's own check, Jim answers "y", and the photo is put back): the #121 fix follows in a later PR. Create no longer refuses a photo because of another mask; edit and delete refuse only when the target mask itself is uncaptured. The engine's read-back check (`verifyTable`) still checks every carried entry after each write.
- **FAILED**: the whole-table refusal stays as it is. The saved diff shows which entry or field Lightroom changed, and the next step is decided from it.
- The combine feature itself (#131) is not built here. This run only records the shapes it needs.

Jim answers y/n in the PowerShell window, as for `npm run ai:probe` [stated: Jim, 2026-10-11, "go" to the ai:probe plan's decision 4] (rule 04, "Steps for Jim").

## Harness

- `npm run masks:carry` (`engine\src\devtools\mask-carry-probe.ts` holds the parts, `engine\src\devtools\mask-carry-probe-cli.ts` the command). It needs Lightroom in Develop on the one photo that holds the five hand-made masks of the steps below, and Claude Desktop quit. It works over the bridge with the engine's existing commands (`get_selection`, `get_settings`, `create_snapshot`, `apply_settings`, `select_photo`, `apply_snapshot`), so no plugin change is needed:
  1. It reads the photo's mask table. It refuses, and writes nothing, unless the table holds masks named Add, Subtract and Intersect with 2 or more components each, a mask named Brush with a brush component (`Mask/Aggregate` or `Mask/Paint`), and a mask named Color with a non-luminance range component (`Mask/RangeMask`). Names are matched without regard to case or spaces.
  2. It prints each of the five masks' components with their MaskBlendMode and MaskInverted.
  3. It takes a snapshot "AVG masks:carry before" and saves its id to disk.
  4. It writes the table back: every entry exactly as read, then one new radial, "AVG masks:carry radial" (centre of the photo, Exposure +0.30). History name "AVG masks:carry".
  5. It checks every entry twice, in the write's own read-back and in a fresh read. The check is the engine's `verifyTable`, the same one every mask pass runs. It ignores the fields Lightroom recomputes (`RECOMPUTED`) and the ones it settles (ReferencePoint, ErrorReason). It also lists each path that differs.
  6. It asks Jim: "Do the hand-made masks look unchanged?"
  7. It applies the snapshot and checks the photo as the engine's revert does (settings and masks as before).
  8. It prints **Mask carry probe: WORKED** or **FAILED (why)**, then **put back: YES/NO**.
- If the command stops after the write and before the put-back, the next `npm run masks:carry` puts the photo back first.
- Results go under `%TEMP%\LrC-AVG\masks-carry\`: `mask_carry_<time>.json` (the table before, the table written, the table after, the diff of both reads, the five shapes with each component's MaskBlendMode and MaskInverted, Jim's answer, the put-back), `mask_carry_bridge_log_<time>.txt` (the plugin's log, user folder redacted), and `state.json` (only while a put-back is still owed). Claude Code collects them.

## Pre-run findings (Claude Code)

- The shapes in the S10 census, all read-only (no write-back was ever made) [handle: `docs\reports\phase8\S10\census\s10_20260906-_OZ80005-Rendered.dng__DDABB6F1.json`]:
  - "Mountains" (`:270`): `Mask/Image` (blend 0), then `Mask/Aggregate` with `MaskBrushTable` and an inline `BrushTable_<hash>` (blend 1, `:321-325`), then `Mask/Aggregate` (blend 0, `:334-338`).
  - "Cloudsx" (`:1151`): `Mask/Gradient` (blend 0, inverted false), then `Mask/Image` (blend 1, inverted true, `:1191-1197`).
  - " Reds" (`:364`) and "Yellows" (`:421`): `Mask/RangeMask` with `Type` 1. The luminance range the engine makes is `Type` 2 (`mask-table.ts` `componentKind`).
  - "Far Mountain" (`:643`): a `Mask/Paint` nested inside a `Mask/Image` component (`:675-681`).
  - Which Lightroom action (Add, Subtract, Intersect) made which blend/inverted pair is not recorded there [unverified].
- S10's put-back did not include the mask table [handle: `docs\reports\phase8\S10\putback\putback.json`, 0 matches for `MaskGroupBasedCorrections`, grep run by Claude Code 2026-10-11].
- Which `What` a mask made with Create New Mask > Brush has at its top level is [unverified]. The probe accepts `Mask/Aggregate` or `Mask/Paint`, both seen in the census. If it is neither, the probe refuses and lists the kinds it found (see "If something goes wrong").
- The menu paths in the steps below come from Lightroom Classic's Masking panel as Claude Code knows it. They have not been checked on Jim's LrC 15.6 [unverified]. The fallbacks are under "If something goes wrong".
- The parts against made-up tables (`engine\tests\mask-carry-probe.test.ts`): shape detection and its refusal text, the table written verbatim plus one radial, and the per-entry diff. A recomputed digest passes. A lost brush entry and a changed MaskBlendMode are named [handle: `npx vitest run tests/mask-carry-probe.test.ts` in `engine\`, 2026-10-11: "Tests 5 passed (5)"]. The command has not been run against Lightroom.

## Steps for Jim

1. In Lightroom's **Library** (press **G**), click one raw photo with sky and some colour in it. Then **Photo > Create Virtual Copy**. The copy is selected, and the masks below go on the copy, not on your original.
2. Press **D** to open **Develop** on the copy. Press **Shift+W** to open **Masking**.
3. Make the **Add** mask:
   1. Click **Create New Mask > Linear Gradient** and drag from the top of the photo down to the middle.
   2. In the Masks panel, under this mask, click **Add > Radial Gradient** and drag a circle in the lower half.
   3. Drag the mask's **Exposure** slider to **+1.00**.
   4. Double-click the mask's name ("Mask 1") in the Masks panel, type **Add**, press **Enter**.
4. Make the **Subtract** mask:
   1. Click **Create New Mask > Linear Gradient** and drag from the left edge to the middle.
   2. Under this mask, click **Subtract > Radial Gradient** and drag a circle inside the gradient.
   3. Drag **Exposure** to **+1.00**. Rename it **Subtract** (double-click the name, type, **Enter**).
5. Make the **Intersect** mask:
   1. Click **Create New Mask > Linear Gradient** and drag from the right edge to the middle.
   2. Hold **Alt** and click **Subtract** under this mask (it becomes **Intersect**), choose **Radial Gradient**, and drag a circle that overlaps the gradient.
   3. Drag **Exposure** to **−1.00**. Rename it **Intersect**.
6. Make the **Brush** mask: click **Create New Mask > Brush** and paint two or three strokes across the photo. Drag **Exposure** to **+1.00**. Rename it **Brush**.
7. Make the **Color** mask: click **Create New Mask > Range > Color Range** and click one colour in the photo with the eyedropper. Drag **Saturation** to **−100**. Rename it **Color**.
8. Look at the photo, then click each of the five masks in the Masks panel with **Show Overlay** ticked, so you know how each one looks.
9. Quit Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > **Quit**.
10. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

    ```powershell
    npm run masks:carry
    ```

11. The window lists your five masks, one line each, then says "Writing the … masks back unchanged". Do not click in Lightroom until it asks you something. Then it prints one line per mask (`read_back: Add: unchanged`, and so on). A new mask, "AVG masks:carry radial", now shows in the Masks panel. That one is the probe's.
12. In Lightroom, click each of your five masks with **Show Overlay** ticked and look at the photo. Then answer **"Do the hand-made masks look unchanged?"** in the PowerShell window: **y** or **n**, then **Enter**.
13. The window ends with **Mask carry probe: WORKED** or **Mask carry probe: FAILED (…)**, then **put back: YES** or **put back: NO**. The radial is gone again and your five masks stay. Tell Claude Code "done".

### If something goes wrong

- If the window says `REFUSED: … does not hold the hand-made masks`, it lists each mask it missed:
  - `no mask named "X"`: rename that mask to X (double-click its name in the Masks panel; if that does not let you type, right-click the mask > **Rename Mask**). Then run the command again.
  - `X: it has 1 component`: click the mask X, add its second part as in its step above, and run the command again.
  - For Intersect: if Alt does not turn **Subtract** into **Intersect**, right-click the mask > **Intersect Mask With > Radial Gradient**.
  - `Brush: no brush component (kinds: …)` or `Color: no Color Range component (kinds: …)`, after the mask was made as in its step: tell Claude Code "done". The kinds are saved, and the probe needs to learn them.
- If the window says `put back: NO`: in Develop, on the copy, open the **Snapshots** panel (left side, under Navigator) and click **AVG masks:carry before**. Then run `npm run masks:carry` again: it puts the photo back first.
- If the window says `FAILED (select one photo …)`: click just the copy in Develop and run the command again.
- If the window says `FAILED (…)` with `plugin` or `bridge` in it: in Lightroom, **File > Plug-in Manager**, click **LrC-AVG**, **Reload Plug-in**, **Done**, then run the command again.
- If the window says `FAILED (… Another LrC-AVG engine …)`: Claude Desktop is still running. Quit it as in step 9, then run the command again.

## Observed (Jim)

(Jim fills this in, or Claude Code transcribes it from the saved results with Jim's answer.)

## Numbers

| Mask | Components (What, MaskBlendMode, MaskInverted) | read_back | read_again |
|---|---|---|---|
| Add | | | |
| Subtract | | | |
| Intersect | | | |
| Brush | | | |
| Color | | | |

- Jim's answer, "Do the hand-made masks look unchanged?":
- Headline:
- put back:

## Verdict

(Jim decides: go / no-go for the #121 fix. The probe's headline is a suggestion.)

## Consequences / open questions

- On WORKED: the #121 fix PR. It drops the whole-table refusal for create, and edit and delete refuse only an uncaptured target. A regression test: a table of one multi-component mask plus one radial, add a linear, and all three read back. It also updates the tool description (`engine\src\mcp\defs-masks.ts`).
- For #131: the five shapes' blend/inverted pairs above are the captured forms a combine path would write. The combine API (its arguments, which kinds can be combined) is planned on its own.
- Still [unverified] after one run: other brush forms (a brush added to an AI mask, as in "Far Mountain"), Depth Range, and a mask with three or more components.
