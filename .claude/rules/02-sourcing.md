# 02 — Sourcing

Source: the directive (`C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\CLAUDE_CODE_LAUNCH.md`), the convention in `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LR_SDK_NOTES.md` and `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PRD.md`, and PHASES "Standing rules" (`C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PHASES.md`).

## The rule

Any claim about SDK behaviour or runtime behaviour (Lightroom, Node, sharp, MCP clients), in reports, docs, code comments and **commit messages**, carries a handle or a tag:

| Marker | Meaning |
|---|---|
| `[handle: …]` | Something a third party can check: a script path plus its observed output, a screenshot path, a log path, a URL, or `file:line` |
| `[unverified]` | Not yet confirmed; must not be relied on until a spike or test confirms it |
| `[inference]` | Claude's reasoning, not an observation |
| `[stated]` | Jim said it |
| `[community]` | Adobe forum or other user report, not Adobe documentation |
| `[upstream claim]` | Automaat's code or comments assert it; we have not observed it |

- **Never write an observation you did not make.** Lightroom-side results (latency, freshness, dialog behaviour, key dumps, profile strings) come from Jim. Leave the field blank and ask.
- Code *you* ran counts as an observation only with the command and its output (or where the output was saved).
- Graphify answers and LLM summaries are pointers, not handles. Follow them to `file:line`.
- On a contradiction between a handle and a vault doc, report both and ask Jim. Don't pick one silently.

## Report format

Reports live in `docs\reports\<phase>\<id>.md` and in the vault `Reports\` folder (see 04-workflow). Sections, in order:

1. Front matter: `report`, `phase`, `status` (`template` | `observed` | `accepted`), `authored_by` (who wrote each part), `date`.
2. **Purpose**: the question the spike or phase answers, and the PHASES.md go/conditional/no-go rule, quoted.
3. **Harness**: the files involved and how to run them (link the README).
4. **Pre-run findings (Claude Code)**: checks Claude Code ran itself, each with its handle.
5. **Observed (Jim)**: filled by Jim only; raw numbers and pasted output, screenshot paths.
6. **Numbers**: the report fields the directive asks for, filled from the Observed section.
7. **Verdict**: go / conditional / no-go, decided by Jim; a script's suggested verdict is labelled as a suggestion.
8. **Consequences / open questions**: which decisions (AVG-0xx) or docs change, and what stays `[unverified]`.

## Commit messages

Conventional-commit subject (`chore:`, `feat:`, `fix:`, `spike:`, `docs:`, `test:`). If the body states a runtime or SDK fact, give its handle or tag it `[unverified]`.
