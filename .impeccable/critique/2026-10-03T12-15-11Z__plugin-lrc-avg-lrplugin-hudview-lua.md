---
target: HUD (plugin/LrC-AVG.lrplugin/HudView.lua)
total_score: 20
p0_count: 0
p1_count: 4
timestamp: 2026-10-03T12-15-11Z
slug: plugin-lrc-avg-lrplugin-hudview-lua
---
Method: dual-agent (A: design-review sub-agent · B: detector sub-agent), isolated. Code-based: the HUD renders only inside Lightroom, so the window was reconstructed from `HudView.lua`; whether text past 72 chars clips or wraps is [unverified].

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Stage updates live; "your turn" looks the same as "Claude working" |
| 2 | Match System / Real World | 1 | `lr_begin_session`, `hsl.orange.sat`, "Metrics", "Converged", "q75", "decay", "recipe written" |
| 3 | User Control and Freedom | 3 | Abort always there (306 ms, PHASE5.md AC-2); a disconnect removes every exit |
| 4 | Consistency and Standards | 2 | Lowercase wire slider names vs Lightroom's labels; three names for one window; "NOT sent" caps |
| 5 | Error Prevention | 2 | Good greying + pending lock; Accept live during a pick only to be refused; Abort first, unconfirmed |
| 6 | Recognition Rather Than Recall | 3 | Everything on screen; long names push the copy letter off the Target line |
| 7 | Flexibility and Efficiency | 1 | No shortcuts; Pick/Approve have no menu item |
| 8 | Aesthetic and Minimalist Design | 1 | 28 fixed rows, 12 blank grid rows, 3-line settings block, dead buttons all session |
| 9 | Error Recovery | 2 | Notes suggest next steps but leak codes (`INVALID_ARGS`); disconnect gives no way back |
| 10 | Help and Documentation | 2 | README HUD section is good; the HUD never points to it or to the snapshot |
| **Total** | | **20/40** | **Acceptable (bottom of band)** |

## Anti-Patterns Verdict

**LLM assessment:** Not visual slop: native controls, no decoration, a layout that never shifts. It fails the product test instead. A Lightroom-fluent photographer would stop at about a dozen strings taken straight from the wire or the logs. That is PRODUCT.md's first anti-reference, the debug console, almost verbatim.

**Deterministic scan:** 0 findings, and the zero means nothing. The detector's folder walk only collects web extensions (`detector/node/file-system.mjs:13-17, 29`), so scanning `plugin/LrC-AVG.lrplugin` examined no files. Scanning each file by name does read it, but only with Tailwind/inline-style/CSS regexes (`detect-text.mjs:462-474`), which LrView Lua never matches. No false positives.

**Visual overlays:** none. The target is a native Lightroom dialog with no URL, so the browser step was skipped.

## Overall Impression

The structure is sound: every click is accounted for, the layout is stable, and the controls are native. But the window reads as a developer's status panel. The biggest opportunity is one "whose turn is it" headline at the top, in a photographer's words, with the action buttons directly under it.

## What's Working

1. **Every click says what happened.** A pending lock with a 10 s ceiling, then "sent", "NOT sent: <reason>" or the engine's answer (`Hud.lua:209-248`). This meets principle 4 already.
2. **Stable native layout.** Fixed rows, `group_box`, buttons greyed rather than hidden, and the Approve title bound to the pass number (S8.md Numbers).
3. **The engine's notes already have the co-pilot voice:** "Pick a copy here, or tell Claude which one." (`hud-actions.ts:278`) and "Converged: Accept keeps the edit, Abort puts the photo back." (`:280`).

## Priority Issues

**[P1] Engine words throughout**
- Why: breaks principle 1 and fails the PRODUCT.md success test for a first-time photographer.
- Examples: hint `lr_begin_session` (`HudView.lua:59`); slider column sends canonical names (`payload.ts:99` `slider: c.name`); guardrail reasons in wire terms (`payload.ts:116-118`); "Metrics", "Converged" (`HudView.lua:29-30`); "the recipe written" (`hud-actions.ts:215, 288`).
- Fix:
  - "No edit running. In Claude Desktop, ask Claude to edit the selected photo."
  - "Connected to Claude Desktop" / "Not connected to Claude Desktop".
  - Stage labels: "Rendering a preview", "Measuring the preview", "Claude is looking at the result", "Claude thinks the edit is done".
  - Slider column: Lightroom's panel labels ("Exposure", "Orange Saturation"), mapped in `engine\src\params\` (the only place allowed to know SDK names).
  - "Clipping: within limits" for green.
  - Drop "recipe".
- Command: `/impeccable clarify`

**[P1] Nothing says "your turn", and the ask is buried**
- Why: the top line is Connection, the least useful line in normal use. Whether you're needed is split across Stage (row 4), the note (row 19) and button greying (rows 20-22). Someone glancing over from the chat misses a pick or an approval. Breaks principle 2.
- Fix: a headline first, buttons right under it with the current action first and Abort last, then one feedback line merging `note` and `lastAction`:
  ```
  Your turn: approve pass 2 so Claude can make pass 3.
  [ Approve pass 2 ]  [ Accept ]  [ Abort ]
  Approve sent; waiting for Claude.
  ```
- Command: `/impeccable layout`

**[P1] A disconnect or engine restart leaves no exit, and can mislead**
- Why: disconnected, the HUD greys everything and says only "Buttons off: the engine is not connected." (`HudView.lua:62`).
- After Claude Desktop restarts the engine, the HUD still holds the old session [inference from the code]:
  - It reads "Claude session active" with live buttons (`HudView.lua:97, 114`).
  - An Abort gets "That session is not open in the engine." (`hud-actions.ts:61`). `answerClick` returns false because no channel matches (`publisher.ts:100`), so the user sees only "no answer from the engine within 10 s" and is never told the photo was **not** put back.
- Fix:
  - Disconnected hint: "Claude Desktop is not connected. Your edit so far stays. To undo it: Develop > Snapshots > AVG pre-session …".
  - On reconnect, treat the shown session as unknown until an update for it arrives.
  - The engine answers a click for an unknown session with an end update that names the snapshot.
- Command: `/impeccable harden`

**[P1] Keyboard operation is required but unverified, and Abort is the first control**
- Why: PRODUCT.md requires keyboard operation. The HUD takes the keyboard when it opens (S8.md Numbers, "Keyboard stayed": no), and Abort is its first button (`HudView.lua:161`), so focus may land on it [inference]. Tab/Space/Enter in the floating dialog are [unverified]. Pick and Approve have no menu item (`Info.lua:24-27`). The 5 s auto-close (`HudState.lua:24`) is a time limit on reading the outcome.
- Fix:
  - Put Abort last.
  - Add "Approve Pass" and "Pick A/B/C" menu items.
  - Keep the ended HUD open (or ≥15 s).
  - Run a small Jim-observed spike that records Tab, Space and Enter behaviour.
- Command: `/impeccable audit`, then `/impeccable harden`

**[P2] Every field shown at once**
- Why: mid-session, a photographer's glance is spent on "preview 1600 px q75" and "decay 1, 0.6, 0.4, 0.25" (`HudView.lua:42-53`), 12 grid rows that are mostly blank, Pick/Approve rows dead for whole modes, and an always-on "Selection: the session's photo." (`HudState.lua:212`).
- Fix:
  - Settings → one line ("Autonomous, up to 4 passes") or Plug-in Manager only.
  - Show the selection line only when the target has changed.
  - Hide the mode-irrelevant button rows with `visible = bind(...)` [unverified in this project; spike first].
- Command: `/impeccable distill`

## Persona Red Flags

**Jordan (photographer who didn't build it):**
- Meets `lr_begin_session`, "Engine connected" (which engine?), "Metrics", "Converged", "Guardrails: clamped: exposure: pass 2 allows at most ±0.3 (0.5 x decay 0.6)" and `hsl.orange.sat`.
- Pick A-C stay greyed through a whole Converge session, so Jordan wonders whether they should be picking.
- Abort sits beside Accept at equal weight, with no hint that it returns to the pre-session snapshot.
- The window disappears 5 s after Accept.

**Alex (power user):**
- No shortcuts.
- The HUD takes the keyboard at every open and breaks `\` Before/After (S8.md).
- Every button locks for up to 10 s after any click (`HudState.lua:26`).
- Slider names don't match the panel he edits in.

**Sam (keyboard only):**
- Tab order and activation keys are [unverified].
- Abort is likely the first focused control [inference].
- Focus jumps into the HUD unannounced.
- The 5 s auto-close.
- Pick and Approve can be reached by keyboard only through the chat.

## Minor Observations

- Pass 0 repeats itself: "Stage: Pass 0: profile, lens and baseline  (pass 0 of 4)". `pass` is always sent (`payload.ts:36`), the stage line appends it (`HudView.lua:70`), and it puts two spaces before "(pass".
- Double colon: "Guardrails: clamped: exposure: …" (`HudView.lua:101` + `payload.ts:118`).
- With no session and no engine, the hint still says Claude will start one: the `s == nil` check comes before the connection checks (`HudView.lua:59-62`).
- The Target line is 72 chars wide while filename and copy name may each be 120 (`HudState.lua:20`). The copy letter at the end, "(AVG landscape_golden_hour B)", is the first thing to go, and the copy name shows the intent id with underscores.
- Delta cells are 20/10/10/10 chars. "grading.highlights.hue" and "Adobe Landscape" overflow them [inference].
- Accept is live during awaiting_pick, then refused by the engine ("Accept keeps the pick's edit: click Pick first, or Abort.", `hud-actions.ts:177`). Grey it in the plugin.
- "NOT sent" in capitals (`Hud.lua:213-236`) is harness-dialog style, not product copy.
- The camera line is the only unlabelled line (`HudView.lua:99`).
- `lastAction` outlives the session it describes (cleared only on a new session, `Hud.lua:187`).

## Questions to Consider

1. The HUD's one job is "is it my turn?". Why is the top line about the connection, and why is the answer split across three places?
2. Who acts on "decay 1, 0.6, 0.4, 0.25" mid-edit? What would be lost if the HUD showed no settings at all?
3. The HUD takes the keyboard whenever it opens. Should it open by itself only when it needs you (a pick or an approval), rather than at every session start?
