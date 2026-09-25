# 04 — Workflow

Source: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PHASES.md`, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\CLAUDE_CODE_LAUNCH.md`, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LrC_AVG_STATE.md`; PR + Greptile rule decided by Jim 2026-09-23 (Phase 0b directive).

Repo: https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway (public). `main` is branch-protected: PRs required, no force pushes, no deletions. GitHub requires 0 approvals because Jim works alone; **the Greptile triage is the gate, and this rule enforces it, not GitHub**.

## Pull request + Greptile workflow (every change, in this order)

1. **Work happens on a branch** named `phase-<n>/<topic>` (e.g. `phase-1/bridge`) or `fix/<topic>` (e.g. `fix/s1-export-quality`). Branch from an up-to-date `main`.
2. **Never commit to `main` directly.** This applies from Phase 0b on (the last direct commit to `main` was `63e9185`). The rule is ours to keep: `enforce_admins` is off, so GitHub would let an admin push.
3. **Open a PR** with `gh pr create --fill` after pushing the branch (`git push -u origin <branch>`).
4. **Wait for Greptile's review.** Poll `gh pr view <n> --comments` (and the review comments, `gh api repos/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/pulls/<n>/comments`) for a review or comment whose author is the Greptile app (login contains `greptile`). Do not triage or merge before it arrives. If it does not arrive, stop and tell Jim.
5. **Triage every Greptile comment** in one table, posted as a PR comment (`gh pr comment <n> --body-file <file>`):

   | file:line | Greptile finding | decision | reason | commit (if fixed) |
   |---|---|---|---|---|

   `decision` is exactly one of **fix**, **reject**, **defer**. Each summary finding and each inline comment gets its own row. When Greptile reports no issues, post the table anyway with a single "no findings" row. A **defer** names where it is tracked (report, handover or issue). A **reject** gives a sourced reason (handle or tag, per `02-sourcing.md`).
6. **A PR merges only when** the triage table is posted **and no fix decisions remain open**. Every **fix** row carries the hash of the commit that fixed it, pushed to the PR branch. If Greptile reviews those new commits, triage the new comments the same way, in an updated or additional table.
7. **Merge** with `gh pr merge <n> --squash --delete-branch`. Jim may choose `--merge` for phase branches whose history is worth keeping. Then `git switch main && git pull`.
8. **After the merge, update** the vault `LrC_AVG_STATE.md` "Next action".

## Phase gating

- Work only on the phase that `LrC_AVG_STATE.md` names as current. A phase is done only when every acceptance line in PHASES.md is checked with a reproducible handle and Jim has confirmed the Lightroom-side lines.
- Do not start the next phase on your own initiative, even when the current one looks finished. Hand back and wait.
- Phase 0 gates Phase 1: no bridge, params-map or MCP-tool work beyond the Phase 0 scaffold until the six spike reports exist with Jim's observations.

## STOP markers and decisions

- When a directive says **STOP**, stop: report what was done and what is pending, then wait for Jim.
- When a decision belongs to Jim (scope, a spec contradiction, a rule conflict, anything destructive or outward-facing), lay out the options with a recommendation and stop. Do not pick one and carry on.
- Open decisions go in the handover or report under "Decisions for Jim".

## Steps for Jim (decided by Jim 2026-09-23 and 2026-09-24)

Any procedure Jim carries out (spike runs, Lightroom actions, PowerShell commands) is **automated first, then written as a short numbered checklist** he can follow literally:

- **Automate first.** Jim clicks in Lightroom, runs at most one PowerShell command per spike, and says "done". Harnesses save their own results to `%TEMP%\LrC-AVG\<Sn>\` (plugin output stays in temp, see `03-lightroom.md`), and Claude Code collects them. Never ask Jim to open temp files, use Notepad, copy/paste strings or console output, edit JSON by hand, or take screenshots unless nothing else can capture the result. [stated: Jim, 2026-09-24: "eliminate the copy/paste, especially from temp files … simplified, toned down, and automated where possible"]
- Anything only Jim can observe is asked by the harness in a Lightroom dialog (tick boxes / yes-no) and saved with the results.
- **Every step is required.** Never write "optional", "your call" or "if you want". If a step is not needed, leave it out. A conditional step is allowed only with a mechanical trigger ("If the dialog shows X, do Y").
- Give exact menu paths, exact copy-paste commands and what Jim should see. Don't assume Jim knows what Claude Code knows (file formats, keys, logs).
- Put troubleshooting under a separate "If something goes wrong" heading, written as if/then rules.
- Harness dialogs must state outcomes plainly, with a headline (WORKED / FAILED, "put back: YES/NO"), so an error cannot pass as "no errors" (S1 run 1: the dialog hid `error loading thumb`).
- Jim does not commit. When Jim edits a report file by hand, Claude Code carries his edits onto a branch and through the PR workflow.

## Reports

- Every phase and spike gets a report (format in `02-sourcing.md`).
- The repo copy lives at `docs\reports\<phase>\<id>.md`, where Jim fills in "Observed". Report changes go through the PR workflow above. When a report is final, copy it to the vault `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\Reports\` (same file name, under a phase subfolder) and keep both identical. If they ever differ, the vault copy wins.
- Handover documents (`docs\PHASE<n>_HANDOVER.md`) open with explicit self-attribution: which session wrote it, what was built, what Jim must run, what is still unverified. A fresh session reads the handover first and trusts it over re-deriving from code.
- At the end of a directive, update `LrC_AVG_STATE.md` (status and "Next action").

## Commits

- Commit only what the task needs. Fixtures and `logs\*` are never committed; check `git status` before every commit.
- Before pushing: `npm run build`, `npm test`, `npm run typecheck`.
- End commit messages with the attribution line the session's instructions give.
