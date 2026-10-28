---
report: PARITY-BATCH1-CHECKS
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): the index and its order, 2026-10-27. Jim: the runs; his results go in each linked report."
date: 2026-10-27
---

# The Lightroom checks of #207 parity batch 1, in order

## Purpose

PR #231 (merged to `main` as `437d3eb`; engine and plugin 1.5.0) brings issues #214, #215, #216, #218 and #219 together, and the harness of #212. Every new tool is tested against the simulated Lightroom only; whether it works in Lightroom is `[unverified]` until these checks run [stated: CLAUDE.md, "Lightroom-side results are Jim's observations"]. This page is the one ordered list. Each check's own report holds its harness, its steps, and the blank Observed, Numbers and Verdict that Jim's run fills.

| # | Check | Report | Issue | Catalog | Takes about |
|---|---|---|---|---|---|
| 1 | `npm run perf:check -- --label baseline` | [`PERF.md`](PERF.md) | #212 | your usual catalog, 1,000 photos selected | 2 min `[inference]` |
| 2 | `npm run stats:check` | [`METRICS-PARITY.md`](METRICS-PARITY.md) | #216 | your usual catalog, 20 raw photos | 2 min `[inference]` |
| 3 | `npm run develop:check` | [`DEVELOP-PARITY.md`](DEVELOP-PARITY.md) | #214 | two raw virtual copies | 2-4 min [handle: that report, step 5] |
| 4 | `npm run presets:check` | [`PRESET-PARITY.md`](PRESET-PARITY.md) | #215 | one virtual copy | 2 min `[inference]` |
| 5 | `npm run catalog:check` | [`CATALOG-PARITY.md`](CATALOG-PARITY.md) | #218 | a throwaway or copied catalog | 1 min [handle: that report, step 6] |
| 6 | Claude Code plugin and `.mcpb` | [`DISTRIBUTION.md`](DISTRIBUTION.md) | #219 | any | 10 min `[inference]` |

The order puts the read-only timing first (it measures the catalog before anything else touches it), keeps the three checks on your usual catalog together, and leaves the one that needs a throwaway catalog and the one that needs Claude Desktop for last. `perf:check -- --label after` is not part of this batch: it runs after the PR that speeds up the reads (#212).

## Steps for Jim

1. In PowerShell, update `main` and install:

   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   git switch main
   git pull
   npm install
   ```

2. Quit Claude Desktop (its tray icon > Quit). It stays closed until check 6.
3. Start Lightroom Classic with your usual catalog. In File > Plug-in Manager, select LrC-AVG, click **Reload Plug-in**, then **Done**.
4. Check 1: follow the "Steps for Jim" of [`PERF.md`](PERF.md), with the label `baseline`. Tell Claude Code "done".
5. Check 2: follow the "Steps for Jim" of [`METRICS-PARITY.md`](METRICS-PARITY.md). Tell Claude Code "done".
6. Check 3: follow the "Steps for Jim" of [`DEVELOP-PARITY.md`](DEVELOP-PARITY.md), from its step 2 (step 1 above already did its step 1). Tell Claude Code "done".
7. Check 4: follow the "Steps for Jim" of [`PRESET-PARITY.md`](PRESET-PARITY.md). Tell Claude Code "done".
8. Check 5: follow the "Steps for Jim" of [`CATALOG-PARITY.md`](CATALOG-PARITY.md); it has you open a throwaway catalog. When it is done, open your usual catalog again (File > Open Recent). Tell Claude Code "done".
9. Check 6: follow the "Steps for Jim" of [`DISTRIBUTION.md`](DISTRIBUTION.md), both parts. Tell Claude Code "done".

Each "done" lets Claude Code collect that check's results file and fill the report's Observed and Numbers for you to confirm; the Verdict of each is yours.

### If something goes wrong

- If a check says "reload the LrC-AVG plugin" or answers `unknown_command`: do step 3 again, then that check again.
- If a check says another engine holds the lock: quit Claude Desktop from its tray icon, then that check again.
- If a check ends with `put back: NO`: follow its report's "If something goes wrong" for that line, then go on with the next check.
- If a check stops with any other message: tell Claude Code the check's number and go on with the next one.
