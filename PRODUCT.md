# Product

Written by Claude Code for `/impeccable` (2026-10-03). The answers under Users, Brand Personality, Anti-references and Accessibility are Jim's [stated: Jim, 2026-10-03, impeccable init]; the rest is from `README.md` and the vault `LrC_AVG_CONTEXT.md`.

## Register

product

## Users

Lightroom Classic photographers on Windows who did not build LrC-AVG: they know Develop, History and Snapshots, but not the engine, its passes or its guardrails. Jim is today's only user; the design serves the next one first [stated: Jim, 2026-10-03, "Other LrC users first"].

Context: the user is chatting with Claude in Claude Desktop while Lightroom shows the photo being edited. The HUD is a small floating window in Lightroom that they glance at between looking at the photo and reading the chat. The job is to follow an edit Claude is making, and to step in at the few moments that need them: pick a variant, approve a pass, accept, or abort.

## Product Purpose

LrC-AVG lets Claude edit a raw photo iteratively with Lightroom's own Develop settings: apply, render, measure, look, refine, up to a pass cap and within guardrails. Every edit is non-destructive and reversible through History and Snapshots. The HUD is the Lightroom-side view of that loop: where the session is, what changed in the last pass, whether the guardrails held, and the controls that need the user.

Success: a photographer who has never seen the HUD can tell at a glance what Claude is doing, whether it is waiting for them, and how to stop or keep the edit, without reading the README.

## Brand Personality

Co-pilot [stated: Jim, 2026-10-03]: plain language, addressed to the photographer, saying what Claude is doing and what it needs. Three words: **clear, calm, brief**. A co-pilot reports in short sentences and stays quiet when nothing needs the user; it is not a narrator.

## Anti-references

All four [stated: Jim, 2026-10-03]:

- **Debug console**: wire names, engine jargon, internal state, every field shown at once.
- **Chatty assistant**: long sentences, apologies, friendly filler.
- **Interrupting**: pop-ups, stolen focus, anything that blocks editing in Lightroom.
- **Non-native look**: anything that fights Lightroom's own UI conventions.

## Design Principles

1. **Photographer's words, not the engine's.** Name things as Develop names them (sliders, History, Snapshots); a term the user would have to look up does not belong on the HUD.
2. **Say when it's your turn.** The moments that need the user (pick, approve, accept) stand out from the moments that don't; while Claude is working, the HUD says so and asks nothing.
3. **Never in the way.** The HUD follows the session without taking focus or blocking Lightroom; it reports outcomes in place rather than in a dialog.
4. **Every exit is visible.** Abort and the way back (the pre-session snapshot) are always findable, and a click always says what happened to it.
5. **Lightroom-native conventions.** Use Lightroom's words, panel order, slider rendering and panel tones, and sit where Lightroom has free space; brevity and order carry the hierarchy, not decoration. [stated: Jim, 2026-10-04, D1 of `docs/hud/lrc-avg-hud-spec-v2.md`: the HUD moves out of LrView into its own window; it was "Native first. Use Lightroom's own controls and layout conventions".]

## Accessibility & Inclusion

- **Keyboard operation** [stated: Jim, 2026-10-03]: the HUD's actions must be usable without the mouse.
- Lightroom's conventions; text at 12 px or larger (11 px only for key hints and captions); every action usable from the keyboard; meaning is never carried by colour alone. [stated: Jim, 2026-10-04, D1 of `docs/hud/lrc-avg-hud-spec-v2.md`; it was "Native LrView controls and Lightroom's text sizes".]
