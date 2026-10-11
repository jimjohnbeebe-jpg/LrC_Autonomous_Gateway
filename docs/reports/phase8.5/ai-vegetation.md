---
report: ai-vegetation
phase: "8.5"
status: observed
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

Jim's run of `npm run ai:probe` on PR #132's branch (`3db51ee`), 2026-10-11 14:24-14:35Z, Claude Desktop quit. Transcribed by Claude Code from the probe's saved results; the y/n answers are Jim's [handle: `docs\reports\phase8.5\ai-vegetation\ai_probe_2026-10-11T14-24-16-677Z.json`, copied from `%TEMP%\LrC-AVG\ai-probe\`; plugin log lines 13661-13720 in `ai-vegetation\bridge_log_excerpt.txt`].

- Photo: `20260906-_OZ80041.NEF` Copy 2 (a virtual copy), a juniper in front and sagebrush and dry grass on the slope [handle: `ai-vegetation\photo_crop.jpg`, cut from the probe's screenshot `shot_vegetation_reads_gate_busy_2026-10-11T14-31-58-725Z.png`; Jim answered "y" to "Does it show trees, shrubs or grass?"]. The full-screen screenshots stay on Jim's PC (`%TEMP%\LrC-AVG\ai-probe\`): they show his whole desktop.
- Headline: **AI mask probe: DONE**, 3 of 3 runs, no Lightroom restart, the photo put back after each run ("settings and masks as before").
- `mountains_reads`: the update answered `started` in 15 ms. The gate read busy (`aborted`, update `running`) at 10.5, 14.2 and 14.9 s. The mask **computed** at 15.8 s, after 12 reads. One read took 2220 ms (at 6.5 s).
- `vegetation_reads`: the update answered `started` in 44 ms. The gate read busy at 10.5 s. At 12.2 s the entry showed **ErrorReason 1**, after 11 reads.
- `vegetation_no_reads`: the update answered `started` in 20 ms. The gate read busy from 0.8 to 7.2 s (4 probes). At 8.7 s it read free, with the update `done`. The one read, right after, showed **ErrorReason 1**.
- Jim's check by hand, same photo, after the probe: Masking > Landscape did not offer Vegetation, "Lightroom did not detect the tree on the first photo. That isn't an issue, but how the MCP responded (crashing LrC) is." [stated: Jim, 2026-10-11].
- No dialog in any run: "n" to both dialog questions three times, and "y" to "Does Lightroom respond now?" three times. No screenshot was taken for "no result", because every run had a result.


### Second photo

Jim asked for a second run on a photo where Lightroom does find Vegetation [stated: Jim, 2026-10-11, "I want to run the probe on a different image … Let's start with the probe on a new image, then go back and troubleshoot the crash"]. Jim's run of `npm run ai:probe -- --new`, 14:43-14:45Z [handle: `ai-vegetation\ai_probe_2026-10-11T14-43-18-379Z.json`; plugin log in `ai-vegetation\bridge_log_excerpt_2.txt`]:

- Photo: `20260906-_OZ80085.NEF` [handle: `ai-vegetation\photo_crop_2.jpg`, cut from `shot_vegetation_reads_gate_busy_2026-10-11T14-44-29-564Z.png`].
- Headline: **AI mask probe: DONE**, 3 of 3 runs, no restart, the photo put back after each run.
- `mountains_reads`: **computed** at 7.4 s (8 reads, no probe: the result came before 10 s).
- `vegetation_reads`: the gate read busy at 10.5 s; **computed** at 12.7 s (11 reads).
- `vegetation_no_reads`: busy from 0.8 to 9.4 s (5 probes), free with the update `done` at 10.5 s; the one read, 0.4 s later, showed it **computed** (10.96 s).
- No dialog, and Lightroom responding, in all three runs (Jim's answers).

## Numbers

| Run | Outcome | Update over at | First busy gate | Dialog | Lightroom responding | Put back |
|---|---|---|---|---|---|---|
| mountains_reads | computed, 15.8 s | (busy until the result) | 10.0 s | n | y | YES |
| vegetation_reads | ErrorReason 1, 12.2 s | (busy until the result) | 10.0 s | n | y | YES |
| vegetation_no_reads | ErrorReason 1, 8.7 s | 8.7 s | 0.3 s | n | y | YES |
| 2nd photo: mountains_reads | computed, 7.4 s | (no probe) | none | n | y | YES |
| 2nd photo: vegetation_reads | computed, 12.7 s | (busy until the result) | 10.5 s | n | y | YES |
| 2nd photo: vegetation_no_reads | computed, 11.0 s | 10.5 s | 0.25 s | n | y | YES |

(In the runs with reads, probing starts at 10 s, as in the engine, so the gate was busy from the first probe on.)

## Analysis (Claude Code)

- **The hang did not come back.** Three AI computations in a row, with and without the engine's reads, each ended within 16 s, with no dialog, and Lightroom kept responding. So nothing here shows the engine's reads taking part in a hang (H2) [inference: one photo, one run each].
- **ErrorReason 1 is Lightroom's own "none found".** The engine reads ErrorReason 1 as "Lightroom found none of that kind" and answers `MASK_NOTHING_FOUND` (`engine\src\session\ai-masks.ts` `byTable`), as with Snow and Water on photos without them [handle: `docs\reports\phase6\masks-capture\capture4-check.json` steps `row4_snow`, `row4_water`]. Lightroom's own Landscape panel found no Vegetation on this photo either (Jim's check above), so that reading holds here. The second photo's run (below) is for a photo where Lightroom does find Vegetation.
- **What differs from 2026-10-11:** that run never got an ErrorReason or a digest, and Lightroom showed an error dialog [stated: Jim, 2026-10-11]. Today Lightroom answered ErrorReason 1 within 9-12 s. Both photos show junipers in a dry landscape [inference from the photo crop and issue #123's description].
- Our entry for every landscape kind carries the ReferencePoint `0.500000 0.500000`, the photo's centre (`engine\src\params\mask-ops.ts` `newComponent`, `pin`). Whether Lightroom uses that point for a landscape kind is [unverified].

- **The second photo computed every mask.** Vegetation took 12.7 s with the engine's reads and 11.0 s without. So neither the probe nor the engine's rhythm of reads and probes brings the crash back on a photo where Vegetation exists [inference: one run each].

### The 2026-10-10 crash, from Windows' event log (Claude Code)

Read-only `Get-WinEvent` on Jim's PC, 2026-10-11 [handle: `ai-vegetation\windows-events.txt`; times are local, UTC-7]:

| Local time | Source | What |
|---|---|---|
| 22:49:49.028 | plugin log | `update_ai_settings` (Vegetation) arrives |
| 22:49:56 | System, `nvlddmkm` id 153 | the NVIDIA display driver logs an error. It is the only `nvlddmkm` event since 2026-10-08 |
| 22:50:01-02 | Windows Error Reporting | `LiveKernelEvent` 141 and 193 (graphics kernel reports) |
| 22:50:04 | plugin log | the last gate probe. The engine saw the update over with the gate free, and then no result |
| 22:52:31.864 | plugin log | the last `get_settings` received |
| 22:52:32 | Application id 1000 | **Lightroom.exe 15.6.0.2 crashed**: `ntdll.dll`, exception `0xc0000374` (heap corruption). The engine's socket got `ECONNRESET` here [handle: repo `logs\engine-20261010.jsonl`, `lr_create_mask` ended after 168.5 s] |
| 22:54:07 | Application id 1002 | "Lightroom.exe … stopped interacting with Windows and was closed" |

What this shows:
- **Lightroom crashed on its own at 22:52:32.** The engine did not kill it, and Jim did not either: Jim's force-close is the 22:54:07 entry, the hung window of a process that had already crashed [inference from the order of the events].
- **The NVIDIA driver failed 7 s into Lightroom's Vegetation computation.** Lightroom's AI masks run on the graphics card [unverified: Adobe does not say so in any source read here]. Lightroom then reported the update over with no result. Its "unexpected error" dialog [stated: Jim, 2026-10-11] fits a computation that failed when the driver did [inference].
- **The other Lightroom crash since 2026-10-08 has the same code.** On 2026-10-09 at 04:57:13 (11:57:13Z), `0xc0000374`, with no NVIDIA event, during S10 run 1. Jim then saw "LrC closed after the last spike" [handle: `windows-events.txt`; `docs\reports\phase8\S10.md` item 6 (c), run 1 11:55-11:57Z]. That battery wrote settings by uuid and exported; it made no AI mask. So Lightroom 15.6 has crashed with heap corruption twice in three days, both times while the plugin was busy. What causes the heap corruption is [unverified]: the driver error, Lightroom, the plugin's calls, or a mix.

What the engine did wrong (the part Jim names [stated: Jim, 2026-10-11, "how the MCP responded (crashing LrC) is" the issue]):
- From 22:50:04, Lightroom had reported the update over and the catalog free, and no result came. The engine still treated the mask as "computing" for 150 s. It read the settings once a second, told the user Lightroom was computing (`WORKING_NOTE`), and would have gone on to its 5-minute limit. In every run where Lightroom had a result, the result was in the table at the first read after "done": 0.02 s and 0.4 s in the no-reads runs above, and 0.3-0.5 s after the update returned in capture 3 [handle: the two result files above, `vegetation_no_reads` events; `docs\reports\phase6\masks-capture\capture3-check.json` steps `4_*`]. So "over, free, and no result" meant the computation had failed, and the engine could have known within seconds [inference].
- Whether the once-a-second reads after the failure helped Lightroom crash is [unverified]. Both runs here kept reading with no crash, but their computations did not fail.

## Verdict

**Go** for the fix PR as recommended in "Consequences": the wait ends when Lightroom reports the update over with the catalog free and a read up to 2 s later shows neither a digest nor an ErrorReason; the engine then stops reading, writes nothing, and asks the user to save and restart Lightroom [stated: Jim, 2026-10-11, "Go with recommendations"]. The NVIDIA driver: Jim found no update yet and will check again [stated: Jim, 2026-10-11].

## Consequences / open questions

- **H1 holds; H2 is not shown; H3 is narrowed** [inference from the runs and the event log above]. The failure was Lightroom's computation, after an NVIDIA driver error. The engine's part is that it did not tell "over with no result" from "still computing".
- **For the fix PR (Jim decides the shape):** once Lightroom reports the update over with the catalog free, and a read after that shows neither a digest nor an ErrorReason, the engine stops the wait. It tells the user that Lightroom's AI computation failed, and asks them to save and restart Lightroom. It stops reading. It writes nothing to a Lightroom that may be unstable, and the session is put back after the restart (restart.ts) or reset (#124). How long "after that" is, is Jim's call. The measured gap is 0.02-0.5 s.
- **Open:** whether the plugin's calls take part in the heap corruption (2 crashes, `0xc0000374`, both while the plugin was busy) is [unverified]. The NVIDIA driver `32.0.16.1692` error at 22:49:56 is outside LrC-AVG. A driver update is Jim's decision.
- Still [unverified]: the dialog's text (no screenshot was taken during the 2026-10-10 run).
