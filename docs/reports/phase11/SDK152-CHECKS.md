---
report: SDK152-CHECKS
phase: "11"
status: observed
authored_by: "Claude Code (Opus 5.5): purpose, harness, results collected from Jim's result files, 2026-10-26. Jim: the runs, the y/n answers, the verdict."
date: 2026-10-26
---

# The plugin checks with `LrSdkVersion` 15.2 (#209 item 5)

## Purpose

Issue #209's acceptance: "Jim: plugin loads in Plug-in Manager on the current LrC; `phase1:check` and `masks:kinds` WORKED". These are also the first runs of `plugin\LrC-AVG.lrplugin\Needs.lua` (the version gates) in Lightroom [handle: PR #223 "Not run yet"]. The question is whether the plugin still works once it declares 15.2. Whether 15.2 hides Develop keys is answered separately, in `docs\reports\phase11\SDKVER.md`.

## Harness

The existing checks, run from `D:\Developer\LrC_Autonomous_Gateway` at `ec2adbb` (#223 merged) after Reload Plug-in, with Claude Desktop quit. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`. Results are copied into `docs\reports\phase11\SDK152-CHECKS\`; bridge logs stay in `%TEMP%\LrC-AVG\`.

## Pre-run findings (Claude Code)

- Every check below connected to the plugin declaring 15.2 on LrC 15.6, plugin 1.3.0 [handle: `hello` in each result file].

## Observed (Jim)

Jim ran the three checks on 2026-10-26 between 21:25 and 21:36 local time, then ran masks:kinds a second time [stated: Jim, "checks done, test 3 failed. Interestingly the denoise continued to run after the check failed, photos not reverted"; "I just ran the masks:kinds test again and it passed"].

**1. phase1:check: WORKED** [handle: `SDK152-CHECKS\p1_check_2026-10-27T04-25-30-302Z.json`, `summary`]. Photo `20260907-_OZ80093.NEF`. The exposure write read back, the snapshot revert was exact (0 differing keys out of 177), and all 6 extended steps passed. Jim answered y to both questions.

**2. masks:kinds, first run: FAILED** [handle: `SDK152-CHECKS\mask_kinds_2026-10-27T04-26-48-371Z.json`, `form_lines`]. Photo `20250414-20250413-_OZ81315-HDR-2.avif`, a virtual copy.

| Mask | Result |
|---|---|
| colour range | NO (Jim: n) |
| brush | YES |
| depth range | skipped (no depth map) |

- The colour range mask read back exactly as written, sampled at the centre `0.136314 0.203294 0.261020`, ColorAmount 0.5 [handle: same file, `forms[0]`]. So Lightroom stored it, but Jim did not see the colour brighten.
- The photo was put back: "settings and masks as before".

**2b. masks:kinds, second run: WORKED** [handle: `SDK152-CHECKS\mask_kinds_2026-10-27T04-35-51-608Z.json`]. Photo: the virtual copy of `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng` that denoise:check had just denoised.
- colour range YES, brush YES, depth range skipped.
- Put back YES.

**3. denoise:check: FAILED, put back NO** [handle: `SDK152-CHECKS\denoise_check_2026-10-27T04-28-25-518Z.json`]. Photos: virtual copies of `20250413-_OZ81430.NEF` and `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`.
- Photo 1's first Denoise applied in 13.8 s, through the `Needs.lua` gate.
- Lightroom was then blocked for 11 s. The engine dropped the bridge after 6.1 s, the put-back gave up, and the plugin still applied photo 2's Denoise [handle: `%TEMP%\LrC-AVG\bridge.log` lines 55661-55669].
- Full timeline and cause: issue #226. Fix: PR #227.
- Claude Code gave Jim the steps to put both photos back from their snapshots "AVG denoise:check before first Denoise". Whether he did is not recorded.

## Numbers

| Field | Value |
|---|---|
| Plugin loads with 15.2 (Plug-in Manager, Reload) | yes: every check connected with `sdk_declared` 15.2 |
| phase1:check | WORKED |
| masks:kinds | FAILED on an HDR AVIF (colour range n); WORKED on a DNG |
| denoise:check | FAILED (bridge drop after Denoise, #226); both Denoise calls passed the gate and applied |
| `Needs.lua` gates passed in Lightroom | AI Denoise (14.5): yes, 2 photos. updateAISettings (13.3): not exercised by these checks |

## Verdict

_Jim's; not given yet. Claude Code's suggestion: #209's acceptance lines are met (phase1:check and masks:kinds WORKED with 15.2). The denoise:check failure is #226, not 15.2. denoise:check is run again after PR #227._

## Consequences / open questions

- **Colour range on the HDR AVIF:** the mask stored as written, but Jim saw no change, while the same mask worked on a DNG. Whether colour range masks behave differently on HDR or AVIF photos is `[unverified]`. It belongs to #210, which already questions colour range.
- `updateAISettings` (13.3) has still not run behind its gate in Lightroom; an AI mask probe (`npm run ai:probe`) would exercise it.
- denoise:check is run again after PR #227 merges.
