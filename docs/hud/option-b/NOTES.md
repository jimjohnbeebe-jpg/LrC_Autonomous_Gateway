# Option B "Rail": notes

The Rail is a Lightroom-style panel stack for the left panel column of the Develop module, where Navigator, Presets, Snapshots, History and Collections normally sit. It uses Lightroom's own panel chrome, so it reads as a second set of module panels.

It has two forms:

- **Docked (the default).** The "Claude Edit" title row and the action panel sit at the bottom of Lightroom's left column, above Copy... / Paste. Lightroom's own panels stay visible above it.
- **Full rail.** It covers the whole column, adding identity, Changes, Undo and Edit Settings above the same action panel. It opens only when the photographer asks for it (Forms and pin).

The action panel is anchored to the column's bottom edge in both forms. So Abort is at the same place on screen in every state and in both forms. The rail never changes form by itself.

It also needs a separate window process. That conflicts with two of Jim's written rules (see Build cost).

Handles: repo paths are relative to `the repo root` at `main` 75369b7 (`git log --oneline -1`). Scratchpad paths are relative to `scratchpad/hud/`. Anything with no handle is tagged [inference], [unverified] or "proposed".

## Revision 3: review findings applied

| Finding | What changed |
|---|---|
| High: auto-expanding put Abort under the pointer | **The rail never changes form by itself.** Unpinned, it is docked, and a turn grows the docked panel in place, upward from its bottom edge at y 900. The action panel is now anchored to the column's bottom in the full rail too. So **Abort is 52 px above the column's bottom edge in every state and in both forms: 23, 848, 72 × 24 at 1920 × 1080.** Accept keeps 23, 800 in W, P, V, D and Abort failed. The primary keeps 23, 729 in P and V (`checks/geometry.cjs`). Key hints now sit above the buttons, so gaining focus moves no button either. A proposed 500 ms input guard was added. The pin now means "keep the full rail for the next edits". |
| Medium: Pick took Lightroom's selection, which Claude had set | At `awaiting_pick` no card is chosen. The primary is drawn off as "Pick a copy" with "Click a copy to choose it." A card is chosen only by a click or 1/2/3 in the rail, or by a selection change the photographer makes after the stage arrives. The engine's own `select_photo` calls are ignored (Proposed addition 4, now with the rule). The default V state is drawn in context, with Lightroom still on copy C. |
| Medium: keyboard model vs `WS_EX_NOACTIVATE` | `WS_EX_NOACTIVATE` is dropped. The window is shown without activation (Tauri `focus: false`, or `SW_SHOWNOACTIVATE`) and moved with `SWP_NOACTIVATE`. A deliberate click activates it normally, and Esc hands activation back to Lightroom. All [inference, untested]. Build cost and Open question 2 are rewritten. |
| Medium: Abort failed led with "Claude is working" | `note_level: "act"` is now defined in the rail. The note becomes the turn sentence (15/600, triangle), the chip reads "Your turn", and the strip shows. There is no filled primary when the action is Abort. For `cap_reached`, Accept is the primary. Both are drawn (`states-extra` columns 1-2). Today's engine output is in a footnote under States. |
| Medium: the note repeated the headline | Proposed addition 11: the engine sends no idle note where the stage headline already says it. Every frame is drawn in that target state, except one labelled "today's engine" (`states-extra` column 5). In converge Done, the freed note slot shows the undo path. |
| Low: D title row squeezed | Title-row children no longer shrink. The chip is tighter (6 px padding, 10 px glyph) and the icons are 18 px with 4 px gaps. D measures icons 218+18, 240+18, 262+18 and chip 106+106 in the 284 px row. `check-b.cjs` now fails when a title-row child is squeezed. Negative test: with revision 2's chip padding and shrinkable icons, it reported D's three icons at 16.6 px. |
| Low: scroll thumb over the chosen card | The card list keeps a 6 px gutter on the right. The chosen card's frame ends at x 278, and the thumb is at x 279-283 (`x-vs`). |
| Low: selection looked like focus | A chosen card now has Lightroom's selected-row look: a `btn` fill, a 1 px hi frame and, with focus, the filled keycap. The 2 px hi ring is for keyboard focus only. |
| Low: a dot at the end of a summary line | Each "·" is bound to the item before it, the line breaks after it, and a dot left at a line end is hidden (`checks/dots.cjs`: `visibleEndDots` 0 in all 10 summaries drawn). |
| Low: before mark unreadable, track half Lightroom's width | The track is now 120 px (x 76-196). The after value sits where Lightroom puts its value, and the delta is to its right. Before → after shows on hover or focus as a tooltip (`rows` column 1). The before hairline starts 6 px above the groove, so it clears the thumb. |
| Low: folding Changes hid the guardrail | When `guardrail.status` is not green, the Changes header's right text becomes a triangle plus a short phrase, folded or open (`rows` column 1, lower). |
| Low: History wording | "History: steps named AVG 4f2a1c pass n/6". Variants: "each copy's steps, named AVG 4f2a1c B pass n/6". |
| Low: which photo holds the snapshot | Variants Undo panel: "Develop > Snapshots, on the master _DSC0412.NEF". The same wording is specified for the D and `gone` undo line in Variants mode. |
| Low: step line exceptions | `applying` reads "Applying pass 2 of 6", and `pass0` has no pass count, as in `HudView.lua` `stepLine` (`plugin/LrC-AVG.lrplugin/HudView.lua:83-89`). |
| Low: danger at 11 px | Added a refinement row: danger at any size on header #292929 (6.39:1). |
| Low: "baseline" on card A, basis mixed | Each card line is the copy's look, from the intent's variant priors (`engine/intents/landscape_golden_hour.json:9-11`). A reads "No look added". |

Revision 2 changes that still hold: the note line, the measured row groups and fallbacks, the hairline-plus-thumb marks, keycaps only with focus, real History names, and the Build cost section. Revision 2's sticky action block, its auto-dock/auto-expand pin, and its "change from the shared baseline" card basis are replaced by the rows above.

## Files

| File | What |
|---|---|
| `option-b/option-b.html` | Every frame. Ids: `#ctx-approve`, `#ctx-variants`, `#ctx-collapsed` (1920 x 1080, in context); `#states`, `#states-more`, `#states-extra`, `#rows` (close-ups on #2b2b2b). |
| `mockups/option-b-context.png` | Scene P, full rail (the photographer expanded it), not focused. Scale 1, 1920 x 1080. |
| `mockups/option-b-context-variants.png` | Scene V as it first appears: docked, no copy chosen, and Lightroom still on copy C, the copy Claude stepped last. Scale 1. |
| `mockups/option-b-context-collapsed.png` | Scene P docked (the default form). Lightroom's Snapshots and History stay visible. Scale 1. |
| `mockups/option-b-states.png` | Full rail: W (pinned), P focused, V focused with B chosen by pressing 2, D. Scale 2, 2768 x 1832. |
| `mockups/option-b-states-more.png` | C converged, W with Abort armed, Done (converge), W docked over a crop of the stage. Scale 2. |
| `mockups/option-b-states-extra.png` | Abort failed (`note_level: "act"`), all passes used (docked), P with `approve_pass` while a preview renders, V in a shorter window (480 px column), P as today's engine sends it. Scale 2, 3448 x 1832. |
| `mockups/option-b-rows.png` | Changes: This pass with a hovered row, Changes folded with a guardrail warning, Whole edit, worst-case grouped rows, the two-line fallback. Pick a Copy with nothing chosen, and with B chosen and focus. Scale 2. |
| `option-b/checks/check-b.cjs` | Layout check: info-panel fill, text past the column, clipped text, text under 11 px, overlap between the parts of every Changes row (37 rows, worst cases included), squeezed title-row children (16 title rows), colours used. Run `node option-b/checks/check-b.cjs option-b/option-b.html`. Last run: `"overflow": []`, `"small": []`, `"rowOverlap": []`, `"titleSqueezed": []`. |
| `option-b/checks/geometry.cjs` | Measured placement, button positions from the column's bottom edge, docked heights, Lightroom's own left-column rows in the stage, and window heights. The numbers below come from it. |
| `option-b/checks/dots.cjs` | Which summary items share a line, and whether a separator dot shows at a line end. |
| `option-b/checks/measure.cjs` | Text widths in the rail's type, used to size the row grid, the chip and the cards. |
| `option-b/checks/tnum.cjs` + `tnum.html` | Inter glyph widths with and without `tnum` (see Type). |

Render: `node render.cjs option-b/option-b.html mockups/<name>.png --selector="#<frame id>" [--scale=2]`.

## Placement

The anchor is `LR_REGIONS.leftPanel`. Values are root-relative CSS px at 1920 x 1080 (`stage/stage.js` FIXED.leftPanel), measured by `checks/geometry.cjs`.

| Part | x, y, w, h | Notes |
|---|---|---|
| Full rail | 0, 112, 300, 824 | Covers the whole left panel region, including Lightroom's Copy... / Paste bar. |
| Panel column | 11, 112, 284, 788 | A 28 px title row, then the info panels (they scroll), then the action panel, anchored to the column's bottom at y 900. |
| Edge | 0, 112, 10, 824 | Draws Lightroom's left-pointing panel triangle at y 520, as the stage does (`stage.js` `tri('left', 'left:2px;top:408px')`). |
| Footer, the connection line | 0, 900, 300, 36 | Full rail only. It sits where Lightroom keeps Copy... / Paste. |
| Docked panel | 11, 900 − h, 284, h | The title row plus the same action panel. Its bottom edge is at y 900, above Lightroom's own Copy... / Paste. |
| "Your turn" strip | x 296, 2 px wide | Only in turn states. It runs the full rail's height, or the docked panel's height. |
| Primary button | 23, 729, 260 x 32 | P and V, both forms. |
| Accept (secondary) | 23, 800, 72 x 24 | W, P, V, D, Abort failed, both forms. In C and at `cap_reached`, Accept is the primary. |
| **Abort** | **23, 848, 72 x 24** | **Every state that has it, both forms.** It is always the action panel's last row, and every action row is a fixed 40 px tall. |

Measured from the column's bottom edge (`checks/geometry.cjs` `fromBottom`), Abort is at 52 px in all 15 rails and docked panels drawn. Accept is at 100 px wherever it is a secondary button. The primary is at 171 px in P and V; in C it is at 139 px.

**Docked panel height per state**, and its top edge in context:

| State | Height | Top edge (y) | Lightroom rows left visible in the stage |
|---|---|---|---|
| W | 208 | 692 | All of them. Collections' header ends at y 552. |
| P | 263 | 637 | All of them. |
| All passes used | 195 | 705 | All of them. |
| V | 490 | 410 | Navigator, Presets and the Snapshots row (y 384-405, the pre-session snapshot). History and Collections are covered. |

W to P grows the panel 55 px upward. Lightroom's History stays visible in both, so in approve-each-pass mode History no longer appears and disappears on every pass. Docked V uses 64 x 43 thumbnails and no "Pick a Copy" header, so that it stops below Lightroom's Snapshots row. The panels a photographer keeps open vary, so what the panel covers in their window varies too [inference].

**Full rail: column needed per state** (title row + info panels + action panel), and the Lightroom window height at which the info panels show without scrolling. The window height adds the stage's chrome around the column: 112 px above (title bar, menu, top band) and 180 px below (bottom bar 36, filmstrip 144).

| State | Action panel | Column needed | Window height, no scroll |
|---|---|---|---|
| W (Edit Settings open) | 180 | 674 | 966 |
| P, focused | 261 | 661 | 953 |
| P, not focused | 235 | 635 | 927 |
| V, focused, B chosen | 523 | 816 | 1108 |
| C | 203 | 603 | 895 |
| D | 202 | 602 | 894 |
| Abort failed | 202 | 602 | 894 |
| Done | 82 | 482 | 774 |

The action panel never scrolls. When the column is short, the info panels scroll first. In V, the card list then scrolls too, and the turn sentence and every button stay in place. The frame `x-vs` draws V with a 480 px column (a window of 772 CSS px at this chrome): the info panels are scrolled away, A and B are visible, C starts below, and the card list shows its thumb. At 125 % Windows scaling, a maximised 1080 px window is about 830 CSS px tall [inference: 1080 / 1.25 minus a 48 px taskbar, unmeasured]. So V's info panels scroll there and its buttons stay put.

Nothing in the stage moves. The rail covers only the left panel region, so the loupe, the photo, the right panel, the toolbar and the filmstrip (with copies A, B, C) stay as they are.

## Forms and pin

- **Docked is the default.** Each edit opens docked, unless the photographer pinned the full rail. The rail opens itself once, at `lr_begin_session` (`open: true`, `engine/src/bridge/hud-protocol.ts:87`), as the current HUD does (`plugin/LrC-AVG.lrplugin/Hud.lua:9-11`).
- **The rail never changes form by itself** (proposed). A turn, a problem or an end stage changes only the docked panel's content. The panel grows or shrinks upward from its bottom edge, so Accept and Abort keep their screen positions. Only the sentence, the cards and the primary appear above them.
- **The full rail opens only on request.** That is the dock glyph in the title row (accessible name "Show the full rail"), or the pin. "Show Snapshots and History" in the Undo panel, or the dock glyph again, goes back to docked.
- **The pin** (proposed) means "keep the full rail". When pinned, every edit opens as the full rail. When unpinned, an expansion lasts until the edit ends, and the next edit opens docked. The W sheet column is drawn pinned.
- **Input guard** (proposed, UI only). For 500 ms after a control appears or moves under the pointer, a click on it is ignored. Examples: the title row's icons and the cards when the docked panel grows, or the primary when a turn arrives. The panel's fixed rows (Accept, Abort) do not move, so the guard rarely applies to them. A click on a card only chooses it, and the Pick primary stays off until a card is chosen. So even a click the guard lets through cannot send `hud_pick`.
- × hides the rail until the next edit opens it, or until File > Plug-in Extras > "LrC-AVG - Show Vision Gateway HUD" (`plugin/LrC-AVG.lrplugin/Info.lua:22-27`).

## States shown, and what triggers each one

The stages are from `HUD_STAGES` (`engine/src/bridge/hud-protocol.ts:40-43`). The headline logic mirrors `HudView.lua` `headline()` (`plugin/LrC-AVG.lrplugin/HudView.lua:61-72`). Frames show the engine with Proposed addition 11 (no idle notes that repeat the headline), except `x-today`.

| State | Trigger | Chip | Action panel, top to bottom |
|---|---|---|---|
| **W** Working (`states`; docked in `states-more`) | `begin`, `pass0`, `applying`, `acquiring_preview`, `metrics`, `awaiting_claude`, with no `approve_pass` and no "act" note | ring, "Working" | Ring + headline, step line, note if any; Accept and Abort |
| **P** Approve (`ctx-approve`, `ctx-collapsed`, `states`, `x-pr`) | **Any non-end stage carrying `approve_pass`** (`HudView.lua:69`; `engine/src/hud/payload.ts:34`, `:44`; `engine/src/session/approval.ts:55-60`) | filled amber dot, "Your turn", + strip | Turn sentence; the step line *only* when the stage is not `awaiting_approval` (`x-pr` draws `acquiring_preview`); primary "Approve pass 1"; Accept, Abort |
| **V** Pick a copy (`ctx-variants` docked and unchosen; `states` full and chosen; `x-vs`) | `awaiting_pick` (`HudView.lua:68`) | as P | Turn sentence; the cards; primary "Pick a copy" (off) until a card is chosen, then "Pick B"; Accept off; Abort |
| **C** Converged (`states-more`) | `converged` | as P | Turn sentence; primary "Accept", then "To go on instead, tell Claude in chat."; Abort |
| **Act** (`states-extra` columns 1-2) | A note with `note_level: "act"` (proposed, Proposed additions 9), at any non-end stage | as P | Triangle + the note as the turn sentence. If the note asks for Abort: the undo line, then Accept and Abort, with no filled primary. At `cap_reached`: primary "Accept", then Abort. |
| **D** Not connected (`states`) | `conn.engine` false while an edit is open (`HudView.lua:66`) | triangle, "Not connected" | Headline; the undo line in the note slot (`HudView.lua:76-81` puts it there too); Accept and Abort off, in their usual rows, with "Accept and Abort come back when Claude reconnects." and "Until then, the snapshot above puts the photo back." |
| **W, Abort armed** (`states-more`) | First Ctrl+Backspace | unchanged | Abort becomes "Abort?" with a 2 px danger ring plus the focus ring; the confirm line |
| **Done** (`states-more`) | End stages `accepted`, `aborted`, `ended` (`hud-protocol.ts:46`) | check glyph, "Done" | Outcome headline, then the note slot. In converge mode it holds the undo line (`HudText.UNDO`), so the way back stays visible after Accept. No buttons. The rail stays open (`Hud.lua:14-16`). |

**Footnote: today's engine.** The engine sends a failed Abort as stage `awaiting_claude` with the note "Abort could not put the photo back. Click Abort again." (`engine/src/session/hud-actions.ts:156`), or "Abort left N settings different from before. Click Abort again." (`:165`). It sends `cap_reached` as `awaiting_claude` with "All 6 passes are used. Accept keeps the edit; Abort puts the photo back." (`:290`). Without `note_level`, the rail can only draw these as W: the ring, "Working", "Claude is working. Nothing needed from you." and the note under it. That was revision 2's frame (revision 2 is not kept in the repo). Revision 3 draws the target state. The idle notes today's engine sends are drawn in `x-today` (P with "Claude's pass 2 waits for your Approve of pass 1.", `approval.ts:156`).

The **note line** (12/400, text colour, at most 3 lines: `HUD_LIMITS.text` = 120 bytes, `hud-protocol.ts:51`):

- It shows `note` as sent, under the headline or turn sentence. While a click is unanswered, the click line `"%s sent; waiting for Claude."` (`HudText.lua:80`) takes its place, as `HudView.lua` `feedback()` does (`:76-81`: undo line, else click line, else note). In D and in `gone`, the undo line takes its place. In converge Done, with no note, the undo line fills the slot (proposed).
- An "act" note is not drawn in the note line: it becomes the turn sentence (see Act).
- Notes the slot still holds, all from the engine: "Claude's last call failed; the edit is still open." (`hud-actions.ts:284`); after clicks, "Pick B: selecting copy B." (`:246`), "Picked B: Claude continues on copy B at its next call." (`:261`), "Approved pass 1: Claude's next pass goes ahead." or "...goes on at its next call." (`:87-88`), "Accept: keeping the edit once Claude's current step is done." (`:199`). In Variants Done: "Accepted: copy B is kept; the other copies stay in the catalog." (`:223-224`).
- The undo line in **Variants mode** reads "To undo it: Develop > Snapshots, on the master _DSC0412.NEF > AVG pre-session …" (proposed). The snapshot is taken on the master at `lr_begin_session` (`engine/src/session/begin.ts:49`), and a revert applies it to `s.master.uuid` (`engine/src/session/end.ts:61`). Whether Develop > Snapshots lists the master's snapshot while a virtual copy is selected is [unverified].

States not drawn, but specified for the same layout:

- **Checking and gone.** After a reconnect, the D layout shows the headline `checking`, then `gone` (`HudText.lua:43-44`; `HudState.lua:34` UNKNOWN_SECONDS = 10). In `gone`, the undo line shows in the note slot (`HudView.lua:76-81`). Whether these states survive depends on the data path (see Build cost).
- **target_changed.** The turn sentence is `HudText.HEADLINE.target_changed`. No event exists for it, so there is no primary. The engine's note is "Another photo was selected, so nothing was changed; the edit is still open." (`hud-actions.ts:282`). A "Select it" button would need a new plugin action [unverified: whether `catalog:setSelectedPhotos` can do it on a request from outside the plugin].
- **No edit running.** The rail stays hidden. Opened from the menu with no edit, it shows `HEADLINE.none`, docked.
- **LrC-AVG not running.** Footer `CONNECTION.not_running` (docked: in the note slot). What detects this depends on the data path (see Build cost).

Each state carries both words and a shape, so colour alone never carries meaning:

| Meaning | Words | Shape |
|---|---|---|
| Working | "Working" | ring glyph (circle + centre dot) |
| Your turn | "Your turn" + the turn sentence | filled dot, plus the 2 px strip and the filled primary |
| Done | "Done" | check glyph |
| Problem | "Not connected" | triangle, in danger |
| Act note | the note, as the turn sentence | triangle, in hi |
| Connected (footer) | "Connected to Claude." | link glyph |
| Clipping green | "Clipping: within limits." | check-in-circle |
| Guardrail action | the sentence; folded: a short phrase in the Changes header | triangle, in hi |
| Chosen card | the primary names the copy ("Pick B") | `btn` fill + 1 px hi frame (+ filled keycap with focus) |
| Keyboard focus | — | 2 px hi ring, 2 px outside the control |
| Active segment | — | fill + weight 600 |
| Disabled button | the reason line in text2 ("Comes back after a pick.", "Click a copy to choose it.") | hairline only, no fill, label in dis |

## Interactions and keyboard

- **Buttons and events.** Approve sends `hud_approve_pass {pass}`, Accept sends `hud_accept`, Abort sends `hud_abort`, and Pick sends `hud_pick {variant}`. These are the existing events (`hud-protocol.ts:48`, `:128-133`). The enabled rules follow `HudView.lua:158-165`: Abort is on while the edit is live; Accept is on except at `awaiting_pick`; Pick is on only at `awaiting_pick` (and, here, once a card is chosen); Approve is on only with `approve_pass`.
- **After a click.** All buttons go off until `answered_click_id`, a new edit, an end stage, or 10 s (`hud-protocol.ts:24-25`; `HudState.lua:29` PENDING_SECONDS). While they are off, the click line is in the note slot, then the engine's answer note (`engine/src/hud/publisher.ts:204` sends `note: answer.note` with `answered_click_id`).
- **What each primary really does.**
  - **Pick B** selects the copy, in Lightroom too: the HUD's Pick runs `focus` on the copy (`engine/src/session/pick.ts:60-62`, `:77`). The engine answers "Pick B: selecting copy B." and then "Picked B: Claude continues on copy B at its next call." (`hud-actions.ts:246`, `:261`). Claude learns of it in its next tool result, because an MCP server cannot call the model (`hud-actions.ts:11-13`, itself tagged [inference] there). At `awaiting_pick`, Claude was told to ask the user in chat (`pick.ts:23-26` PICK_NEXT), so its turn has ended [inference]. Hence: "Selects copy B. Tell Claude in chat to go on." (proposed).
  - **Approve pass 1**: "Lets Claude write pass 2." It states permission, not timing. If `lr_step` is still waiting (up to `APPROVAL_WAIT_MS` = 60000, `approval.ts:34`), the next pass goes ahead at once; otherwise at Claude's next call (`hud-actions.ts:87-88`). With Proposed addition 11, the waiting note at `approval.ts:156` is no longer sent, so the rail no longer tells these two apart before the click. The answer note after the click still does (`:87-88`).
  - **Accept** in W: "Ends the edit after Claude's current step; the sliders stay." (proposed), because Accept waits for the running operation (`hud-actions.ts:10-11`, `:199`). The turn states keep "Ends the edit; the sliders stay as they are."
  - **Abort** after a failed Abort: "Tries again to put the pre-session snapshot back." (proposed). A second click tries again (`hud-actions.ts:140`, `s.abort = userEnd(a, s.abort)`, with the comment "a second click after a failed revert tries again").
- **Pick in two steps, nothing chosen at first (proposed).**
  - At `awaiting_pick`, no card is chosen. The primary is drawn off as "Pick a copy", with "Click a copy to choose it." or, while the rail has focus, "Click a copy, or press 1, 2 or 3." The line names the keys only with focus, because keys work only then (Keyboard). Lightroom's own number keys set star ratings [unverified], so naming them while Lightroom has focus would invite a rating.
  - A card becomes chosen by a click on it, by 1/2/3 while the rail has focus, or by a Lightroom selection change made after `awaiting_pick` arrived (Proposed addition 4). Then the primary reads "Pick B", and Enter or a click sends it.
  - **The selection Claude left is not a choice.** Before each copy's step, the engine selects that copy itself (`engine/src/session/targets.ts:81-95` `focus()` → `select_photo`, called from `step.ts:36` and `variants.ts:74`). So when `awaiting_pick` arrives, Lightroom shows the copy Claude stepped last: C in the recorded A, B, C order (`docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-d4247b.json`). The engine can also select a copy *during* `awaiting_pick`, when Claude asks for a preview or a region preview (`engine/src/session/manager.ts:94`, `:111`). Those selections must not choose a card either. See Proposed addition 4 for the rule.
  - `ctx-variants` draws this default: docked, no card chosen, the primary off, and Lightroom's filmstrip and loupe on copy C.
  - Making 1/2/3 also select that copy in Lightroom is proposed and [unverified].
- **Title row.** It reads: ▾, "Claude Edit", chip, then dock, pin and × (18 px icons, 4 px apart).
  - ▾ follows Lightroom's panel convention. It shows ▾ while the body is visible. Clicked, it folds the body to the title row, and the chip still shows the state. Then it shows ▸.
  - The **dock glyph** switches forms. A filled bottom band means "dock"; a filled side band means "show the full rail".
- **Edge triangle.** Drawn as Lightroom draws its own. Proposed: clicking it hides the full rail as Lightroom hides its panel.
- **Panel headers** collapse and expand like Lightroom's. The open or closed state is remembered on the device (proposed).
- **Changes rows.** Hover or keyboard focus on a row shows a tooltip, "Vibrance +10 → +16", with the row in a hover fill (proposed).
- **"This pass | Whole edit"** switches the Changes rows. It is local and remembered (proposed).

Keyboard (proposed). Keys work only while the rail has focus; nothing is global. The rail never takes focus by itself (Build cost). Keycaps (Enter on the primary, 1/2/3 on cards) and the hint row show **only while the rail has focus**. The hint row sits above the buttons, so gaining focus grows the panel upward and moves no button. The focused control gets a 2 px hi ring. P and V in `states` are drawn focused, and the armed-Abort frame is focused on "Abort?". Every other frame is unfocused.

| Key (rail focused) | Action |
|---|---|
| Enter | The state's primary: Approve, Pick (once a card is chosen), or Accept at converged or `cap_reached` |
| 1 / 2 / 3 | Choose card A / B / C (V only) |
| Ctrl+Backspace | Arms Abort. The button becomes "Abort?" and the line reads "Press Ctrl+Backspace again to abort. Esc cancels." A second press within 3 s sends `hud_abort`. The 3 s window is proposed. |
| Esc | Disarms an armed Abort. Otherwise it gives activation back to Lightroom's main window, the rail's owner [inference, untested: see Build cost]. It never aborts and never folds. |
| Tab | Moves through: primary, Accept, Abort, cards, segment, panel headers, Show Snapshots, dock, pin, close |

- The hint row shows "Ctrl+Backspace aborts · Esc to Lightroom". Enter's hint lives only on the primary's keycap.
- A mouse click on Abort is a single deliberate action and sends at once, as the current HUD does (`HudView.lua:207`). Only the keyboard path asks for confirmation. A click is safe from ambush because Abort never moves (Placement), and new controls are guarded for 500 ms (Forms and pin).

## Motion (static in the PNGs)

- **Working ring.** The stroke pulses between text2 and text over 1.6 s. With `prefers-reduced-motion`, it is a static ring.
- **Turn arrives, docked.** The panel's top edge rises in 150 ms; the sentence and primary fade in. The bottom rows do not move. With reduced motion, the change is instant. A chip change is always instant.
- **Dock, undock, fold.** 150 ms; instant with reduced motion. Only the photographer's own click starts them.
- **Numbers and slider marks.** They jump to new values. No number tweening, no sliding thumbs.
- **No attention-seeking motion.** No bounce, shake or flashing. Turn states are marked by the strip, the chip and the primary only.

## Fields: existing payload vs proposed engine additions

Existing `hud_update` fields (`hudUpdatePayloadSchema`, `hud-protocol.ts:83-108`) used here:

| Field | Shown as |
|---|---|
| `stage` | state, chip, step line (`HudText.STEP`, with `stepLine`'s two exceptions) |
| `mode` | V layout vs converge layout; Variants wording in Undo |
| `pass`, `max_passes` | "Pass 1 of 6" and the step line (`payload.ts:39-40`) |
| `target.filename` | "_DSC0412.NEF" |
| `target.copy_name` (`hud-protocol.ts:61`) | Variants mode after a pick: a second identity line, "copy B · AVG landscape_golden_hour B" (name format `AVG <intent id> <letter>`, `engine/src/session/copies.ts:51`). At `awaiting_pick` it is left out: the target is then the copy Claude stepped last (`s.active`, set by `focus`, `targets.ts:94`), not a choice. |
| `target.iso`, `shutter`, `aperture` | "ISO 100 · 1/250 s · f/8". The "ISO " prefix is today's (`HudView.lua:93`). |
| `target.lens`, `target.lens_profile` | Lens line; "lens profile on" is today's prefix (`HudView.lua:97`). |
| `approve_pass` | "Approve pass 1" (label from `HudState.lua:185-190`); P at any non-end stage |
| `variants` (`payload.ts:43`, sent only at `awaiting_pick`) | Which cards can be chosen, and "3 copies" on the Pick a Copy header |
| `answered_click_id` | Buttons back on |
| **`note`** (`hud-protocol.ts:104`; set at `payload.ts:32`, `:46`; click answers at `publisher.ts:204`) | The note line, or the turn sentence when "act" |
| `deltas[].slider/before/after/delta` | This pass rows: after value, delta, and before → after in the tooltip. Labels from `engine/src/params/labels.ts:10-42`; delta strings from `payload.ts:101-108`; booleans arrive as "on"/"off" and curves as "curve" (`payload.ts:95-99`). |
| `guardrail.status/reason` | The clipping line (`payload.ts:119-135`); green with no reason shows `CLIPPING_OK`. Non-green also puts a short phrase in the Changes header. |
| `settings.mode/max_passes/variant_count/long_edge/quality/clip_high_pct/clip_low_pct` | Edit Settings, plus the mode word in its folded header |
| `snapshot` | Undo panel and the undo line (`payload.ts:48`; name format `begin.ts:49`) |
| `session_id` | The History prefix (see Proposed additions 7) |
| `session_photos` | Whether the selected photo belongs to the edit (`HudSelection.lua`) |

`settings.decay` is left out on purpose: it is engine vocabulary (PRODUCT.md, principle 1). It stays on the Plug-in Manager page.

## Proposed engine and protocol additions

Each one needs a `hudUpdatePayloadSchema` change. If the plugin stays in the data path, each also needs a matching `HudState.lua` change, because the plugin refuses unknown fields (`hud-protocol.ts:11`).

1. **Variant labels** ("natural", "dramatic", "soft"). The engine already has them: `v.label` (`engine/src/session/variants.ts:109`); intent file `engine/intents/landscape_golden_hour.json:9-11`.
2. **Variant thumbnails.** The engine keeps each copy's last render JPEG (`v.last.jpeg`, `variants.ts:109`). `HUD_LIMITS.text` is 120 bytes (`hud-protocol.ts:51`), so an image needs a path or a separate channel [inference].
3. **Per-copy look line and guardrail sentence**, one per card.
   - **The line is the copy's look**: its variant priors from the intent (`landscape_golden_hour.json:9-11`, applied in `copyPass0`, `variants.ts:79`), in Basic panel order. B: Contrast +20 · Blacks −15 · Clarity +10 · Dehaze +10. C: Contrast −10 · Highlights −15 · Shadows +15 · Clarity −10. A copy with no priors reads "No look added".
   - Revision 2 used "the change from the shared baseline". By `awaiting_pick`, each copy has also had one refined pass (`engine/src/session/pick.ts:21` requires `v.passes >= 1`), so that basis would have mixed each copy's look with Claude's refinement. Refinement detail belongs in Changes after the pick.
   - The guardrail sentence is the copy's own, for example B's pass-0 correction (format `payload.ts:129`). Today `deltas` and `guardrail` cover one photo, the last pass of the running target (`payload.ts:29-31`, `:45`).
   - Format: one line that wraps to 2 lines at most beside the thumbnail, ending "+ n more" if it still does not fit. Measured: the longest, C's, is "Contrast −10 · Highlights −15" on line 1 in a 178 px column (`checks/dots.cjs`).
4. **Letter-to-uuid map for the copies, and a "chosen by the photographer" rule.** `session_photos` lists uuids without letters (`payload.ts:42`). The rule: at `awaiting_pick`, the rail starts with no card chosen. A Lightroom selection change chooses a card only if all of these hold:
   - it happens after the `awaiting_pick` update arrived;
   - it lands on one of the copies;
   - the engine did not make it.

   The engine makes selections through `focus()` (`targets.ts:81-95`), including during `awaiting_pick` for previews (`manager.ts:94`, `:111`). Two ways to tell them apart [inference, both untested]:
   - Engine → rail: the engine polls `get_selection` (`engine/src/bridge/protocol.ts:162`), knows its own `select_photo` calls, and sends `chosen_by_user: "A" | "B" | "C" | null`.
   - Plugin → rail: the plugin, which runs `select_photo`, ignores the next selection event that matches the uuid it just selected.
5. **The "Whole edit" diff** since the pre-session snapshot. The engine holds the start settings (`payload.ts:62` `s.startSettings`) and has `differingSettings` (imported in `engine/src/session/end.ts:14`), so it can be computed [inference]. The diff can exceed `HUD_LIMITS.rows` = 12, so it needs its own limit or a "+ n more" row.
6. **Slider ranges** to place the before and after marks. They are not in the payload. Proposed: a static table next to `labels.ts`, in Basic panel order. Lightroom's exact ranges (for example Temp's non-linear scale, or Sharpening Amount) are [unverified]. The mockup uses ±100, Tint ±150, Exposure ±5, Amount 0-150, Luminance 0-100, and Temp on a log scale with 5,500 at the stage's 0.42 [mockup].
7. **The History prefix "AVG 4f2a1c": derivable, no addition needed.** `session_id` is `s.id` (`payload.ts:36`). The short id is `id.replace(/-/g, "").slice(0, 6)` (`begin.ts:107`), and History step names use `s.short` (`engine/src/session/io.ts:149-151`).
8. **The intent's display name** ("Landscape — golden hour", `landscape_golden_hour.json:3`). Not shown in this option, to keep it brief. It is an open question.
9. **`note_level`: "info" | "act"**, now with defined rendering. It marks the notes that ask the photographer to do something: `hud-actions.ts:156`, `:165`, `:290`, and the "Click … again" refusals in `finishAccept` and `finishPick` (`:202-227`, `:262-264`). The rail draws an "act" note as follows:
   - The note replaces the headline as the turn sentence, at 15/600 hi, with a triangle in hi. The step line is left out.
   - The chip reads "Your turn", and the strip shows.
   - If the note asks for Abort (`:156`, `:165`), there is no filled primary: Accept and Abort keep their rows, and Abort's line becomes "Tries again to put the pre-session snapshot back." The undo line sits under the sentence, so the manual way back is visible at the moment Abort fails.
   - At `cap_reached` (`:290`), Accept is the primary, then Abort.

   String matching is not proposed: it would couple the rail to engine wording. Without this field, the rail falls back to drawing these notes plain under the W headline (today's footnote).
10. **Row groups and short labels**. Lightroom's sub-headers and short row labels for the non-Basic names in `labels.ts`:

    | Group | Short labels |
    |---|---|
    | HSL / Color › Hue, Saturation or Luminance | colour names, "Orange" |
    | Color Grading › Shadows, Midtones, Highlights or Global | "Hue", "Saturation", "Luminance"; "Blending", "Balance" |
    | Detail › Sharpening | "Amount", "Radius", "Detail", "Masking" |
    | Detail › Noise Reduction | "Luminance", "Color" |
    | Lens Corrections | checkbox rows |
    | Tone Curve | curve rows |

    This could be a static table in the rail, or a `group` field per delta row. Lightroom's exact sub-header wording in 15.x is [unverified]: lrc.mcor.dev and Adobe help are not reachable from this container. Jim's check covers only the full labels (`labels.ts:2-3`).
11. **No idle note where the headline already says it** (new; an engine change with no schema change). Stop sending:
    - `approval.ts:156` ("Claude's pass 2 waits for your Approve of pass 1.");
    - `approval.ts:63` ("Approve pass 1 to let Claude make the next pass, or tell Claude in chat.");
    - `hud-actions.ts:286` ("Pick a copy here, or tell Claude which one.");
    - `:288` ("Accept keeps the edit; Abort puts the photo back.");
    - in converge mode, `:224` ("Accepted: the edit is kept.").

    Keep the Variants accept note ("Accepted: copy B is kept; the other copies stay in the catalog."), because it adds a fact. With 9, the `:290` note could also be trimmed to "Your turn: all 6 passes are used.", because the buttons' lines already say what Accept and Abort do. That is how `x-cap` is drawn (proposed string).

UI-only state needs no engine change: form, pin, fold, segment, chosen card, hover, armed Abort, focus, the input guard.

## Copy

These strings are reused exactly from `plugin/LrC-AVG.lrplugin/HudText.lua`:

- `HEADLINE.working` (`:45`), `awaiting_pick` (`:46`), `approve` with 1 (`:47`), `converged` (`:48`), `not_connected` (`:42`), `accepted` (`:50`).
- `STEP.awaiting_claude` and `acquiring_preview` (`:58-60`).
- `CONNECTION.connected` and `not_connected` (`:66-67`).
- `UNDO` (`:72`) in D, in Abort failed, and in converge Done.
- `CLIPPING_OK` (`:75`).
- `CLICK.sent` (`:80`) in the note slot after a click.
- Button labels "Approve pass 1", "Pick B", "Accept", "Abort" (`HudState.lua:185-190`).

Engine strings shown as given: the note-line list above, and the "act" notes "Abort could not put the photo back. Click Abort again." (`hud-actions.ts:156`). The guardrail sentence "Shadow clipping was 3.47 % (limit 1 %); corrected." is in the format `payload.ts:129` produces.

There are two display changes to existing text, both proposed:

- The step line reads "Claude is looking at the result · pass 2 of 6" instead of `"Step: … (pass n of N)"` (`HudText.lua:55-56`). As `HudView.lua` `stepLine` does (`:83-89`), `applying` reads "Applying pass 2 of 6" (no "·" suffix), and `pass0` reads "Setting profile, lens corrections and baseline" with no pass count.
- Numbers get a true minus sign (U+2212) and a non-breaking space before "%", for example "3.47 %". Values use Lightroom's own format: Temp "5,500", Exposure "+0.33", and a sign on the rest ("+6"), as the stage's Basic panel draws them (`stage/stage.js` `fmt`); Lightroom's own value format is [unverified]. The payload sends ASCII "-" (`payload.ts:106`).

New strings, all **proposed**:

- **Chrome and panel names:** "Claude Edit" (the brief's "Claude edit", Title-Cased like Lightroom's panel names); "Working", "Your turn", "Done", "Not connected"; "Changes", "Pass 1 of 6", "This pass", "Whole edit", "Since the snapshot", "was Camera Neutral"; "Pick a Copy", "3 copies"; "Undo", "Develop > Snapshots", "Develop > Snapshots, on the master _DSC0412.NEF", "History: steps named AVG 4f2a1c pass n/6" (Variants: "History: each copy's steps, named AVG 4f2a1c B pass n/6"), "Show Snapshots and History"; "Edit Settings", "Autonomous", "Approve each pass"; accessible names "Show the full rail", "Dock at the bottom", "Pin the full rail", "Hide".
- **Changes:** the sub-headers ("Basic", "Tone Curve", "HSL / Color › Saturation", "Detail › Sharpening", "Detail › Noise Reduction", "Lens Corrections"), "changed" for a curve row, "off → on" for checkbox rows. Folded guardrail phrases: "Clipping corrected", "Clipping over limit", "Pass undone", "Change held", "Change not made".
- **Edit Settings body:** "Autonomous · up to 6 passes", "Preview 1600 px, quality 75", "Clipping limits: 0.5 % highlights, 1 % shadows", "Change in File > Plug-in Manager.".
- **Copy cards:** "No look added" (was "No change from the baseline.").
- **Action lines:**
  - From the shared design system: "Lets Claude write pass 2.", "Ends the edit; the sliders stay as they are.", "Stops Claude and puts the pre-session snapshot back.".
  - New: "Ends the edit after Claude's current step; the sliders stay." (W); "Selects copy B. Tell Claude in chat to go on." (replaces "Claude continues on this copy."); "Pick a copy" (the primary while nothing is chosen) with "Click a copy to choose it." or, with focus, "Click a copy, or press 1, 2 or 3."; "Comes back after a pick."; "To go on instead, tell Claude in chat."; "Tries again to put the pre-session snapshot back." (after a failed Abort).
- **Variants Abort:** "Stops Claude; the master goes back, the copies stay." In Variants mode, a revert puts the master back and the copies stay in the catalog (`engine/src/session/end.ts:4-8`; `hud-actions.ts:125`).
- **D:** "Accept and Abort come back when Claude reconnects." and "Until then, the snapshot above puts the photo back.".
- **Act:** "Your turn: all 6 passes are used." (a trimmed engine note, Proposed additions 11).
- **Keyboard:** "Abort?", "Press Ctrl+Backspace again to abort. Esc cancels.", "aborts", "to Lightroom".

## Visual system: refinements to the shared Native tokens

The design-system tokens used are header #292929, body #404040, text #d0d0d0, text2 #adadad, header text #b0b0b0, hi #e6ebef, accent #f0ad4e, on-accent #1d1305, danger #f2937a, slider track #2b2b2b and slider thumb #cfcfcf.

Refinements:

| Token or rule | Value | Source and use |
|---|---|---|
| frame | #161616 | Separators, gutter, edge, the line above the action panel. Inside the range sampled from Jim's screenshot, #0f0f0f-#161616 (F23). |
| line | #353535 | Hairline inside a panel body. |
| btn | #555555 | Secondary button fill; the chosen card's fill; the scroll thumb. The mid tone of the stage's `.lr-btn` gradient (`stage/stage.css`), drawn flat. Lightroom's own selected row in the stage is #5d5d5d (`stage/stage.css:90`). |
| hover | #4a4a4a | A hovered or focused Changes row (new). |
| dis | #8a8a8a | **Disabled button labels only.** |
| edgetri | #5e5e5e | Lightroom's panel-edge triangle, the same colour as `stage/stage.css` `.lr-tri`. |
| **danger at any size on header** | #f2937a on #292929 | **The design system allows danger only at ≥ 13 px semibold.** On the header colour it reaches 6.39:1, so the rail also uses it for the 11/600 "Not connected" chip. On body (#404040) it stays at 13 px / 600 (Abort), at 4.56:1. |
| chosen card text | text, not text2 | text2 on btn is 3.32:1, so a chosen card's look line switches to text (4.83:1). |

Contrast was computed with `node ../contrast.cjs '<pairs>'` (scratchpad `contrast.cjs`):

| Pair | Ratio |
|---|---|
| hi on btn | 6.21 |
| text on btn (chosen card) | 4.83 |
| text2 on btn | 3.32 (not used) |
| text on hover | 5.75 |
| hi on hover | 7.38 |
| text on header (tooltip) | 9.43 |
| text2 on track (segment control) | 6.31 |
| accent on header (chip) | 7.48 |
| danger on header | 6.39 |
| text on body | 6.72 |
| text2 on body | 4.62 |
| danger on body | 4.56 (used only at 13 px / 600: Abort) |
| on-accent on accent | 9.40 |
| on-accent on hi (chosen keycap, checkbox tick) | 15.24 |
| dis on body | 3.00 (disabled labels only; that WCAG exempts inactive components is [unverified here: w3.org is blocked by the proxy]) |

Other visual details:

- **Colours.** `check-b.cjs` reads text and background colours only. It reports 14 across every frame, all from the token table. The other three tokens are drawn where it does not look: thumb and edgetri are SVG fills, and line is a border. The mouse pointer in `rows` column 1 is sheet chrome.
- **Caption colour.** The close-up captions use #c8c8c8, as the brief asked. That is sheet chrome, not HUD.
- **Font.** Inter, from `../fonts/inter.woff2`.
- **Tabular figures.** `tnum` is on for every number container: row values, deltas, the tooltip, pass counts, chips, keycaps, the step line, identity EXIF, settings and card lines. It is off for prose, the lens string and snapshot names, because Inter's `tnum` also widens the hyphen from 6 px to 8 px at 12 px (`node option-b/checks/tnum.cjs` printed `a:8.00 b:6.00`).
- **Type sizes.** 15/600 turn sentence; 13/500-600 buttons, filename and card names; 12/400 rows, notes and card lines; 11 px only for chips, key hints and the right-hand header text.
- **Grid.** Paddings 12/8/4; title row 28, headers 24, rows 24 (two-line and text rows 40), action rows 40, primary 32, secondary 24.
- **Title row.** Measured in D, the widest state: ▾ at 10+8, name 26+72, chip 106+106, icons 218+18, 240+18 and 262+18, in 284 px. Every child is `flex: none`.
- **One primary per state.** P: Approve. V: Pick B once chosen; before that, an off "Pick a copy". C and `cap_reached`: Accept. W, D, Abort failed and Done have no filled primary.
- **Abort** is a danger-coloured text button with a hairline. It is never filled, and it is always the action panel's last row.
- **Focus ring.** A 2 px hi outline, 2 px outside the focused control. A chosen card has a 1 px frame and a fill instead, so the two never look alike.
- **Undo panel.** The snapshot name is a plain Lightroom-style row, 12/400 hi, with no box (250 px in a 260 px row). The undo line in D, Abort failed and Done starts at the column's text edge (x 12), not under the status glyph, so the name fits on one line.
- **Pick a Copy.**
  - Full rail: a Lightroom panel (header "Pick a Copy", right "3 copies") with full-width list rows, separated by hairlines, and 80 x 53 thumbnails. Docked: no header, 64 x 43 thumbnails.
  - Each row: the thumbnail with the look filter; the name ("B" 13/600 + "dramatic" 13/500); the look line in text2, 2 lines at most; B's guardrail sentence, 2 lines with an inline hi triangle; the keycap 1/2/3 when focused.
  - A 6 px gutter on the right keeps the rows clear of the scroll thumb.
  - The brief asked for thumbnails of about 128 x 85. 80 x 53 is the largest that keeps C's look line to 2 lines beside it in the full rail (178 px text column). The loupe and the filmstrip show the copies at full size.
- **Slider rows** are drawn like Lightroom's Basic panel. The grid, measured with `checks/measure.cjs` at 12 px Inter, tnum on numbers:

  | Part | Column x | Notes |
  |---|---|---|
  | label | right-aligned to 70 | one line up to 64 px (longest short label "Luminance" 63 px), else two lines |
  | track | 76-196 (120 px) | Lightroom's own is about 150 px in the stage's Basic panel |
  | after value | 202-237, right-aligned | where Lightroom puts its value; worst case "5,650" and "+0.50", 35 px |
  | delta | 243-278, right-aligned | worst case "+0.17", 35 px at 600 |

  - Before → after is no longer a column. It shows on hover or keyboard focus, as a header-coloured tooltip under the row ("Vibrance +10 → +16").
  - The marks:
    - a **1 px text2 hairline, 8 px tall, starting 6 px above the groove** at the before value, so it clears the thumb even when the change is small;
    - Lightroom's single filled **▲ thumb** under the groove at the after value;
    - the **change segment** in accent at 60 % on the groove: at least 6 px long, always ending at the thumb, so direction shows even for +4 on a ±100 track (2.4 px at 120 px).
  - **Two-line rows** (label above the track, from x 12) are used for any label wider than 64 px with no short form (`labels.ts:45-46` passes unknown names through). `rows.png` shows "Noise Reduction Luminance".
  - **Checkbox rows** (on/off, `payload.ts:97`): a checkbox in the after state, the full label from x 30, and "off → on" right-aligned at the row's end, with no delta (the payload sends none: `payload.ts:106`).
  - **Curve rows** ("curve" both sides, `payload.ts:98`): the label and "changed".
  - **Text rows** (Profile): the value, then "was …" on a second line.
- **Row order.** Basic panel order (Profile, Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation), then Tone Curve, HSL / Color, Color Grading, Detail, Lens Corrections. Sub-headers appear only when rows come from more than one panel (proposed). Signs and numbers carry direction; there is no red or green for up and down.
- **Section order (refinement).** The brief put the "Your turn" block right under the header. Here the turn sentence and the actions form one action panel at the column's bottom, in both forms, with identity, Changes, Undo and Edit Settings above it. This is what keeps Abort in one place (Placement). It also matches where Lightroom keeps its own buttons: Copy... / Paste at the bottom of the left panel, and Previous / Reset at the bottom of the right one (the stage draws both).

## Build cost

The rail cannot be built from LrView:

- It needs a borderless panel docked to Lightroom's panel geometry.
- It needs custom slider marks, thumbnails and wrapping text. LrView `static_text` does not wrap (`plugin/LrC-AVG.lrplugin/HudText.lua:5-10`).
- A floating dialog has a title bar and saves its own frame (`presentFloatingDialog` args `title`, `save_frame`, `docs/reports/phase5/S8.md`). Docking one is [unverified].

So Option B implies a **separate window process** (for example a Tauri WebView window, F24), owned by Lightroom's main window and positioned by watching it. The window APIs would be:

- `EVENT_OBJECT_LOCATIONCHANGE` to follow Lightroom's window (`research/md_event-constants.md:121`);
- ownership via `GWLP_HWNDPARENT` (`research/md_nf-winuser-setwindowlongptra.md:246`);
- **shown without activation**: Tauri `WindowConfig` `focus: false` ("Whether the window will be initially focused or not", `research/raw_config.rs:2051-2053`), or `ShowWindow` with `SW_SHOWNOACTIVATE` ("similar to SW_SHOWNORMAL, except that the window is not activated", `research/md_nf-winuser-showwindow.md:90`);
- **resized and moved without activation**: `SetWindowPos` with `SWP_NOACTIVATE` ("Does not activate the window", `research/md_nf-winuser-setwindowpos.md:231-237`). This covers the docked panel growing on a turn.

Revision 2 proposed `WS_EX_NOACTIVATE`. It is dropped: such a window "does not become the foreground window when the user clicks it" and "should not be activated ... via keyboard navigation by accessible technology, such as Narrator" (`research/md_extended-window-styles.md:31`). Activating it then needs `SetActiveWindow` or `SetForegroundWindow` (`research/md_nf-winuser-createwindowexa.md:271`). With that style, a click would never give the rail keyboard focus, and PRODUCT.md:44 (keyboard operation) would fail.

The keyboard model this implies, all [inference, untested]:

- The rail appears and changes size without taking focus, so Lightroom keeps the keyboard (PRODUCT.md:31, :38).
- A deliberate click on the rail activates it normally. Then the keys work, and the keycaps and hint row appear.
- Esc gives activation back to the owner window, Lightroom, for example with `SetForegroundWindow`. The rail's process is the foreground process at that moment, which is one of the conditions that call needs (`research/md_nf-winuser-setforegroundwindow.md:96`).
- Clicking back into Lightroom deactivates the rail as with any window.

**Two of Jim's written rules conflict with this. Only Jim can waive them:**

1. **Stack rule**, gateway `CLAUDE.md:25`: "Lua for the plugin, Node ≥ 22 / TypeScript for the engine." A Tauri window adds Rust and a third process. An Electron window would stay in TypeScript, but it ships a second Chromium runtime and is still a third process [inference].
2. **PRODUCT.md:45**: "Native LrView controls and Lightroom's text sizes". The rail draws Lightroom's look in a WebView. It does not use LrView controls, and Lightroom's own UI font and sizes are [unverified] (Inter here).

**Proposed data path: engine → rail.**

- The engine already computes the HUD state (`engine/src/hud/payload.ts` `hudState`) and publishes it (`engine/src/hud/publisher.ts`). The rail would take the same payload over a local channel, validated with the same zod schema. The schema is TypeScript in the engine package, so the strict-field check moves from `HudState.lua` to the rail [inference].
- The rail's clicks would go to `userAction()` (`engine/src/session/hud-actions.ts:57-67`) directly.
- The plugin keeps the bridge, the menu items, and the current floating HUD as the fallback.

What happens to the plugin-side states under this path:

| State | Today | Engine → rail |
|---|---|---|
| `CONNECTION.not_running` (LrC-AVG not running in Lightroom) | Plugin-side | Becomes "the engine cannot reach Lightroom's bridge". The engine knows this from its socket (`engine/src/bridge/client.ts` header: three silent heartbeats drop the link). Lightroom going silent for 11-34 s while Plug-in Manager or a menu is open (same header) would show as this state, falsely, unless the rail waits it out [inference]. |
| D, "Claude is not connected" | The plugin sees the engine drop | If the rail is the engine's child, it dies with the engine and D never shows; Lightroom's own Snapshots panel reappears under it instead. If the rail outlives the engine, it shows D when its feed stops. It cannot tell "Claude Desktop closed" from "engine crashed", but both are "not connected" [inference]. |
| `checking` and `gone` (`Hud.lua:17-19`, `markUnknown` `:157`; `HudState.lua:34`) | Exist because the plugin outlives engine restarts | Not needed while the rail lives and dies with the engine: a new engine either sends the edit or has none. They are needed again only if the rail outlives the engine [inference]. |

The alternative path, plugin → rail, keeps those meanings. But the plugin would need to forward every update to a fourth endpoint from Lua (LrSocket, as `Sockets.lua` does today), and the rail would still need its own process.

**Fallback if docking proves impossible:** the same panel stack as an undocked floating window. The best version is a WebView window with a normal title bar, placed by the user, so there is no window-watching. The worst version is the current LrView floating dialog (`Hud.lua`), with the Rail's section order and copy but without slider marks, thumbnails or wrapped notes. That last version needs no rule waiver.

## Trade-offs

1. **The full rail covers Lightroom's whole left column:** Navigator, Presets, Snapshots, History, Collections, and Copy... / Paste. Snapshots and History are where a photographer checks or undoes an edit. The rail compensates in five ways:
   - **It is docked by default.** Lightroom's Snapshots and History stay visible above it in W, P and C (`ctx-collapsed`; `states-more` column 4), and History shows Claude's steps as they land. Docked V covers History but leaves the Snapshots row with the pre-session snapshot (Placement).
   - **It never covers them by itself.** Only the photographer's own click, or the pin, opens the full rail.
   - The full rail's Undo panel names the exact pre-session snapshot, and says that History holds steps named "AVG 4f2a1c pass n/6" (`io.ts:149-151`; written at `pass0.ts:48` and `step.ts:144`). Guardrail corrections add suffixed steps: "baseline k" and "guard k" (`guardrail.ts:48`), "clip revert" and "region revert" (`guardrail.ts:177`). History does not show one step per slider, so undoing one slider of a pass is not possible from History.
   - D, `gone`, Abort failed and converge Done repeat the undo path in the action panel itself (`HudText.UNDO`), so it is visible in both forms.
   - "Show Snapshots and History" docks the full rail.

   Whether Lightroom's left column scrolls, and which panels a photographer keeps open, are [unverified] and [inference].
2. **Height.** The full V needs a window 1108 CSS px tall to show its info panels without scrolling (Placement). Below that, the info panels scroll first, then the card list. The sentence and every button stay visible.
3. **Mini tracks are small.** +4 on a ±100, 120 px track is 2.4 px. The 6 px minimum segment shows the direction; the after value and the delta show the amount; the hairline above the groove shows the true before position.
4. **The turn sentence sits low in the full rail.** Anchoring the action panel keeps Abort in one place, but in the full rail the sentence is under the info panels, not at the top. The chip at the top and the strip along the inner edge still say "Your turn" at a glance.
5. **Build cost.** See Build cost: a third process, and two rule conflicts.
6. **Font.** Inter is the shared design-system face. Lightroom's own UI font on Windows is [unverified], so "native" here means native chrome and layout, not glyph-identical text.

## Stage corrections (local to this page)

`stage/stage.js` is shared with the other options and was left unchanged. `option-b.html` patches its own copy of the stage after rendering (`patchStage`):

- It drops "18 mm" from the histogram line, because the scene data defines no focal length.
- In Variants, it adds the shared Vibrance +10 prior to the selected copy's Basic panel. For B, it also sets Highlights −41 and Shadows +20 (`20261001-d4247b.json` pass 0). C's Highlights −56 and Shadows +35 already come from the stage.
- The docked-W crop's History adds "AVG 4f2a1c pass 2/6" above the stage's real-name list.

The lead should make the first two fixes in `stage/stage.js` too, so the other options' PNGs show them.

## Open questions for Jim

1. **Build cost (decision only Jim can make).**
   - Waive the stack rule and the LrView line for a separate rail window?
   - If so, Tauri (Rust) or Electron (TypeScript, heavier)?
   - Engine → rail, or plugin → rail?
   - If not: take the floating-dialog fallback?
2. **Keyboard reach.** The rail is shown without activation and never takes focus by itself. A keyboard user gets in by clicking it, which activates it normally, and gets out with Esc. Is a click-to-enter rail acceptable for PRODUCT.md:44? A mouse-free way in would need one of these:
   - a plugin menu item that activates the rail (File > Plug-in Extras; whether plugin menu items can have shortcut keys is [unverified]);
   - a global hotkey, which the brief rules out ("nothing global").
3. **Panel geometry.** Lightroom exposes no left-panel geometry to a plugin [inference]. Any of these would misplace a rail docked by fixed offsets:
   - a hidden left panel (F7 / Tab in Lightroom [unverified]);
   - a resized panel width [unverified];
   - a hidden module picker;
   - another module (Library's left panel holds different panels).

   Options: dock to the window's left edge at a fixed width and accept the mismatch; let the user drag-align once; or show the rail only in Develop.
4. **Pick in two steps, starting with nothing chosen** (choose, then Enter or "Pick B") instead of the brief's "1/2/3 pick". Keep the safer two-step, or send on 1/2/3?
5. **Should choosing a card also select that copy in Lightroom**, so the loupe shows it? That changes Lightroom's selection on the user's behalf. A Pick already does (`pick.ts:77`).
6. **Pin meaning:** "keep the full rail for the next edits" (this revision), or drop the pin and remember the last form?
7. **Intent name.** Show "Landscape — golden hour" in the identity block?
8. **Window-level questions.** Full-screen mode and the module-dependent floating-dialog z-order bugs (F25 links, contents unread) may also affect a separate owned window [unverified].
