---
target_identity: "file:D:\\Developer\\LrC_Autonomous_Gateway\\hud\\ui\\index.html"
target_fingerprint: "sha256:0f673eb2a4f5d9b4e196514fe82bed5645e1e7f3638cbada78a9c59a776eca40"
target_path: "D:\\Developer\\LrC_Autonomous_Gateway\\hud\\ui\\index.html"
timestamp: 2026-10-15T01-13-53Z
slug: hud-ui-index-html
---
Method: dual-agent (A: design review · B: detector + browser)

Target: the Deck (hud\ui, rendered from hud\ui-dist at 960 / 1200 / 1460 / 1800 px). Look reference: scratch\reference\20260906-_OZ80005-Edit.jpg.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Sentence + step + timeline are strong; "Claude is working" and "Your turn" share the same 15px/600 type (style.css:84), only glyph + amber separate them |
| 2 | Match System / Real World | 3 | Lightroom number formats right; leaks: "Show Vision Gateway HUD, then Put back" (text.ts:34), ISO-ms snapshot name |
| 3 | User Control and Freedom | 3 | Abort always visible, two-press, Esc never aborts; disconnected shows Snapshot and Put back with no guidance which |
| 4 | Consistency and Standards | 3 | Quiet Accept (while working) looks like a disabled button; off line names the wrong cause when Lightroom is down (view.ts:120) |
| 5 | Error Prevention | 3 | Enter never presses focused button (keys.ts:6); Accept held until a copy is picked |
| 6 | Recognition Rather Than Recall | 2 | Guardrail marks are an unlabeled private glyph language at 9px (glyphs.ts); truncated note readable nowhere (render.ts:62) |
| 7 | Flexibility and Efficiency | 3 | 1/2/3, Enter, Ctrl+Backspace, Esc chain; no keyboard way into the Deck, no key to reopen from the bar |
| 8 | Aesthetic and Minimalist Design | 2 | Each row shows one change three ways (track, before→after, delta); ~12 information pieces at once in the open deck |
| 9 | Error Recovery | 3 | Not-connected puts the way back centre-stage; see wrong-cause off line |
| 10 | Help and Documentation | 2 | Consequence lines are good inline help; nothing explains timeline marks; "Click a card." omits that the copy shows in Lightroom |
| **Total** | | **27/40** | **Acceptable** |

## Design Specificity Verdict

LLM assessment: authored for this product. Lightroom-native slider rows (triangle thumb, U+2212, Exposure to 2 decimals, log Temp, panel order; rows.ts, render.ts:70-84), the way back written as a Lightroom menu path, no keyboard theft (keys.ts), every sentence leads with whose turn it is (text.ts). It goes generic in two places: the filled amber primary + rounded cards (a SaaS pattern; Lightroom chrome is neutral grey), and a centre column thinner than Option C (the "Whole edit" block was deferred), so it reads as a pass log rather than a photographer's summary.

Deterministic scan: `impeccable detect` on hud/ui: 2 findings, both `overused-font` (Inter, style.css:5 and :14); nothing on spacing, contrast, layout, motion or copy. Browser overlay injected on 3 states: working (1 finding, the same font), pick-chosen and error (clean). The font is spec-chosen (Option C, spec 8.1) for tabular numerals; it is a weak finding for an instrument HUD, but it bears on principle 5 (Lightroom-native): whether Lightroom's Windows UI font is Segoe UI is [unverified]. The detector caught nothing the review missed; the review's main issues (clipping, live region, copy) are outside what it scans.

Visual overlays: injected in a scratch harness tab that has since been closed; no overlay is left open.

## Overall Impression

A disciplined, honest instrument with a real turn protocol and safe exits. It breaks at its edges, not its core: the fixed 142px side columns clip exactly the reassurance text principle 4 promises, the screen-reader story is a repaint flood, and the one moment the user must act (the pick) is the weakest screen. Biggest opportunity: make the Deck quiet while Claude works and unmistakable when it is the user's turn.

## What's Working

1. Turn protocol in plain words: "Claude is working. Nothing needed from you." and "Your turn:" prefixes, plus a consequence line under every action (text.ts).
2. Lightroom-native slider rendering and panel order (rows.ts).
3. Safety model: Abort always visible and two-press, Enter never fires the focused button, Esc never aborts, keyboard handed back to Lightroom after each click, exactly one filled primary per state (view.ts:162).

## Priority Issues

1. [P1] Fixed side columns overflow and clip the exit text. Sent: "Off until Claude answers." collides with the undo line, which is cut off; armed hint wraps to 3 lines at 11px; target-changed band runs into the timeline; at 960px card names cut to "A nat…", timeline label to "pass 2 · 3 copie", photo line loses exposure (both assessments; shots sent-1200, C-armed-1200, pick-960, pickchosen-960-kbd). Fix: line budget per column; show the off line instead of consequence lines when buttons are off; undo path on one line with full name in a tooltip; timeline on a fixed row; clamp band/identity to one line. Commands: harden, layout.
2. [P1] Screen reader and keyboard access. aria-live="polite" on the whole host (index.html:11) whose innerHTML is replaced on every state, timer tick and resize (deck.ts:75): floods or gets dropped. Marks and timeline aria-hidden with no text; consequence lines not tied to buttons; arrow in "+0.33 → +0.70" is a hidden SVG; no keyboard way into the Deck. Fix: one visually hidden status node announcing only phase/sentence changes; aria-describedby button→consequence; aria-label on the timeline; revisit Q4 (menu item gives focus when invoked from the keyboard). Commands: audit, harden.
3. [P2] Wrong or merged state copy. Lightroom down says "Off until Claude is connected." (view.ts:120); "Not connected to Claude." also means "no edit open" (text.ts:22, render.ts:142); Approve vs Accept are near-synonyms side by side; quiet Accept looks disabled. Fix: one off line per cause; separate no-edit sentence; relabel Accept by effect (e.g. "Keep and finish", checked against the chat wording); a distinct disabled style. Command: clarify.
4. [P2] The pick has no visible next step. No primary until a card is chosen; Abort (red) is the only button; hint "Click a card." (text.ts, render.ts:131). Fix: "Click a copy to see it in Lightroom, then continue on it." plus a disabled "Continue on copy…" placeholder in the primary slot. Commands: onboard, clarify.
5. [P2] The accent competes with the photo. Against the reference (ochre/red earth, slate-blue sky), Deck amber #eda447 echoes the ochre and working blue #9fb7d4 the sky; a saturated 32px amber block at the photo's edge is the loudest thing after the image and may bias warmth judgements [inference]. Fix: amber only for the turn dot and a 1px ring/focus edge; primary in a light neutral or much lower-chroma amber; chrome strictly neutral grey. Commands: quieter, colorize.

## Persona Red Flags

Alex (power user): no keyboard way into the Deck; key hints only show once it has focus (style.css:41-43); tab order toggle → cards → actions, spec 4.6 says primary first; no key to reopen from the bar.

Sam (screen reader / keyboard): whole-Deck repaint as live region; copy guardrail sentence tooltip-only at ≤1400px; arrow read as "+0.33 +0.70"; 11px armed hint breaks the ≥12px rule.

Lightroom photographer new to LrC-AVG: "pass", "pass 0", "AVG pre-session 2026-10-05T18:42:07.311Z", "Show Vision Gateway HUD, then Put back"; Approve vs Accept; half-disc and H-bar marks mean nothing; at the pick only Abort is pressable.

## Minor Observations

- Working sentence wraps to a one-word last line ("you.") at 1200px; snapshot name breaks mid-word.
- Bar: consequence line floats away from its Abort button (render.ts:51, 55).
- Open deck: quiet Accept has no consequence line, only a tooltip.
- Timeline drops its dots above 8 passes (glyphs.ts).
- .card:disabled { opacity:1 } makes cards look clickable while a click awaits its answer.
- Pulse timer runs every 200 ms while hidden.
- Rows beyond the visible slots are cut by panel order, not weight (render.ts:87-95): the heaviest change can land in "+4 more"; the end screen shows the last pass, not the whole edit.
- text3 on --raised ≈ 4.3:1 [inference: from tokens].

## Questions to Consider

1. Should the Deck stay a 44px bar while Claude works and open to 144px only at the user's turn?
2. Lightroom's Basic panel already shows the same sliders live: should the centre carry Claude's intent in words and the whole edit's net change instead of per-pass rows?
3. Should a tool beside colour-critical work carry any saturated hue, or can "your turn" be shown by position, weight and motion alone?
