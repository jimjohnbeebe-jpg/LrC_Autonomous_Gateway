---
report: SDKVER
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (the two runs, Observed, verdict)"
date: 2026-10-26
---

# SDKVER: does the declared `LrSdkVersion` hide Develop keys?

## Purpose

GitHub issue #209 (epic #207) moves the plugin's `LrSdkVersion` from 13.0 to the latest Lightroom Classic SDK version, and settles the question `Info.lua` leaves open: whether the declared version hides newer Develop keys, which is `[unverified]` today [handle: `plugin\LrC-AVG.lrplugin\Info.lua:20-22` at `b5ea6ee`; issue #209 "What"]. The five Phase 0 spike plugins declared 13.0 and ran on LrC 15.5.1; upstream declares 8.0 and still calls APIs from 11 to 15.6, which suggests the declared version does not gate APIs `[inference, weak]` [handle: issue #209 "Facts so far"]. Nobody has compared the keys `photo:getDevelopSettings()` returns under two declared versions.

The question: **on the same photos, in the same Lightroom, does `getDevelopSettings()` return the same keys, with the same types, when the plugin declares 13.0 (A) and when it declares the new value (B, the one the PR for #209 sets in `Info.lua`)?** If not: which keys, on which photos, and are they in the pinned file `engine\src\params\sdk-keys.lrc15.json`?

Acceptance (issue #209): "Jim: plugin loads in Plug-in Manager on the current LrC; `phase1:check` and `masks:kinds` WORKED. The answer to 'does the declared version hide keys' recorded in a report." This report answers the second sentence; the checks in the first are run by their own commands.

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's):

- **Go:** the same keys with the same types on every photo under A and B. The declared version can be raised with no loss of keys.
- **Conditional:** keys differ. The keys only under B are new Develop keys the declared version exposes; they are pinned from B's dumps only (rule 03: live dump, never documentation) and the params map reviewed for them. Keys only under A (a key B hides) would be a **no-go** for the new value until understood.

## Harness

`npm run sdkver:check` (Jim's steps: `spikes\SDKVER\README.md`). Files: `engine\src\devtools\sdkver-check.ts` (the steps), `sdkver-diff.ts` (the diff and the reading of `Info.lua`), `sdkver-check-cli.ts` (the command line); test `engine\tests\sdkver-check.test.ts`. Existing bridge commands only (`hello`, `list_collections`, `search_photos`, `get_context`, `get_settings`); no plugin change. It reuses spike S10's `connect` and `census` (`s10-config.ts`, `s10-census.ts`), which read every photo of the "fixtures" collection by uuid, select nothing and write nothing, and save each photo's settings as an S5-shaped dump (`spikes\S5\pin.ts` can pin from them).

- **What a run records.** For each photo: every key `getDevelopSettings()` returned, with its JSON type and a short digest of its value; the keys the pinned file lacks. For the run: `hello.sdk_declared`, `hello.lrc_version`, `hello.plugin_version`, `hello.process_started_at`, the time.
- **The two declared versions come from two natural states of the plugin, not from an edit.** Run 1 is the plugin Lightroom has loaded now (13.0). Run 2 is the same plugin folder after the PR for #209 changed `Info.lua`, with **File > Plug-in Manager > Reload Plug-in** between. Rewriting the version line in a copy of the plugin would need a second plugin that Jim adds in Plug-in Manager, its own ports (the bridge binds 8765/8766 [handle: `Bridge.lua:2-3`], so two bridges would collide `[inference]`), and Lua written without a Lightroom to try it on; a rewrite of the tracked `Info.lua` would race the PR's own edit. The cost: the label of a run is what the loaded plugin reports (`Bridge.lua` `SDK_DECLARED`), a hand-kept copy of `Info.lua`'s value, which the harness checks against this repo's `Info.lua` (a NOTE line when they differ) and a test keeps equal (`sdkver-check.test.ts`, first test of "Info.lua").
- **The comparison** (second run on): the newest earlier run that declared another version, preferring one from the same Lightroom. Photos are matched by uuid. It lists keys only under each version, keys with another type, the number of values that differ on shared keys (a photo edited between the runs shows there, so a key set that moved because of an edit is not read as an SDK effect), and the keys new against the pinned file. The window ends **SDKVER: WORKED** when Lightroom was reached and every photo read, whatever the keys did; its "Suggestion" line is a suggestion.
- **Results** under `%TEMP%\LrC-AVG\sdkver\`: `sdkver_<declared>_<time>.json`, `dumps\<time>\`, `sdkver_bridge_log_<time>.txt`. Claude Code collects them into `docs\reports\phase11\SDKVER\`.

What it does not test: whether a declared version hides **API functions** (the other half of the issue's question): the audit and the per-tool "needs Lightroom Classic N" checks of #209 cover that.

## Pre-run findings (Claude Code)

- At `b5ea6ee`, `Info.lua` declares `LrSdkVersion = 13.0` and `LrSdkMinimumVersion = 13.0` [handle: `plugin\LrC-AVG.lrplugin\Info.lua:26-27`]. `hello` already carries `sdk_declared` and `process_started_at` [handle: `engine\src\bridge\protocol-results.ts:19-26`; `plugin\LrC-AVG.lrplugin\Bridge.lua:92-100`], and `get_settings` returns the whole `photo:getDevelopSettings()` table [handle: `plugin\LrC-AVG.lrplugin\Develop.lua:79-83` `readSettings`, used by `Develop.getSettings`].
- `sdk_declared` is a constant typed into `Bridge.lua` (`Bridge.SDK_DECLARED = 13.0`, line 52), not read from `Info.lua`. A change to `Info.lua` that leaves it alone makes run 2 report 13.0 again. `engine\tests\sdkver-check.test.ts` fails when they differ; commit `3aa0d44` sets both to 15.2.
- **15.2 is the newest Lightroom Classic SDK confirmed** [handle: `D:\Developer\LightRoom Classic Dev Kit\Readme.txt` line 1, "Adobe Lightroom Classic 15.2 Software Development Kit (Build: "202602111402-ec4112e8")"]; a newer one is [unverified] (the Adobe Developer Console download page needs a sign-in). The guide documents no hiding of calls or develop keys by the declared version [handle: `Manual\Lightroom Classic SDK Guide.pdf` pp. 22-23]. Details, with the "first supported in" version of each call the plugin makes: vault `LR_SDK_NOTES.md`, "Recorded in Phase 11".
- **The version gates** (`plugin\LrC-AVG.lrplugin\Needs.lua`): `photo:updateAISettings` needs 13.3 and AI Denoise 14.5; each answers `feature_unavailable`, "… needs Lightroom Classic N or later: <call> not found …", before anything changes, and the engine passes it on as `FEATURE_UNAVAILABLE` [handle: `engine\tests\sdk-version-gate.test.ts`]. Needs.lua has not run in Lightroom yet: Jim's `phase1:check`, `masks:kinds` and `denoise:check` after the merge are its first run.
- Two comments disagree on what a reload does to `process_started_at`: `Bridge.lua:77` and `:87` say a Reload Plug-in on LrC 15.6 started a fresh `_G`, so a reload reads as a restart; `protocol-results.ts:23` says a reload keeps the Lua state `[inference]`. The harness does not rely on either; it records the value of each run.
- The pinned file holds 192 keys from five dumps, from LrC 15.5.1 and 15.6 (two with no `lr_version`) [handle: `node -e` over `engine\src\params\sdk-keys.lrc15.json`, 2026-10-26: `keys.length` 192, `sources` of `s5_20260907-_OZ80093.NEF`, `s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`, `masks-capture_3_dump-1`, `s14_monochrome_…`, `curve_probe_settings_…HDR`]. It is a union over photos in different states. So "new against the pinned file" lists keys of photo states the five dumps lack, as well as any key the SDK version adds; the A against B diff on the same photos is what answers the question.
- Against the simulated plugin, with hello made to declare another version and the photo made to lose and gain a key between the runs: run 1 saves the keys and compares nothing; run 2 lists the lost key under A, the gained key under B and under "new against the pinned file", and prints the suggestion; an unchanged photo gives "the declared version hid none of them"; a repeat at the same version compares nothing and says so; a missing collection gives FAILED; nothing is selected or written [handle: `npx vitest run tests/sdkver-check.test.ts` in `engine\`, 2026-10-26: "Tests 14 passed | 1 failed (15)"; the failing one is the Bridge.lua/Info.lua equality test, which fails in the working tree because the PR's `Info.lua` edit (15.2) was made before `Bridge.lua` was changed]. The simulator reports what it is told, so this shows the harness works, not what Lightroom does.
- At the same time, in the worktree: `npm run build`, `npm run typecheck` and `npm run arch:check` clean ("no dependency violations found (332 modules, 1777 dependencies cruised)"), and `npm test` "Test Files 165 passed (165)", "Tests 1783 passed | 9 skipped" before the equality test was added [handle: the commands run in `.claude\worktrees\lr-sdk-version`, 2026-10-26].

## Steps for Jim

`spikes\SDKVER\README.md` (6 steps in two runs: quit Claude Desktop, one PowerShell command, "done"; then Reload Plug-in, the same command, "done").

## Observed (Jim)

### Run 1 (plugin as loaded, declared 13.0)

Jim ran `npm run sdkver:check` from `.claude\worktrees\lr-sdk-version` at `f52c41a` on 2026-10-27 04:00 UTC (2026-10-26 local), Lightroom Classic 15.6, plugin 1.3.0, and said "sdkver run 1 done". Claude Code collected the files into `docs\reports\phase11\SDKVER\run1\` (the run, its 31 dumps, and the first attempt's FAILED record). The two bridge logs, about 4.8 MB each, stay in `%TEMP%\LrC-AVG\sdkver\` (logs are not committed, rule 04).

- **First attempt, 04:00:00Z: FAILED**, "could not connect to Lightroom (127.0.0.1:8765: ECONNREFUSED)" [handle: `run1\sdkver_failed_2026-10-27T04-00-00-474Z.json`]. The plugin's `process_started_at` in the next attempt is 04:00:22Z, so the bridge was not listening yet at 04:00:00 `[inference]`. Nothing was saved, as the harness intends.
- **Second attempt, 04:00:32Z: WORKED** [handle: `run1\sdkver_13.0_2026-10-27T04-00-32-563Z.json`, `headline` "WORKED", `errors` `[]`]. `hello.sdk_declared` 13, `info_lua.sdk` 15.2, so one `NOTE:` line, as the README expects for run 1. 31 photos read, 0 skipped (12 raw, 19 rendered).
- 12 keys are new against the pinned file: `CropConstrainAspectRatio`, `IncrementalTemperature`, `IncrementalTint`, `RemoveAreas`, `RetouchAreas`, `UprightFourSegments_0`, `UprightTransform_0` to `_5` [handle: same file, `new_vs_pinned`]. These are under 13.0, so the declared version does not explain them. They come from photo states the five pinned dumps lack (Pre-run findings, pinned-file bullet) `[inference]`.

### Run 2 (after Reload Plug-in, declared 15.2)

Jim reloaded the plugin, ran `npm run sdkver:check` from `D:\Developer\LrC_Autonomous_Gateway` at `ec2adbb` on 2026-10-27 04:21 UTC (2026-10-26 local), and said "sdkver run 2 done". Claude Code collected the run and its 29 dumps into `docs\reports\phase11\SDKVER\run2\`. The bridge log stays in `%TEMP%\LrC-AVG\sdkver\`.

- **WORKED** [handle: `run2\sdkver_15.2_2026-10-27T04-21-17-106Z.json`, `headline` "WORKED", `errors` `[]`]. `hello.sdk_declared` 15.2, `info_lua.sdk` 15.2, and no `NOTE:` line. The Reload Plug-in made Lightroom read the new `Info.lua`, and `process_started_at` moved from 04:00:22Z to 04:19:59Z [handle: `hello` in both run files]. This answers the open question under "Consequences" for this Lightroom.
- 29 photos read, 0 skipped (12 raw, 17 rendered). The two photos missing from run 2, `20260907-S10-tiff16.tif` and `20260907-S10-tiff32.tif`, were removed from the catalog by Jim between the runs [stated: Jim, 2026-10-26, "Yes, I removed them"]. After run 2, a read by uuid answered `unknown_photo` for both [handle: a read-only bridge script run by Claude Code, 2026-10-26].
- **Comparison with run 1 on the 29 shared photos:** no key only under 13.0, none only under 15.2, no type changed, no value changed [handle: same file, `comparison`]. The suggestion line: "the same keys, with the same types, under 13.0 and 15.2 on 29 photos: the declared version hid none of them."
- The same 12 keys as in run 1 are new against the pinned file.

## Numbers

| Field | Run 1 (A) | Run 2 (B) |
|---|---|---|
| Declared `LrSdkVersion` (`hello.sdk_declared`) | 13 | 15.2 |
| `NOTE:` lines about Info.lua (none / text) | 1: the loaded plugin declares 13.0, the worktree's `Info.lua` 15.2 (expected) | none |
| Lightroom Classic (`lrc_version`) | 15.6 | 15.6 |
| Plugin version | 1.3.0 | 1.3.0 |
| `process_started_at` | 2026-10-27T04:00:22Z | 2026-10-27T04:19:59Z |
| Photos read ("fixtures") | 31 (12 raw, 19 rendered), 0 skipped | 29 (12 raw, 17 rendered), 0 skipped |
| Keys per photo (file: count) | 172: 16 rendered photos; 173-177: 10 photos; 180-183: 5 photos (`_DSC0103.NEF (Copy 1)` 183, `PICT0019.DNG` 182). Full list in `run1\sdkver_13.0_*.json` `run.photos[].key_types` | 172: 15 rendered photos; the other 14 photos as in run 1. The two removed TIFFs had 172 and 176 |
| Keys new against the pinned file | 12 (listed in Observed, run 1) | the same 12 |
| Photos in one run only | n/a | 2, only in A: the two S10 TIFFs (removed by Jim) |
| Keys only under A | n/a | 0 |
| Keys only under B | n/a | 0 |
| Keys with another type | n/a | 0 |
| Values that differ on shared keys | n/a | 0 |
| Suggestion line | n/a | "the declared version hid none of them" (29 photos) |

## Verdict

_Jim's; not given yet. The script's suggestion: **Go**, because the keys and types are the same under 13.0 and 15.2 on the 29 photos both runs read. This is a suggestion only._

## Consequences / open questions

- If the key sets are the same: the answer for `Info.lua:20-22` is "no hiding, on these photos and these two values". Everything stays `[unverified]` for photo states the "fixtures" photos do not have (masks, Monochrome, HDR mode, grading): keys such as `ExtendedToneCurvePV2012*` or `GrayMixer*` appear only in those states [handle: vault `LR_SDK_NOTES.md` "Recorded in Phase 8"; `docs\reports\phase10\curve-probe.md` "Purpose"; `docs\reports\phase10\S14.md` "d. Mixer"], so a photo without the state could not show a hidden key. Which states the collection covers is in the Run 1 photo list.
- If the keys differ: pin B's new keys from its dumps (`node spikes\S5\pin.ts` with the `dumps\` files, rule 03), review `engine\src\params\` for them, and record in `LR_SDK_NOTES.md`.
- Whether **Reload Plug-in** makes Lightroom read `Info.lua` again is `[unverified]`; `docs\reports\phase6\masks-capture.md` raised the same question for a new Lua module. A reload that left the old declared version in place would show as the same `sdk_declared` in both runs and the README's File > Exit step answers it. A restart is the sure way to load `Info.lua` anew.
- `sdk_declared` is the plugin's own constant, not a value Lightroom reports `[inference]`. Whether the SDK has a call that returns the version a plugin declared is `[unverified]`: the plugin uses none, and the SDK reference was not searched for this report.
- Item 5 of #209 (`phase1:check`, `phase5:check`, `masks:*`, `denoise:check` with the new value) is a separate set of runs; this report does not replace them.
