# Keeping up with Automaat/lightroom-mcp

LrC-AVG tracks [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp) (epic #207): every upstream tool has a row in [`PARITY.md`](PARITY.md), and code taken from upstream is credited in `engine/THIRD_PARTY_NOTICES.md` and `plugin/LrC-AVG.lrplugin/THIRD_PARTY_NOTICES.md`.

| | |
|---|---|
| Last compared commit | `1040453a5db79e42d44dbd33d1ca9dd549f2bde0` (2026-10-26) [handle: `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` front matter] |
| Pinned tool names | [`parity/upstream-tools-1040453.txt`](parity/upstream-tools-1040453.txt), 68 names |
| Vendored snapshot (unchanged, read-only) | `vendor/automaat/` at `a160e7a` (2026-09-22) |

## 1. List what is new upstream

In PowerShell. Keep the clone outside this repository (it is upstream's code, read as data; its `CLAUDE.md` does not apply here).

```powershell
$up = "$env:TEMP\lightroom-mcp"
if (-not (Test-Path $up)) { git clone https://github.com/Automaat/lightroom-mcp $up }
git -C $up fetch origin
git -C $up log --oneline 1040453..origin/main
```

New tool names against the pin (the `=>` lines are new upstream, `<=` lines were removed upstream):

```powershell
$new = git -C $up show origin/main:server/src/tool-contracts.ts |
  Select-String -Pattern '^    name: "([a-z_]+)"' |
  ForEach-Object { $_.Matches[0].Groups[1].Value }
$old = Get-Content D:\Developer\LrC_Autonomous_Gateway\docs\parity\upstream-tools-1040453.txt |
  Where-Object { $_ -and -not $_.StartsWith('#') }
Compare-Object $old $new
```

The pattern is the one that produced the pin (`grep -oE '^    name: "[a-z_]+"' server/src/tool-contracts.ts` gave 68 names at `1040453`). If upstream moves its tool list to another file, the count drops sharply: look for the file before trusting an empty diff.

## 2. Checklist for a new comparison

1. Read the new commits (step 1) and note the ones that change Lightroom behaviour, tools or the plugin protocol. Their claims are `[upstream claim]` until Jim runs them on Windows (`.claude/rules/02-sourcing.md`).
2. Write the new pin: `docs/parity/upstream-tools-<short hash>.txt`, same two comment lines, one name per line in the file's order. Delete the old pin and change the file name in `engine/tests/parity-map.test.ts` and in this page.
3. For each new upstream name, add a row to the table in `PARITY.md`: the upstream name, our `lr_*` tool (or "none"), a status (`have`, `ours+`, `planned #nnn` with the issue, or `decision Dn` naming Jim's open decision, never deciding it), and a short note. A removed upstream name loses its row.
4. Update the "Count:" line in `PARITY.md` and the counts in `engine/tests/parity-map.test.ts` together.
5. When a new `lr_*` tool is registered, `npm test` fails until `PARITY.md` names it: give it a row or add it to "LrC-AVG tools with no upstream counterpart".
6. Code taken from upstream (rewritten or copied) gets a row in both `THIRD_PARTY_NOTICES.md` files with the upstream commit and PR.
7. Update the "Last compared commit" above, and the stale rows of `WHATS_NEW_VS_AUTOMAAT.md`.
8. For a large change, write a comparison report under `docs/reports/<phase>/` (the `lrc-avg-checks` skill, "Reports").
9. Run `npm run build`, `npm test`, `npm run typecheck`, `npm run arch:check`, then the PR workflow (`.claude/rules/04-workflow.md`).

## Suggestion for Jim (not built)

A scheduled GitHub Actions job could run step 1 weekly and open an issue when `Compare-Object` finds new names. It is a new recurring job on the public repository, so it is Jim's call; until then the check is run by hand at the start of each parity batch.
