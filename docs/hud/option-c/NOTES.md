# Option C "Deck": design notes

The Deck is a wide, low bar that docks over Lightroom's filmstrip band. At rest it is a 44 px bar that carries the turn, the turn's primary action and Abort, and every filmstrip thumbnail stays visible below it. Opened, it is 144 px, exactly the height of the filmstrip band. It then shows the copies side by side as large cards (Variants), or the last pass and the whole edit as Lightroom slider rows (Converge), with the single action that the turn needs. Until Lightroom's real filmstrip height is measured, the deck opens only when the photographer opens it (§2).

Files (all under `scratchpad/hud/`):

- `option-c/option-c.html` holds four frames:
  - `#ctx-variants`: Scene V at 1920 x 1080, opened by the photographer, with copy B chosen. Lightroom's selection is left where the gateway left it, on copy C (§3).
  - `#ctx-working`: Scene W at 1920 x 1080, collapsed.
  - `#states`: states sheet 1 of 2, crops `#crop-0` to `#crop-7` (V with keyboard focus, V chosen, V after Continue, C, P, P busy, W collapsed, W expanded).
  - `#states-more`: states sheet 2 of 2, crops `#crop-8` to `#crop-16` (cap reached, C collapsed, D, focus, Abort armed, Accept sent, pass undone, Done, V collapsed).
- `mockups/option-c-context.png` is 1920 x 1080, scale 1.
- `mockups/option-c-context-working.png` is 1920 x 1080, scale 1.
- `mockups/option-c-states.png` is 3968 x 4024 and `mockups/option-c-states-more.png` is 3968 x 4488, both scale 2.
- These checks are quoted below:
  - `option-c/audit.cjs` reports geometry, overflow, overlap, the smallest font, off-token colours (text, fill, border and focus outline) and the number of primaries per deck. Text cut on purpose with an ellipsis is listed as a note, not a problem.
  - `option-c/measure-film.cjs` measures the filmstrip against the collapsed bar.
  - `option-c/measure-text.cjs` measures string widths in Inter (`TNUM=0` measures with tabular figures off).
  - `option-c/zoom.cjs` makes close-up crops for inspection.

Re-render (from `scratchpad/hud/`):
- `node render.cjs option-c/option-c.html mockups/option-c-context.png --selector=#ctx-variants`
- the same with `#ctx-working` and `mockups/option-c-context-working.png`
- `--selector=#states --scale=2 --w=1984` for `option-c-states.png`, and `--selector=#states-more --scale=2 --w=1984` for `option-c-states-more.png`

How claims are marked:
- Gateway handles are repo-relative to `jimjohnbeebe-jpg/lrc_autonomous_gateway` at `75369b7`.
- "[stage]" means the figure was measured on the mockup stage (`stage/stage.js`), not in Lightroom.
- "proposed" means new copy, a new behaviour or a new field. None of it exists in the gateway today.
- "constructed" (crops 5, 8 and 14) means the crop uses data made up for that state, not the shared scene data.
- "spec v2" is the lead's `scratchpad/hud/lrc-avg-hud-spec-v2.md`.

**Local stage fixes.** `option-c.html` changes the rendered stage after `renderLightroom()` (function `fixStage`); `stage/stage.js` itself is unchanged. It blanks the histogram's focal length ("18 mm", `stage/stage.js:233`), which is in neither the scene data nor the payload. For a selected copy it sets the Basic values the real run holds after pass 0 and its corrections: copy B Highlights −41, Shadows +20, Blacks +5, Vibrance +10; copy C Vibrance +10 (`docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-d4247b.json`, `passes` entries with `n` 0, `settings_after`). See open question 7.

---

## 1. Placement

**Region:** `LR_REGIONS.filmstrip` = x 0, y 936, w 1920, h 144 [stage]. The anchor is the bottom edge of Lightroom's client area. The deck's top edge is fixed at y 936 in both sizes, so expanding grows downward over the filmstrip and never upward over the photo.

**Full window width, not loupe width.** Lightroom's filmstrip runs the full window width (the stage's `.lr-film` is 1920 wide, `stage/stage.css` `.lr-film`). A deck the width of the loupe (x 300-1620) would leave cut-off but still clickable filmstrip cells at both ends (cells start at x 14, `.lr-cells` left 14px). The deck's column lines continue the panel edges above it: the right column starts at x 1620, the left edge of the right panel (`LR_REGIONS.rightPanel`).

**Collapsed (44 px): it replaces the filmstrip header, y 936-980.** The alternative, a bar along the bottom edge (y 1036-1080), would cut 31 px off the bottom of every thumbnail. The header position cuts none:

```
$ node option-c/measure-film.cjs
{"deck":[0,936,1920,44],"filmhead":[0,936,1920,22],"cell0":[14,971,112,96],"img0":[20,985.5,100,67],"minImgTop":985.5,"toggle":[956,1074,8,4]}
```

- The bar ends at y 980. The highest thumbnail image starts at y 985.5, so every thumbnail stays whole and clickable. The bar hides only the top 9 px of each cell's grey frame and the 22 px header strip [stage].
- The header's own controls are lost while the deck is shown: the monitor buttons, the grid button, the previous/next arrows, the source "Previous Import ... / _DSC0412.NEF" and the Filter control. The filename and, for a copy, its copy name move into the deck (§2 "Status column"). See trade-offs.
- Lightroom's filmstrip show/hide triangle at x 956, y 1074 stays visible when the deck is collapsed. The expanded deck covers it [stage].

**Sizes per state** (root-relative px, from `node option-c/audit.cjs` and `review-c-r3/geom.cjs`):

| State | Deck box | Inner geometry |
|---|---|---|
| Expanded (V, C, P, W, cap, D, focus, armed, sent, undone) | 0, 936, 1920 x 144 | Left column x 0-380, centre x 380-1620, right column x 1620-1920 (content x 1636-1904, 268 wide). Column hairlines are 1 x 120 at y 947. |
| V cards | 432 / 816 / 1200, 961, each 368 x 114 | 16 px gaps; centred in the centre column, 52 px from each hairline. One 11 px caption line above them at y 941 ("Each copy's changes beyond the baseline"). |
| Right column | primary or secondary 1636, 948, 268 x 32 | Abort 1636, 1006, 54 x 24 in every expanded state but D (1636, 986). The V hint box is 52 px, the height of a primary plus its line, so Abort stays at y 1006 when a card is chosen. P: Accept 1636, 1006, 65 x 24 and Abort 1709, 1006. Armed Abort 139 x 24. Converge undo line: two 12 px lines, y 1036-1068. Variants copies line: one line, y 1052-1068. |
| Collapsed (W, C, V, Done) | 0, 936, 1920 x 44 | A hairline at x 1620 (1 x 20). Actions start at x 1636, y 944, 28 px tall: W Accept (text-only) 61 + Abort 54; C Accept (primary) 96 + Abort 54; V "Show the copies" (primary) 123 + Abort 54. The consequence text is right-aligned to x 1604. Done has only the close button at x 1876 (28 x 28). |

**Grid:** the outer edges and the key boxes sit on the 4 px grid, most of them on 8. The deck top is 936, the cards are at x 432, 816 and 1200. The left column content starts at x 16. Glyphs start at x 36 and text at x 60.

**What it never covers:**
- the photo, which ends at y 860 (`LR_REGIONS.photo` 429, 152, 1062, 708);
- the loupe toolbar (y 900-936);
- either panel, including the Copy/Paste and Previous/Reset buttons, which end at y 936 [stage].

In Develop with the left panel's Snapshots section open, the Converge way back is shown twice: in Lightroom itself, and in the deck's undo line. In Library (Jim's screenshot) or with the left panel hidden, the deck's undo line is the only place it shows. In Variants the way back is different (§2, "The way back by mode").

**No window shadow and no outer radius (a departure).** The shared Instrument window spec has one shadow (0 10px 30px) and a radius of 8. A deck docked to the window's bottom edge would cast that shadow off-screen, and Lightroom's own docked panels are square. So the deck has square edges and a 1 px `line` hairline on top (plus one at the bottom when collapsed). Radius 8 is used on the cards, radius 6 on the buttons and radius 4 on the thumbnails.

---

## 2. States and their triggers

Stages come from `engine/src/bridge/hud-protocol.ts:40-43`. Headlines come from `plugin/LrC-AVG.lrplugin/HudText.lua:39-53`. The headline order (bridge, then end, then connection, then unknown, then stage) is today's `plugin/LrC-AVG.lrplugin/HudView.lua:61-72`.

**Size rule (proposed; changed in round 3): the deck never opens by itself** until Lightroom's filmstrip geometry is measured (spec v2 open item 26, `lrc-avg-hud-spec-v2.md:1029`). If the photographer hid or shrank the filmstrip, a 144 px deck that opened on every turn would cover the bottom of the loupe, and possibly the photo, each time (principle 3; §8 "Geometry is assumed"). So:
- At rest the deck is the 44 px bar. On your turn the bar carries the turn sentence, the turn's primary and Abort, with their consequences (`#crop-9` for C, `#crop-16` for V). In V the primary is "Show the copies", which opens the cards, because the pick needs them.
- Problems (not connected, gone) show in the bar: the triangle, the headline and the undo line, laid out as the Done bar (`#crop-15`; the D bar is not drawn). The bar shows a problem only once it has lasted longer than the engine's silence allowance. The plugin went silent for 11-34 s while Plug-in Manager or a menu was open, and the engine waits out a longer silence while a session is open (`engine/src/bridge/client.ts:8-13`, `silenceAllowanceMs`). Using that allowance as D's debounce is [inference].
- A note at stage `awaiting_claude` shows in the bar after "pass n of 6" (see "Notes" below).
- The photographer opens the deck with the triangle (or "Show the copies") and closes it with the triangle or Esc. It keeps the size the photographer chose across turns.
- The photographer can set the expanded height by dragging the deck's top edge; it is remembered per monitor, and 144 px is the default (proposed).
- It never takes focus when it changes size (§3).
- Once the geometry is measured, opening once per turn (the round-2 rule) can come back as an option (open question 1).

**Host requirement for D and Gone.** Scene D is drawn assuming the deck's window outlives the engine. If the engine hosts the deck, the window closes when the engine exits (Claude Desktop closed or the engine crashed, the main "not connected" case: the engine is the stdio server Claude Desktop starts, `CLAUDE.md` Commands), and neither D nor its way back would appear. Today only the plugin's floating dialog survives that case (`HudView.lua:66`, 76-79). So:
- D and Gone need a host that outlives the engine (a helper process with its own connection state, §5 field 9), or
- until open question 6 is decided, today's plugin floating dialog (`plugin/LrC-AVG.lrplugin/Hud.lua`) stays as the fallback surface for not_connected and gone. Opening it from the plugin when the engine drops is a plugin change (proposed), and it takes the keyboard when it opens (`docs/reports/phase5/S8.md:185`).

**The way back by mode.** In Converge, Abort applies the pre-session snapshot, and the undo line is "To undo it: Develop > Snapshots > AVG pre-session ..." (UNDO, `HudText.lua:72`). In Variants the master is never edited (`engine/src/session/variants.ts:4`); the snapshot is made on the master (`engine/src/session/begin.ts:49-50`, `create_snapshot` with `target_uuid: photo.uuid`); an Abort puts the master back and leaves the copies in the catalog with their edits (`engine/src/session/end.ts:4-7`, :114; `abortedNote`, `engine/src/session/hud-actions.ts:124-125`). Whether a virtual copy shows the master's snapshot is [unverified]. So in V, VB, Vp and the V bar:
- Abort's line is "Leaves the master as it was; the copies stay in the catalog." (proposed);
- the way-back line names the copies: "Copies: “AVG landscape_golden_hour A–C”" (proposed; names from `copyName()`, `engine/src/session/copies.ts:51`; the letter range comes from the copy list, so two copies read "A–B");
- the Snapshots line is shown in Converge only.

| State (drawn?) | Trigger | Shape + words | Primary | Other actions |
|---|---|---|---|---|
| **V** Variants pick, nothing chosen (drawn, `#crop-0`, with keyboard focus on card A) | stage `awaiting_pick` with `variants` [A, B, C] (`engine/src/hud/payload.ts:43`; `engine/src/session/hud-actions.ts:286`), deck opened | amber dot + HEADLINE.awaiting_pick | none. The right column says "Choose a copy to continue on", then "Click a card." (without focus) or "Click a card, or press 1, 2 or 3." (with focus, as drawn). | Abort (Variants line). Accept is absent: the engine refuses it until a pick (`hud-actions.ts:182-184`), and today's HUD greys it (`HudView.lua:161`). |
| **V** copy B chosen (drawn, `#ctx-variants`, `#crop-1`) | a card clicked in V, or 1 / 2 / 3 pressed while the deck has focus | the card gets a 1 px accent ring and an accent caret on its top edge, above the thumbnail. No keycaps: a pointer click hands focus back to Lightroom (§3). | **Continue on copy B**, which sends `hud_pick` {variant B} (`hud-protocol.ts:131`) | Abort (Variants line) |
| **V** after Continue (drawn, `#crop-2`) | stage `awaiting_claude` with the note "Picked B: Claude continues on copy B at its next call." (`hud-actions.ts:261`) | info glyph + the note as the sentence; identity line "_DSC0412.NEF / AVG landscape_golden_hour B"; timeline "copy B · pass 0" | none | Accept (secondary: "Keeps copy B; the other copies stay."), Abort (Variants line). Card B reads "Picked"; there are no keycaps, because a second pick is refused (`hud-actions.ts:234`, "already picked"). The cards are the copy list the deck kept from `awaiting_pick` (§5 field 1). |
| **V** at rest (drawn, `#crop-16`) | stage `awaiting_pick`, deck not opened (the default) | amber dot + HEADLINE.awaiting_pick at 15/600, then "_DSC0412.NEF · 3 copies" in `text3` | **Show the copies** (opens the cards; sends nothing) | Abort; "Abort leaves the master as it was; the copies stay in the catalog." in the bar |
| **C** Converged (drawn, `#crop-3`) | stage `converged` (`hud-actions.ts:289`), deck opened | dot + HEADLINE.converged | **Accept**, which sends `hud_accept` | Abort |
| **C** at rest (drawn, `#crop-9`) | any your-turn state with the deck not opened (the default) | dot + headline at 15/600, then the filename in `text3` | the turn's primary at 28 px (Accept); no keycap | Abort; both consequences in the bar |
| **P** Approve (drawn, `#crop-4`) | `approve_pass` present, stage `awaiting_approval` (`payload.ts:44`; `engine/src/session/approval.ts:156`; `HudView.lua:69`) | dot + HEADLINE.approve with 1. The engine's note "Claude's pass 2 waits for your Approve of pass 1." (`approval.ts:156`) repeats the headline, so it is left out for the deck (§5 field 12). | **Approve pass 1**, which sends `hud_approve_pass` {pass 1}; line "Lets Claude write pass 2." | **Accept and Abort as a compact pair** (24 px, outlined; Accept in `text`, Abort in `danger`), consequences in their tooltips: "Accept keeps the edit as it is now." and "Abort puts the pre-session snapshot back." (proposed). Accept is enabled at this stage today (`HudView.lua:161`), and an Accept ends the approval wait at once with the edit kept (`approval.ts:165-167`; `hud-actions.ts:14-16`). |
| **P** busy pass (drawn, `#crop-5`, constructed) | as P, with 12 rows in `deltas` (the maximum, `hud-protocol.ts:51`) | as P | as P | as P. Shows the overflow rule (§7) and the "held" guardrail mark. |
| **W** Working, collapsed (drawn, `#ctx-working`, `#crop-6`) | stages `begin`, `pass0`, `applying`, `acquiring_preview`, `metrics`, `awaiting_claude` without a note (HEADLINE.working, `HudView.lua:71`) | pulsing ring + "Working · pass 2 of 6 · Claude is looking at the result · _DSC0412.NEF" (STEP.awaiting_claude) | none | **Accept as a text-only control** (`text2`, no border; tooltip "Ends the edit after Claude's current step."), because the plugin enables Accept at every stage of an open session but `awaiting_pick` (`hud-protocol.ts:21-23`), and the engine accepts during a run once Claude's current step is done (`hud-actions.ts:199`). Abort, with one `text3` phrase: "Abort puts the pre-session snapshot back." The status leads; nothing in the bar reads as a request. |
| **W** Working, expanded (drawn, `#crop-7`) | the photographer clicks the triangle in W | ring + HEADLINE.working; STEP line; the identity in `text3` below it | none | Accept (secondary: "Ends the edit after Claude's current step."), Abort, undo line. The centre shows the last pass and the whole edit, as in C. |
| **Cap** reached (drawn, `#crop-8`, constructed: pass 6 of 6) | stage `awaiting_claude` with `pass` equal to `max_passes`, both payload fields (`hud-protocol.ts` `hudUpdatePayloadSchema`; `payload.ts:39-40`). The engine raises this stage with the cap note (`hud-actions.ts:290`). That this pair only follows a capped pass is [inference]: `engine/src/session/step.ts:55` sets `cap_reached` when the pass number reaches `max_passes`. | **your turn**: amber dot + "Your turn: all 6 passes are used." (proposed); the timeline ring is `accent`. The cap note is left out for the deck (§5 field 12). | **Accept** | Abort. Open question 9 keeps the engine-side version. |
| **D** Claude disconnected (drawn, `#crop-10`, assuming a host that outlives the engine) | plugin connection `engine` false while an edit is open (`HudView.lua:66`, 76-79) | danger triangle + HEADLINE.not_connected | none: Accept and Abort are drawn off (`line` outline, `text3`), with one line under both: "Off until Claude is connected." | The undo path is the centre's 15/600 line. |
| Gone (not drawn) | 10 s "unknown" after a reconnect (`hud-protocol.ts:26-29`) | triangle + HEADLINE.gone | as D | as D |
| Checking (not drawn) | "unknown" before the 10 s (`hud-protocol.ts:26-27`) | ring + HEADLINE.checking | buttons off | none |
| **C** keyboard focus on the primary (drawn, `#crop-11`) | after "LrC-AVG - Show Vision Gateway HUD" (§3) | as C | Accept, with the 2 px focus ring and its Enter keycap | Abort |
| **C** Abort armed (drawn, `#crop-12`) | the first Ctrl+Backspace while the deck has focus | Abort reads "Press again to abort" with a `danger` hairline; beside it, at 11 px: "Ctrl+Backspace again; / Esc or 3 s cancels." | unchanged, without a keycap: Enter is ignored while armed (§3) | none |
| **C** Accept sent (drawn, `#crop-13`) | any click, until `answered_click_id`, a new edit or an end stage arrives, or 10 s pass (`hud-protocol.ts:24-25`) | **working ring + CLICK.sent as the sentence** ("Accept sent; waiting for Claude."); the timeline ring turns `working`. The turn sentence is not shown, so the deck never says "your turn" while nothing can be clicked. | none. Every button is off: "Off until Claude answers." | After 10 s: CLICK.no_answer |
| **W** pass undone (drawn, `#crop-14`, constructed) | `guardrail.status` `undone` (`payload.ts:122-124`) | as W expanded. Block header "Pass 2 · undone"; its rows in `text3`, the thumb at the before value (where Lightroom's slider is), no accent segment, the after value struck through, "not kept" in place of the delta; triangle on the timeline and on the guardrail line | none | as W expanded |
| Target changed (not drawn) | stage `target_changed` (`hud-protocol.ts:30-31`) | dot + HEADLINE.target_changed | proposed: **Select _DSC0412.NEF**, which re-selects the edit's photo (see field 10 in §5) | Abort |
| **Done** (drawn, `#crop-15`: accepted, Converge) | `accepted`, `aborted`, `ended` (`hud-protocol.ts:46`) | check glyph + HEADLINE.accepted, HEADLINE.aborted or HEADLINE.ended. The engine's end note is shown only when it adds something: the Variants accept note "Accepted: copy B is kept; the other copies stay in the catalog." (`hud-actions.ts:223-224`) and an Abort that left settings different (`hud-actions.ts:127`) are shown; "Accepted: the edit is kept." and "Aborted: the photo is back as it was before the edit." repeat the headline and are left out (§5 field 12). | none | Collapsed bar with the undo line and a **close ×** (`text2` glyph, 28 px target, hairline on hover) at x 1876. Esc also closes it. Proposed: the bar hides by itself when the photographer selects a photo outside the edit. |
| No edit (not drawn) | no session | hidden (proposed) | none | "LrC-AVG - Show Vision Gateway HUD" shows it with HEADLINE.none (`Info.lua:27`). |

Every drawn state has exactly one filled accent button, or none (V before a choice, V after Continue, W, D, sent, undone, Done): `audit.cjs` "primaries". In V the cards are the choices. An amber card would read as a recommendation, so only the chosen card gets the accent ring.

**Notes** (the payload's `note`, `hud-protocol.ts:104`). Today's HUD shows it on its feedback line, after the click line (`HudView.lua:76-80`). It is how a click says what happened to it (`PRODUCT.md:39`), and it carries what a stage alone cannot: "Picked B: Claude continues on copy B at its next call." (`hud-actions.ts:261`), "Pick B did not go through. Click Pick B again." (:263), "Accept did not go through; the edit is still open. Click Accept again." (:226), "Claude's last call failed; the edit is still open." (:284), and an answered click's note (`engine/src/hud/publisher.ts:204`). The deck shows every note it receives:
- **Expanded, any stage but `awaiting_claude`:** on the note line in the left column, under the identity or STEP line, at 12/400 `text2`, up to 2 lines (then an ellipsis; the tooltip has the rest). No drawn state has one: the drawn notes are either the sentence (V after Continue) or left out for the deck (field 12).
- **At `awaiting_claude`:** the note replaces HEADLINE.working as the 15/600 sentence, with the info glyph (an "i" in a ring). HEADLINE.working ("Nothing needed from you") is false there: the engine sets a note at `awaiting_claude` once an operation is over (`hud-actions.ts:270-293`), after an approval while nothing runs (`hud-actions.ts:88-89`, `approval.ts:186`), or when an Abort failed (`hud-actions.ts:156`, 165). A note during a running step (`payload.ts:32`, `s.work.note`, e.g. `engine/src/session/probe.ts:25`) is published with that step's stage, not with `awaiting_claude` [inference]. The cap is the exception: it is drawn as your turn (Cap row).
- **Collapsed:** the note replaces the STEP text after "pass n of 6", or follows the headline after " · ".
- Notes that repeat what the deck already says are left out for the deck by the engine (proposed, §5 field 12): the defaults at `awaiting_pick` and `converged` (`hud-actions.ts:286`, 288-289), the approval note (`approval.ts:156`), the cap note (`hud-actions.ts:290`), and the end notes that repeat the headline. The deck itself never filters notes by their words.

**Status column** (left):
- Line 1: glyph + the sentence (headline, CLICK.sent, or a note at `awaiting_claude`).
- Line 2: on Claude's turn, the STEP label (`HudText.lua:57-63`); otherwise the photo's identity ("_DSC0412.NEF · ISO 100 · 1/250 s · f/8").
- Line 3 (the band above the timeline): the note; with no note on Claude's turn, the identity in `text3`.
- When the target is a copy and the stage is not `awaiting_pick`, the identity is "_DSC0412.NEF / AVG landscape_golden_hour B", from the existing `target.copy_name` (`payload.ts:68`; format at `engine/src/session/copies.ts:51`), as Lightroom's filmstrip header writes it [stage]; the EXIF moves to the tooltip. Claude tells the photographer to compare copies "by their copy names" (`engine/src/session/pick.ts:23-26`). At `awaiting_pick` the identity shows the photo, because the cards carry the copies.

**Pass timeline** (left column, bottom, from x 60):
- One position per pass, 0 to `max_passes`.
- A filled `text2` dot is a done pass. A hollow `text3` dot is a remaining pass.
- A 1.5 px ring around a dot marks where the edit stands now: `accent` on your turn (the cap included), `working` while Claude works or a click is pending, `text2` with a note at `awaiting_claude`, `text3` when unknown (D).
- Under each done pass is its guardrail mark, 9 px. The words "pass 2 of 6" follow the dots.
- In V, pass 0 carries no mark. Each copy had its own outcome, so the marks sit on the cards. The words are "pass 0 · 3 copies" at `awaiting_pick` and "copy B · pass 0" after the pick.
- **Above 8 passes (not drawn, proposed):** a 160 px, 2 px track (done part `text2`, rest `line`) with the current ring at its position, the mark of the current pass only, and the words "pass 12 of 20". The dot form needs 20 px per pass: 7 passes take 156 px plus the label; 9 or more would crowd the 304 px column (`max_passes` may be up to 99, `hud-protocol.ts:51`).

**Guardrail marks** (all six statuses of `HUD_GUARDRAIL`, `hud-protocol.ts:47`; sentences from `payload.ts:113-134`). Each mark is a different shape, so the meaning never rests on colour. The same glyph is used on the timeline (9 px), on the guardrail line under "Pass n" (12 px), on the cards' guardrail line, and after the slider name of a corrected card row ("Blacks ◐ +5"):

| Status | Glyph | Colour | Sentence shown |
|---|---|---|---|
| `green` | check | `ok` | "Clipping: within limits." (CLIPPING_OK) |
| `corrected` | half-filled circle | `text2` | e.g. "Shadow clipping was 3.47 % (limit 1 %); corrected." |
| `clamped` | a bar between two stops ("held") | `text2` | e.g. "Clarity: change held to ±4 this pass." (`#crop-5`) |
| `refused` | a bar between two stops ("held") | `text2` | e.g. "Dehaze: not changed, it would push clipping over the limit." |
| `unmet` | problem triangle | `danger` | e.g. "Highlight clipping is still 1.2 % (limit 0.5 %) after corrections." |
| `undone` | problem triangle | `danger` | e.g. "Pass undone: highlight clipping went over the limit." (`#crop-14`) |

Proposed: in the collapsed bar, an `unmet` or `undone` status adds the triangle and its sentence after the STEP text (not drawn).

---

## 3. Interactions and keyboard

**Pointer:**
- The disclosure triangle at the deck's top-left (x 16) expands and collapses the deck. It is Lightroom's own panel-header idiom: ▸ shut, ▾ open (the stage's panel headers, `stage/stage.js` `tri('down')` / `tri('right')`). In the V bar, "Show the copies" does the same.
- A click on a card chooses it (ring + caret). **Lightroom's selection does not change:** spec v2 E12 marks `hud_show` "no in v1" (`lrc-avg-hud-spec-v2.md:276`; open question 2). `#ctx-variants` is drawn that way: the deck has copy B chosen, and the loupe still shows copy C, the copy the gateway selected last [inference: `engine/src/session/variants.ts:38` runs pass 0 on the copies in order, and `copyPass0` calls `focus()` (`variants.ts:74`), which selects the copy (`engine/src/session/targets.ts:88`, `select_photo`); in the running engine it is the copy Claude stepped last]. After the pick, the engine selects the picked copy (`pick.ts:61`, :77), so `#crop-2` renders copy B selected.
- The primary then sends the pick. Choosing is local and can be undone (choose another card). Sending is the step that counts. This splits today's one-click "Pick B" (`HudView.lua:202-204`) in two, because a pick decides which copy every later pass edits (`hud-actions.ts:12-13`). Claude learns of the pick only at its next call (`hud-actions.ts:12-13`), so the primary's line says "Claude continues on copy B at its next call.", the engine's own words (`hud-actions.ts:261`).
- Pointer Abort is one click, as today (`HudView.lua:207`).
- A hover on any action or card shows its full sentence as a tooltip (proposed). Examples: Abort's "Ctrl+Backspace"; P's "Accept keeps the edit as it is now." and "Abort puts the pre-session snapshot back."; the W bar's Accept "Ends the edit after Claude's current step."; a corrected card row's "asked −15"; the lens "18.0-105.0 mm f/3.5-5.6 · lens profile on" on the identity line; each copy's name ("AVG landscape_golden_hour A") on its card; the hidden rows of a "+n more" line; per-pass guardrail sentences on the timeline marks.

**Focus (round 3: in line with spec v2 §4.2, `lrc-avg-hud-spec-v2.md:490-497`).** The deck never takes focus by itself (`PRODUCT.md:31`, :38):
- Every programmatic show or resize is a show without activation (`SW_SHOWNA`, spec v2 §4.2, citing `research/md_nf-winuser-showwindow.md:90-94`).
- A pointer click on the deck activates it: the user's deliberate act. `WS_EX_NOACTIVATE` is **not** used, because it also keeps the window out of reach of accessibility tools' keyboard navigation ("should not be activated through programmatic access or via keyboard navigation by accessible technology, such as Narrator", `research/md_extended-window-styles.md:31`). Round 2 relied on it; that is withdrawn.
- After a pointer action, the deck hands focus back to Lightroom; after a keyboard action, focus stays in the deck (spec v2 §4.2, proposed there). Choosing a card with the pointer counts as a pointer action here (proposed), so the pointer path never leaves the deck holding the keyboard.

**Keyboard route into the deck** (`PRODUCT.md:44` requires keyboard operation):
- **"LrC-AVG - Show Vision Gateway HUD"** (`plugin/LrC-AVG.lrplugin/Info.lua:27`) expands the deck and gives it focus, on the primary if the turn has one, else on the triangle. This is the one deliberate focus grab, and the photographer asks for it.
- **The File > Plug-in Extras items** (`Info.lua:28-33`: Pick A, Pick B, Pick C, Approve Pass, Accept Edit, Abort Edit) act without the deck. Today each one also opens the classic floating HUD (`plugin/LrC-AVG.lrplugin/MenuAbort.lua:3`, "The HUD opens if it is closed"), which takes the keyboard (`docs/reports/phase5/S8.md:122`, :185). Keeping them from doing so while the deck is connected is a plugin change (spec v2 D1 "Known conflict", `lrc-avg-hud-spec-v2.md:416`). How the photographer reaches Lightroom's menus by keyboard is Windows' and Lightroom's own [unverified].
- Without `WS_EX_NOACTIVATE`, a screen reader's keyboard navigation can reach the deck [inference from the same line].

**Key hints are drawn only while the deck has keyboard focus** (round 3). The 1 / 2 / 3 keycaps on the cards, the Enter keycap in the primary and the "press 1, 2 or 3" text appear only then (`#crop-0`, `#crop-11`); without focus the V hint reads "Click a card." and primaries have no keycap. Without focus, keys go to Lightroom, where 1-5 set star ratings and Enter switches to Loupe (`lrc-avg-hud-critique.md:112`, citing https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html; [unverified] here, not opened from this container). A hint drawn without focus would invite a keypress that rates the photo instead of choosing a copy.

**Keys** (only while the deck has focus; nothing global, spec v2 §4.6, `lrc-avg-hud-spec-v2.md:530`):

| Key | Does |
|---|---|
| Tab / Shift+Tab | moves focus: triangle, then the cards (V), then the primary or secondary, then Accept and Abort (P), then Abort (then × in Done) |
| Left / Right | moves focus between cards (V). **Focus is not a choice.** |
| 1 / 2 / 3 | chooses copy A / B / C (V). **This departs from the brief's "1/2/3 pick": the keys choose, and Enter confirms.** |
| Space | activates the focused control; on a focused card, chooses it |
| Enter | the turn's primary: Continue on copy X, Accept (converged, cap), Approve pass n, Show the copies (V bar). It does nothing where there is no primary (V before a choice, W, after Continue, D, sent), and while Abort is armed (so a reflex Enter cannot accept). |
| Ctrl+Backspace | arms Abort ("Press again to abort", with "Ctrl+Backspace again; Esc or 3 s cancels." beside it). A second press within 3 s aborts. Esc or 3 s disarms (proposed timing). While armed, the primary has no Enter keycap. |
| Esc | disarms if armed; else closes the bar in Done; else collapses if expanded; else returns focus to Lightroom. It never aborts. |

**Focus look.** Every control (triangle, cards, primary, secondary, Accept and Abort, ×) shows keyboard focus as a 2 px `text` outline, offset 2 px, following the control's radius (`#crop-11` on the primary; `#crop-0` on card A). A card under keyboard focus has that ring and no caret. A chosen card has the 1 px `accent` ring and the caret. So focus and choice differ in colour, width, offset and shape. A focused, chosen card shows both.

Key hints are drawn at 11 px: the keycaps (with focus only) and the armed Abort's line. On raised surfaces they use `text2`, because `text3` is never placed on raised. Ctrl+Backspace is otherwise shown only in Abort's tooltip (§9, open question 5).

**Window host [inference]:**
- The deck cannot be an LrView floating dialog. `presentFloatingDialog` takes title, contents, blockTask, save_frame, onShow, windowWillClose, selectionChangeObserver and sourceChangeObserver (`docs/reports/phase5/S8.md:70`), and nothing among them docks, sizes or removes the frame [inference].
- Such a dialog also takes the keyboard when it opens (`S8.md:185`).
- So the Deck is a separate borderless window placed over Lightroom's client area. Its host is open: the engine (Node, `CLAUDE.md` stack rule) or a small helper. D and Gone need a host that outlives the engine (§2).
- Staying on Lightroom's window follows spec v2 §4.3 (topmost policy). A cross-process owner relationship is rejected there, because it attaches the two threads' input queues (`lrc-avg-hud-spec-v2.md:509`). EVENT_OBJECT_LOCATIONCHANGE reports Lightroom's moves and resizes (`research/md_event-constants.md:121`).
- Tauri's `parent` option takes another Tauri window's label (`scratchpad/tauri-config.rs:2162-2173`), so it cannot name Lightroom's window [inference, F24].

---

## 4. Motion

The PNGs are static. The working halo is drawn at mid-pulse: a `working` ring at 35 % opacity around the inner ring.

- **Expand and collapse** (the photographer's action only): the height animates 44 ↔ 144 over 150 ms, ease-out. The top edge stays at y 936. The new content fades in over 100 ms after the height lands, so text never reflows mid-animation.
- **Working ring:** the halo grows from r 5 to r 8 and fades out over a 1.6 s loop. The inner ring holds still. The info glyph never moves.
- **Your turn arriving, or a note at `awaiting_claude`:** the glyph and sentence swap in place; the deck does not change size (§2). There is no flash, bounce, sound or focus change (PRODUCT.md "Interrupting", `PRODUCT.md:31`).
- **Choosing a card:** the ring and caret appear within 100 ms.
- **Abort armed:** the border, label and line swap in 100 ms. Nothing shakes.
- **Click sent:** the dot becomes the working ring and the sentence swaps at once; no transition on the buttons going off.
- **Numbers:** they never tween. Deltas, values and pass counts swap instantly.
- **Reduced motion:** the halo is static and the height snaps. Whether WebView2 maps Windows' animation setting to `prefers-reduced-motion` is [unverified].

---

## 5. Fields: existing payload vs proposed additions

**Existing** (`hud_update`, `engine/src/bridge/hud-protocol.ts:83-108`):

| Shown | Field |
|---|---|
| state choice, headline | `stage`, `mode`, `variants`, `approve_pass` |
| "pass 2 of 6", timeline length; the cap read as your turn (`pass` == `max_passes` at `awaiting_claude`) | `pass`, `max_passes` (`payload.ts:39-40`) |
| "3 copies", card letters A / B / C at the pick | `variants`, sent at `awaiting_pick` only (`payload.ts:43`). After the pick no field carries them: the deck keeps the last `awaiting_pick` list in memory for "copy B · pass 0" and the cards (`#crop-2`), and loses it if the deck restarts (proposed field 1 fixes that). |
| identity line | `target.filename`, `.iso`, `.shutter`, `.aperture` (formats from `payload.ts:81-93`); `target.copy_name` when the target is a copy (`payload.ts:68`); the lens and `lens_profile` appear only in the tooltip |
| note line, or the sentence at `awaiting_claude`; the collapsed bar's text after "pass n of 6" | `note` (`hud-protocol.ts:104`; at most 120 bytes, `hud-protocol.ts:51`) |
| Pass n rows (label, before, after, delta) | `deltas[]`: the target's last pass only (`payload.ts:45`), at most 12 rows (`hud-protocol.ts:51`). `after` is the pass's requested value before any guardrail correction (`payload.ts:101-108`, `delta()` prints `changes[].after`), see field 3. That an undone pass still lists its changes is [inference] (`engine/src/session/step.ts:181`, "written, then undone"). |
| guardrail line and timeline mark of the last pass | `guardrail.status` / `.reason`; CLIPPING_OK when green with no reason (`hud-protocol.ts:35`) |
| undo lines (Converge) | `snapshot` (`hud-protocol.ts:106-107`) |
| buttons back on after a click | `answered_click_id` (`hud-protocol.ts:101`) |
| "AVG 4f2a1c" in D | `session_id`. That History steps start with "AVG " + `session_id` is [inference] from `docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-d4247b.json` names ("AVG d4247b B pass 0/4 baseline 1"). |

**Proposed** (each needs a schema change, because `hudUpdatePayloadSchema` is a `z.strictObject` and the plugin refuses unknown fields, `hud-protocol.ts:10-11`; an engine-hosted deck would read the session directly, but the field list below still holds):

1. **Variant labels and copy names, and the copy list at every stage of a Variants edit** ("natural", "dramatic", "soft"; "AVG landscape_golden_hour A"). The labels are in the intent (`engine/intents/landscape_golden_hour.json:9-11`) and the engine's `Target.label` (`engine/src/session/variants.ts:88`, 109); the copy names are `copyName()` (`copies.ts:51`) and `variantEntry().copy_name` (`copies.ts:54`). Neither is in the payload per copy, and `variants` itself is sent only at `awaiting_pick` (`payload.ts:43`). The Variants way-back line ("Copies: “AVG landscape_golden_hour A–C”") needs the names too.
2. **Variant thumbnails.**
   - Each copy's last render is kept in memory as `v.last.jpeg` (`variants.ts:109`).
   - Text fields are capped at 120 bytes (`hud-protocol.ts:51`), so the image needs another channel.
   - Preview files are deleted after the engine reads them (`engine/src/preview/service.ts:6`), so a thumbnail file needs its own lifetime.
   - Lightroom's own thumbnails would be the native alternative. Whether the SDK can hand one to another process is [unverified].
   - The drawn size is 138 x 92 CSS px (§7). Spec v2 sizes thumbnails from Option C's figure (`lrc-avg-hud-spec-v2.md:443`, which still says 144 x 96); 480 px covers 138 x 92 at 300 % (414 px) [inference, the same arithmetic].
3. **Per-copy change summary: the copy's settings after pass 0 and its corrections, minus the baseline** (round 3; round 2 showed the requested priors, which is what was asked, not what the copy holds). The baseline is copy A's settings after pass 0, the intent's own priors only (`landscape_golden_hour.json:7`). From the real run (`20261001-d4247b.json`, `passes` entries with `n` 0, `settings_after`):
   - B: Contrast +20, Blacks +5, Clarity +10, Dehaze +10. Its guardrail correction set Blacks to +5 (`guardrail_actions[0].changes` {blacks: 5}, "clip_low_pct was 3.4743 %"); pass 0 had asked −15. The row carries the half-filled mark after "Blacks", and its tooltip says "asked −15".
   - C: Contrast −10, Highlights −15, Shadows +15, Clarity −10 (C's `settings_after`: −10, −56, 35, −8; A's: 0, −41, 20, 2).
   - A: none.
   - A pre-correction value is never drawn as the copy's state. The same holds for the Pass n rows: `deltas[].after` is the pre-correction value (see the existing table), so the deck needs post-correction `after` values there too (proposed).
   - `deltas` covers only the target's last pass (`payload.ts:45`), so the cards need their own field.
4. **Per-copy guardrail** for the cards: B "corrected", A and C green. Today the payload has one `guardrail`.
5. **Whole-edit diff** since the pre-session snapshot (the right block in C, P and W). The engine holds the start settings (`payload.ts:62`, `s.startSettings`), but no field carries the diff.
6. **Per-pass guardrail history** for the timeline marks. Alternatively the deck can remember each update's `guardrail` per `pass` itself, but it loses that history on restart.
7. **Slider ranges** for the mini tracks, kept on the deck side and keyed by `engine/src/params/labels.ts` labels. Drawn: −100..+100 for most sliders, Tint −150..+150, Exposure −5..+5, Sharpening Amount 0..150, Temp 2000..50000; Lightroom's exact ranges, and that Temp's slider is not linear, are [unverified]. A row is drawn without a track when before or after is not a number (Profile, Point Curve: `payload.ts:95-98` `shown()` sends "curve").
8. **Row order** as in Lightroom's Basic panel, then Tone Curve, HSL/Color, Color Grading, Detail, Lens; sorted on the deck side. `deltas` arrive in change order (`payload.ts:45`).
9. **Connection state** for D. Today only the plugin knows it (`HudView.lua:66`). A helper host also needs its own "engine gone" state (§2).
10. **New events** (`HUD_EVENTS`, `hud-protocol.ts:48`):
    - `hud_show {variant}`: choosing a card selects that copy in Lightroom. Spec v2 E12 says "no in v1" (`lrc-avg-hud-spec-v2.md:276`); the mockups follow that. Kept here for open question 2;
    - `hud_select_target`: re-selects the edit's photo after "Target changed".
    - The plugin already has `select_photo` (`plugin/LrC-AVG.lrplugin/Catalog.lua:15-17`, routed in `Dispatch.lua:36`).
11. **Numbers formatted as Lightroom's Basic panel writes them**, on the deck side: U+2212 minus; "+" on positive values of signed sliders (not Temp, Sharpening Amount or Noise Reduction Luminance); Exposure to two decimals ("+0.33 → +0.70"); Temp with a thousands separator. The stage panel writes them the same way (`stage/stage.js` `fmt()`) [stage]. The payload sends a hyphen-minus and bare numbers (`payload.ts:106`, `shown()`). The delta column keeps its own form ("+0.37", "−3").
12. **No repeated notes for the deck.** The engine leaves out, for this host, the notes that repeat what the deck already says: the defaults at `awaiting_pick` and `converged` ("Pick a copy here, or tell Claude which one.", "Accept keeps the edit; Abort puts the photo back.", `hud-actions.ts:286`, 288-289); the approval note "Claude's pass 2 waits for your Approve of pass 1." (`approval.ts:156`); the cap note "All 6 passes are used. Accept keeps the edit; Abort puts the photo back." (`hud-actions.ts:290`); and the end notes that repeat the headline, "Accepted: the edit is kept." (`hud-actions.ts:224`) and "Aborted: the photo is back as it was before the edit." (`hud-actions.ts:125-127`). Today's floating HUD needs them, so this is a per-host choice in the engine. The deck does not filter notes by their words.

---

## 6. Copy

**Existing strings, used verbatim** (`plugin/LrC-AVG.lrplugin/HudText.lua` line in brackets, unless another file is named):
- HEADLINE.awaiting_pick "Your turn: pick a copy, or tell Claude which one." (46)
- HEADLINE.approve "Your turn: approve pass %d so Claude can go on." (47); a no-break space keeps "pass 1" on one line
- HEADLINE.converged "Your turn: Claude thinks the edit is done." (48)
- HEADLINE.not_connected "Claude is not connected. Your edit so far stays." (42)
- HEADLINE.working "Claude is working. Nothing needed from you." (45); HEADLINE.accepted "Done: the edit is kept." (50)
- STEP.awaiting_claude "Claude is looking at the result" (60)
- UNDO "To undo it: Develop > Snapshots > %s" (72), split after "Snapshots >"; Converge only
- CLIPPING_OK "Clipping: within limits." (75)
- CLICK.sent "%s sent; waiting for Claude." (80)
- Button labels "Accept" and "Abort" (`HudView.lua:207`), and "Approve pass %d" (`HudState.lua:187`)
- Guardrail sentences from `payload.ts:122-133`: "Shadow clipping was 3.47 % (limit 1 %); corrected." (no-break spaces keep "3.47 %" and "(limit 1 %)" whole), "Clarity: change held to ±4 this pass.", "Pass undone: highlight clipping went over the limit."
- Engine note: "Picked B: Claude continues on copy B at its next call." (`hud-actions.ts:261`). The approval, cap and repeated end notes are left out for the deck (§5 field 12).
- Slider labels Profile, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, "Point Curve", "Sharpening Amount" (`engine/src/params/labels.ts`)
- Referenced but not drawn: HEADLINE.gone, .checking, .target_changed, .aborted, .ended, .none, and CLICK.no_answer

**New strings, all proposed:**
- "Working" (collapsed bar)
- "pass 2 of 6" (lower case, standing alone); "pass 0 · 3 copies"; "copy B · pass 0" (after the pick); "_DSC0412.NEF · 3 copies" (V bar)
- Block headers "Pass 2" (round 2: "Pass 2 · this pass"); "Pass 2 · undone"; "Whole edit · since the pre-session snapshot"
- "not kept" (an undone pass's rows)
- "+3 more" plus the hidden labels (overflow line)
- "Each copy's changes beyond the baseline" (caption above the cards); "No change beyond the baseline" (card A); "Picked" (card B after Continue); "asked −15" (tooltip of a corrected card row)
- "Choose a copy to continue on"; "Click a card." (without focus); "Click a card, or press 1, 2 or 3." (with focus)
- "Continue on copy B" (the primary; today "Pick B", `HudState.lua:184`); "Show the copies" (the V bar's primary)
- "Your turn: all 6 passes are used." (the cap read as your turn)
- The consequence lines (built from the shared brief and the engine's notes, not in the gateway):
  - "Claude continues on copy B at its next call." (the engine's words, `hud-actions.ts:261`)
  - "Ends the edit; the sliders stay as they are."
  - "Ends the edit after Claude's current step." (Accept while Claude works; `hud-actions.ts:199`; a tooltip in the W bar)
  - "Keeps copy B; the other copies stay." (from `hud-actions.ts:223`)
  - "Lets Claude write pass 2."
  - "Puts the pre-session snapshot back." (Abort, Converge)
  - **"Leaves the master as it was; the copies stay in the catalog."** (Abort, Variants: V, VB, Vp; `engine/src/session/end.ts:4-7`, :114; `hud-actions.ts:125`; `variants.ts:4`)
  - **"Copies: “AVG landscape_golden_hour A–C”"** (the Variants way-back line in place of UNDO; names from `copies.ts:51`)
  - P tooltips: "Accept keeps the edit as it is now." and "Abort puts the pre-session snapshot back." (`approval.ts:165-167`)
  - Collapsed bars: W "Abort puts the pre-session snapshot back."; C "Accept ends the edit; the sliders stay." and "Abort puts the pre-session snapshot back."; V "Abort leaves the master as it was; the copies stay in the catalog."
- "Press again to abort"; "Ctrl+Backspace again; / Esc or 3 s cancels."
- "Off until Claude answers." (sent); "Off until Claude is connected." (D, once, under both buttons; built on REASON.not_connected, `HudText.lua:86`)
- "Each step in History starts with “AVG 4f2a1c”." (the prefix is [inference], §5)
- The identity line formats "_DSC0412.NEF · ISO 100 · 1/250 s · f/8" and "_DSC0412.NEF / AVG landscape_golden_hour B"

**Words:** "edit", "copy", "pass", "snapshot", "History". The words "session", "engine", "stage", "seq" and "payload" appear nowhere on the deck ("pre-session" appears only inside the snapshot's own name and the phrase "pre-session snapshot", as in the brief).

---

## 7. Design-system refinements (within the shared system)

- **Tabular figures** are on for the whole deck except prose and identifiers that contain hyphens. With `tnum` on, Inter widens the hyphen ("pre - session", "2026 - 10 - 04", seen in a round-2 render). So the undo line, consequence lines, block sub-headers, notes, card text and D's undo block set `tnum` 0. Numbers in columns (values, deltas, pass counts, keycaps) keep it.
- **Cards are 368 x 114, not about 220 x 120.** At this height a card holds a thumbnail you can judge (138 x 92, larger than Lightroom's 100 x 67 filmstrip thumbnail [stage]) next to a 2 x 2 change grid and a two-line guardrail sentence. They were 120 tall; 6 px went to the one-line caption that states the cards' basis. The change grid is 56 / 24 / 72 / 24 px with 6 px gaps and right-aligned values. It reads down the columns in Basic-panel order (B: Contrast, Blacks | Clarity, Dehaze), so a corrected row's mark sits after its own slider name ("Blacks ◐ +5"), not in the gap before the next pair.
- **Mini track** (round 3, simplified to Lightroom's form; zoomed at 3x with `zoom.cjs` on `#crop-3`):
  - a 2 px `line` track, 100 px;
  - one filled `text` thumb (Lightroom's triangle) below the track, at the after value;
  - the segment from before to after in `accent` at 60 % opacity, at least 2 px; no arrowhead, no before tick, no zero tick;
  - the before value appears only in the "a → b" text;
  - an undone pass: thumb in `text3` at the before value (where the slider is), no segment.
  - Mark opacity (this segment and the halo) is the only opacity used. No surface is transparent.
- **Rows** are 18 px: label 108, track 100, "a → b" 88, delta 36, with 8 px gaps (356 px). The "a → b" column grew from 76 to fit "+0.33 → +0.45" (88 px, `measure-text.cjs`), and the track gave up 12 px. An undone block's delta column is 48 ("not kept" is 46 px). A block holds a header and 5 row slots (header 16 + 2, slots 90, guardrail line 2 + 16: 126 px under an 11 px top pad, inside the 143 px deck).
- **Overflow rule** (proven in `#crop-5` with 12 rows, the payload's maximum): rows are sorted in Basic-panel order; "Pass n" may flow into a second sub-column (10 slots); "Whole edit" keeps one (5 slots). When rows do not fit, the last slot reads "+n more" in `text3`, followed by the hidden labels (ellipsis; hover lists them all). With two sub-columns plus Whole edit, the centre is 356 + 24 + 356 + 48 + 356 = 1140 of 1240 px.
- **Undo line** is 12/400 `text2`, not 11 px: it is the principle-4 exit, and 11 px is for key hints and captions. The snapshot name is 250 px wide with `tnum` off (`TNUM=0 node option-c/measure-text.cjs`), inside the 268 px column. The Variants copies line is one line, 239 px.
- **Abort row:** Abort is 24 px; its consequence sits 4 px down, so the first line centres on Abort's label whether it has one line (Converge) or two (Variants: 1010 vs Abort's 1006, `review-c-r3/geom.cjs`). The armed hint (two 11 px lines) centres on the button. The V hint box is 52 px, so Abort stays at y 1006 whether or not a card is chosen.
- **Secondary button:** outlined (`line` border, `text` label, 13/500), the size of the primary in the expanded right column and 28 px in the bar. Used for Accept wherever Accept is allowed but is not the turn's action. Two smaller forms: P's compact 24 px outlined Accept beside Abort, and the W bar's text-only Accept (`text2`, no border), so the working bar asks nothing.
- **Colours:** `audit.cjs` reports `off-token []` for all 19 decks (2 context frames, 17 crops). Every fill, stroke, text, background, border and focus-outline colour is one of the 12 Instrument tokens.
- **Sizes:** the smallest font is 11 px (keycaps with focus, the card caption and the armed Abort's line); the turn sentence is 15/600 (`audit.cjs` "minFont"). `audit.cjs` reports no text outside its column and no overlapping text; the two "+n more" lines are reported as cut by design. A negative test (the collapsed bar's consequence text moved 934 px left onto the status text) reported 9 overlaps in round 2.

---

## 8. Trade-offs

**For:**
- It is the best surface for Variants. The three copies sit side by side at 138 x 92, directly under the photo, with their look, what each copy holds in Lightroom's words (after corrections) and their clipping outcome. The pick is one click (or one key, with focus) plus Enter.
- It never covers the photo, the Develop panels, Snapshots or History. In Develop, Lightroom's own way back (Develop > Snapshots) stays visible next to the deck's undo line; in Library, or with the left panel hidden, the deck's undo line carries principle 4 (`PRODUCT.md:39`) alone.
- The full width holds the turn, the evidence (this pass plus the whole edit) and the action in one glance, with no drop-down.
- It sits 76 px below the photo's bottom edge (860 vs 936 [stage]), so the eye moves only a short way between the photo and the turn.

**Against:**
- **It covers the filmstrip, where the virtual copies live.** The deck compensates in seven ways:
  1. the cards show the copies, larger than the filmstrip does, with what each holds;
  2. at rest the deck is the 44 px bar, which keeps every thumbnail whole and clickable (§1); it opens only when the photographer opens it (§2), and closes on Esc or the triangle;
  3. choosing a card does not change Lightroom's selection in v1 (spec v2 E12), so the loupe keeps the copy the gateway selected last (§3); comparing at full size means opening that copy from the filmstrip with the deck at rest. `hud_show` (open question 2) would let the card do it;
  4. during an edit, selecting a photo outside the edit only produces "Target changed" (`hud-protocol.ts:30-31`), so the filmstrip's main job is paused anyway;
  5. the filename and the copy name the filmstrip header showed move into the deck's identity line, each card's tooltip names its copy, and the Variants way-back line names all copies;
  6. the Done bar can be closed (× or Esc), and hides itself when a photo outside the edit is selected (proposed), so between edits the filmstrip header comes back;
  7. Lightroom's menu commands for moving between photos remain [unverified: which ones and their keys].
- **The filmstrip header's controls are hidden** while the deck is shown, at either size: the second-window buttons, the source path and photo count, the Filter.
- **The expanded deck hides Lightroom's filmstrip toggle** (x 956, y 1074 [stage]).
- **Geometry is assumed.** Lightroom lets the photographer resize or hide the filmstrip [unverified], and no SDK call reports its height [inference]. The deck anchors to the bottom of Lightroom's client area. With a taller filmstrip it covers less of it; with a shorter or hidden filmstrip the expanded deck covers the bottom of the loupe. Mitigation (round 3): the deck never opens by itself, so it covers the loupe only when the photographer opens it, and the photographer can set the expanded height, remembered per monitor (§2). The 44 px bar still covers the loupe's bottom 44 px when the filmstrip is hidden [inference].
- **The host is unresolved, and D depends on it** (§2, §9 question 6).
- **Small windows:** the three columns at full card size need 1816 px (380 + 1136 + 300). In a narrower Lightroom window the cards would have to shrink to the thumbnail plus the name, or the left column would fold into the collapsed-bar form [inference: not drawn].

---

## 9. Open questions (for Jim)

1. **Auto-expand or never?** Round 3 makes (b) the default until the filmstrip geometry is measured (spec v2 open item 26):
   - (a) Expand once per turn, per new note at `awaiting_claude`, and on lasting problems (the round-2 rule; an option once the geometry is known).
   - (b) Never expand on its own: the collapsed bar carries the turn and its primary (`#crop-9`, `#crop-16`), and the photographer opens the evidence on demand (now the default, drawn).
2. **Two-step pick.** Spec v2 E12 says choosing a card does not select the copy in v1, and the mockups follow it (`#ctx-variants` shows copy C in the loupe with B chosen). Should a later version select the copy (proposed `hud_show`)?
3. **Real filmstrip height.** Proposed now: the photographer sets the expanded height, remembered per monitor (§2). Should the deck also follow a filmstrip the photographer resized, once that height can be measured?
4. **Variants timing (for the lead's shared scene).** The shared scene shows the pick after pass 0. The engine raises `awaiting_pick` only once every copy has had its refined pass (`engine/src/session/pick.ts:21`, `passes >= 1`; `variants.ts:19-22`), so "pass 0 · 3 copies" is unreachable in the running engine. The crops still follow the shared scene. If the shared Scene V moves to pass 1, the deck shows "pass 1 · 3 copies" with passes 0 and 1 done; the layout is unchanged.
5. **Ctrl+Backspace hint.** Is a tooltip plus the armed line enough, or should the right column drop the undo line's first half ("To undo it: Develop > Snapshots >") to make room for the hint?
6. **Who hosts the window?** The engine (Node) or a helper process? Only a host that outlives the engine can show D and Gone (§2); until this is decided, the plugin's floating dialog stays the fallback for those two.
7. **Stage mismatches, for the lead's shared stage** (`option-c.html` patches the first two in its rendered frames; `stage/stage.js` is unchanged):
   - `BASIC_BASE` gives copies B and C the pre-session values (Highlights −21, Shadows +10, Vibrance 0) instead of the baseline (−41, +20, +10), and copy B Blacks −15 instead of the corrected +5 (`20261001-d4247b.json`, `passes` entries with `n` 0, `settings_after`). The shared Scene V's "Blacks 0 -> −15" for copy B is stale for the same reason.
   - The histogram readout shows "18 mm" (`stage/stage.js:233`), a focal length that is in neither the scene data nor the payload.
   - Scene W is at pass 2, but the converge stage shows the Basic values and History after pass 1 (`stage/stage.js` `BASIC_CONVERGE`, `HISTORY_CONVERGE`).
8. **Repeated notes.** Should the engine leave out, for the deck, the notes listed in §5 field 12 (as drawn)? If not, they appear on the note line and repeat the headline.
9. **Cap reached as your turn, engine side.** The deck now reads `awaiting_claude` with `pass` == `max_passes` as your turn (`#crop-8`). Should the engine also raise a your-turn stage there, so every host (today's floating HUD included) shows Accept as the turn's action?

---

## 10. Round 3 changes (review findings applied)

- Key hints only with keyboard focus (§3); hero, `#crop-1`, `#crop-3`, `#crop-9` re-rendered without keycaps.
- Variants way back: Abort "Leaves the master as it was; the copies stay in the catalog."; the copies line replaces the Snapshots line in V, VB, Vp and the V bar (§2).
- Cards show post-correction values ("Blacks ◐ +5", asked −15 in the tooltip); field 3 redefined (§5).
- P keeps Accept as a compact secondary beside Abort; the round-2 "Known gap" is gone.
- Abort row alignment; the V hint box is 52 px so Abort does not move.
- Undone pass rows: "Pass 2 · undone", `text3`, thumb at before, after struck, "not kept".
- Mini tracks simplified to Lightroom's one-thumb form; timeline marks 9 px; "held" is a bar between two stops.
- Repeated lines removed: Done note (Converge), P's approval note, D's "Off" lines (one line), "· this pass".
- The cap is your turn on the deck side, with Accept as the primary.
- W bar: Accept text-only, one consequence phrase.
- Hero: focal length blanked; copies' Basic values patched; Lightroom's selection left on copy C (spec v2 E12).
- After the pick: "copy B · pass 0"; the copy list is kept by the deck (field 1 extended).
- §3 follows spec v2 §4.2 (no `WS_EX_NOACTIVATE`; pointer clicks activate; focus returns after a pointer action).
- Never auto-expand is the default; user-set expanded height per monitor (§2); new state V at rest (`#crop-16`).
- Values formatted as Lightroom writes them ("+0.33 → +0.70").
