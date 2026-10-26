---
report: Automaat/lightroom-mcp vs LrC-AVG, second comparison (issue #190 pass 2; epic #207)
phase: 10
status: template
authored_by: "Analysis: Claude Code, 2026-10-26. No Lightroom was run; the Lightroom-side checks it names are for Jim to run and observe, under the child issues of #207."
date: 2026-10-26
compared: "upstream Automaat/lightroom-mcp main at 1040453 (2026-10-26, v0.25.0 plus about 40 unreleased commits) against LrC_Autonomous_Gateway main at c953c72 (engine and plugin 1.3.0)"
---

# Automaat vs LrC-AVG: where upstream is now, what it means for us

Tags used: `[handle: ...]` reproducible source; `[inference]` my reasoning; `[unverified]` not checked; `[upstream claim]` upstream says it, nobody here observed it. I ran no Lightroom. Everything about Lightroom behaviour below is upstream's claim or an earlier report of ours.

## 0. Answers in one page

| Your question | Answer |
|---|---|
| Are there new Automaat features better than ours? | Yes, in four areas: **(a)** several live-tested mask findings that contradict or tighten what we do (section 3), **(b)** multi-process bridge sharing for Claude Desktop (4.1), **(c)** Lua lint and 1,289 Lua specs (4.6), **(d)** a wide catalog/metadata tool set (section 5). In the core edit loop (metrics, guardrails, sessions, intents, HUD, provenance) we are ahead. |
| Are we missing features that are now in Automaat? | Yes. 68 upstream tools vs our 37. About 30 have no counterpart; most are catalog/metadata. A handful matter for editing: auto tone/WB, sharpness metric, camera/lens/ISO search filters, mask tone-curve and Point Color, one AI mask to many photos, safe removal of virtual copies. Full map in Appendix A. |
| Will any of it make our development unnecessary? | No part of the core. Upstream's "closed loop" is a prompt-level skill (`skills/raw-photo-lightroom-preset/SKILL.md`) with no guardrails, sessions, HUD or convergence rules. The **catalog tools** (search, keywords, collections, metadata, import/export) are where we duplicate a faster-moving project; that is a maintenance choice (6.2). |
| Their "SDK v2": are we on it? | **No.** "SDK v2" here is the **MCP TypeScript SDK**: upstream moved to `@modelcontextprotocol/server ^2.4.0` today (PR #421). We are on `@modelcontextprotocol/sdk` 1.32.0. Neither project is on a "Lightroom SDK v2"; none exists (upstream declares `LrSdkVersion = 8.0`, we declare 13.0). Migration cost is small; see section 2. |

**Three things I would look at before any porting** (they are about correctness of what we already ship):

1. **Our colour-range mask probably writes the wrong colour triple** (3.1). Upstream fixed exactly this on 2026-10-24.
2. **Our one-person AI masks (`person_*`) rest on a claim upstream observed to be false on 15.6** (3.2). Our report still says `[unverified]`.
3. **Claude Desktop starts several engine processes per connector**; ours answers `ENGINE_BUSY` from the ones that do not hold the lock (4.1). Upstream hit this with Cowork/Code and built leader/follower forwarding.

## 1. The two states

| | Upstream (now) | Vendored snapshot | LrC-AVG (now) |
|---|---|---|---|
| Commit | `1040453` | `a160e7a` (2026-09-22) | `c953c72` |
| Version | npm 0.25.0 + unreleased | 0.15.0 | engine/plugin 1.3.0 |
| Tools | **68** | 18 | **37** |
| Lua plugin | 54 files, Info `LrSdkVersion = 8.0` | 15 files | 41 files, `LrSdkVersion = 13.0` |
| MCP SDK | `@modelcontextprotocol/server ^2.4.0` | `sdk ^1.29.0` | `sdk` 1.32.0 (pinned) |
| Node | `>=20` | `>=18` | `>=22` |
| Tests | Jest 529, busted 1,289, live-kit unit 55 (from PR #421/#424 text) | | vitest, 1,747 pass / 16 fail on Linux (Windows-only tests) |
| Platforms | macOS + Windows | | Windows only |

Handles: upstream `git log` (130 commits `a160e7a..HEAD`, 300 fetched); `server/package.json:53-58`; `plugin/LightroomMCP.lrplugin/Info.lua:2`; tool count `grep -oE '^    name: "[a-z_]+"' server/src/tool-contracts.ts` = 68; ours `grep -c 'name: "lr_' engine/src/mcp/defs-*.ts` = 37, `engine/package.json:35`, `plugin/LrC-AVG.lrplugin/Info.lua:26`. Our test numbers: I ran `npx vitest run` on a scratch copy of `c953c72` on Linux: 1747 passed, 16 failed, 15 skipped; the 6 failing files (catalog-files, catalog-import-resume, cleanroom, golden, settings-tools, settings) are Windows path/fixture tests, same set before and after; I did not investigate each.

**Already ported from upstream (issue #190, PR #191, 2026-10-24):** preview by uuid (#259), AI Denoise (#288), colour and depth range masks (#324, #334), brush from strokes (#326) [handle: `docs/reports/phase9/upstream-ports.md`, issue #190 comment]. Still listed as "left for a later PR": mask tone curve + point color (#328), one AI mask on many photos (#329), IPTC creator/copyright/location (#258, #265), `rename_keyword` (#264), `export_photo_metadata` (#249). This report covers everything after that cut as well.

## 2. "SDK v2"

### 2.1 Lightroom SDK
Nobody is on a v2. Upstream declares `LrSdkVersion = 8.0` and still uses APIs from 11 to 15.6 with `type(x) == "function"` probes (`HandlerDevelop.lua:1219-1220`, `HandlerRemoveFromCatalog.lua:78`). We declare 13.0. Our `Info.lua:20-22` says whether 13.0 hides newer develop keys is `[unverified]`. Upstream working with 8.0 declared and masks/Denoise at 15.6 is weak evidence that the declared version does not hide APIs `[inference]`; not enough to change ours.

### 2.2 MCP TypeScript SDK (the one that actually changed)
- Upstream PR #421 (`1040453`, "build(server): migrate to MCP SDK v2") closes their #396. Packages: `@modelcontextprotocol/server` 2.4.0 + `@modelcontextprotocol/client` 2.4.0 (dev), Node `>=20` [handle: `server/package.json:53-58`].
- v2.4.0 is the npm `latest` of `@modelcontextprotocol/server` (engines `node >=20`, depends on `zod ^4.2.0` and `@modelcontextprotocol/core`). The old package `@modelcontextprotocol/sdk` is still `latest = 1.32.2`, modified 2026-10-23 [handle: `npm view @modelcontextprotocol/server version dist-tags engines dependencies`; `npm view @modelcontextprotocol/sdk dist-tags time.modified`, run 2026-10-26]. So v1 is not abandoned, and we are two patches behind on it.
- Guide: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2 (read 2026-10-26). Package split; `setRequestHandler(Schema, ...)` becomes `setRequestHandler("tools/call", ...)`; `extra` becomes `ctx` (`extra.signal` → `ctx.mcpReq.signal`, `extra.sendNotification` → `ctx.mcpReq.notify`); a codemod exists.

**Our exposure** (what the migration would touch) [handle: `grep -rn modelcontextprotocol` over engine, spikes]:

| Where | Change |
|---|---|
| `engine/src/mcp/server.ts:20-21, 105, 115, 135` | import `Server` from `@modelcontextprotocol/server`; two `setRequestHandler` calls to method strings; `extra.sendNotification`/`extra.signal` to `ctx.mcpReq.*` |
| `engine/src/mcp/main.ts:31` | `StdioServerTransport` import path |
| `engine/src/mcp/defs-shared.ts:4`, `deadline.ts:24` | type imports |
| `engine/src/mcp/client-info.ts` via `server.getClientVersion()` | deprecated but functional in v2 per the guide |
| 8 test files + `tests/probe/harness.ts` | `Client`, `InMemoryTransport`, `StdioClientTransport` imports (v2 `client` package) |
| `engine/tests/setup-bundle.test.ts:18`, `docs/DEPENDENCIES.md`, `spikes/*` | pin string and records |

Upstream's PR shows it is a small diff: the same 68 tool names, descriptions and schemas kept; their own old-SDK client still talked to the new server (PR #421 text). Our design (low-level `Server`, zod, own error shape, progress, abort) maps one to one; the guide says low-level `Server` users keep registering their own handlers.

**Behavioural notes from the guide that matter to us** [handle: guide "Behavioral changes"]: stdio `ReadBuffer` now skips non-JSON stdout lines instead of failing (harmless for us); stdio gets a 10 MB read-buffer cap (our inputs are small); in-flight handlers are aborted on transport close (our `deadline`/abort path already handles `signal`); unknown-tool handling is client-side.

**Not verified:** I tried to run the official codemod on a scratch copy and the sandbox classifier denied running freshly downloaded code, so I did not. The cost estimate above is read from our import footprint and the guide, not measured `[inference]`: roughly one small PR (about 10 files, mostly imports), plus Jim's Claude Desktop smoke test, since the spikes that proved Desktop behaviour used v1 (`spikes/S3`).

**Recommendation:** do it, as its own PR after the current push lands; no feature depends on it. Reasons: upstream will keep moving on v2; the 2026-07-28 protocol features are only on v2 (`serveStdio`, `requestState`); cost is small; our setup bundle pins SDK files (`setup-bundle.test.ts:18`) so the bundle changes once either way. Not urgent, since v1 still ships fixes. Rule 04 applies (module map unchanged: only `mcp` touches the SDK).

## 3. Where upstream's live testing contradicts or tightens our masks

Both projects write the undocumented `MaskGroupBasedCorrections` table. Upstream put guards in `GuardedMaskWrite.lua` (version gate 15.6 + PV 15.4, per-`What` key schema, read-back compare at 1e-5, rollback). Ours checks PV (`SUPPORTED_PROCESS_VERSIONS`, `canonical.ts:37`), reads back and reverts inside the session (`session/masks.ts`). Different design, same intent; ours also measures and reverts on clipping or region drift, which they do not.

### 3.1 Colour range: probable bug in ours (highest priority)
- Upstream PR #339 (2026-10-24): `create_range_mask` colour documented `red/green/blue` as sRGB and wrote them into `PointModels`; "a red sample selected the cyan patch". The stored triple is Lightroom's own per-photo ranking of the sample (L*, a*, b* mapped 0 to 1 by an image-dependent curve), not a function of sRGB; the same colour stores different triples in different photos (black `0 0.4122 0.4824` vs `0 0.4872 0.5202`; pure red `0.5225 0.8881 0.7583` vs `0.7220 0.8665 0.7515`); selection follows the triple, not the pin. Lua cannot compute it, so upstream now takes `l,a,b` verbatim and offers `copy_sample_from` (#341) [handle: `git show 2acd90c`; `CLAUDE.md` mask paragraph, "not sRGB"].
- Ours: `engine/src/params/mask-range.ts` `colorFields(sample: Rgb, ...)` writes "the 0-1 sRGB of the preview at the point" as the first three numbers of `PointModels` (`mask-range.ts:36-41`); `session/masks.ts:206` fills `sample` from `sampleColor(baseline.jpeg, point)`. We ported #324, which had the bug, the same day it was fixed upstream.
- Our evidence it works: Jim answered "y" to one check on one photo; the sampled pixel was `0.085490 0.112941 0.136471` (very dark) [handle: `docs/reports/phase9/upstream-ports.md`, Observed item 1]. A y/n on one dark patch cannot tell "right colour" from "a dark region got selected" `[inference]`. Jim's hand-made "Color Range 1" row (`0.991135 0.440358 0.818088`) reads like a Lab-style ranking, not an sRGB triple `[inference]` (`mask-range.ts:3-6`).
- **Recommended action:** (1) a two-photo check: colour range at a clearly red and a clearly green point on a colourful photo, then ask which areas were selected; (2) until then, refuse `color_range` (like `people`/`landscape` are refused) or label it unverified in the tool text; (3) fix by taking Lightroom's own triple: reuse a Lightroom-authored range (`list_masks` already reads ranges) and port `copy_sample_from`. Needs Jim to run Lightroom.

### 3.2 One-person AI masks (`person_*`): contradicted, our status `[unverified]`
- Upstream, live on 15.6: "Lightroom ignores `InstanceIDs` in a written mask and always masks the first person"; so single-person is refused [handle: `CLAUDE.md` People/Landscape paragraph; `AiMaskParts.lua` `refuseSinglePerson`].
- Ours: `session/person-masks.ts`, `params/mask-person.ts` probe the instance boxes and write the entry with `InstanceIDs`; our own report says engine-made one-person masks stay `[unverified]` until a two-person photo on the current process version is tried [handle: `docs/reports/phase6/masks-capture.md:487`].
- **Action:** the two-person test is now more urgent. If it fails on Windows too, the tool silently masks the wrong person; refuse `person_*` on photos with 2 or more people (the boxes are already read) until proven. Per rule 04 (Lightroom-side result), Jim's observation required.

### 3.3 Orientation: upstream has the mirrored-photo mapping we said no source gives
- Upstream stores mask coordinates in the unrotated frame; `ImageFrame.lua` has all eight EXIF codes including mirrored (`BA`, `DC`, `CB`, `AD`), and gradients swap width/height and flip the radial rotation sign when axes swap or mirror (#331, #333; live check on 15.6) [handle: `ImageFrame.lua:1-40`; `git show e1ca0c6`].
- Ours handles `AB/BC/CD/DA` and refuses mirrored with "no source gives their mapping" (`crop-frame.ts:18-20, 66-68`), and says placement on turned/cropped photos is `[unverified]` until `npm run masks:crop`.
- **Action:** cross-check `crop-frame.ts` against `ImageFrame.lua` (it is an independent data point for the turned cases) and, if Jim agrees, lift the mirrored table as `[upstream claim]` behind `masks:crop`.

### 3.4 Other mask facts worth copying into our notes
- A colour range holds exactly one `PointModels` entry; two crash Lightroom and crash-loop the catalog on reopen. We already refuse more than one (`mask-range.ts:6-7`).
- Writing to a photo while Landscape digests are pending "froze Lightroom for a third-party client"; nothing found on a photo opened in Develop raises a modal alert that blocks all Develop reads. Our `Pending.lua` guard covers the first; the modal case matches our LIGHTROOM_DIALOG handling [handle: `CLAUDE.md`; our `Pending.lua` header].
- Brush: Size is a screen size (stored `Radius` times displayed long edge is constant), Feather maps to Radius and CenterWeight by a fixed curve (`BrushFeather.lua`), density 0 is an erase stroke. We have no feather, density or erase (tool text: "no erase").
- Mask sliders must be saved before returning (#343), and omitted zero local adjustments must be accepted (#345): both are fixes to the write path; check that our `apply_settings` read-back does not hit them `[unverified]`.
- **AI masks and sync:** upstream #313/#316 recompute copied AI masks per target (`photo:updateAISettings()` in a second write gate), and found "a mask that keeps its digests is never recomputed" (`create_mask_batch`). Our `lr_sync_series` copies global settings only and says masks are not synced (`sync/sync.ts:204-205`), so we avoid the hazard. If we ever sync masks, this is the recipe.

## 4. Infrastructure and platform

### 4.1 Multiple engine processes per connector (bridge sharing)
- Upstream #238/#243: Claude Desktop (2.16120.0) starts several MCP server processes for one connector (probes, the chat connection, a Cowork/Code shared pool). With a one-client plugin, every bridge after the first exited, and Desktop showed "Couldn't start for Cowork and Code sessions ... connection closed during the server/discover probe". Fix: elect a leader via the instance lock; followers forward `tools/call` over a local socket / Windows named pipe, with an HMAC of the plugin token; election starts only on `initialize` or first tool call so probes never touch the plugin; "owner lost, result unknown" is reported instead of retrying, since the call may have changed photos [handle: `git show ebd4c24`; `server/src/bridge.ts`, `broker.ts`; `CLAUDE.md` line 19]. Follow-ups: #286 (recover from an unresponsive owner), #295 (finish forwarded calls before exit), #236 (diagnose hijacked ports).
- Ours: one engine per bridge via a TCP lock on 8767; tools answer `ENGINE_BUSY` without the lock; the lock is taken on the first tool call and released after idle, as a workaround for Desktop starting two engines and routing calls to the one without the lock [handle: `engine/src/mcp/instance-lock.ts`, `bridge-gate.ts:1-12` citing PIDs 2304/12632 and `ENGINE_BUSY`]. We have not tested Cowork/Code concurrency `[unverified]`; `docs/CLIENTS.md` lists Claude Code as tested 2026-10-16 only.
- Our difference: session state, HUD channel and Deck live in the process that holds the lock, so a forwarding follower must forward the whole tool surface including HUD events, not just calls `[inference]`.
- **Recommendation:** treat as a design decision for Jim. Option A (recommended once you use Cowork/Code against lrc-avg): port the leader/follower idea in `bridge`/`mcp` (module map: it adds IPC inside `bridge`; no new cross-module edge `[inference]`). Option B: keep lazy-lock and document that Cowork/Code and chat cannot use lrc-avg at the same time. Option C: do nothing until a user reports it.

### 4.2 Image tools: fast thumbnail path vs exact export path
- Upstream `get_photo_preview` uses a Lightroom thumbnail request (smallest cached preview at least `size`, often larger; 855 px for 512 on a 6048 px raw), stale right after a photo enters Develop ("wait about 3.5 s, fetch twice") [handle: `HandlerPreview.lua:12-30`; `CLAUDE.md` live-testing section]. Cheap (milliseconds), approximate.
- Ours renders an export (`lr_get_preview`, "about 3 seconds"), which is what makes exact metrics possible. Right for editing; slow for browsing a shoot.
- **Idea** `[inference]`: add a `fast: true` mode (thumbnail) to uuid previews for culling and keywording (our issues #111, #112, #162) and keep export for measurement.
- Upstream also guards Claude's image limits: over 3.5 MB (5 MB base64) or over 2000 px once a request holds more than 20 images [handle: `HandlerPreview.lua:24-27`]. We already cap (`engine/src/mcp/image-cap.ts`); check the 2000 px / 20-image rule against ours `[unverified]`.

### 4.3 Metrics
- Upstream `get_photo_stats` (#423): up to 20 photos, 64-bin luma histogram, mean luma, shadow/highlight fractions, **sharpness (Laplacian variance at 512 px long edge)**, pure-JS `jpeg-js` 0.4.4, no native dependency [handle: `server/src/photo-stats.ts`].
- Ours (`metrics/compute.ts`) measures far more (percentiles, std, channel means, R/B, per-channel clipping, `clip_high_tone_pct`, saturation, hue histogram, regions) but has **no sharpness metric** (grep `sharpness|laplacian` in `engine/src`: only slider names) and measures one photo of the open session at a time.
- **Port candidates:** (1) a sharpness number (about 25 lines on top of `sharp`), useful to cull and to check Denoise/sharpening passes; (2) multi-photo stats without a session (our issue #162 "read-only inspection without a session"). Do not adopt `jpeg-js`: we have `sharp`, and rule 01 says `sharp` for all image work.

### 4.4 Rollback and History
- Upstream added snapshot tools, `undo_last_step` (global `LrUndo`, "shared with user and other plug-in actions", needs `confirm: true`), `reset_develop_adjustments`, and History names for raw setting writes ("Set Develop Settings", #409) [handle: `HandlerUndo.lua`, `HandlerSnapshots.lua`, `git show f491880 bfae827`].
- Ours is stricter: a snapshot before each session, named History step per pass, Abort restores. Do not adopt `undo_last_step`: it undoes whatever the user last did too, which conflicts with our guarantee that Abort returns the photo to its pre-session state.
- Gap worth a small tool: list/restore our `AVG pre-session` snapshots from chat after a session has ended (we create and apply snapshots internally via `Dispatch.lua` `create_snapshot`/`apply_snapshot`, but expose no snapshot tool) `[inference]`.

### 4.5 Auto Tone / Auto White Balance
- Upstream `apply_auto_adjustments` uses `LrDevelopController.setAutoTone` / `setAutoWhiteBalance` via a Develop session (up to 100 photos, 240 s budget, `remaining_ids`) [handle: `HandlerDevelop.lua:1198-1225`; `git show 2dace8b`]. We use neither.
- Relevance to issue #194 ("technically OK, not creative") `[inference]`: Lightroom's Auto result is a cheap, vendor-made baseline Claude can compare its own pass-0 against (render both, pick or start from the better). Not a creativity fix by itself; our Phase 10 experiments (looks, look-from-an-edit) are the right track.

### 4.6 Lua quality tooling
- Upstream: `selene` lint with a custom std for LR globals (`lightroom.yml`), busted specs (48 spec files, 1,289 specs per PR #421/#424 text), CI on three OSes, a live-test kit that refuses to run unless the open catalog carries a throwaway marker (`requireThrowawayCatalog`) [handle: `.github/workflows/lua-lint.yml`, `lua-test.yml`; `plugin/spec/`; `tests/e2e/live/README.md`].
- Ours: Lua parse-checked with `luaparse` only (`engine/tests/lua-plugin.test.ts`); CI is `arch.yml` and `release.yml` [handle: `ls .github/workflows`]. Our Lua is 5,538 lines (`wc -l plugin/LrC-AVG.lrplugin/*.lua`), including the Bridge, Pending/AI waits and HUD state machines. Rule (b) says "thin adapter", but the Pending/Denoise/Masks Lua carries real logic.
- **Recommendation:** adopt `selene` + the `lightroom.yml` std first (MIT, a native binary, no Python, runs on Windows), then busted specs for the logic-heavy files (Pending, Bridge, Sockets, Denoise). Needs a Jim decision on rule 01 (adds Lua tooling, not a language). Keep the throwaway-catalog guard idea for our live checks: `masks:*`, `denoise:check` run against whatever catalog is open `[unverified]`.

### 4.7 Packaging and distribution
- Upstream ships `.mcpb` for one-click Claude Desktop install, Bun binaries, a Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json`) bundling a skill, MCP Registry metadata (`server.json`), and serves the skill as an MCP prompt (`prompts` capability) (#401, #402, #416) [handle: those files; `create-server.ts` in `1040453`].
- Ours: setup `.exe` + `lrc-avg-setup`; `.mcpb` and npm are deferred (issue #172, #166).
- **Reuse when you reach #166/#172:** their prompt handler shape (`prompts/list`, `prompts/get` returning the skill text) is directly our #166; their `manifest.json`/`server.json` are templates for #172. Note their installer copies the plugin into Lightroom's Modules folder on first start; we deliberately do not (`.claude/rules/04` PowerShell conventions) - keep that.

### 4.8 Performance
- Upstream #282-#284: batched `catalog:batchGetRawMetadata`, `findPhotoByPath` instead of scanning `getAllPhotos`, one-pass line framing; on a 50,000-photo catalog p50 improvements of 1.7x to 67x, and one path lookup that took 95 s [handle: `git show 37a8ad5 37b3cb4`].
- Ours: `Library.searchPhotos` falls back to `catalog:getAllPhotos()` with no criteria (`Library.lua:123`); no `batchGet*Metadata` anywhere in the plugin (grep over `plugin/LrC-AVG.lrplugin/*.lua`: none), 20 per-photo getter calls in `Photos.lua`/`Library.lua`. Size of Jim's catalog unknown; matters only for large catalogs `[unverified]`. Low priority; worth doing whenever the search tool is next touched (it needs new filters anyway, 5.1).

## 5. Catalog and metadata features we lack

| Group | Upstream | Ours | Value for AVG `[inference]` |
|---|---|---|---|
| 5.1 Search filters | camera, lens, ISO, focal length, flag, colour label, edited status, file type, folder (#408) | filename, keywords, rating, date, collection, folder (`defs-catalog.ts:52-58`) | **High**: needed for batch (#110) and culling (#111). Use `buildSearchDesc` as reference |
| 5.2 Colour labels | `set_color_label` (#406) | none | Medium, trivial to add (culling workflows) |
| 5.3 Keywords | `rename_keyword`, `remove_keyword_subtree`, hierarchy paths | paths only | Low for AVG; on #190 list for `rename_keyword` |
| 5.4 IPTC | `set_metadata` (title, caption, headline, creator, copyright), `set_location`, accessibility text (#417) | title/caption/headline (`Metadata.lua`) | Low-medium (#112 auto-keywording) |
| 5.5 Smart collections, `delete_collection`, `remove_from_collection`, `get_collection_photos`, folders listing (#418, #420) | partial | Low |
| 5.6 Private AI metadata | `set_ai_metadata`/`get_ai_metadata` via `LrMetadataProvider` (#419) | none; our provenance is log files | **Interesting**: an AVG field "edited by session X / look Y" would make AVG edits searchable inside Lightroom; would add an `LrMetadataProvider` and a schema-version duty (upstream documents the migration rules) |
| 5.7 `export_photo_metadata` (#249) | JSON dump of metadata for many photos | none | Low |
| 5.8 Remove photos from catalog (#424) | `LrSelection.removeFromCatalog` wrapped safely (confirm flag, 100-ID cap, verifies the exact selection before and after, refuses a master without its virtual copies, 14.3+) | none | See 5.9 |
| 5.9 Process version | `set_process_version` (#411): sets 1-6, refuses masked-photo downgrades | we refuse non-supported PVs and tell the user to update in Develop (`pipeline.ts:59-70`) | Medium: a guarded "bring this photo to PV 6" tool removes a manual step |

**5.8 detail:** our S7 report says "Removal: no call found" after probing 19 names on `LrCatalog` and `LrPhoto` [handle: `docs/reports/phase4/S7.md:198`]; `LrSelection.removeFromCatalog()` is documented and was known but deliberately not called because it acts on the selection [handle: `spikes/S11/README.md:22`; `plugin/spikes/S11.lrplugin/S11Stack.lua:12`]. Upstream shows a pattern that checks the selection is exactly the targets before and after, and live-tested it on 15.6 (mac). That could clean up the unpicked Variants copies (AVG-008), which today stay in the catalog. It deletes catalog edits and metadata, so it is a destructive-action decision for Jim, not a default `[inference]`.

## 6. Does upstream preclude any of our work?

### 6.1 Core AVG (no)
Upstream has no equivalent of: the step loop with pass cap and shrinking per-pass limits, clipping guardrails with auto-revert, `convergence`, intents library (11 looks, pipeline-aware), Variants/Approve modes, HUD and Deck, recipes/provenance logs, canonical parameter map with range checks, series sync with adaptive exposure, error taxonomy. Upstream's `set_develop_settings` writes raw SDK keys without those checks, which rule 03 forbids for us. Its closed loop is prose in a skill (`SKILL.md` "Closed-loop route", "never guess 30-50 sliders at once") on top of `get_photo_preview`, `get_photo_stats` and `create_develop_preset`.

### 6.2 Catalog tools (overlap)
We maintain our own search/keywords/collections/IPTC/import/export. Upstream now has ~30 more tools of that kind, tested on a live fixture kit. Options for Jim:
- **A. Keep ours, port selectively** (current approach, issue #190). Cost: continuous porting; every port needs a Windows run by Jim.
- **B. Stop growing catalog tools; document Automaat as the companion for them.** The plugins coexist: different toolkit ids (`com.lightroom.mcp` vs `com.lrcavg.gateway`) and ports (58763/58764 vs 8765/8766) [handle: upstream `Info.lua`, ours `Info.lua`, `PRD` port numbers in `docs/reports/phase1/PHASE1.md:215`]. Risks `[inference]`: about 105 tools in Claude's context (see our issue #165 on tool count), and Claude may call `set_develop_settings` or `apply_develop_preset` from Automaat and bypass our guardrails mid-session; the README would have to say so.
- **C. Hybrid (recommended):** port the few that serve editing or culling (5.1, 5.2, sharpness, auto tone, snapshot list/restore); leave metadata/organisation extras to Automaat and say so in `docs/CLIENTS.md`.

### 6.3 Masks
Upstream has more mask operations (curve, Point Color, intersect, copy sample, many-photo AI mask, delete empty masks, depth, brush erase and feather); we have the same shape coverage with session integration (measurement, revert, regions). Not precluded; port the missing operations in the edit loop only: mask tone curve and Point Color (#328), one AI mask to many photos (#329), brush feather/density/erase (#340).

## 7. Things that do not transfer
- macOS-first live testing: their live kit drives Lightroom via Accessibility on macOS (`tests/e2e/live/README.md`); most "live-verified" upstream claims are 15.6 macOS. Windows behaviour differs on sockets and read gates (their own notes: #110/#124/#134). Treat every upstream claim as `[upstream claim]` until Jim runs it.
- `skills/.../generate_xmp_preset.py`: Python, excluded by rule 01.
- Auto-install of the plugin into `Modules`: we deliberately do not.
- `undo_last_step`, unguarded preset apply, raw-key `set_develop_settings`: conflict with rules 03 and the Abort guarantee.

## 8. Recommended plan (order; each its own PR, decisions marked for Jim)

| # | Item | Why | Needs |
|---|---|---|---|
| 1 | **Colour-range check, then refuse or fix** (3.1) | Probable wrong-colour selection shipped in 1.1.0+ | Jim: 2-photo run; decision refuse-vs-fix |
| 2 | **Two-person `person_*` test** (3.2) | Upstream observed the opposite | Jim: one two-person photo |
| 3 | `selene` + `lightroom.yml` CI (4.6) | Cheap, finds Lua bugs before Jim does | Jim: OK on Lua tooling (rule 01) |
| 4 | MCP SDK v2 migration (2.2) | Stay on the supported line; small diff | Jim: Desktop smoke test |
| 5 | Bridge sharing decision (4.1) | Cowork/Code in Claude Desktop | Jim: options A/B/C |
| 6 | Search filters + colour label + sharpness metric (5.1, 5.2, 4.3) | Serve batch (#110) and culling (#111) | none beyond Windows run |
| 7 | Mirrored-orientation table, brush feather/erase, mask curve/Point Color, AI mask to many photos (3.3, 3.4, 6.3) | Finish mask parity | masks:* runs |
| 8 | Auto tone/WB tool as a baseline for #194 (4.5); snapshot list/restore tool (4.4); fast thumbnail previews (4.2) | Editing quality and culling speed | Jim: priorities |
| 9 | #166 prompts / #172 `.mcpb` using upstream shapes (4.7) | Already on your deferred list | Jim: un-defer |
| 10 | Decision on removal of unpicked Variants copies (5.8) and PV upgrade tool (5.9) | Destructive; Jim's call | Jim |
| 11 | Refresh `docs/WHATS_NEW_VS_AUTOMAAT.md` | It says upstream has 18 tools and that tone-curve writing is "not included"; both are stale | none |

Items 1 and 2 are corrections to what we ship, not features; they should come before any port.

## 9. What I did not do or could not verify
- No Lightroom here; nothing in sections 3-5 about Lightroom behaviour is observed by me.
- I did not run the MCP codemod (sandbox classifier denied downloading and running it); the v2 cost is estimated.
- I did not read upstream's GitHub issues or open PRs (only the repo's git history; the issue tracker is outside this session's GitHub scope). Planned-but-unmerged upstream work is therefore unknown to me.
- Test counts for upstream come from their PR texts, not from running their suites.
- Token cost of the two tool lists is not measured; 68 vs 37 tools is the only figure.
- `1040453` is a day-old main, and most of the 40 unreleased commits are one to three days old (2026-10-23 to 2026-10-26); they have not seen long use.
- I made no change to the repository and pushed nothing. A scratch copy of the engine, used only for the baseline test run, is in the session scratchpad.

## Appendix A. All 68 upstream tools mapped

Legend: **have** = equivalent in ours, **ours+** = ours is stronger, **partial**, **missing**, **n/a** = deliberately not adopted.

| Upstream tool | Ours | Note |
|---|---|---|
| search_photos | partial | no camera/lens/ISO/focal/flag/label/edited/filetype filters |
| get_selected_photos | have | `lr_get_selected_photos` |
| get_photo_metadata | ours+ (different) | canonical names, `lr_get_metadata`, `lr_get_active_photo_context` |
| get_photo_preview | ours+ / partial | exact export + metrics + region crop; no fast thumbnail mode |
| get_photo_stats | partial | richer metrics; no sharpness, no 20-photo batch |
| set_gps | have | `lr_set_gps` |
| set_location | missing | |
| set_metadata | partial | `lr_set_iptc`: no creator/copyright |
| set_ai_metadata, get_ai_metadata | missing | private catalog fields |
| list_folders, get_folder_photos | partial | `folder` filter in search; no folder listing |
| list_collections | have | |
| create_collection | have | `lr_create_collection` |
| create_smart_collection | missing | |
| add_to_collection | have | `lr_add_to_collection` |
| get_collection_photos | have | `collection_id` in search |
| remove_from_collection | have | per issue #190 comment "already in LrC-AVG" (handle: that comment) |
| delete_collection | missing | |
| set_keywords | have | paths supported |
| remove_keyword_subtree | missing | |
| list_keywords | have | |
| rename_keyword | missing | on #190 list |
| undo_last_step | n/a | global `LrUndo` conflicts with Abort guarantee |
| set_rating, set_flag | have | |
| set_color_label | missing | |
| remove_photos_from_catalog | missing | see 5.8 |
| import_photos, export_photos | have | `lr_import_photos`, `lr_export_photos` |
| export_photo_metadata | missing | on #190 list |
| list_develop_presets, get_develop_preset, compare_develop_presets, export_develop_preset | missing | our issue #113 (deferred) |
| create_develop_preset | partial | `lr_create_preset_from_active` (file route, not plugin-hidden API) |
| apply_develop_preset | n/a | unguarded; we apply looks through intents |
| copy_develop_settings | ours+ | `lr_sync_series` |
| set_develop_settings | ours+ | `lr_step` (canonical map, limits, guardrails, History names) |
| set_process_version | missing | see 5.9 |
| create_virtual_copies | partial | internal for Variants; no tool |
| list/create/apply/delete_develop_snapshot | partial | internal snapshots; no tool |
| apply_auto_adjustments | missing | see 4.5 |
| reset_develop_adjustments | n/a / partial | session Abort and revert |
| apply_denoise | have | `lr_apply_denoise` (ported PR #191) |
| list_masks | have | `lr_list_masks` |
| create_gradient_mask, update_gradient_mask | have | `lr_create_mask` linear/radial, `lr_edit_mask` |
| create_brush_mask, add_brush_strokes | partial | strokes ported; no erase, feather, density, no add-strokes |
| create_range_mask | partial / see 3.1 | luminance, colour (probable defect), depth |
| delete_masks | have | `lr_delete_mask` (one per call) |
| delete_empty_masks | missing | catalog-wide `deleteAllEmptyMasks` |
| set_mask_adjustments, get_mask_adjustments | have | `lr_edit_mask` sliders, `lr_list_masks` |
| invert_mask | partial | `inverted` in `lr_edit_mask`; copy-as-new not offered |
| create_mask | have | subject, sky, background |
| create_mask_batch | missing | #329 on #190 list |
| create_people_mask, create_landscape_mask | have | by part/category (all people); `person_*` single-person see 3.2 |
| set_mask_curves, get_mask_curves | missing | #328 |
| edit_mask_point_colors, get_mask_point_colors | missing | #328 |
| combine_mask | have | `lr_edit_mask` `combine` (add/subtract/intersect, verified forms only) |

Our tools with no upstream counterpart (the AVG layer): `lr_help`, `lr_list_intents`, `lr_get_intent`, `lr_save_intent`, `lr_delete_intent`, `lr_begin_session`, `lr_step`, `lr_probe`, `lr_set_regions`, `lr_select_variant`, `lr_approve_pass`, `lr_end_session`, `lr_get_session_log`, `lr_get_metrics`, `lr_sync_series`, `lr_create_preset_from_active`.
