---
report: Phase 0 close-out (init + feasibility spikes)
phase: 0
status: accepted
authored_by: "Claude Code (Opus 5.5), 2026-09-26, compiled from the six accepted spike reports. Decisions on each proposal and on closing Phase 0: Jim (2026-09-26: all 19 accepted, LR_SDK_NOTES draft approved, D-01 decided, decision to close Phase 0)."
date: 2026-09-26
---

# Phase 0 close-out

## Purpose

Check Phase 0 against its acceptance line and hand Jim, the architect, one list of everything the spikes propose to change. Accepting a proposal changes nothing by itself: each accepted item is applied to the architect's vault docs in a later step, and the Phase that owns it implements it.

PHASES.md, quoted (`PHASES.md:26`): "**Acceptance:** six spike reports in `Reports/` with measured numbers; `LR_SDK_NOTES` "To record in Phase 0" section filled; `STATE.md` next action set to Phase 1."

## Harness

This report has no harness of its own: it compiles the six spike reports and their evidence. Each spike's harness, run steps and raw files are in its own report: `docs\reports\phase0\S1.md` … `S6.md` (sections "Harness" and "Observed"). The evidence files are in `docs\reports\phase0\S2\` … `S6\`. S1 has no folder: its CSV figures are quoted in `S1.md`, and its screenshot is `docs\reports\phase0\S1-run2-dialog.png`. S5 also has screenshots at `docs\reports\phase0\S5-*.png`.

## Pre-run findings (Claude Code)

Checks Claude Code ran itself on 2026-09-26, before asking Jim to decide:

| Acceptance line (`PHASES.md:26`) | Status | Handle |
|---|---|---|
| Six spike reports in `Reports/` with measured numbers | **done** | `docs\reports\phase0\S1.md` … `S6.md`, each `status: accepted` with Jim's verdict; the vault copies under `Reports\Phase0\` are byte-identical [handle: `Get-FileHash` over all six pairs, run by Claude Code on 2026-09-26: 6 of 6 equal] |
| LR_SDK_NOTES "To record in Phase 0" filled | **approved by Jim (2026-09-26); written into the vault once this PR merges** | the text is "Draft for LR_SDK_NOTES" below |
| STATE next action set to Phase 1 | **set once this PR merges** (Jim decided to close Phase 0 on 2026-09-26) | `LrC_AVG_STATE.md` "Next action" |

Init items (`PHASES.md:15`) were done in the Phase 0 session of 2026-09-23 [handle: `docs\PHASE0_HANDOVER.md` §1–2: `node -v` → v24.11.1, git, `CLAUDE.md`, `.claude\rules`, MCP availability, Automaat survey, `.gitignore`].

## Observed (Jim)

**Spike verdicts.** Jim ran the Lightroom and Claude Desktop sides of every spike and gave each verdict. The observations themselves are in each report's "Observed" section.

| Spike | Question | Jim's verdict | Handle |
|---|---|---|---|
| S1 | Is a thumbnail after `applyDevelopSettings` fresh within 1.5 s? | **No-go for thumbnails; export is the primary preview path** (2026-09-24) | `S1.md` Verdict [stated] |
| S2 | Do LrSocket `receive` + `send` binds work both ways with ≥ 1 MB messages? | **Go** (2026-09-26) | `S2.md` Verdict [stated] |
| S3 | Does Claude Desktop show an MCP image result, and can Claude describe it? | **Conditional go** (2026-09-26) | `S3.md` Verdict [stated] |
| S4 | Is a floating HUD live, non-modal, and does it leave focus with Develop? | **Go** (2026-09-26) | `S4.md` Verdict [stated] |
| S5 | Key dump, profile strings, `CameraProfile` / lens writability | **Go** (2026-09-24) | `S5.md` Verdict [stated] |
| S6 | Does `createVirtualCopies` work from Loupe and Grid, with copies addressable by id? | **Go** (2026-09-26) | `S6.md` Verdict [stated] |

**Close-out decisions**, given in the Claude Code session of 2026-09-26, each chosen from options Claude Code offered [stated]:
- "Accept all 19 (Recommended)" for P-01 … P-19;
- "Write it in (Recommended)" for the LR_SDK_NOTES draft;
- "Export file path (Recommended)" for D-01;
- "Close Phase 0 (Recommended)".

## Numbers

Key numbers per spike. Each figure's handle is the spike report named, in its "Numbers" section.

| Spike | Key numbers | Report |
|---|---|---|
| S1 | no post-change thumbnail within 30 s (5/5 steps); 1600 px export fresh at ~2.6 s; `applyDevelopSettings` 20–45 ms | `S1.md` |
| S2 | 26/26 echoes intact; small RTT median 0.32 ms; 1 MiB 31 ms; 16 MiB (client cap) passed | `S2.md` |
| S3 | 1600×1066 q75 JPEG (332,604 B) reached the model in Desktop and in Claude Code CLI; described correctly [stated]; Desktop shows it only in the expanded tool-call box [stated] | `S3.md` |
| S4 | all five checks ticked; `blockTask = true` blocked its task 36.65 s until close; focus at opening not tested | `S4.md` |
| S5 | 178 keys pinned; Adobe profiles are Looks over "Adobe Standard"; `Look = {}` clears; snapshot restore exact over 178 keys | `S5.md` |
| S6 | 3 of 3 copies per view; no write gate; `getPhotoByLocalId` found all six | `S6.md` |

## Proposed changes, for Jim to accept or reject

Each row is a proposal from a spike report's "Consequences" section; the handle column says where. "Where it lands" names the vault doc to edit, or the Phase that implements it. **Decision** is Jim's: he accepted all 19 on 2026-09-26 [stated: "Accept all 19", chosen from the options Claude Code offered].

### Architecture and decisions

| # | Where it lands | Proposed change | Handle | Decision |
|---|---|---|---|---|
| P-01 | ARCHITECTURE §6, PRD §6.8 | The `LrExportSession` export becomes the primary preview source. The `requestJpegThumbnail` "retry once, then export" path is dropped for post-change previews; `preview_source` is `export` in practice. | `S1.md` Consequences 1 | **accepted** |
| P-02 | PRD §2 goal, NFR-2 | Re-baseline the pass budget from "≤ 1.5 s per pass, 400 ms render" to **about 3 s per pass local** (~2.6 s export + 20–45 ms apply + metrics and transport). | `S1.md` Consequences 2 | **accepted** |
| P-03 | AVG-004 | Confirmed: LrSocket dual socket is the transport. The HTTP polling fallback is not needed. | `S2.md` Verdict + Consequences | **accepted** |
| P-04 | AVG-002 | Confirmed, with a condition: Claude Desktop stays the runtime client; previews are not shown inline in the answer, only in the expanded tool-call box. | `S3.md` Verdict | **accepted** |
| P-05 | AVG-005 | Confirmed: snapshots work as rollback. `applyDevelopSnapshot` / `deleteDevelopSnapshot` take the entry's `snapshotID`; the restore was exact over 178 keys, `Look` included. | `S5.md` Consequences | **accepted** |
| P-06 | AVG-008 | Confirmed: `createVirtualCopies` supports Variants mode on LrC 15.5.1 from Loupe and Grid. | `S6.md` Verdict + Consequences | **accepted** |
| P-07 | AVG-010, MCP_TOOLS intent `default_camera_profile` | A profile is a **pair**, not a string. Adobe Raw profile = `CameraProfile = "Adobe Standard"` + its full `Look` table; Nikon Camera Matching profile = `CameraProfile = "<string>"` + `Look = {}`. The intent names the profile ("Adobe Landscape", "Camera Landscape") and the params map produces the pair. | `S5.md` Consequences | **accepted** |

### PRD wording

| # | Where it lands | Proposed change | Handle | Decision |
|---|---|---|---|---|
| P-08 | PRD §6.3 | The floating, non-modal, live-bound HUD is feasible as designed. Its `[unverified: focus/refresh …]` can cite S4 for refresh and for focus during updates; focus at the moment it opens stays [unverified]. | `S4.md` Consequences | **accepted** |
| P-09 | PRD §6.6 step 1 | Variants flow: re-select the master before **each** `createVirtualCopies` call (the new copy becomes the active photo); use the call's return value; pass the copy name as the argument (it becomes `copyName`); no write gate around the call. | `S6.md` Consequences | **accepted** |
| P-10 | PRD §6.6 step 5 | Say that previews and the A/B/C contact sheet are not inline in the Desktop answer: Jim expands the tool-call box or compares the copies in Lightroom. The contact sheet itself is tested in Phase 4. | `S3.md` Consequences | **accepted** |
| P-11 | PRD goals (`PRD.md:33`, "Every edit visible on the native Develop sliders immediately") | Note that a pass-0 profile choice (an Adobe Look) carries its own clarity, highlights, shadows and tone curve that do not move the sliders; the goal holds for pass 1+ edits, and the profile shows only as its name [inference]. | `S5.md` Consequences (`S5.md:180`) | **accepted** |

### Implementation rules (for the Phase that builds each part)

| # | Phase | Proposed rule | Handle | Decision |
|---|---|---|---|---|
| P-12 | 1 | **Read back every develop write.** Lightroom silently ignored a malformed `CameraProfile` (no error, no change), and a successful `CameraProfile` write can still leave an unexpected Look applied. | `S5.md` Part 1 + Part 2 analysis | **accepted** |
| P-13 | 1 | Plugin bridge: re-arm listeners from a monitor loop (they cycle about every 10 s without a client); **rebind the send socket whenever a new client connects on the receive side** (its `onClosed` did not fire on disconnect); keep the heartbeat. | `S2.md` Consequences | **accepted** |
| P-14 | 1 | Engine socket reader: scan only newly arrived chunks for `\n` instead of rescanning the whole buffer. | `S2.md` Consequences [inference] | **accepted** |
| P-15 | 1 | Keep bridge state inside one long-running task or on disk, not in `_G` shared across menu-item scripts (once not visible across scripts, cause unknown). | `S5.md` Consequences | **accepted** |
| P-16 | 1 | Params map exposes `EnableLensCorrections` (boolean) and `LensProfileEnable` (0/1) as two independent keys. | `S5.md` Consequences | **accepted** |
| P-17 | 1 | Ship the six recorded Adobe Look tables with the params map (from `docs\reports\phase0\S5\run2\`); re-capture them when Camera Raw updates [inference]. Keep `Name`, `UUID` and `LookTable` for every Look until Look identity is settled. | `S5.md` Consequences | **accepted** |
| P-18 | 4 | Look copies up with `catalog:getPhotoByLocalId(id)`, and check identity before acting on a looked-up photo (`isVirtualCopy`, `masterPhoto`, `copyName`), above all before removing it. | `S6.md` Consequences | **accepted** |
| P-19 | 5 | Present the HUD from its own task (`blockTask = true` parks it until close) and keep its function context alive while it is open. | `S4.md` Consequences | **accepted** |

### Decisions the spikes left open (not needed to close Phase 0)

| # | Question | Options | Recommendation | Handle |
|---|---|---|---|---|
| D-01 | How does the preview JPEG cross from plugin to engine? | (a) base64 inside the JSON line, as ARCHITECTURE §3 says; (b) the export's file path, and the engine reads the JPEG | **(b)** [inference]: the export already writes the file, both processes run on the same machine, and it skips a pure-Lua base64 encode whose cost was not measured. (a) is known to fit: ~970 K base64 chars < the 1 MiB that round-tripped in 31 ms. | `S2.md` Consequences |
| D-02 | How are unpicked variant copies removed (`cleanup_unpicked_variants`, PRD "Keep unpicked variants = false")? | (a) find an SDK call that removes a photo (none tested; existence [unverified]); (b) the plugin selects the copies and Jim runs Remove Photos; (c) keep unpicked copies in v1 | decide in Phase 4, after a search for (a); (b) conflicts with the no-modal design | `S6.md` Consequences |

## Draft for LR_SDK_NOTES

Jim approved this text on 2026-09-26 [stated: "Write it in"]. The vault doc is the architect's, so it is written in only after this PR merges: the six "To record in Phase 0" lines (`LR_SDK_NOTES.md:60-67`) are filled with this text, and the older entries it supersedes are marked as such.

**To record in Phase 0 — recorded 2026-09-26 (LrC 15.5.1, Windows 11)**

- **SDK version.** `LrApplication.versionString()` returns `"15.5.1"` [handle: `docs\reports\phase0\S6\s6_*.json` `lr_version`]. The five spike plugins (S1, S2, S4, S5, S6) declare `LrSdkVersion = 13.0` / `LrSdkMinimumVersion = 13.0`, and all loaded and ran on 15.5.1 [handle: `plugin\spikes\S*.lrplugin\Info.lua`; their runs in `S1.md`, `S2.md`, `S4.md`, `S5.md`, `S6.md`]. The SDK version that ships with 15.5.1, and whether declaring 13.0 hides newer develop keys, were not measured [unverified].
- **Develop key dump.** 178 distinct keys (NEF 177, DNG 173), process version 15.4, pinned to `engine\src\params\sdk-keys.lrc15.json` (the path the notes gave as `engine/params/…` became `engine/src/params/…`) [handle: `S5.md` Part 1 analysis; `engine\tests\params-pinned-lrc15.test.ts`]. `Texture` exists. Monochrome profiles drop 18 keys (which ones: not analysed).
- **Profile strings.** Nikon Camera Matching profiles are `CameraProfile` strings, identical for NEF and DNG; some carry a literal `Group: ` prefix (e.g. `Group: Camera Standard`) [handle: `S5.md` Part 1 analysis]. Adobe Raw profiles are **Looks over `CameraProfile = "Adobe Standard"`**; names and UUIDs are in `S5.md` Numbers. `Look = {}` clears a Look; a full recorded Look table writes back and reads back identical [handle: `S5.md` Part 2 analysis]. **Lightroom silently ignores a malformed `CameraProfile`** (no error, no change) [handle: `S5.md` Part 1 analysis].
- **`requestJpegThumbnail` after `applyDevelopSettings`.** No image within 30 s: every request answered at once with no data and `error loading thumb` (5/5 steps, ~485 requests each). A no-change thumbnail is not size-guaranteed (945×630 for a 1600 px request in one run, 1890×1260 in another). The `LrExportSession` export at 1600 px was fresh at ~2.6 s. `applyDevelopSettings` takes 20–45 ms [handle: `S1.md` Run 2 analysis].
- **LrSocket.** Works as a server: `receive` + `send` binds on 8765/8766, Node connected to both; 26/26 messages echoed intact; small-message RTT median 0.32 ms; 1 MiB 31 ms; 16 MiB passed, so no message-size limit was found up to 16 MiB. With no client, listeners re-arm about every 10 s. **A send-mode socket did not fire `onClosed` when the client disconnected.** `send()` returns within 4.5 ms even for 16 MiB [handle: `S2.md` Analysis; `docs\reports\phase0\S2\summarize.out.txt`].
- **Floating dialog on Windows.** `LrDialogs.presentFloatingDialog` is non-modal, stays in front of the main window, survives module switches, and updates live through `LrView.bind` on a property table; keyboard input reached the main window while it updated, once Jim had clicked into the main window. With `blockTask = true` the call blocks its task until the window closes, while other tasks keep running. Focus at the moment it opens: not tested [handle: `S4.md` Verdict + Analysis].

**Also recorded in Phase 0** (append):

- `photo:createDevelopSnapshot(name, true)` returns `true`; `applyDevelopSnapshot` and `deleteDevelopSnapshot` take the entry's **`snapshotID`** (`id_global` untested) [handle: `S5.md` Part 2 analysis].
- `catalog:createVirtualCopies(copyName)` acts on the selected photo, returns the new copy, sets its `copyName`, needs no write gate, works from Loupe and Grid, and makes the new copy the active photo [handle: `S6.md` Analysis]. `catalog:getPhotoByLocalId` exists and finds virtual copies [handle: same].
- In-memory `_G` state was once not visible from a different menu-item script in the same Lightroom session; cause [unverified] [handle: `S5.md` Part 2 analysis].
- Claude Desktop passes MCP `image` content blocks to the model and shows them to the user only inside the expanded tool-call box [handle: `S3.md` Analysis]. This answers the MCP-transport entry's `[unverified]` (`LR_SDK_NOTES.md:54`).

**Entries this supersedes** (to mark, not delete):

- `LR_SDK_NOTES.md:10` and `:62` "SDK version … record it" → see "SDK version" above (still [unverified]).
- `:25` Automaat's "LrSocket does not support server sockets … HTTP polling every 3 s" → resolved by S2; also stale upstream since `3ef5d72` [handle: `docs\AUTOMAAT_SURVEY.md` §6].
- `:34` `createVirtualCopies` / `getPhotoByLocalId` [community] → observed on 15.5.1 (S6).
- `:39` floating dialog [unverified] → observed (S4), except focus at opening.
- `:54` Claude Desktop image rendering [unverified] → observed (S3).
- `:58` Automaat "Requires Node.js 22+", "HTTP server on 8765 with 3 s plugin polling", "License [unverified]" → Automaat's `server\package.json` says `engines.node ">=18"`, its polling was removed upstream, and its license is **MIT** [handle: `docs\PHASE0_HANDOVER.md` §2 and §4 findings 1 and 9; `vendor\automaat\LICENSE:1-3`].
- `:15` `EnableLensCorrections` → both `EnableLensCorrections` and `LensProfileEnable` exist and are independent (S5).

## Still [unverified] after Phase 0

Collected from the six reports; each stays open until the Phase named tests it.

- **Phase 1:** the SDK version shipped with 15.5.1 and whether `LrSdkVersion = 13.0` hides keys; round trips while Lightroom is busy; non-ASCII (UTF-8) payloads over LrSocket; more than one message in flight; behaviour across a plugin reload or Lightroom restart; lens "on" writes via `applyDevelopSettings`; Look identity (the Adobe Color name appeared with two UUIDs); whether a partial Look table (`Name` + `UUID`) is enough; the `_G` visibility cause; the cost of base64 encoding in Lua (D-01).
- **Phase 2:** export time at smaller long edges; handling the export's embedded ICC profile in metrics; `LR_jpeg_quality` range (0–1 assumed).
- **Phase 4:** an SDK call that removes a photo (D-02); A/B/C contact-sheet delivery and readability; whether removed `localIdentifier`s are reused; `createVirtualCopies` with several photos selected or from Develop; `getPhotoByLocalId` speed on a large catalog; many image results in one Desktop conversation.
- **Phase 5:** HUD focus at opening; buttons in a floating dialog; updates driven by bridge messages; `presentFloatingDialog` without `blockTask`; `closeFloatingDialogsForPlugin`.
- Also open: which keys monochrome profiles drop; the cause of "Profile missing." after the part-1 S5 writes; whether the interactive Claude Code CLI shows images.

## Set-up notes for Phase 1

- The S3 test server `lrc-avg-spike-s3` is still in Claude Desktop's config (Store install; a backup of the previous file sits next to it). Remove it when the engine is registered.
- The six spike plugins are still in Lightroom's Plug-in Manager. They only act from their menu items, and only S2 opens sockets, after its Start item [inference, as `spikes\README.md` notes]. Removing them is Jim's choice.
- `fixtures\20260907-_OZ80093.jpg` (Lightroom export, 2048 px) exists on disk and is gitignored; sharp decodes it, so it can seed the Phase 2/3 golden previews.

## Carried-over decisions for Jim (from `docs\PHASE0_HANDOVER.md` §6 and the vault handover §6)

1. Graphify is a Python tool run outside the repo; keep it, or drop it under a strict reading of the stack rule.
2. Register the repo graph as an MCP server, or not.
3. Vendored Automaat Python files stay excluded from git, or the snapshot is tracked verbatim.
4. Whether `03-lightroom.md` should exempt spikes from the "canonical parameter map only" rule. This is moot after Phase 0 unless spikes return.
5. Old public commits still contain the connector names trimmed in PR #2; removing them needs a history rewrite. Recommendation: leave it.

## Verdict

<!-- Jim: close Phase 0 (and which proposals are accepted), or not. -->
**Jim decided to close Phase 0** (2026-09-26, chosen from the options Claude Code offered, which recommended closing) [stated]. Phase 0 is **complete** only once its two remaining acceptance lines are done after this PR merges: LR_SDK_NOTES "To record in Phase 0" written into the vault, and STATE's "Next action" set to Phase 1 (`PHASES.md:26`; `.claude\rules\04-workflow.md` "Phase gating"). Until then it is decided but not complete.

- Proposals P-01 … P-19: **all accepted** [stated].
- LR_SDK_NOTES draft: **approved** for the vault [stated].
- D-01: **(b), the export's file path**: the plugin returns the path of the JPEG Lightroom exported, and the engine reads it from disk [stated: "Export file path"]. D-02 stays open for Phase 4.
- STATE's "Next action" becomes Phase 1. Phase 1 work starts only when Jim says so.

## Consequences / open questions

Following Jim's decisions, after this PR merges:
- the LR_SDK_NOTES draft above is written into the vault doc;
- D-01 changes ARCHITECTURE §3 (`ARCHITECTURE.md:64`): previews cross as the export's file path, not base64 in the JSON line;
- P-01 … P-11 are applied to the vault docs they name. Each edit is marked "(Phase 0, P-nn, accepted by Jim 2026-09-26)" so it can be traced back here;
- P-12 … P-19, D-01 and D-02 are added to PHASES.md under the Phase they name, as inputs for that Phase's plan;
- `LrC_AVG_STATE.md` "Next action" becomes Phase 1 (`PHASES.md:28-32`), and the vault handover is updated.
