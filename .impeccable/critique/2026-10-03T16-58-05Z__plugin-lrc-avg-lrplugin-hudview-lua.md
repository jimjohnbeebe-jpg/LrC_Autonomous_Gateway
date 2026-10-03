---
target: HUD (plugin/LrC-AVG.lrplugin/HudView.lua)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:D:\\Developer\\LrC_Autonomous_Gateway\\plugin\\LrC-AVG.lrplugin\\HudView.lua"
target_fingerprint: "sha256:7fe39f66b5545f28d5262eacc0980c38d499e1bb7cb1e36461c44397ec6b1802"
target_path: "D:\\Developer\\LrC_Autonomous_Gateway\\plugin\\LrC-AVG.lrplugin\\HudView.lua"
timestamp: 2026-10-03T16-58-05Z
slug: plugin-lrc-avg-lrplugin-hudview-lua
---
Method: dual-agent (A: design-review sub-agent · B: detector sub-agent), isolated. Code-based: the HUD renders only inside Lightroom, so the window was reconstructed from `HudView.lua:200-210`; on-screen facts come only from Jim's check runs (`docs\reports\phase6\hud-p1-check\check.txt` §3, LrC 15.6). Re-run after fix/hud-p1 (PR #63, `39c5657`), on `main` `91d6044`. Baseline: 2026-10-03T12-15-11Z, 20/40.

## Design Health Score

| # | Heuristic | Was | Now | Key Issue |
|---|-----------|-----|-----|-----------|
| 1 | Visibility of System Status | 3 | 3 | Headline-first works, but it reads the stage only: when a note asks for a click, the headline still says "Nothing needed from you" |
| 2 | Match System / Real World | 1 | 2 | Wire names gone; left: "pass" (unexplained), "baseline", "Target changed", "decay", "q80", UTC snapshot name |
| 3 | User Control and Freedom | 3 | 3 | Abort live and last; the way back (snapshot) shows only while disconnected; nothing after "Done: the edit is kept." |
| 4 | Consistency and Standards | 2 | 3 | Lightroom labels; copy vs variants, edit vs session drift; Claude's revert says "The edit has ended.", your Abort "Done: the photo is back as it was." |
| 5 | Error Prevention | 2 | 3 | Greying matches engine refusals; pending lock; Abort last |
| 6 | Recognition Rather Than Recall | 3 | 3 | Menu items mirror buttons; what a "pass" is needs the README |
| 7 | Flexibility and Efficiency | 1 | 2 | Menu items + Tab/Space/Enter (check.txt:255-258); no shortcuts, 3-level menu, HUD takes the keyboard on auto-open |
| 8 | Aesthetic and Minimalist Design | 1 | 2 | +1 for headline-first only; ~32 fixed rows (was ~28); settings, camera, 12 grid rows in every state |
| 9 | Error Recovery | 2 | 2 | No codes; but a "not sent" line is wiped by the next update, and "Click Abort again" sits under "Nothing needed from you" |
| 10 | Help and Documentation | 2 | 3 | Empty/broken states point somewhere; the undo line names the snapshot |
| **Total** | | **20** | **26/40** | **Acceptable (top of band)** |

## Design Specificity Verdict

**LLM assessment:** The top third is authored for this product: the turn grammar ("Your turn: …" / "Claude is working…" / "Done: …", `HudText.lua:39-53`), an undo line that names the real snapshot (`HudText.lua:72`), Lightroom's slider labels (`labels.ts:10-42`) and guardrail sentences in photographer terms (`payload.ts:119-170`). The bottom two thirds is still category-interchangeable: settings dump, camera line, an always-on "Selection: OK", a connection line, and a 12-row grid that is mostly blank. That half is PRODUCT.md's "debug console" anti-reference with friendlier words.

**Deterministic scan:** 0 findings, both runs (folder and the 7 files by name; exit 0). The zero means nothing: in impeccable 0.1.11 the folder walk skips `.lua`, and a named `.lua` file is only matched against CSS/inline-style patterns (a CSS line copied into a `.lua` control file fired `overused-font` only). LrView has nothing those rules can match. No false positives.

**Visual overlays:** none. Native Lightroom dialog, no URL; browser step skipped.

## Overall Impression

fix/hud-p1 did its job: the window now leads with whose turn it is, and the disconnect story is observed and reassuring. The one real defect left is that the headline can contradict the note at exactly the stressful moments. The biggest remaining opportunity is cutting the bottom half.

## What's Working

1. Turn grammar on top, buttons under it, Abort last (`HudView.lua:200-207`), observed (check.txt:132-135, 197-200).
2. Disconnect/restart: "Checking this edit with Claude..." → "no longer open" (`HudState.lua:179-182`), undo line naming the snapshot (`HudView.lua:76-81`), the engine answers a click on a lost edit (`events.ts:93-111`); observed (check.txt:167-169, 231-233).
3. Photographer's words in the grid and clipping sentence (`labels.ts`, `payload.ts:119-170`); every button has a menu item (`Info.lua:28-33`).

## Priority Issues

**[P1] The headline says "Nothing needed from you" when you must click.**
- Why: `HudView.lua:66-72` builds the headline from the stage alone; the engine signals "you must click" only in the note, at stage `awaiting_claude`: failed Abort (`hud-actions.ts:156, 165`), failed Accept (`:226`), all passes used (`:290`). Under "Claude is working. Nothing needed from you." the note says "Click Abort again." Breaks principles 2 and 4 at the riskiest moment.
- Fix: an optional `ask` field in `hud_update`, shown as the headline when present: "Your turn: Abort did not finish. Click Abort again." / "Your turn: Accept did not go through. Click Accept again." / "Your turn: all 4 passes are used. Accept or Abort." Also "working" → "Claude is working. Nothing needed here." (the HUD cannot see a question Claude asks in the chat).
- Command: /impeccable harden

**[P2] The bottom half is still a debug console.**
- Why: settings block (`HudView.lua:41-57`), camera line (`:91-99`), "Selection: the edit's photo." (`HudState.lua:228`), "Connected to Claude." (`HudText.lua:66`) and 12 reserved grid rows show in every state; Pick/Approve are dead for a whole Converge edit.
- Fix: drop camera + settings (or one line "Approve each pass, up to 4 passes"); selection line only when wrong, connection line only when not connected; fit grid rows and buttons to the edit with `visible = bind(...)` (spike first, [unverified] in this plugin).
- Command: /impeccable distill

**[P2] Engine words remain.**
- Fix: `HudText.lua:58` "…lens corrections and baseline" → "Setting the profile and lens corrections"; `HudState.lua:237` "Target changed: X is selected." → "Another photo is selected (X). Select Y again; the edit is still open."; `HudView.lua:152` "Session settings:" → "This edit's settings:"; `HudView.lua:45` "variants" → "copies"; `HudView.lua:46, 54` drop "decay", "q80", "preview … px"; `hud-actions.ts:127` "…the edit's log lists them." → "…apply the AVG pre-session snapshot to go back fully."; `hud-actions.ts:284` "last call failed" → "last step failed"; `approval.ts:156` "waits for your Approve of pass 2" → "waits for you to approve pass 2". Snapshot name is a UTC ISO stamp (`begin.ts:49`), hours off the user's clock: local time is Jim's call (logs too).
- Command: /impeccable clarify

**[P2] Lines cut with "..." and an empty right side.**
- Why: at MARGIN 0.95 the note and the clipping sentence (the only place the user learns what the guardrails did) ended in "..." (check.txt:191, 246); empty space at the right at both margins. Already in FEEDBACK.md.
- Fix: back to 0.85 (clean in run 1) and narrow lines and grid together.
- Command: /impeccable layout

**[P2] "Your turn" differs from "working" only in its words.**
- Why: every line is the same `static_text`, same font (`HudView.lua:178`); principle 2 wants these moments to stand out.
- Fix: bold font on the headline slots ([unverified]: nothing in `plugin\` sets `font`; spike first).
- Command: /impeccable typeset

## Persona Red Flags

**Alex (power user, keyboard):** no shortcuts, every action is File > Plug-in Extras > item; the HUD takes focus on every auto-open (`Hud.lua:9-11`); all buttons lock up to 10 s after a click (`HudState.lua:29`); a menu item can wait 20 s silent (`HudClick.lua:113-116`).

**Sam (keyboard only):** no colour-alone meaning (passes). Getting into the HUD needed a title-bar click (check.txt:55), so from Lightroom the menu is the only way in. Empty grid rows and blank slots add empty screen-reader stops [inference].

**The next photographer** (PRODUCT.md, glancing between photo and chat): meets "pass", "baseline", "Target changed", "decay", "q80" and a UTC snapshot name; may see "Nothing needed from you" while Claude asks them something in the chat; the clipping sentence can end in "...".

## Minor Observations

- Three names for one window: "LrC-AVG - Vision Gateway" (`Hud.lua:39`), "Show Vision Gateway HUD" (`Info.lua:27`), "HUD" in the README. "Bridge status" in the menu is an engine word (`Info.lua:26`).
- While an Abort is pending, the headline still says "Claude is working…": no "Putting the photo back" headline.
- Tone curves show as "curve"/"curve" with an empty Change cell (`payload.ts:98`); "copy ?" can appear in the Accepted note (`hud-actions.ts:223`).
- A refusal line is wiped by the next update (`Hud.lua:185-186`, FEEDBACK.md).
- Approve is 16 wide, the others 12 (`HudView.lua:186, 205`); "Lens Corrections (panel on/off)" is not Lightroom's label (`labels.ts:35`).

## Questions to Consider

- If the photographer reads only the headline, what would a HUD of headline + buttons + one feedback line + changed rows lose by dropping the other 14 rows?
- Should "pass" be in a photographer's vocabulary at all, or should Approve read "Let Claude go on (2 of 4)"?
- Should the HUD ever claim "nothing needed" when it cannot see the chat?

## Against the baseline's P1s

| Baseline P1 | Now |
|---|---|
| 1. Engine words | Partly: every example it named is gone; the words above remain |
| 2. No "your turn" | Resolved, observed (check.txt:132-135); new gap: notes asking for a click don't reach the headline |
| 3. Disconnect / restart | Resolved, observed (check.txt:167-169, 231-233) |
| 4. Keyboard | Resolved for the four listed fixes; HUD taking focus on auto-open deferred to Phase 7 (FEEDBACK.md) |
