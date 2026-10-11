---
report: ai-vegetation
phase: "8.5"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (observed, verdict)"
date: 2026-10-11
---

# The AI Vegetation mask hang (issue #123, fix/ai-mask-probe)

## Purpose

On 2026-10-11 (the Lightroom check of PR #122) Claude asked for an AI Vegetation mask (`lr_create_mask`, `kind: "landscape_vegetation"`). Lightroom showed an "unexpected error" dialog and then hung, and Jim force-closed it [stated: Jim, 2026-10-11]. Jim's rule for this bug: find the actual cause, no timers or blocks, and measure with a probe before changing code [stated: Jim, 2026-10-10, "DO NOT HACK THIS FIX"; plan for issue #123 approved 2026-10-11, "go"].

Questions:
1. Does a Vegetation mask fail again on the same kind of photo, and what does Lightroom's dialog say?
2. What do Lightroom's answers show, step by step: the update, the write gate, the mask's entry?
3. Do the engine's once-a-second reads during the computation take part (H2)? The run without reads tells.
4. Does a Mountains mask on the same photo compute (the control)?

The fix (a later PR) is chosen from these answers. The candidates are below, under "Consequences".

Jim answers y/n questions in the PowerShell window, not in Lightroom dialogs, because a hung Lightroom shows no dialog [stated: Jim, 2026-10-11, "go" to the plan's decision 4] (rule 04, "Steps for Jim").

## Harness

- `npm run ai:probe` (`engine\src\devtools\ai-probe.ts` runs, `engine\src\devtools\ai-probe-cli.ts` the command). It needs Lightroom in Develop on one photo with trees, shrubs or grass, and Claude Desktop quit. It works over the bridge, as the engine does:
  1. It asks Jim whether the selected photo shows trees, shrubs or grass, then takes a snapshot "AVG ai-probe before".
  2. Three runs. Each run writes one mask entry with the 2026-10-11 sliders (saturation +15, temperature −10; History "AVG ai-probe <run>"), sends `update_ai_settings` with the plugin's guard, and watches for up to 3 minutes:
     - `mountains_reads`: Mountains, read as the engine reads (from 250 ms, doubling to 1 s; gate probes every 2 s from 10 s, stopped once the update is over and the gate is free). The control.
     - `vegetation_reads`: Vegetation, the same rhythm. The 2026-10-11 call.
     - `vegetation_no_reads`: Vegetation with gate probes only, every 2 s from 0.25 s. No read of the settings until Lightroom reports the update over and the gate free, then one read every 5 s.
  3. Each answer is written down with its time: the update's answer, each probe (gate `executed`/`aborted`, the update's state), each read (how long it took, what the entry showed: no result yet, computed, ErrorReason n, gone).
  4. Screenshots of the whole screen, taken by the probe: at the first busy gate, 10 s after the update is over with no result, and when Jim answers that a dialog is open.
  5. After each run: three y/n questions (a dialog open now, a dialog at any time, Lightroom responding), then the snapshot is applied and checked as the engine's revert checks it (settings and masks).
  6. If Lightroom does not respond, or the photo cannot be put back, the command stops and says how to restart Lightroom. Run again, it puts the photo back first and goes on with the next run (`-- --new` starts over).
- Results, under `%TEMP%\LrC-AVG\ai-probe\`: `state.json`, `ai_probe_<time>.json` (saved at every stop), `ai_probe_bridge_log_<time>.txt` (the plugin's log, user folder redacted), `shot_<run>_<what>_<time>.png`. Claude Code collects them.
- The engine now also writes what an AI mask wait saw (`ai_trace`: the update's answer, each probe, the reads summed up) on the session log's failure entry when the wait ends without a result (`engine\src\session\ai-update.ts`, `io.ts` `failed`). The next failure in a chat explains itself.

## Pre-run findings (Claude Code)

- The plugin log of the 2026-10-11 run: the update arrived at 22:49:49.028; gate probes at 22:49:59.188, 22:50:01.743 and 22:50:04.294, then none; `get_settings` about once a second until 22:52:31.864, one gap of 4.6 s (22:49:52.566 to 22:49:57.151) [handle: `%TEMP%\LrC-AVG\bridge.log` lines 13495-13656 on Jim's PC, read 2026-10-11]. The log records each command's arrival, not its answer.
- The engine stops probing only when a probe reads the gate free and the update's own record "done" (`engine\src\session\ai-update.ts`, `judge` and `watch`, `w.settled`). So Lightroom reported `updateAISettings` over with the catalog free by 22:50:04, and the entry then showed no digest and no ErrorReason for about 150 s [inference from the code and the log above].
- The plugin received reads all through the "hang", so its tasks still ran [inference: arrivals only, see above]. Whether Lightroom's window froze or a dialog only sat in front is [unverified].
- The session log has no record of the probes' answers [handle: repo `logs\20261010-45ea50.json`, `failures` holds one `BRIDGE_DISCONNECTED` entry]; hence `ai_trace`.
- The probe against the simulator: `engine\tests\ai-probe.test.ts` (a mask that computes; the 2026-10-11 shape with probes stopped and reads going on; no reads before the update is over; a busy gate's screenshot). `engine\tests\session-ai-dialog.test.ts` "logs what the wait saw on the failure" checks `ai_trace`. The screenshot command (the PowerShell lines of `ai-probe-cli.ts` `shot`, run from a scratch Node script) wrote a 7680 × 2160 PNG of the whole desktop in 1188 ms on Jim's PC [handle: Claude Code's run of 2026-10-11, size read by sharp `metadata()`; the file was deleted after the check].

## Steps for Jim

1. In Lightroom's **Library** (press **G**), click one photo with trees, shrubs or grass: the same kind as the 2026-10-11 photo (juniper and shrubs in a landscape). The probe adds three masks to it, one at a time, and puts it back after each.
2. Press **D** to open **Develop** on that photo.
3. Quit Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > **Quit**.
4. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run ai:probe
   ```

5. Answer the questions in the PowerShell window (y or n, then Enter). Do not click in Lightroom while a run says "do not click in Lightroom".
6. When the window says **AI mask probe: DONE**, tell Claude Code "done".

### If something goes wrong

- If the window says **AI mask probe: STOPPED**, follow the three steps it prints (exit or end Lightroom, start it, select the same photo in Develop, run `npm run ai:probe` again). Repeat until it says DONE.
- If the window says `FAILED: select one photo …`, click just one photo in Develop and run the command again.
- If the window says `FAILED: … plugin`, in Lightroom: **File > Plug-in Manager**, click **LrC-AVG**, **Reload Plug-in**, **Done**, then run the command again.

## Observed (Jim)

_To be filled from Jim's run._

## Numbers

| Run | Outcome | Update over at | First busy gate | Dialog | Lightroom responding | Put back |
|---|---|---|---|---|---|---|
| mountains_reads | | | | | | |
| vegetation_reads | | | | | | |
| vegetation_no_reads | | | | | | |

## Verdict

_Jim's: go / conditional / no-go for the fix PR it points at._

## Consequences / open questions

The fix PR is chosen from the runs [inference: the candidates from issue #123 and the plan of 2026-10-11]:
- H1: "update over, gate free, no result" means Lightroom's computation failed. The engine ends the wait then, and puts the photo back.
- H2: the reads during the computation take part. The engine stops reading while Lightroom computes.
- H3: the failure belongs to Vegetation on Lightroom's side. The engine reports it plainly and leaves the photo as it was.

Still [unverified]: the dialog's text, and whether Lightroom's window froze.
