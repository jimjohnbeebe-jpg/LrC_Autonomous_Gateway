# 04 — Workflow

Source: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PHASES.md`, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\CLAUDE_CODE_LAUNCH.md`, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LrC_AVG_STATE.md`.

## Phase gating

- Work only on the phase that `LrC_AVG_STATE.md` names as current. A phase is done only when every acceptance line in PHASES.md is checked with a reproducible handle and Jim has confirmed the Lightroom-side lines.
- Do not start the next phase on your own initiative, even when the current one looks finished. Hand back and wait.
- Phase 0 gates Phase 1: no bridge, params-map or MCP-tool work beyond the Phase 0 scaffold until the six spike reports exist with Jim's observations.

## STOP markers and decisions

- When a directive says **STOP**, stop: report what was done and what is pending, then wait for Jim.
- When a decision belongs to Jim (scope, a spec contradiction, a rule conflict, anything destructive or outward-facing), lay out the options with a recommendation and stop. Do not pick one and carry on.
- Open decisions go in the handover or report under "Decisions for Jim".

## Reports

- Every phase and spike gets a report (format in `02-sourcing.md`).
- The repo copy lives at `docs\reports\<phase>\<id>.md`, where Jim fills in "Observed". When a report is final, copy it to the vault `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\Reports\` (same file name, under a phase subfolder) and keep both identical. If they ever differ, the vault copy wins.
- Handover documents (`docs\PHASE<n>_HANDOVER.md`) open with explicit self-attribution: which session wrote it, what was built, what Jim must run, what is still unverified. A fresh session reads the handover first and trusts it over re-deriving from code.
- At the end of a directive, update `LrC_AVG_STATE.md` (status and "Next action").

## Git

- Default branch `main`. Commit only what the directive asks for, with the message it gives. Fixtures and `logs\*` are never committed; check `git status` before every commit.
- Before committing: `npm run build`, `npm test`, `npm run typecheck`.
- End commit messages with the attribution line the session's instructions give.
