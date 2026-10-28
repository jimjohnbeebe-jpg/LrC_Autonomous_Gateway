---
report: METRICS-PARITY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps, 2026-10-27); Jim (Observed, verdict: blank)"
date: 2026-10-27
---

# METRICS-PARITY: sharpness, lr_get_photo_stats and the fast preview (issue #216)

## Purpose

GitHub issue #216 (epic #207, Automaat parity) adds what Automaat's `get_photo_stats` and `get_photo_preview` have and LrC-AVG lacked: a **sharpness** metric, **metrics of many photos without a session**, and a **fast preview** from Lightroom's cache [handle: issue #216 "Upstream" and "Work"]. Its acceptance line: "Metric definitions and tests; stats of 20 photos within a stated time budget (Jim's run); fast-preview staleness measured and documented."

This check answers the two Lightroom-side parts:

1. **Do 20 photos' stats come back within the budget?** The stated budget is **3 s a photo, 60 s for 20** [inference: the export time the tool description states, "about 1-3 s a photo"; an export took about 2.6 s at 1600 px in S1, handle: `docs\reports\phase0\S1.md`]. `lr_get_photo_stats` exports at 800 px and works for about 30 s per call (`not_yet`), so 20 photos may take two calls; the check times all of them.
2. **How stale is the fast preview?** After a change, how long until `requestJpegThumbnail` shows it? Automaat says it is stale right after a photo enters Develop and to "wait about 3.5 s, and fetch the preview twice" [upstream claim: Automaat/lightroom-mcp 1040453 `CLAUDE.md:100`, macOS LrC 15.6]. Spike S1 on 15.5.1 got no image at all within 30 s after a write ("error loading thumb") [handle: `docs\reports\phase0\S1.md` Run 2]. Which holds on this machine is open.

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's): **go** when the 20 photos come back within 60 s and a fast preview comes from the cache; the staleness number goes into `lr_get_preview`'s description and `STALE_NOTE` (`engine\src\mcp\tools-preview-fast.ts`) either way. If the fast preview never catches up within 12 s, it stays a browsing tool only, as it is documented now.

## Harness

`npm run stats:check`. Files: `engine\src\devtools\stats-check-cli.ts` (drives Lightroom), `engine\src\devtools\stats-check.ts` (the caught-up rule and the verdict, tested in `engine\tests\stats-check.test.ts`). It uses the engine's own tools (`Tools.getPhotoStats`, `Tools.getPreview`), so it runs the same code Claude does.

1. **Stats.** `lr_get_photo_stats` on the photos selected in the Library grid (2 to 20), called again with `not_yet` until every photo is measured; per call: its time, photos measured, photos left; per photo: its metrics (sharpness included) or its error.
2. **Fast against exact.** For up to three of them, one `quality: "fast"` preview and one exact preview: source, size, time, metrics. If the loaded plugin has no `thumbnail_preview`, the check stops here and says to reload the plugin.
3. **Staleness after a change**, on the first selected photo, once Jim has opened it in Develop: a snapshot ("AVG stats:check before"); a fast and an exact preview; Exposure moved by 1 (History "AVG stats:check exposure"); a fast preview at 0, 0.5, 1, 2, 3.5, 5, 8 and 12 s after the write; an exact preview; the photo put back from the snapshot and its Exposure read back. A fast preview has **caught up** when its mean luma moved at least 75 % of the way the exact export's moved [inference: the 75 % is ours].
4. **One question** (y/n in the PowerShell window): is Exposure back where it was.

The window ends with YES/NO lines, **Stats check: WORKED/FAILED** and **put back: YES/NO**. Results: `%TEMP%\LrC-AVG\stats-check\stats_check_<time>.json` (Claude Code collects them).

What it does not test: the sharpness advisory inside a session (`engine\src\session\sharpness-advice.ts`, threshold 15 %, provisional [inference]); that waits for an edit session where Claude changes sharpening or noise reduction. Whether thumbnails go stale in other ways (a preview cache cleared, a photo never rendered) is not tested.

## Pre-run findings (Claude Code)

- **Sharpness** is defined in `engine\src\metrics\sharpness.ts` (header comment): the variance of the four-neighbour Laplacian of the Rec. 709 luma after area resampling to a 512 px long edge, the definition of Automaat's `photoStats` [upstream claim: `server/src/photo-stats.ts` at 1040453], computed on the pixels sharp decodes. It is in every metrics summary, in `delta_metrics`, per region, and optional in the session log schema (`engine\schemas\session-log.schema.json`). Tests: a checkerboard and a ramp with a step each measure lower after a blur, a flat image measures 0, a fixed checkerboard measures 13764.706, and two sizes of one image measure within 5 % [handle: `npx vitest run tests/metrics-sharpness.test.ts` in `engine\`, 2026-10-27: "Tests 6 passed (6)"].
- **The image cap against Claude's limits.** Automaat states Claude rejects images over 5 MB of base64, and over 2000 px once a request holds more than 20 images [upstream claim: `HandlerPreview.lua:21-25` at 1040453]. Ours capped the base64 at 900,000 characters, far under the first, and had no pixel cap, though no tool sends more than 1920 px [inference: `MAX_LONG_EDGE` in `engine\src\mcp\tools-shared.ts`]. `capImage` now also caps the long edge at 2000 px [handle: `npx vitest run tests/mcp-image-cap.test.ts` in `engine\`, 2026-10-27: "Tests 3 passed (3)"].
- **The fast preview** against the fake plugin: the result is marked `source: "thumbnail"`, `stale_possible: true`, sized down to `long_edge`; when the plugin answers `thumbnail_failed` the exact export is rendered and `fast_fallback` says why; it is refused with `session_id` or `region`; it never becomes the engine's last render [handle: `npx vitest run tests/mcp-preview-fast.test.ts` in `engine\`, 2026-10-27: "Tests 4 passed (4)"]. The fake plugin writes a JPEG it made itself, so this shows the engine's side only; `Preview.lua thumbnailPreview` has not run in Lightroom.
- **lr_get_photo_stats** against the Lightroom simulator: one export per photo by uuid in the order given, a photo that fails gets its own error, the budget and a cancelled call stop it with `not_yet`, refused while a session is open [handle: `npx vitest run tests/mcp-photo-stats.test.ts` in `engine\`, 2026-10-27: "Tests 5 passed (5)"]. The simulator's export time is not Lightroom's.
- **The plugin version.** `thumbnail_preview` is new in this branch's plugin; the plugin version is not bumped here (the integration does that). An older plugin answers `unknown_command`, which the engine turns into the exact export with `fast_fallback`, and the check into a stop with "reload the plugin".

## Steps for Jim

1. Quit Claude Desktop (system tray icon > Quit), so the check can take the engine's lock.
2. In Lightroom: **File > Plug-in Manager**, select **LrC-AVG**, click **Reload Plug-in**, then **Done**.
3. In the Library grid (press **G**), select **20 raw photos** of one shoot (click the first, Shift-click the last).
4. In PowerShell, in the repo folder:

   ```powershell
   npm run stats:check
   ```

   You see "1. lr_get_photo_stats on 20 photos ..." and, after up to a minute, "20 of 20 measured in ... s"; then "2. Fast and exact previews ...".
5. When the window says "Now in Lightroom: click <file name> and press D", do that, then type **y** and Enter.
6. Wait about 20 s while it says "3. Exposure ... then fast previews"; do not click in Lightroom.
7. When asked "is Exposure back where it was", look at the Basic panel's Exposure and type **y** or **n**, then Enter.
8. The window ends with "Stats check: WORKED" or "FAILED" and "put back: YES" or "NO". Say "done" to Claude Code.

### If something goes wrong

- If the window says "could not connect to Lightroom", Lightroom is still starting its bridge: wait 30 s and run step 4 again.
- If it says "the loaded plugin has no thumbnail_preview", do step 2 again, then step 4.
- If it says "select 2 to 20 photos", fix the selection (step 3) and run step 4 again.
- If it ends with "put back: NO": in Develop, open the **Snapshots** panel (left side), click **AVG stats:check before**.

## Observed (Jim)

_Blank until Jim's run._

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin version | |
| Photos selected | |
| `lr_get_photo_stats` calls, time per call | |
| Total time for all photos (budget 3 s a photo) | |
| Photos with an error | |
| Sharpness range over the photos | |
| Fast preview time, exact preview time (median of three) | |
| Fast preview came from the cache (n of 3) | |
| Fast preview caught up after the write (ms, or "not within 12 s") | |
| Exposure read back as before | |
| Jim's answer | |

## Verdict

_Jim's: go / conditional / no-go._

## Consequences / open questions

- The staleness number replaces the `[upstream claim]` in `STALE_NOTE` and in `lr_get_preview`'s description.
- The 15 % sharpness advisory threshold stays provisional until a session that changes sharpening or noise reduction shows how far sharpness moves.
- Whether a thumbnail is stale for other reasons (a cleared preview cache, a photo never rendered) stays [unverified].
