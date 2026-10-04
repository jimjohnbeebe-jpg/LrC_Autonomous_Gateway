# Option A "Island": design notes

A one-row strip in Lightroom Classic's black top band. At rest it never covers the photo or a panel. On your turn it widens to hold that turn's actions inline. Details drop down only when asked for.

Files (all under `scratchpad/hud/`):

- `option-a/option-a.html` holds five frames: `#ctx-converged`, `#ctx-approve-open`, `#states`, `#details` and `#widths`.
- `mockups/option-a-context.png` is Scene C at rest, 1920 x 1080.
- `mockups/option-a-context-open.png` is Scene P with the details open (This pass), 1920 x 1080.
- `mockups/option-a-states.png` is the states sheet at `--scale=2`, 2400 x 5614 (19 rows).
- `mockups/option-a-details.png` is the details sheet at `--scale=2`, 2400 x 5674: W after pass 2, W after pass 0 (Lens Corrections group), P on Whole edit, and a fit check of the longest step lines and labels.
- `mockups/option-a-widths.png` is the narrow-window sheet at `--scale=1.5`, 2424 x 2802: P, V, D, C and Problem at 1536 and 1366 px windows.
- Checks: `option-a/audit.cjs` (writes `option-a/audit-out.json`; now also checks details rows for overlap and callouts for overhang), `option-a/measure.cjs`, `option-a/hyph.cjs` with `option-a/tnum-hyphen-check.html`, and `option-a/zoom.cjs` (crops and magnifies a PNG region).

Re-render with `node render.cjs option-a/option-a.html mockups/<png> --selector=#<frame id>`, adding `--scale=2` for `#states` and `#details` and `--scale=1.5` for `#widths`. The page builds its frames only after `document.fonts.load('600 15px Inter')` resolves, because every placement measures text widths.

How claims are marked: "[stage]" means the figure was measured on the mockup stage (`stage/stage.js`), not on real Lightroom. Gateway handles are repo-relative to `jimjohnbeebe-jpg/lrc_autonomous_gateway` at `75369b7`. "Spec" means the lead's `hud/lrc-avg-hud-spec-v2.md`. "Proposed" marks a string, field or behaviour that does not exist today.

### What changed in this revision (review round 3)

| Finding | Change |
|---|---|
| Host section: "D can never be shown" and "its own connection to the plugin's socket" (high) | Section 10 "Who starts it" now follows spec D3 option A: the engine-hosted channel spawns the island detached; D shows when the channel closes or misses 3 pings; Not running comes from the proposed `lightroom` field or `bridge_status.json`. The island never touches the plugin's sockets. Section 2's Not running row, section 5 item 8 and open question 1 rewritten to match. |
| Long Lightroom labels overlapped in an 88 px column (medium) | Rows now sit under Lightroom panel subheads (11 px text3). Label column 150 px, track 110 px, rows `min-height` 24. Checkbox rows ("Enable Profile Corrections", "Remove Chromatic Aberration") have no track, so the label takes the track's column. Drawn: a pass-0 This pass view with a Lens Corrections group, and a fit check of the longest labels. The audit checks every adjacent pair of detail rows: 0 overlaps in 45. |
| Step line and view switch shared one fixed row; pass numbers broke stepLine's rules (medium) | The step line has its own line and wraps. The This pass / Whole edit switch sits in the diff header row with the first group's caption. Step text follows `stepLine` (`plugin/LrC-AVG.lrplugin/HudView.lua:83-89`). W has begin and pass0 forms ("Working · Starting", "Working · Setting the baseline"), drawn. |
| Problem sentences lost their instruction to "…" (medium) | The island shows a short proposed sentence per failed action, instruction intact; the engine's full note stays in the details. The narrow form is the instruction alone. `:207` added. After a failed Abort, Abort comes pre-armed, so one click aborts. Drawn: Problem with the pointer on the pre-armed Abort, and Problem in Variants (`:207`). |
| "Change in File > Plug-in Manager" beside the running edit's settings (medium) | The row is "This edit's settings", caption "For the next edit: File > Plug-in Manager". The idle row, which shows the page's values, keeps "Change in File > Plug-in Manager". |
| Keyboard way in conflicts with today's menu item and depends on cross-process activation (medium) | Section 3 lists the plugin change (spec D1 "Known conflict"), adds S9-13 for cross-process activation, and names the fallback: the classic LrView HUD. The focused-chip row is marked [unverified until S9-13]. |
| "Working" next to "Claude's last call failed" (low) | New warn kind: neutral triangle + the note, no ring, no "Working". Drawn. The info row now uses `approval.ts:186`. |
| D undo line read as a one-click undo (low) | It uses HudText.UNDO's own prefix "To undo it:" in plain text2, no link styling. A click anywhere on the island opens the details. |
| Island text centre off the band's text (low) | Top edge y 65; a 40 px island's centre is y 85, level with the identity-plate text (measured with `review-a-r2-crops/probe2.cjs`: island cy 85, idtext cy 85). |
| Callouts had no single anchoring rule (low) | One rule in `placeTip()`: left-aligned to the control, right-aligned when it would pass the island's right edge, never past the island's left edge. Audit: 0 px overhang on all 4 callouts. |
| Abort's consequence wrong in Variants mode (low) | "Stops Claude and puts the master back; copies A, B and C stay in the catalog." (proposed), used by the details footer and the armed callout in a Variants edit. Not drawn. |
| "actions under the chevron" (low) | Dropped. The compact row is the glyph, "Your turn" and the chevron. |
| No hide control (low) | A 24 px × (text3) left of the chevron on Done and on the idle row; Esc also hides those two while the island has focus. The menu item and the next edit bring it back. Drawn. |
| V dropped look names before keycaps at 1536 (low) | V shortens in this order: keycaps (they return on keyboard focus), then the "shown" word (the underline stays), then the look names. At 1536 V keeps "A natural / B dramatic / C soft". |
| Library shows no Snapshots or History; hidden top panel; activity indicator (low) | (a) qualified to "in Develop"; (b) S9-14 added and a default chosen: the compact row 8 px inside the loupe's top-right corner; (c) the free span now starts at an identity zone of 360 px. C and Cap reached got a short form so they keep Accept inline at 1366. |

The round-2 changes (note shown in every state, P trigger, details footer buttons, pointer Abort confirm, mini tracks, attached drop-down, History rows, narrow windows, "shown" chip, focal length blanked) stay as they were except where the table above says otherwise.

---

## 1. Placement

**Region:** the top band, `LR_REGIONS.topband` = x 0, y 52, w 1920, h 60 [stage]. Measured after the build (`node option-a/audit.cjs $PWD/option-a/option-a.html`, "band"): `idtextRight` 233.3, `modulesLeft` 1449 [stage].

**Horizontal anchor: the loupe's centre line (x 960 at 1920), then clamped.** The photographer's eye is on the photo, so the island starts on the photo's axis. The clamp rule (proposed; implemented in `placeIsland()` and `bandGeom()` in `option-a.html`):

1. **Left limit: an identity zone of 360 px** from the window's left edge, or the identity-plate text + 24 px if that is wider. LrC shows its activity and progress indicator in the identity-plate area during exports, which every pass makes (F10), and it may be wider than the 234 px plate text [inference: its width is not measured; S9-15]. The zone includes the clearance.
2. **Right limit:** 24 px before the module picker. The free span is x 360 to (window − 495) [stage], so it is **window − 855** px wide (1065 px at 1920).
3. If the island does not fit centred, shift it toward the free-space centre, as far as the span allows.
4. If it still does not fit, take the state's next shorter form (table below).
5. Last resort: the compact row (glyph + "Your turn" + chevron), with the actions in the details.

**Vertical anchor: the top edge is fixed 13 px into the band (y 65 at the stage's size).** A 40 px island spans y 65-105, so its centre (y 85) is level with the identity-plate text (centre y 85). The module-picker labels sit at y 88 [stage]; the band's own two text lines do not share a centre, and the plate's is the one nearer the island. The Variants island grows downward only (y 65-109), 3 px inside the band's bottom (y 112).

**Departure from the brief: the Variants island is 44 px tall, not 48.** The stage draws Lightroom's top-panel toggle triangle at x 956-964, y 55-59 (`stage/stage.js`, `tri('up', 'left:956px;top:3px')`); the island's top edge clears it by 6 px. A 48 px island from y 65 would end at y 113, below the band. Whether real LrC draws the toggle in the same place is [unverified]; the stage is a mockup.

**Form widths and the narrowest window each fits** (widths from audit "forms"; minimum window = width + 855, which assumes Lightroom keeps the stage's band geometry at smaller windows [inference]):

| State | Forms, longest first (px wide) | Narrowest window per form |
|---|---|---|
| W Working | pass n of N 332; begin 312; pass0 386; a later pass-0 stage, e.g. "Claude is looking at the result", 445; with an info note 556 | 1187; 1167; 1241; 1300; 1411 |
| Warn | 466 | 1321 |
| C Converged | full 545; short "Your turn" + Accept + Abort 323; compact 159 | 1400; 1178; 1014 |
| P Approve | full 645; short "Your turn" + Approve pass 1 + Abort 374; compact 159 | 1500; 1229; 1014 |
| V Variants pick (copy A "shown") | full 809; no keycaps 722; no keycaps and no "shown" word 678; letters 549; letters + "Your turn" 458; compact 159 | 1664; 1577; 1533; 1404; 1313; 1014 |
| D Disconnected | full undo line 732; short undo line "To undo it: Develop > Snapshots…" 663; no undo line (undo in the details) 429 | 1587; 1518; 1284 |
| Cap reached | full 486; short 323; compact 159 | 1341; 1178; 1014 |
| Problem (failed Abort) | full 484; instruction only "Click Abort again." 304 | 1339; 1159 |
| Problem in Variants (`:207`) | full 1023, then V's ladder | 1878 |
| Sent / Done / Not running / Idle | 454 / 367 / 506 / 651 | 1309 / 1222 / 1361 / 1506 |

The 903 px D-without-snapshot row needs a 1758 px window; below that it takes the short undo line.

**Drawn in `option-a-widths.png`** (captions print the measured span, form and shift):

- **1536 px window (span 681):**
  - P full, shifted 50 px left.
  - V without keycaps and without the "shown" word (look names kept), shifted 66 px left.
  - D short undo line, shifted 59 px left.
  - C full, centred.
  - Problem full, centred.
- **1366 px window (span 511):**
  - P short, centred.
  - V letters + "Your turn", shifted 41 px left.
  - D no undo line, shifted 27 px left.
  - C short, centred.
  - Problem full, shifted 54 px left.

**Still falling back:**

- P loses its full sentence below 1500 px.
- V loses its keycaps below 1664 px (they return on keyboard focus), the "shown" word below 1577 px, its look names below 1533 px, and its sentence below 1404 px.
- D loses the snapshot's time below 1587 px, and the whole undo line below 1518 px.
- The compact row takes over for V below 1313 px, for P below 1229 px, and for C and Cap reached below 1178 px. Below 1014 px even that does not fit [stage].

The identity zone costs width: with the round-2 clamp (span window − 753) V would keep its "shown" word at 1536 and C its full sentence at 1366. If S9-15 measures the activity indicator narrower, the zone shrinks and these forms come back.

The alternative from the review, dropping a too-wide island 8 px into the loupe surround, is not used in a normal window: it would cover the loupe's top margin at rest. It is the default only when the top panel is hidden (section 10, Lightroom states).

**Inner grid:**

- Left inset 16 px (15 px padding plus the 1 px border).
- Glyph box 16 px, then an 8 px gap to the words.
- 24 px between the sentence and the first action. 16 px between other groups. 8 px between buttons or chips.
- Buttons are 28 px tall and sit 6 px from the island's outer edge. Chips are 36 px tall and sit 4 px from it.
- The × (Done and idle only) is 24 x 24, 12 px after the last item.
- A 1 x 20 hairline divider (24 in V), with 12 px before it and 4 px after.
- A 32 x 32 chevron, 4 px from the right edge.
- The details use 16 px side padding, 12 px section padding, rows of at least 24 px, and whole-pixel line heights.

**The details drop-down is attached:**

- 0 px gap. It shares the island's bottom hairline: the panel's top is at island bottom − 1 (y 104), and the panel sits one layer below the island.
- Right edges are aligned, so the chevron sits over the panel.
- The island's corners that sit on the panel are squared, and so are the panel's corners that sit under the island. In P the panel is narrower than the island (x 843-1283 under 638-1283). In W it is wider (x 686-1126 under 794-1126).
- The panel is 440 wide (audit "geo"): 444 px tall in W after pass 2, 564 in W after pass 0 (two groups), 464 in P This pass, 536 in P Whole edit.

**What it covers:**

- At rest the island stays inside the band, between y 65 and y 109. The band ends at y 112 and the photo starts at y 152 (`LR_REGIONS.photo` = 429, 152, 1062, 708 [stage]).
- There is no shadow at rest, so nothing falls on the loupe surround.
- The details cover the loupe top and the photo's top centre only while open.
- Callouts (y 113-149) appear only while an action is hovered, focused or armed.
- The Navigator, Snapshots and History panels, the Basic panel and the filmstrip are never covered.

---

## 2. States and their triggers

Stages are from `engine/src/bridge/hud-protocol.ts:40-46` (HUD_STAGES, HUD_END_STAGES). Headline strings are from `plugin/LrC-AVG.lrplugin/HudText.lua:39-53`.

**Precedence** follows today's `headline()` (`plugin/LrC-AVG.lrplugin/HudView.lua:61-72`), with three island rows added (marked *):

1. Not running
2. No edit
3. Done (end stage)
4. D (not connected)
5. Checking / gone
6. \*Problem (action note)
7. V (`awaiting_pick`)
8. P (`approve_pass`)
9. C (`converged`)
10. \*Cap reached
11. T (`target_changed`)
12. \*Warn (a failed call)
13. W

**The update's `note`** (`hud-protocol.ts:104`; filled by `engine/src/hud/payload.ts:32,46`) is shown in every state:

- In the details, it appears in full under the step line.
- In the island it depends on its kind (section 5, proposed `note_kind`):
  - **info** takes W's filename slot in text2, cut with "…" past 360 px;
  - **warn** replaces W's ring and "Working" with a neutral triangle and the note;
  - **problem** becomes the Problem state, with a short sentence;
  - **cap_reached** selects the Cap reached state.

Today's HUD shows the note on its feedback line (`HudView.lua:76-81`).

| State (drawn?) | Trigger | Shape + words (never colour alone) | Actions in the row |
|---|---|---|---|
| **W** Working (drawn: pass 2, begin, pass0, info note) | stage `begin`, `pass0`, `applying`, `acquiring_preview`, `metrics`, `awaiting_claude`, with no `approve_pass`, and no action, warn or cap note | working ring (hollow, pulsing) + "Working" + a second slot + the filename, or an info note in the filename's place. The second slot follows today's `stepLine` (`HudView.lua:83-89`; `HudText.lua:55-56`): "pass n of N" from pass 1 up, never at `begin` or `pass0`; otherwise the stage's STEP words: "Starting" at begin (`HudText.lua:58`), "Setting the baseline" at pass0 (proposed short form of STEP.pass0), and e.g. "Claude is looking at the result" at a later pass-0 stage. | none in the row. The details footer holds Accept (secondary) and Abort; Ctrl+Backspace arms Abort. Accept is on at every stage but `awaiting_pick`, as today (`HudView.lua:161`). |
| **Warn** (drawn) | a note of the warn kind: "Claude's last call failed; the edit is still open." (`engine/src/session/hud-actions.ts:284`) | neutral text2 triangle + the note (13/500) + the filename. No ring and no "Working": Claude may have stopped to talk in the chat, so "Nothing needed from you" may not hold. | as W |
| **Problem** (drawn: failed Abort with the pointer on Abort; Problem in Variants) | a `note` that asks for a click again: "Abort could not put the photo back. Click Abort again." (`hud-actions.ts:156`), "Abort left n settings different from before. Click Abort again." (`:165`), "Pick B did not go through, so nothing was accepted. Click Pick B again, then Accept." (`:207`), "Accept did not go through; the edit is still open. Click Accept again." (`:226`), "Pick B did not go through. Click Pick B again." (`:263`) | danger triangle + a short sentence that keeps the instruction (section 6), 15/600. The engine's full note is in the details. | the stage's own actions. At `awaiting_claude` that is Abort inline; Accept is in the details. After a failed Abort (`:156`, `:165`) **Abort comes pre-armed**: danger hairline, and its callout says "Click to abort again." plus the consequence, so the one click the sentence asks for aborts. It stays armed while the Problem state lasts (no 3 s disarm). At `awaiting_pick` (`:207` returns there through `idleStage`, `:286`) the chips stay and the short sentence replaces "Your turn: pick a copy". No primary. |
| **Cap reached** (drawn) | stage `awaiting_claude` with the note "All 6 passes are used. Accept keeps the edit; Abort puts the photo back." (`hud-actions.ts:288-290`, `endReason === "cap_reached"`) | filled amber dot + "Your turn: all 6 passes are used." (proposed) | primary **Accept**, Abort. The full note is in the details. |
| **C** Converged (drawn: focus callout, and Abort armed by a click) | stage `converged` | filled amber dot + HEADLINE.converged | primary **Accept**, Abort |
| **P** Approve (drawn in the row, and in both detail views) | `approve_pass` present at any non-end stage (the engine sends it only then: `engine/src/hud/payload.ts:34,44`), the same rule as `HudView.lua:69` (headline) and `:165` (button) | dot + HEADLINE.approve, formatted with `approve_pass`. The details' step line names the actual stage with its STEP words (e.g. "Pass 1 of 6 · Rendering a preview"). | primary **Approve pass 1**, Abort; Accept in the details |
| **V** Variants pick (drawn: hover, and keyboard focus [unverified until S9-13]) | stage `awaiting_pick` with `variants` = [A, B, C] | dot + "Your turn: pick a copy" + three chips. The copy in the loupe is underlined with "shown" (proposed, section 5 item 9). | the chips (1/2/3). Accept is absent: the engine refuses it until a copy is picked (`hud-actions.ts:183`; today's HUD greys it, `HudView.lua:161`). There is no primary in this state. |
| **D** Disconnected (drawn; no-snapshot form drawn) | the island's channel to the engine closed or missed 3 pings mid-edit (spec 3.7), and the "gone" case (spec 3.2: a new engine's `welcome` names another edit or none; or 10 s of checking, F8) | neutral grey triangle + HEADLINE.not_connected, or HEADLINE.gone | none. Plain text2 "To undo it: Develop > Snapshots > …18:42:07" (HudText.UNDO's prefix, `HudText.lua:72`; the snapshot name cut to its time). No link styling: nothing in the island undoes by itself, and Abort needs the engine (`HudView.lua:158`). A click anywhere on the island, or the chevron, opens the details at the full name. With no `snapshot`: HudText.UNDO with UNDO_NO_SNAPSHOT, verbatim (`HudText.lua:73`). |
| **Abort armed** (drawn on C) | first click on Abort, or first Ctrl+Backspace, in any state that has Abort | Abort gets a danger hairline and stays the same size. The callout under it says "Click again to abort." (keyboard: "Press Ctrl+Backspace again to abort.") + the consequence, at once. | as before |
| T Target changed (not drawn) | stage `target_changed` | dot + HEADLINE.target_changed | Abort only, with no primary: the action happens in Lightroom (select the photo) |
| Checking (not drawn) | channel connected, first `state` not yet arrived; at most 10 s (spec 3.7) | ring + HEADLINE.checking | none; buttons off |
| **Sent** (drawn) | after any click, until `answered_click_id`, a new edit or an end stage arrives, or 10 s pass (`hud-protocol.ts:24-25`) | ring + HudText.CLICK.sent ("Accept sent; waiting for Claude."); buttons shown off: text3, line hairline, no fill | off. After 10 s, CLICK.no_answer. |
| **Done** (drawn) | `accepted`, `aborted`, `ended` | check glyph + HEADLINE.accepted, HEADLINE.aborted or HEADLINE.ended, plus the filename. The end note (e.g. "Accepted: the edit is kept.", `hud-actions.ts:224`) is in the details. | **×** (hide). Without it, Done stays until the next edit, per Jim's "Stay open" decision (`hud-protocol.ts:18-20`). The × or Esc (while the island has focus) hides it; the process stays connected (spec 3.2, "User hides it"). It comes back with the next edit, or with the menu item "LrC-AVG - Show Vision Gateway HUD". |
| **Not running** (drawn) | the channel is connected and the engine reports `lightroom` = "down" for 6 s (proposed field, spec 3.3 and 3.7, E10); or, while the channel is down, `%TEMP%\LrC-AVG\bridge_status.json` (written by the plugin, `plugin/LrC-AVG.lrplugin/Bridge.lua:52`, `:140-169`) says the bridge is not running. A stale file counts as unknown, never as not running (spec 3.7). | neutral triangle + HEADLINE.not_running (`HudText.lua:41`) | none |
| **No edit** (drawn as the idle row) | no edit running | Hidden by default. File > Plug-in Extras > "LrC-AVG - Show Vision Gateway HUD" (`plugin/LrC-AVG.lrplugin/Info.lua:27`) shows an idle row: hollow grey circle + HEADLINE.none + CONNECTION.connected or .not_connected, until ×, Esc or the next edit. This keeps today's "is the bridge connected?" signal one menu item away (proposed). | **×**; the chevron opens the settings page's values, captioned "Change in File > Plug-in Manager" (here they are the page's, not an edit's) |

Exactly one primary (filled accent) button appears per state. V, W, Warn, D and Problem have none.

When Lightroom's main window is gone, the island hides and exits (spec 3.2, 3.7). It never shows Not running then, because that advice needs a running Lightroom.

---

## 3. Interactions and keyboard

**Pointer:**

- The chevron toggles the details, and so does a click on the sentence or, in D, anywhere on the island. A click anywhere on the island makes it the active window (see Focus below).
- Accept, Approve and Pick send `hud_accept`, `hud_approve_pass` (with `pass`) and `hud_pick` (with `variant`) (`hud-protocol.ts:48`, 127-132).
- **Pointer Abort arms, then confirms:**
  - The first click arms Abort. It keeps its size and place, gets a danger hairline, and the callout under it shows "Click again to abort." plus "Stops Claude and puts the pre-session snapshot back." at once (0 ms, not after the 400 ms hover delay). In a Variants edit the consequence is "Stops Claude and puts the master back; copies A, B and C stay in the catalog.": revert puts the master back and the copies stay with their edits (`engine/src/session/end.ts:4-7`).
  - A second click within 3 s sends `hud_abort`.
  - Moving the pointer off Abort, Esc, or 3 s disarms it.
  - **Exception: after a failed Abort** (Problem, `hud-actions.ts:156`, `:165`) Abort is shown pre-armed and stays armed, so one click sends `hud_abort`, as the sentence asks. The user already confirmed once.
  - The details footer's Abort works the same way.
  - Today's HUD aborts on one click (`HudView.lua:207`). This is a deliberate change: the island sits in a strip next to the module picker and under the top-panel toggle, where stray clicks happen.
- Hover or keyboard focus on any other action shows its consequence in a callout under the island after 400 ms (proposed). The consequences:
  - Accept: "Ends the edit; the sliders stay as they are."
  - Abort: as above.
  - Approve: "Lets Claude write pass 2."
  - Pick: "Claude continues on this copy."
  - Chip B adds its clipping note.
- **Callout anchoring (one rule, `placeTip()`):** left edge on the control's left edge; if that would pass the island's right edge, right edge on the control's right edge; never past the island's left edge. Audit: no callout extends beyond its island (`tipOverhangRightLeft` all 0,0).
- The × on Done and the idle row hides the island.

**Keyboard** (only while the island has focus; nothing global):

| Key | Does |
|---|---|
| Tab / Shift+Tab | moves through buttons, chips, the ×, the chevron and, when open, the details' controls |
| 1 / 2 / 3 | picks A / B / C (V only) |
| Left / Right | moves between chips (proposed) |
| Enter | the turn's primary (Accept in C and Cap reached, Approve pass n in P). On a focused chip it picks that chip. On the chevron, or with no primary (W, Warn, D, Problem), it toggles the details. |
| Space | activates the focused control; on the island body it toggles the details |
| Ctrl+Backspace | arms Abort ("Press Ctrl+Backspace again to abort." in the callout). A second press within 3 s aborts; Esc or 3 s disarms (proposed timing). Pre-armed after a failed Abort: one press aborts. |
| Esc | disarms Abort if armed by a click or key (a pre-armed Abort stays armed); else closes the details if open; else, on Done and the idle row, hides the island; else hands focus back to Lightroom. It never aborts. |

Key hints are shown in 11 px: keycaps 1/2/3 on the chips (in narrow windows only while the island has keyboard focus), Enter in the Accept callout, and Esc and Ctrl+Backspace in the details. They use text3 on the bg surface and text2 on raised surfaces, because text3 is never placed on raised.

**Getting in without a mouse (proposed; [unverified until S9-13]):**

- The intended way in is the menu item "LrC-AVG - Show Vision Gateway HUD" (`Info.lua:27`): it would activate the island and focus the turn's primary. In V it would focus the first chip, as drawn in the states sheet. With no primary, Abort, else the chevron. Reaching the item with Windows' Alt menu keys (Alt, F, then the Plug-in Extras submenu) is [inference].
- **Known conflict: today that item opens the classic floating dialog.** It runs `Hud.show()` (`plugin/LrC-AVG.lrplugin/MenuHud.lua:9`), and every other HUD item opens the classic window to show its outcome (spec D1 "Known conflict", 3.4; `MenuAbort.lua:3`, `Hud.lua:199-200`, `HudClick.lua:130`). That window takes the keyboard when it opens (`docs/reports/phase5/S8.md:122`, `:185`).
- **Plugin change needed (a plugin release):** while the island is connected, the Pick, Approve, Accept and Abort items send their event without opening the classic window (spec D1's proposed fix). How the plugin learns that the island is connected is part of that change (spec D1).
- **The activation itself is cross-process and may be refused.** The island would call `SetForegroundWindow` on itself after the engine relays the menu click. Windows allows that only if the caller is the foreground process, was started by it, received the last input event, or a few other cases hold (`research/md_nf-winuser-setforegroundwindow.md:92-100`). After a menu click Lightroom is the foreground process and received the last input [inference], and the island was started by the engine, not by Lightroom. So the call may be refused, and Windows then flashes the taskbar button instead (`:104`). The plugin cannot call `AllowSetForegroundWindow` for it [inference: the Lua SDK has no Win32 calls].
- **Proposed spike check S9-13** (an addition to the spec's S9 table, D2): with the island connected and Lightroom in front, choose the menu item 20 times. Pass: `GetForegroundWindow` is the island on 20 of 20, and Jim's "1" then picks copy A, 3 of 3. Handle: the conditions above.
- **Fallback, which exists today:** if S9-13 fails, "Show Vision Gateway HUD" keeps opening the classic LrView HUD (`MenuHud.lua:9`), which is keyboard-operable today. Taking focus is what the user asked for at that moment. Only the other items stop opening it. That covers `PRODUCT.md:44` ("the HUD's actions must be usable without the mouse") without new plumbing; every action also has its own menu item (`Info.lua:25-33`).

**Focus (the island must never steal it):**

- The current floating dialog takes the keyboard when it opens from a background task (`docs/reports/phase5/S8.md` ~line 183, F13).
- The island is shown without activation (section 10). A pointer click on it, or (if S9-13 passes) the menu item above, activates it.
- WS_EX_NOACTIVATE is not used. The Windows docs say a window with that style "should not be activated ... via keyboard navigation by accessible technology" (`scratchpad/hud/research/md_extended-window-styles.md:31`), which conflicts with the keyboard requirement (`PRODUCT.md:44`).
- Esc gives focus back to Lightroom.

---

## 4. Motion

In the PNGs the working ring is a static mid-pulse frame.

- **Working ring:** the halo (a working-colour ring at 35 % opacity) grows from r 5 to 8 and fades to 0 over a 1.6 s loop. The inner ring holds still. Warn has no ring and no motion.
- **State change:** the island's width animates over 150 ms, ease-out, from its new anchor (for example W 332 to C 545). The content cross-fades over 100 ms.
- **Your turn:** the dot appears and the island widens. There is no flash, bounce, sound or focus change (PRODUCT.md "Interrupting", `PRODUCT.md:31`).
- **Details:** open with opacity plus a 4 px downward slide over 120 ms. The island's corners square at the same moment. Close over 100 ms.
- **Callouts:** fade in over 100 ms. The armed-Abort callout appears at once, with no delay and no fade, so a quick second click is never a surprise. A pre-armed Abort shows its danger hairline from the first frame of the Problem state.
- **Hide (×, Esc):** fades out over 100 ms.
- **Numbers:** they never tween. Deltas and values swap instantly.
- **Reduced motion:** the halo is static and width changes snap. Whether WebView2 or Electron maps Windows' "Animation effects" setting to `prefers-reduced-motion` is [unverified].

---

## 5. Fields: existing payload vs proposed additions

**Existing** (`hud_update`, `engine/src/bridge/hud-protocol.ts:83-108`; the channel state of spec 3.3 carries the same fields):

| Shown | Field |
|---|---|
| state choice | `stage`, `mode`, `approve_pass`, `variants`, `note` |
| "pass 2 of 6", step line | `pass`, `max_passes`, `stage` (STEP words, `HudText.lua:57-63`) |
| _DSC0412.NEF; ISO 100 · 1/250 s · f/8 · 18.0-105.0 mm f/3.5-5.6 · lens profile on | `target.filename`, `.iso`, `.shutter`, `.aperture`, `.lens`, `.lens_profile` (formats per `engine/src/hud/payload.ts:61-93` and `hud-protocol.ts:32-33`) |
| This pass rows (label, before, after, delta) | `deltas[]` (`payload.ts:45`, 101-107) |
| guardrail line | `guardrail.status`, `.reason` (CLIPPING_OK when green with no reason) |
| W's info note, Warn, Problem's full note in the details | `note` (`hud-protocol.ts:104`) |
| undo line | `snapshot` (absent → HudText.UNDO_NO_SNAPSHOT) |
| This edit's settings summary | `settings.mode`, `.max_passes`, `.long_edge`: the edit's own values (`payload.ts:173-181`) |
| buttons back on | `answered_click_id` |

**Proposed** (engine, plugin or island additions). A new `hud_update` field needs a plugin release, because `hudUpdatePayloadSchema` is a `z.strictObject` (`hud-protocol.ts:83`) and the plugin refuses unknown fields (`hud-protocol.ts:11`). On the spec's channel (D3 option A) the new fields live in `hudChannelStateSchema` and the Lua `hud_update` stays unchanged (spec 3.3, 3.4).

1. **`note_kind: "info" | "warn" | "problem" | "cap_reached"` and `note_short`** (engine fields). `note_short` is the island's sentence for a problem note, instruction intact (section 6).
   - **Until they exist, the island maps notes itself** (proposed, fragile, because it keys on engine wording):
     - `/Click (Abort|Accept|Pick [ABC]) again/` → problem (`hud-actions.ts:156`, `:165`, `:207`, `:226`, `:263`); the short sentence is chosen by the note's start (`Abort could not` → `:156`, `Abort left` → `:165`, `Pick X did not go through, so` → `:207`, `Accept did not go through` → `:226`; `:263` is already short and is shown as sent);
     - `/^All \d+ passes are used\./` → cap_reached (`:290`);
     - `"Claude's last call failed; the edit is still open."` → warn (`:284`);
     - everything else → info. Examples: `:261` "Picked B: Claude continues on copy B at its next call.", `engine/src/session/approval.ts:156` and `:186` ("Pass 1 approved in chat: Claude goes on at its next call."), the work note "Making the virtual copies" (`engine/src/session/variants.ts:30`).
   - A cap flag (`cap_reached: true`) would let the island stop parsing the cap note.
2. **Variant labels** ("natural", "dramatic", "soft") per letter. The intent file has them (`engine/intents/landscape_golden_hour.json:9-11`), but the payload carries only the letters (`hud-protocol.ts:97`). Spec 3.3 `copies[].label`.
3. **Variant thumbnails.** The engine keeps each copy's last render (`v.last.jpeg`, `engine/src/session/variants.ts:107`); spec 3.6 delivers them over the channel (`get_thumb`), nothing on disk. The chip looks in the mockup are CSS filters approximating the copies' slider differences (`.cl-dramatic`, `.cl-soft` in `option-a.html`), not renders.
4. **Per-copy guardrail** for the chips (B's "corrected" note). The payload carries one `guardrail`, for the target's last pass (`payload.ts:45`). Spec 3.3 `copies[].guardrail`.
5. **"Whole edit" diff** since the pre-session snapshot (Profile, Highlights, Shadows, Clarity, Vibrance in Scene P). The engine holds the start settings (`payload.ts:62` uses `s.startSettings`), but no field carries a since-start diff. Spec 3.3 `whole_edit`.
6. **Slider ranges** for the mini tracks: min and max per Lightroom label (spec 3.3 `rows[].min`, `.max`, or island-side keyed by `engine/src/params/labels.ts`). A track is drawn only when before and after are both numbers and the setting is a slider; otherwise the row shows text.
7. **Row groups, order and in-panel labels.** Rows sit under Lightroom panel subheads in Lightroom's order: Basic, Tone Curve, HSL / Color, Color Grading, Detail, Lens Corrections. `deltas` arrive in the engine's change order (`payload.ts:45`, `last.changes`) with only the flattened label (`payload.ts:103`, `lightroomLabel`).
   - The group needs spec 3.3's `rows[].group` (E6), or an island-side map from the labels in `labels.ts`.
   - Inside a group the row shows Lightroom's in-panel label: "Amount" under "Detail · Sharpening", "Luminance" under "Detail · Noise Reduction", "Orange" under "HSL / Color · Saturation" (island-side: strip the group's words from the label). That the engine's labels are section + control, and that Lightroom shows the control name inside the section, is [inference from `labels.ts:25-33`, e.g. "Sharpening Amount", "Noise Reduction Luminance"].
   - Without a group (today's payload), the full label is shown and wraps; the row grows (`min-height`), drawn as the fit check's last row.
   - **Checkbox settings** ("Enable Profile Corrections", "Remove Chromatic Aberration") arrive as numbers 0 and 1 with delta "+1": the intent's priors are 0/1 (`landscape_golden_hour.json:7`) and `shown()` passes numbers through (`payload.ts:95-99`). The island shows them "off → on", with no track and no delta, and the label takes the track's column (island-side, keyed by label).
   - When do they appear? Only when the photo came in with them off. In real session 3133cd they were already on, so pass 0 listed four changes: Profile, Highlights, Shadows, Vibrance (`docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-3133cd.json`, pass 0 `settings_before` has `"lens.profile_enable":1,"lens.ca_remove":1` and `changes` has 4 entries). The details sheet draws the other case.
8. **Connection state, for D and Not running.** Not a payload field, and the island does not need the plugin for it:
   - D comes from the island's channel to the engine: closed, or 3 missed pings (spec 3.7).
   - Not running needs the proposed `lightroom` field ("connected" / "waiting" / "down", spec 3.3, E10), or, while the channel is down, the plugin's `bridge_status.json` (`Bridge.lua:52`, `:140-169`; spec 3.7).
9. **Selection, for "shown" in V.** The plugin already knows the selected photo: `catalog:getTargetPhoto` every `PERIOD_SECONDS = 2` plus the selection observer (`plugin/LrC-AVG.lrplugin/HudSelection.lua:25`, `:37`). The engine has a `get_selection` bridge command (`engine/src/bridge/protocol.ts:162`). Spec 3.5 (E7) polls it from the engine while idle and sends `selection` on the channel.
10. **History prefix "AVG 4f2a1c"** (the `short` id). The engine computes `short` as the session id without dashes, first 6 characters (`engine/src/session/begin.ts:107`), and names steps `AVG <short> pass n/N` (`engine/src/session/io.ts:148-151`). The island can derive it from `session_id` with the same rule. Spec 3.3 `history_prefix` keeps that rule in one place.
11. **Minus sign:** the island shows U+2212 ("−20"); the payload sends `String(c.delta)` with a hyphen-minus (`payload.ts:106`). Island-side formatting.

---

## 6. Copy

**Existing strings, used verbatim** (`plugin/LrC-AVG.lrplugin/HudText.lua`, unless another file is named):

- Headlines:
  - HEADLINE.converged "Your turn: Claude thinks the edit is done." (48)
  - HEADLINE.approve "Your turn: approve pass %d so Claude can go on." (47)
  - HEADLINE.not_connected "Claude is not connected. Your edit so far stays." (42)
  - HEADLINE.not_running (41), HEADLINE.none (40), HEADLINE.accepted (50)
- STEP words (58-62): "Starting" (W at begin), "Setting profile, lens corrections and baseline" (the details at pass0), "Applying pass" (+ " n of N", as `stepLine` builds it), "Waiting for your approval", "Claude is looking at the result", "Rendering a preview"
- UNDO "To undo it: Develop > Snapshots > %s" (72). The details split it after "Snapshots >" and show the name on the next line. The island in D keeps its prefix and shortens only the name.
- UNDO_NO_SNAPSHOT "the newest AVG pre-session snapshot" (73); the D island shows UNDO with it, verbatim.
- CLIPPING_OK "Clipping: within limits." (75)
- CLICK.sent "%s sent; waiting for Claude." (80) and CONNECTION.connected "Connected to Claude." (66)
- Button labels "Accept", "Abort" (`HudView.lua:207`) and "Approve pass n" (`plugin/LrC-AVG.lrplugin/HudState.lua:187`, bound at `HudView.lua:166`)
- "on" / "off" for checkbox values: the payload already uses them for booleans (`payload.ts:97`) and for `lens_profile` (`payload.ts:73`).
- Engine notes, shown as sent:
  - "Claude's last call failed; the edit is still open." (`hud-actions.ts:284`, the Warn state)
  - "Pass 1 approved in chat: Claude goes on at its next call." (`approval.ts:186`, W's info note)
  - "Pick B did not go through. Click Pick B again." (`hud-actions.ts:263`, already short)
  - "Claude's pass 2 waits for your Approve of pass 1." (`approval.ts:156`)
  - Every problem note in full, in the details.
- The guardrail sentences "Shadow clipping was 3.47 % (limit 1 %); corrected." and "<Label>: not changed, it would push clipping over the limit." follow `payload.ts` `hudGuardrail` (F19).
- Not drawn but used by the state table: HEADLINE.target_changed, HEADLINE.checking, HEADLINE.gone, HEADLINE.aborted, HEADLINE.ended and CLICK.no_answer.

**New strings, all proposed:**

- "Working"
- "pass 2 of 6" (the island's lower-case form; only from pass 1 up)
- "Setting the baseline" (W at pass0; short form of STEP.pass0)
- "Your turn: pick a copy". This is the first clause of HEADLINE.awaiting_pick (`HudText.lua:46`), which the details show in full.
- "Your turn". The short form for C, Cap reached, P and V in narrow windows, and the compact row.
- "Your turn: all %d passes are used." The Cap reached sentence, from the engine's cap note.
- Problem sentences (the island's `note_short`; the details keep the engine's note):
  - "Abort did not go through. Click Abort again." (for `hud-actions.ts:156`)
  - "Abort did not finish. Click Abort again." (for `:165`)
  - "Accept did not go through. Click Accept again." (for `:226`)
  - "Pick B did not go through. Click Pick B, then Accept." (for `:207`)
  - Narrow form: the instruction alone, e.g. "Click Abort again."
- "Click to abort again." (the pre-armed Abort's callout) / "Click again to abort." / "Press Ctrl+Backspace again to abort."
- "To undo it: Develop > Snapshots > …18:42:07" and "To undo it: Develop > Snapshots…": the island's short forms of UNDO.
- "Pass 1 of 6 · Waiting for your approval", "Applying pass 2 of 6" and the bare STEP words: today's "Step:" line recomposed, with stepLine's pass rules.
- "This pass" / "Whole edit"
- Panel subheads: "Basic", "Tone Curve", "HSL / Color · Saturation", "Color Grading · Shadows", "Detail · Sharpening", "Detail · Noise Reduction", "Lens Corrections". Lightroom's own panel and section names [inference for the section names; the panel names are the ones the stage draws after Jim's screenshot].
- "Each step in History starts with “AVG 4f2a1c”." The prefix is `AVG <short>` (`engine/src/session/begin.ts:107`; step names from `engine/src/session/io.ts:148-151`). A copy's steps add its letter, "AVG 4f2a1c B pass 0/6", so they still start with the prefix.
- "This edit's settings" / "For the next edit: File > Plug-in Manager" (the edit's settings were copied into it at begin, `engine/src/session/begin.ts:117`, and are read from there, `engine/src/session/approval.ts:40`; today's HUD says the same with "Session settings:" vs "Settings page (the next session reads them):", `HudView.lua:152`)
- "Change in File > Plug-in Manager" (the idle row only, where the page's values are shown)
- "Approve each pass · up to 6 passes · preview 1600 px" / "Autonomous · up to 6 passes · preview 1600 px"
- "closes" (after the Esc keycap)
- "shown" (the copy in the loupe)
- "Hide" (the ×'s accessible name and tooltip; the × itself has no text)
- Consequence lines: "Ends the edit; the sliders stay as they are." / "Stops Claude and puts the pre-session snapshot back." / "Stops Claude and puts the master back; copies A, B and C stay in the catalog." (Variants) / "Lets Claude write pass 2." / "Claude continues on this copy."
- Chip labels "A natural" / "B dramatic" / "C soft" (data, from proposed field 2)

**Vocabulary check:**

- The HUD says edit, copy, pass, snapshot, History, Clipping, master. It never says session, engine, stage, seq, payload or chevron.
- "Master" appears only in the Variants Abort consequence. It is the word the engine and the end result use for the original photo (`end.ts:4-5`); whether photographers read it as Lightroom's "master photo" of a virtual copy is [inference].
- The one exception is "pre-session", which is part of the snapshot's real name ("AVG pre-session " + ISO time, `engine/src/session/begin.ts:49`), the name the photographer sees in the Snapshots panel.
- The captions on the sheets name stages and fields because they are for Jim, not for the HUD.

---

## 7. Changes to the shared design system, and to the shared stage

These are refinements within the shared design system:

- **The Variants island is 44 px tall, not 48.** The island's top edge is fixed at y 65 rather than centred by height (section 1).
- **The island has no shadow at rest.** The 1 px line border separates it from the black band. The brief's single shadow (0 10px 30px rgba(0,0,0,.45)) stays on the drop-down and the callouts, which float over the loupe.
- **Opacity is used in two places only:** the working halo (35 %, the pulse frame) and the accent segment on the mini tracks (60 %, as briefed; it blends to #9b7038 on bg). The HUD surface itself is fully opaque.
- **Tabular figures apply to digit runs only** (`tnum()` in `option-a.html`). Inter's `tnum` also widens the hyphen: at 12 px, "-" measures 6 px plain and 8 px with tnum, and "pre-session" measures 67 px and 69 px (`node option-a/hyph.cjs $PWD/option-a/tnum-hyphen-check.html`, run from `hud/`, printed `Inter:loaded | a 67.00 b 69.00 c 6.00 d 8.00`).
- **Buttons:**
  - Abort's hairline is the `line` token. Armed and pre-armed Abort use a `danger` hairline at the same size.
  - The secondary button (Accept in the details) is `raised` with a `line` hairline and `text` label.
  - Buttons that are off are text3 with a `line` hairline and no fill.
  - The × is a text3 glyph on bg, 24 x 24, no hairline.
  - Focus rings are a 2 px `text`-colour outline, offset 2 px (1 px on chips).
- **Details rows (redrawn for this review):**
  - Columns in a 408 px content width: label 150 (8 px of it a gap), track 110, before → after 92, change 56.
  - Rows are at least 24 px and grow when a label wraps.
  - Panel subheads are 11 px text3 caption rows (the brief allows 11 px for captions). The first group's subhead shares the diff header row with the This pass / Whole edit switch.
  - A text value (Profile) spans the track, before → after and change columns. A checkbox row's label spans the label and track columns; its value sits in the before → after column.
- **Mini track:**
  - The track is 2 px in `line`, 98 px between its end pads. There is no centre tick.
  - Before is a 1 x 8 text3 tick above the track. After is one filled `text` thumb below it, pointing up as Lightroom's thumbs do.
  - The accent segment between them is 4 px tall and at least 4 px long. One unit is 0.49 px now, so +4 alone would be 2 px; the minimum keeps a direction visible. At small deltas the tick and the thumb nearly coincide; the signed number carries the size.
  - The range is -100 to 100 for every slider shown (proposed field 6 replaces it).
- **Chips:**
  - The copy in the loupe gets a 2 px `text` underline under its label and an 11 px "shown" (dropped in narrow windows; the underline stays).
  - The thumbnail looks are local classes in `option-a.html`.
- **Shared stage, changed in round 2 for every option** (`stage/stage.js`): History shows only names the engine writes (`io.ts:148-151`, `guardrail.ts:48` and `:177`); unchanged in this round.
- **Option A stage tweaks** (`option-a.html`):
  - `toPass2()` sets Vibrance +12 and Clarity +3 and the History rows "AVG 4f2a1c pass 2/6", "… pass 1/6", "… pass 0/6 baseline 1", "… pass 0/6", Import, for Scenes W and C.
  - `lr()` blanks the stage's histogram focal-length cell ("18 mm"). The payload has no focal-length field (`hud-protocol.ts:58-67`).

---

## 8. Checks run

- **Renders** (`render.cjs` printed, no page errors or failed requests):
  - `option-a-context.png 1920x1080`, `option-a-context-open.png 1920x1080`
  - `option-a-states.png 2400x5614`, `option-a-details.png 2400x5674`, `option-a-widths.png 2424x2802`
- **Looked at:** every PNG with the Read tool, and `zoom.cjs` crops of the details sheet (both W views, P Whole edit, the fit check) and both halves of the states sheet.
- **Details layout** (audit "overlaps", "rowsChecked"): 0 overlaps over 45 adjacent pairs of step lines, notes, header rows, group captions, diff rows and guardrail lines, including the fit check's wrapped "Noise Reduction Luminance" row and its two-line guardrail sentence.
- **Step lines** (fit check, drawn): "Setting profile, lens corrections and baseline", "Pass 12 of 12 · Claude is looking at the result", "Applying pass 2 of 6" and "Pass 99 of 99 · Rendering a preview" each fit on one line at 440 px.
- **Callouts** (audit "tipOverhangRightLeft"): all 4 drawn callouts stay within their island's span.
- **Vertical alignment** (`node review-a-r2-crops/probe2.cjs`, run from `hud/`): island y 65 h 40 cy 85; identity text cy 85; module label cy 88; toggle y 55-59.
- **Placement in narrow windows:** every island in `#widths` starts at x 360 or later and ends 24 px or more before "Library" (captions print span and shift).
- **Type sizes in the HUD** (audit "sizes"): 11/400, 11/500, 12/400, 12/500, 13/500, 13/600, 15/600. 11 px is used only for keycaps, "closes", the settings captions, "shown" and the panel subheads.
- **Colours in the HUD** (audit "colors" and "svg"): only token values appear, plus the window shadow: #202122, #2a2b2d, #161718, #3a3b3e, #e4e6e8, #aeb2b6, #8d9196, #eda447, #1d1305, #86c296, #ee8064, #9fb7d4.
- **Overflow:** the audit printed no "OVERFLOW" and no "TRUNCATED" lines. The info-note row (556 px) fits its 360 px cap.
- **Contrast** (`node <scratchpad>/contrast.cjs '<pairs json>'`, output from round 2; no new colour pairs this round: the × and the subheads are text3 on bg):

| Pair | Ratio |
|---|---|
| text on bg | 12.89 |
| text2 on bg (notes, chip labels, Warn triangle, D undo line) | 7.56 |
| text3 on bg (off buttons, before tick, ×, panel subheads) | 5.09 |
| text on raised (secondary Accept) | 11.33 |
| text2 on raised ("shown" on a hovered chip, callouts) | 6.64 |
| text2 on inset | 8.41 |
| on-accent on accent | 8.72 |
| danger on bg (Abort, armed hairline) | 6.07 |
| danger on raised (armed callout border and glyph) | 5.34 |
| ok on bg | 7.81 |
| working on bg | 7.83 |
| accent 60 % over bg (track segment, #9b7038) | 3.66 |

The non-text pairs are low:

| Pair | Ratio |
|---|---|
| line on bg | 1.44 |
| line on black band | 1.88 |
| bg on black band | 1.30 |

The island's edge, Abort's hairline and the track line sit below WCAG's 3:1 for non-text contrast. All three controls are identified by their text (6.07:1 and up) or by the numbers beside them, not by the outline. This is a trade-off, flagged here.

---

## 9. Trade-offs

**For it:**

- Nothing covers the photo or any panel at rest.
- The turn is one line, readable from anywhere near the top of the screen.
- Variants pick is one click or one key, with the three looks side by side and the copy in the loupe marked.
- In Develop, Lightroom's own Snapshots and History panels stay visible, so the way back is on screen as well as named in the details. In Library, the module in Jim's screenshot (F22), neither panel is shown [inference], so there the details' undo line is the only place it is named.

**Against it:**

- **Not LrView, against two stated rules.** `PRODUCT.md:40` (principle 5, "Native first") and the accessibility line `PRODUCT.md:45` ("Native LrView controls and Lightroom's text sizes") both describe the floating dialog's world. The Island looks like an instrument, uses Inter at 11-15 px, and needs its own window and runtime (section 10). Choosing it means amending PRODUCT.md:45 as well as principle 5. The spec drafts both amendments (D1, "Proposed amendment to PRODUCT.md"); Jim decides.
- **Band geometry is not known to the plugin.** The SDK has no API for the identity plate's width, the activity indicator's width, the module picker's position, the side panels' widths (the loupe centre) or whether the top panel is shown [unverified]. Without them the clamp rule works from the window rectangle and assumed widths, which is a heuristic. S9-14 and S9-15 (section 10) test whether the island can read them from the window itself.
- **The identity zone costs width in narrow windows** (section 1): about 126 px of free span compared with clamping to the plate text, for an indicator whose width is [inference].
- **Abort is not in the row at rest in W, Warn and V.** It is one click under the chevron (a real button in the details footer), on Ctrl+Backspace, and in the menu (`Info.lua:33`). That is "findable", as principle 4 asks (`PRODUCT.md:39`), but less visible than in Rail or Deck. Pointer Abort also costs one more click, the price of the confirm, except after a failed Abort.
- The 54 x 36 thumbnails remind; they do not let you judge a copy. Judging happens in the loupe or the filmstrip, and "shown" says which copy is there.
- The 15/600 near-white sentence is louder than Lightroom's own band text (15 px #898a87 [stage]). This is deliberate for "Your turn", and W uses a quieter 13/500.
- **Narrow windows lose words before actions** (section 1). Below 1178 px every turn is the compact row.
- **The keyboard way into the island depends on S9-13.** If Windows refuses the activation, the keyboard route is the classic HUD, a second-look window.

---

## 10. Host: the island's own window (decision for Jim)

**Why it leaves the floating dialog:**

- `LrDialogs.presentFloatingDialog` gives a titled window (`plugin/LrC-AVG.lrplugin/Hud.lua:99-100`). Its known arguments do not include position, frameless or no-activate (F13, `docs/reports/phase5/S8.md` ~line 70).
- Community bug reports (titles only; content unread from this container):
  - "Floating dialogs always in back, never in front, in screen mode > full screen on Windows" (https://community.adobe.com/t5/lightroom-classic-bugs/p-sdk-floating-dialogs-always-in-back-never-in-front-in-screen-mode-gt-full-screen-on-windows/idi-p/15360555);
  - "Floating dialog will not come to the front when Develop, Book or Print modules are active" (https://community.adobe.com/t5/lightroom-classic-discussions/floating-dialog-will-not-come-to-the-front-when-develop-book-or-print-modules-are-active/td-p/15605832).

**Candidate runtimes:**

| Runtime | Stack rule (`CLAUDE.md:25`: "Lua for the plugin, Node ≥ 22 / TypeScript for the engine") | Show without activation | Handles |
|---|---|---|---|
| **Electron 44.5.1** (the spec recommends trying it first) | TypeScript, but a third program with its own Chromium. It still needs a rule-01 line. | `showInactive()` | `scratchpad/hud/research/electron/package/electron.d.ts:3646` (`npm pack electron@44.5.1`). `parent?: BaseWindow` (`:4004`) takes only another Electron window. Win32 calls (foreground hook, SetWindowPos) through koffi (`research/koffi-3.3.2.tgz`). |
| **Tauri 2.12.1** | Adds **Rust** | Only the first show skips activation; later shows need a Rust `ShowWindow(SW_SHOWNA)` | F24; spec D2 table. `parent` takes another Tauri window's label only (F24, `scratchpad/tauri-config.rs` ~2049-2173). |

Either way it is a stack-rule decision for Jim, and the spec's spike S9 (D2) measures it.

**Who starts it, and where its state comes from (follows spec D3 option A; spec 3.2, 3.3, 3.7):**

- The engine that holds the bridge lock opens a HUD channel on 127.0.0.1 and writes `%USERPROFILE%\.lrc-avg\hud_endpoint.json` (spec 3.3, proposed). The island connects to it.
- At `lr_begin_session`, if no island is connected, the engine spawns it with `detached: true` and `windowsHide: true` (spec 3.2). Node's docs: on Windows, `detached: true` "makes it possible for the child process to continue running after the parent exits" (`research/node-child_process-v22.md:920-923`). So the island outlives the engine. Whether Claude Desktop kills a detached grandchild when it quits (for example through a job object) is [unverified]; spec S9-9 and acceptance A6 test it.
- **D is shown exactly then:** when the channel closes or misses 3 pings (6 s), the island keeps its last state and shows HEADLINE.not_connected with the undo line and the actions off (spec 3.2, row "Claude Desktop or the engine exits mid-edit"; 3.7). That is today's rule (`HudView.lua:76-81`, `:158`).
- **Gone:** a new engine's `welcome` names another edit or none, so the island shows HEADLINE.gone and the undo line at once (spec 3.2).
- **Not running:** from the proposed `lightroom` field on the channel (spec 3.3, 3.7, E10), or, while the channel is down, from `%TEMP%\LrC-AVG\bridge_status.json` (`Bridge.lua:52`, `:140-169`), treating a stale file as unknown (spec 3.7).
- **Lightroom gone:** when Lightroom's main window is gone, the island hides and exits (spec 3.2, 3.7).
- **The island never connects to the plugin's sockets.** The plugin serves one client at a time and rebinds its send socket for each new one, so a second client would take the bridge from the engine (`engine/src/mcp/instance-lock.ts:1-3`; `plugin/LrC-AVG.lrplugin/Sockets.lua:53-62`, `bindReceive`'s `onConnected`). Round 2's "it needs its own connection to the plugin's socket" and "D can never be shown" were wrong and are withdrawn.
- **D3 option B (a third LrSocket pair in the plugin) is not argued for.** It needs a plugin release and two more ports, Lua would relay state it does not own (and images), it pauses with Lightroom's menus, and a send socket did not fire `onClosed` on disconnect (spec D3, "Against B").

**Z-order rule (proposed; [inference] until S9-7):**

- **The island is visible exactly where Lightroom's main window is visible.**
- While Lightroom or the island is the foreground window, the island is topmost. Detection: EVENT_SYSTEM_FOREGROUND, `research/md_event-constants.md:148`.
- When another app comes to the front, the island drops to sit directly above Lightroom's window, so whatever covers Lightroom covers it. It never floats over Claude Desktop, the app the photographer reads the chat in (F21).
- Mechanism: `SetWindowPos` with `hWndInsertAfter` set to the window just above Lightroom, plus SWP_NOACTIVATE. The docs say "If a topmost window is repositioned … after any non-topmost window, it is no longer topmost" (`research/md_nf-winuser-setwindowpos.md:366`). Finding "the window just above Lightroom" with GetWindow is [unverified].
- **Not HWND_NOTOPMOST.** That flag "Places the window above all non-topmost windows" (`research/md_nf-winuser-setwindowpos.md`, HWND_NOTOPMOST row). Demoting the island with it after Claude Desktop is activated would leave the island above Claude Desktop [inference from that text].
- **Not ownership.** Making Lightroom's window the owner would give the right z-order and hiding: "An owned window is always above its owner … hidden when its owner is minimized" (`research/md_window-features.md:187-189`). But the spec (4.3, "Not chosen") warns it attaches the two threads' input, so a hung island could stall Lightroom's input; `research/md_nf-winuser-attachthreadinput.md:94` describes what attached threads share [inference].

**Lightroom states:**

| Lightroom | Island |
|---|---|
| Minimised | Hidden (EVENT_SYSTEM_MINIMIZESTART, `research/md_event-constants.md:154`); shown again without activation on restore |
| Covered by another app | Covered with it (rule above) |
| Moved, resized, other monitor | Follows the window rectangle (EVENT_OBJECT_LOCATIONCHANGE, `research/md_event-constants.md:121`). The clamp rule reruns on every resize. |
| Top panel hidden (a full-screen screen mode, or the panel toggle / F5) | No SDK call reports it [unverified: none found]. **Proposed S9-14:** read the band's rectangle from Lightroom's window, by UI Automation on the module-picker row or by sampling a window capture for the black band [unverified: whether either works on LrC]. **Default when the band is absent or unknown:** the state's compact form (glyph + short words + chevron) 8 px inside the loupe's top-right corner. At Fit that is surround, but zoomed in or on a photo that fills the loupe it covers the photo's corner [inference]. The alternative, handing off to the classic HUD, is not the default because that window takes the keyboard when it opens (`S8.md:183`). Open question 3. |
| Exports during a pass | LrC's activity indicator takes the identity-plate area. **Proposed S9-15:** measure its width during an export on Jim's machine; the identity zone (360 px, section 1) is set from it. |
| Lights Out (L) | Lightroom dims its own UI, but not a separate window above it [inference]. Lights Out cannot be detected [inference], so the island stays at full brightness. Pressing Esc hands focus back but does not hide it. Open question 9. |
| Other modules (Library, Map, …) | Stays: the band is the same in every module [stage]. |

**Proposed additions to the spec's S9 table** (D2; each [inference] until measured on Jim's machine):

| # | Question | Target | Measure |
|---|---|---|---|
| S9-13 | Cross-process activation from a menu item: the plugin relays "Show Vision Gateway HUD", the engine tells the island, the island activates itself | foreground is the island on 20 of 20; Jim: "1" then picks copy A, 3 of 3 | `GetForegroundWindow` before and after; Jim y/n. Handle for the risk: `research/md_nf-winuser-setforegroundwindow.md:92-100`. |
| S9-14 | Top panel shown or hidden, and the band's rectangle | correct on 10 of 10 toggles (panel toggle, F5, each screen mode) | UI Automation tree or window-capture sample, logged against Jim's y/n |
| S9-15 | Width of LrC's activity indicator during an export | reported, in px at 100 % scaling | window capture during an export |

---

## 11. Open questions for Jim

1. **Runtime and data path:** Electron (TypeScript, its own Chromium) or Tauri (adds Rust) for the island's window, decided by S9? This design follows spec D3 option A: the engine hosts the channel and spawns the island detached; the island never talks to the plugin's sockets. Either runtime needs a line in rule 01 (`CLAUDE.md:25`) and amendments to `PRODUCT.md:40` and `:45` (sections 9, 10).
2. **Anchor:** the loupe centre with clamping (chosen and drawn) or the free-space centre (x 893 in the stage with the 360 px identity zone)?
3. **Hidden top panel:** the compact row 8 px inside the loupe's top-right corner (this design's default), or the classic HUD? Only S9-14 can tell the island which case it is in.
4. **Thumbnails:** the engine's last render (exact, spec 3.6) or none? Dropping them keeps V at 40 px and narrows it by about 190 px.
5. **Accept in V:** absent (this design) or greyed out (today's HUD)?
6. **Hiding:** this design puts a × only on Done and the idle row, so Abort and the way back cannot be hidden mid-edit (principle 4, `PRODUCT.md:39`). Should a hidden Done come back on the next turn of a new edit only (as drawn), or should a hidden island re-show on every turn (spec Q13)?
7. **`note_kind` and `note_short`:** add them to the engine (recommended), or accept the island-side wording match (section 5, item 1)?
8. **Pointer Abort confirm:** this design arms on the first click (section 3), except after a failed Abort. Keep today's one click instead?
9. **Lights Out:** stay visible (this design), or hide when Lightroom is in Lights Out, if a way to detect it is found?
10. **Keyboard way in:** if S9-13 fails, is the classic HUD from "Show Vision Gateway HUD" an acceptable keyboard route (this design's fallback), or should keyboard use stay in the menu items only (spec Q4)?

---

Under the privacy rule, nothing from Jim's screenshot (`lr.webp`) appears in any output. The photo is the stage's placeholder `stage/photo.svg`.
