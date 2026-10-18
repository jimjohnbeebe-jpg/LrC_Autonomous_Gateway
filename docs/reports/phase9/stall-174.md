---
report: Issue #174 — does the bridge's idle rebind make Lightroom stutter and freeze?
phase: 9 (fix/lightroom-stall-174, before PR 3)
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-17. Observed: Jim (blank). Verdict: Jim (blank)."
date: 2026-10-17
---

# Issue #174 — does the bridge's idle rebind make Lightroom stutter and freeze?

## Purpose

**The question.** With LrC-AVG (dev) 1.0.0 enabled, Lightroom Classic "stutters and freezes for several seconds, sometimes for up to 30 seconds. When the plugin is disabled it returns to normal" [stated: Jim, issue #174]. Is the cause the idle rebind that PR #173 added (`plugin\LrC-AVG.lrplugin\Bridge.lua`, `IDLE_REBIND_SECONDS = 10`), which closes and binds both sockets about every 10 s while no engine is connected?

**Go rule** (PHASES.md has none for a diagnosis; proposed [inference]): the idle rebind is **the cause** when the plugin logs freezes, or Jim sees stutter, with it on and neither with it off. **Not the cause** when the freezes stay with it off. Anything else is **unclear** and needs a second run.

**How the check asks Jim:** y/n questions and "press Enter" in the PowerShell window, as in every check since Phase 1 [handle: `docs\reports\phase1\PHASE1.md:17`; `.claude\rules\04-workflow.md` "Steps for Jim"].

## Harness

| What | Files |
|---|---|
| The measurement in the plugin | `plugin\LrC-AVG.lrplugin\Stall.lua`, called from the monitor loop in `Bridge.lua` |
| The check (`npm run stall:check`) | `engine\src\devtools\stall-check-cli.ts` (steps), `stall-check.ts` (reads and sums the `stall-diag:` lines) |
| Test | `engine\tests\stall-check.test.ts` |

What the plugin logs to `%TEMP%\LrC-AVG\bridge.log`:
- `stall-diag: stall <ms> after <tend|idle>`: the monitor loop woke more than 1 s late, so no plugin task ran for that long. That this also means Lightroom's window froze is [inference]: plugin tasks run on Lightroom's main thread.
- `stall-diag: tend <ms>`: a tick whose socket work took over 0.3 s. Its two rebinds sleep 0.1 s each.
- `stall-diag: idle rebind`: one idle rebind.
- The file `%TEMP%\LrC-AVG\no-idle-rebind` turns the idle rebind off. The plugin looks for it every 2 s.

**Steps for Jim.** Lightroom open, the LrC-AVG (dev) plugin disabled, Claude Desktop quit.

1. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run `npm run stall:check`.
2. When it asks, in Lightroom: File > Plug-in Manager, select LrC-AVG (dev), click Enable, then Done.
3. Use Lightroom normally for 2 minutes (the window counts down), then answer y/n.
4. The window turns the idle rebind off. Use Lightroom normally for 2 more minutes, then answer y/n.
5. When it asks, in Lightroom: File > Plug-in Manager, select LrC-AVG (dev), click Disable, then Done. Press Enter.
6. Tell Claude Code "done".

### If something goes wrong

- If the window says "FAILED: the plugin did not start", check that Plug-in Manager shows LrC-AVG (dev) with the path `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin`. Then run step 1 again.

## Pre-run findings (Claude Code)

- **No engine was connected, and the bridge rebound about every 10 s.** `bridge.log` from 17:57:42 to 18:32:55 on 2026-10-17 holds only `bridge: receive: closed` / `bridge: send: closed` pairs, about 10.3 s apart (`tail -80 %TEMP%\LrC-AVG\bridge.log`). `bridge_status.json` at 18:33:02 showed `engine_connected: false`, `plugin_version: "1.0.0"` and `commands_handled: 0`. No Claude Desktop process was running (`Get-CimInstance Win32_Process`, 2026-10-17 18:3x).
- **Only the dev plugin was installed.** `AgSdkPluginLoader_installedPluginPaths` names only `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin`, and `com.lrcavg.gateway.dev` is in `AgSdkPluginLoader_disabledPluginIDs` [handle: `%APPDATA%\Adobe\Lightroom\Preferences\Lightroom Classic CC 7 Preferences.agprefs` lines 1177-1222, 2026-10-17].
- **The installed product plugin is the same code.** The setup changes only the ID and name in `Info.lua` (`tools\setup\plugin-id.ts:1-3, 13-20`). So putting it in place would not help [inference].
- **A separate fault.** `bridge: receive re-arm failed: ?:0: attempt to call method 'reconnect' (a nil value)` at 13:30:40 and 17:56:03 (`grep ERROR bridge.log`). That branch of `tendSockets` runs only when `S.receiveSocket` is set (`Bridge.lua`, `if S.receiveNeedsRebind or not S.receiveSocket ... elseif`), so the socket object had no `reconnect` method at that moment, not a nil socket. Why is [unverified]. Its `onFail` binds afresh, and the bridge recovered both times. It happened twice in a day and is not linked to the freezes [inference]. It is left as it is.
- **The harness works, against a fake log.** The check ran with `TEMP` pointed at a scratch folder holding a made-up `bridge.log`. The result is under "Pre-run smoke".

### Pre-run smoke

A made-up log (ten `idle rebind` lines, each followed by `stall 3000 ms after tend`, in the first 2 minutes only) and piped answers `y`, `n`. The harness printed `Idle rebind ON : stutter seen by Jim YES; plugin froze 10 time(s), longest 3000 ms, 30000 ms in all (10 right after socket work); 10 idle rebind(s)` and `Idle rebind OFF: ... froze 0 time(s)`, then `Suggestion (Jim decides): the freezes go with the idle rebind.` [handle: `stall_check_2026-10-18T01-40-08-382Z.json` in Claude Code's scratch folder, 2026-10-17]. Its note "the plugin did not report the idle rebind off within 15 s" was expected: the made-up `off` line was dated before the harness wrote the flag. This run checks the harness only, not Lightroom.

## Observed (Jim)

Run of 2026-10-17 18:46-18:52 local time, Claude Desktop quit (`engine_connected_at_start: false`). Jim's answers and the plugin's lines were collected by Claude Code from the saved results [handle: `%TEMP%\LrC-AVG\stall\stall_check_2026-10-18T01-46-31-367Z.json`].

- **Stutter with the idle rebind on: YES. With it off: NO** [stated: Jim, the two y/n answers].
- With it on, **5 of the 6 idle rebinds spent 10.0-11.8 s in the socket work**: `tend 10498 ms`, `10417`, `11830`, `10041`, `10302`, plus `10024` and `10016` just after the phase window. The first rebind after start (18:47:01) logged no slow tick. So the bridge cycled about 10 s in close/bind, then 10 s idle, then rebound.
- With it off, there was no slow socket tick in the window. The loop woke late once (`stall 3823 ms after idle`, 18:51:22). Three more came after the window, while Jim was answering. Jim saw no stutter, so a late wake-up alone is not a freeze he notices. Lightroom being busy (Develop rendering) delays plugin tasks too [inference].
- After the flag was removed (18:51:43), the next rebind took 8144 ms. The `reconnect` (a nil value) error came back once at 18:52:02.

## Numbers

| Phase | Jim saw stutter | Freezes logged | Longest (ms) | Total (ms) | After socket work | Idle rebinds | Slow socket ticks, longest (ms) |
|---|---|---|---|---|---|---|---|
| Idle rebind on | YES | 1 | 2342 | 2342 | 0 | 6 | 5, 11830 |
| Idle rebind off | NO | 1 | 3823 | 3823 | 0 | 0 | 0, 0 |

**The idle rebind took about 10 s of socket work each time and lines up with the stutter Jim saw. With it off, both the slow socket work and the stutter were gone.** Whether those 10 s block Lightroom's window, or the close/bind only waits while something else freezes the UI, is [inference]. The detector cannot see inside a tick. That close() waits out LrSocket's ~10 s no-client cycle (P-13, `Bridge.lua:15-16`) is [inference] too.

## Fix and verification run

**Fix** (option 1, chosen by Jim 2026-10-17 [stated: "Go with option 1"]): the bridge rebinds both sockets **once**, 20 s after its first bind, and only if no engine has connected by then. An engine connection marks the check done (`Bridge.lua`, `STARTUP_REBIND_SECONDS`, `startupRebindDone`). The run 1b case is still covered: the replaced instance there let go 10 s after the new start [handle: run 1b lines quoted at `STARTUP_REBIND_SECONDS`].

**Verification:** the same `npm run stall:check`, same steps. Pass: no stutter in either phase, and at most one `idle rebind` (about 20 s after the plugin starts) with at most one slow socket tick.

Observed (Jim): (blank)

## Verdict

(Jim)

## Consequences / open questions

- If the idle rebind is the cause, the fix is to rebind only when no listener is actually left (the run 1b case), not on a timer. That needs its own plan.
- `Stall.lua` is diagnosis only. Whether it stays in 1.0.0 is decided with the fix.
