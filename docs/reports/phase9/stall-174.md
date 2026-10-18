---
report: Issue #174 — does the bridge's idle rebind make Lightroom stutter and freeze?
phase: 9 (fix/lightroom-stall-174, before PR 3)
status: observed
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-17. Observed: Jim, runs 1-4 (collected by Claude Code from the saved results). Verdict: Jim, 2026-10-18."
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
- `stall-diag: idle rebind` (runs 1-2) or `stall-diag: startup rebind` (run 3): one rebind.
- Runs 1-2 only: the file `%TEMP%\LrC-AVG\no-idle-rebind` turned the idle rebind off. The plugin looked for it every 2 s. Removed for run 3.
- Run 3: `bridge: stopped (plugin disabled)` when the monitor loop sees Disable.
- Run 4: also `bridge: not started (plugin disabled)` (init of a disabled plugin) and `plugin: enabled in Plug-in Manager` / `plugin: disabled in Plug-in Manager` (PluginEnable.lua, PluginDisable.lua).

**Steps for Jim, runs 1-2.** Lightroom open, the plugin disabled, Claude Desktop quit. `npm run stall:check`; Enable when asked; 2 min, y/n; the window turns the idle rebind off; 2 min, y/n; Disable when asked, Enter.

**Steps for Jim, runs 3-4** (plugin with the Disable stop; run 4 also with the Enable and Disable scripts). Claude Desktop quit, the LrC-AVG (dev) plugin disabled.

1. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run `npm run stall:check`.
2. When it asks: quit Lightroom with File > Exit. The window waits until Lightroom has fully closed.
3. Start Lightroom. Leave LrC-AVG (dev) disabled. Press Enter when Lightroom shows your photos.
4. Use Lightroom normally for 2 minutes (the window counts down), then answer y/n.
5. When it asks: File > Plug-in Manager, select LrC-AVG (dev), click Enable, then Done. Use Lightroom normally for 2 minutes, then answer y/n.
6. When it asks: File > Plug-in Manager, select LrC-AVG (dev), click Disable, then Done. The window checks that the bridge stops and stays quiet (about 45 s).
7. Tell Claude Code "done".

### If something goes wrong

- If the window says "FAILED: the plugin did not start", check that Plug-in Manager shows LrC-AVG (dev) with the path `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin`. Then run step 1 again.
- If the window says "Disable stopped the bridge: NO", quit Lightroom and start it again before using it.

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

Observed, run 2 (2026-10-17 19:01-19:07, plugin at `89c6ccd`; answers and lines collected by Claude Code [handle: `%TEMP%\LrC-AVG\stall\stall_check_2026-10-18T02-01-37-429Z.json`, `%TEMP%\LrC-AVG\bridge.log`]):

- **Stutter: phase 1 YES, phase 2 NO.** Lightroom was already stuttering **with the plugin disabled, before the run started**, and it stopped only at step 3 [stated: Jim, 2026-10-17, "Lightroom was displaying the stuttering with the plugin-disabled before the test started, as well as the first part of the test, it only stopped with step 3"].
- **The fix restarted once.** The new bridge logged one `idle rebind` (19:02:51, 20 s after its bind) and no slow socket tick. But phase 1 still logged 13 late wake-ups, among them **`stall 31358 ms`** (19:03:37), 48 s in all. Phase 2 logged 3, at most 1309 ms.
- **Disable did not stop the old bridge.** Run 1 ended with Jim's Disable by 18:52:02. Yet the run 1 bridge (plugin at `da9395e`, 10 s rebind) kept rebinding every 10 s until 18:58:21. Its stalls grew (`13616`, `9514`, `8655`, `26417 ms`), and it then logged nothing until the new start at 19:02:30 [handle: `bridge.log` 18:52:02-19:02:30]. So run 2's phase 1 ran beside a disabled-but-running old bridge. The monitor loop stops only on a newer generation or token (`Bridge.lua` `monitor`). Automaat says Lightroom cancels the function context on disable [upstream claim: `vendor\automaat\README.md:280`, macOS], but a cancelled context does not end a `while` loop that only sleeps [inference].
- So run 2 does not tell whether the fixed bridge alone stutters.

**Run 3** (decided by Jim 2026-10-17 [stated: "Go with 1 + 2"]): the monitor loop also stops when `_PLUGIN.enabled` is false, and returning ends the task, so the cleanup handler closes both sockets (`Bridge.lua` `monitor`). The check now starts from a restarted Lightroom: 2 min with the plugin disabled (does Lightroom stutter with no LrC-AVG at all?), 2 min enabled, then Disable. Pass: no stutter in either phase, at most one rebind, and `Disable stopped the bridge: YES`, quiet afterwards.

Observed, run 3 (2026-10-18 04:29-04:35, plugin at `aac415c`; collected by Claude Code [handle: `%TEMP%\LrC-AVG\stall\stall_check_2026-10-18T11-29-28-077Z.json`, `%TEMP%\LrC-AVG\bridge.log` 04:30:15-04:30:16]):

- **The check stopped at step 4: `the plugin did not start within 3 minutes`.** Jim enabled the plugin, and nothing more was written to `bridge.log` [stated: Jim, 2026-10-18, "The plug-in was enabled but the test never picked it up"]. Claude Desktop then got `BRIDGE_DISCONNECTED ... 127.0.0.1:8765: ECONNREFUSED` [stated: Jim, the pasted Claude Desktop reply].
- **Lightroom ran the init script of the disabled plugin when it started.** At 04:30:15, before the baseline began (`plugin_started_during_baseline: false`), the log shows `starting generation 1`, `listening`, `stall-diag: on`, then within the same millisecond `bridge: stopped (plugin disabled)` and `sockets closed (task ended)`. So `_PLUGIN.enabled` was false in that init. The plugin had been disabled since run 2 ended. LrForceInitPlugin runs init at startup [handle: Lightroom Classic SDK Guide, chapter 2, Info.lua table, `LrForceInitPlugin`], and disabled plugins evidently get it too.
- **So, before this fix, a "disabled" plugin bound and rebound the sockets for the whole Lightroom session.** That fits Jim's stutter with the plugin disabled before run 2 [inference].
- **Enable did not run the init script again in this case**: no line after 04:30:16.318 (the `bridge.log` mtime is 04:30). In run 2, Enable did start a bridge (19:02:30). Why the two runs differ is [unverified].
- The baseline (2 min, plugin disabled, no bridge) was not summed, because the check stopped before the summary.

**Fix after run 3.** Info.lua gets `LrEnablePlugin = 'PluginEnable.lua'` and `LrDisablePlugin = 'PluginDisable.lua'`, scripts that the SDK says run on Enable and Disable in Plug-in Manager [handle: Lightroom Classic SDK Guide, chapter 2, "Customizing plug-in load behavior"]. Adobe's `remote_control_socket` sample stops its socket loop the same way (`stop.lua`).
- PluginInit.lua starts nothing while `_PLUGIN.enabled` is false (it logs `bridge: not started (plugin disabled)`).
- PluginEnable.lua starts the bridge.
- PluginDisable.lua calls `Bridge.stop()`, which bumps the generation so the loop leaves at its next tick.
- The loop's `_PLUGIN.enabled` check stays as a second stop.
- Both scripts log a line (`plugin: enabled/disabled in Plug-in Manager`), so the next run shows that Lightroom ran them.

**Run 4**: the same `npm run stall:check` and the same steps, with the same pass rule as run 3.

Observed, run 4 (2026-10-18 04:55-05:01, plugin at `74de940`; collected by Claude Code [handle: `%TEMP%\LrC-AVG\stall\stall_check_2026-10-18T11-55-04-541Z.json`, `%TEMP%\LrC-AVG\bridge.log` 04:57:55-05:00:31]; the file says `"run": 3`, since the harness label was not changed):

- **Stutter: plugin disabled NO, enabled NO** [stated: Jim, the two y/n answers]. But **"Lightroom did freeze at least once per session, just not at the rate it was freezing before"** [stated: Jim, 2026-10-18].
- **Lightroom ran both scripts.** At Lightroom start: `bridge: not started (plugin disabled)` (04:57:55). On Enable: `plugin: enabled in Plug-in Manager`, then `starting generation 1` (04:57:59). On Disable: `plugin: disabled in Plug-in Manager` (05:00:24), `bridge: stopped (plugin disabled)` 3.6 s later, `sockets closed (task ended)` 3.6 s after that. No line in the 30 s check window after that (`disable_stopped: true`, `quiet_after_stop: true`).
- **Plugin disabled (2 min): no bridge line at all.**
- **Plugin enabled (2 min): one startup rebind (04:58:23, 20 s after the bind). Its socket work took 11.9 s (`tend 11864 ms`), as each rebind did in run 1.** Late wake-ups: 2003 ms, 1631, 2214, and 5798 ms at 05:00:21, while Jim was answering the question. None came right after socket work.
- That the one freeze per session Jim saw is the 12 s startup rebind is [inference]: the timings fit, but the detector cannot see inside a tick.

**Numbers, run 4**

| Phase | Jim saw stutter | Late wake-ups | Longest (ms) | Total (ms) | After socket work | Rebinds | Slow socket ticks, longest (ms) |
|---|---|---|---|---|---|---|---|
| Plugin disabled | NO | 0 | 0 | 0 | 0 | 0 | 0, 0 |
| Plugin enabled | NO | 3 | 2214 | 5848 | 0 | 1 | 1, 11864 |
| After Disable (30 s) | — | 0 | 0 | 0 | 0 | 0 | 0, 0 |

## Verdict

**Go with this fix for now** [stated: Jim, 2026-10-18, "Let's go with this fix for now and return later if it is a persistent problem"]. Issue #174's freezes went from many per session to at least one per session. Disable now stops the bridge, and a disabled plugin starts nothing.

## Consequences / open questions

- **Open: the remaining freeze.** If it persists, the candidate is the one startup rebind (12 s of socket work, run 4). The fix would rebind only when no listener is actually left (the run 1b case), not on a timer, and needs its own plan. It is deferred by Jim to "return later if it is a persistent problem".
- **`Stall.lua` and `npm run stall:check` stay**, so the same check can run again when this returns. Stall.lua writes a line only when the loop wakes more than 1 s late, or a tick's socket work takes over 0.3 s.
- LR_SDK_NOTES gets: (1) LrForceInitPlugin runs the init of a disabled plugin at Lightroom start, with `_PLUGIN.enabled` false (run 3); (2) LrC 15.6 runs LrEnablePlugin and LrDisablePlugin (run 4); (3) a sleeping task loop outlives Disable (run 2).
