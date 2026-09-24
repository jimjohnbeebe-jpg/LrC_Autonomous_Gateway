---
document_type: process
project: LrC_Autonomous_Gateway
authored_by: Claude Code (Opus 5.5), Phase 0b session 2026-09-23
decided_by: Jim (Phase 0b directive, 2026-09-23)
---

# Review workflow — pull requests + Greptile triage

> Summary of the rule in `.claude\rules\04-workflow.md` (the authoritative text; also mirrored in `CLAUDE.md` and in the vault `PHASES.md` "Standing rules"). Written by Claude Code in the Phase 0b session.

## Repository and protection

- Repo: https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway (public). Automaat is vendored with attribution (README NOTICE), not forked.
- `main` protection was applied 2026-09-23 via `gh api -X PUT repos/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/branches/main/protection`. Read-back: `required_pull_request_reviews.required_approving_review_count = 0`, `enforce_admins = false`, `required_status_checks = null`, `allow_force_pushes = false`, `allow_deletions = false`, `restrictions = null`.
- GitHub requires no approvals because Jim works alone. **The gate is the Greptile triage, and it is enforced by the rule, not by GitHub.** With `enforce_admins` off, an admin could still push to `main`; the rule forbids it.

## The loop

1. Branch: `phase-<n>/<topic>` or `fix/<topic>`, taken from an up-to-date `main`.
2. Never commit to `main` directly. The last direct commit was `63e9185`, which added LICENSE and README before protection was enabled.
3. `git push -u origin <branch>` then `gh pr create --fill`.
4. Wait for Greptile's review: a comment or review whose author login contains `greptile`.
5. Post a triage table as a PR comment, with one row for every Greptile finding:

   | file:line | Greptile finding | decision | reason | commit (if fixed) |
   |---|---|---|---|---|

   `decision` ∈ {`fix`, `reject`, `defer`}. With no findings, post the table with a single "no findings" row.
6. Merge only when the table is posted and every `fix` row has its fixing commit pushed. Greptile comments on those fix commits get triaged the same way.
7. `gh pr merge <n> --squash --delete-branch` (or `--merge` for phase branches whose history is worth keeping, at Jim's choice).
8. Update the vault `LrC_AVG_STATE.md` "Next action".

## First use

This document was added in PR `fix/greptile-check`. That PR also carries the rule edits themselves (`.claude\rules\04-workflow.md`, `CLAUDE.md`), so the rule went through its own workflow. Its outcome is recorded in `docs\PHASE0_HANDOVER.md` (Phase 0b section).
