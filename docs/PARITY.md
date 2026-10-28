# LrC-AVG and Automaat/lightroom-mcp: tool map and coexistence

LrC-AVG started as a fork of [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp) (MIT, Marcin Skalski) and is meant as a **complement** to it: the same reach into the Lightroom Classic catalog under `lr_*` names, plus a guarded, measured edit loop that upstream does not have (epic #207, decision D7 recommends keeping the `lr_*` names and publishing this table [stated: issue #207 "Decisions needed from Jim", D7 is still open]).

- Upstream compared: `Automaat/lightroom-mcp@1040453` (2026-10-26), **68 tools** [handle: `docs/parity/upstream-tools-1040453.txt`, extracted from upstream `server/src/tool-contracts.ts`; `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` section 1].
- LrC-AVG: branch `phase-11/parity-batch-1` (engine 1.5.0), **61 tools** [handle: `grep -ohE 'name: "lr_[a-z_]+"' engine/src/mcp/defs-*.ts | sort -u | wc -l` = 61; `TOOL_DEFS` in `engine/src/mcp/server.ts`].
- Kept current by `engine/tests/parity-map.test.ts`: it fails when a pinned upstream name has no row below, when a row names an `lr_` tool the server does not register, or when a registered tool is not named anywhere on this page. How to renew the pin: [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md).

Most rows marked `have` or `ours+` were added on this branch (#214-#218) and are tested against the simulated Lightroom only; whether each works in Lightroom is `[unverified]` until Jim's checks in [`reports/phase11/PARITY-BATCH1-CHECKS.md`](reports/phase11/PARITY-BATCH1-CHECKS.md) are observed.

## Status legend

| Status | Meaning |
|---|---|
| `have` | An `lr_*` tool reaches the same capability |
| `ours+` | Ours reaches it and adds something (snapshot first, measurements, guardrails, before/after) |
| `planned #nnn` | Not there yet, or only in part; the GitHub issue that plans it |
| `decision Dn` | Waits for Jim's decision Dn in epic #207; not decided here |

Every `lr_*` write tool runs only when no edit session is open, and returns the earlier values or names the snapshot that undoes it [handle: `whenIdle` in `engine/src/session/manager.ts`; the builders' notes of #214-#218 in each child issue]. The mask tools are the exception the other way round: ours work inside an edit session (`session_id`), upstream's on any photo [handle: `engine/src/mcp/defs-masks.ts:54`].

## Upstream tool to LrC-AVG tool

| Upstream tool | LrC-AVG | Status | Note |
|---|---|---|---|
| `search_photos` | `lr_search_photos` | have | Camera, lens, ISO, focal length, flag, colour label, edited and file type filters added (#218) |
| `get_selected_photos` | `lr_get_selected_photos` | have | |
| `get_photo_metadata` | `lr_get_metadata`, `lr_get_active_photo_context` | ours+ | Settings by canonical name; `raw: true` adds Lightroom's own SDK keys (#214) |
| `get_photo_preview` | `lr_get_preview` | ours+ | Exact export with metrics and region crops; `quality: "fast"` for Lightroom's cached preview (#216) |
| `get_photo_stats` | `lr_get_photo_stats`, `lr_get_metrics` | ours+ | 1-20 photos, sharpness included (#216) |
| `set_gps` | `lr_set_gps` | have | |
| `set_location` | `lr_set_iptc` | have | Sublocation, city, state, country, ISO country code (#218) |
| `set_metadata` | `lr_set_iptc` | planned #218 | Title, caption, headline, creator, copyright, alt text and extended description are there; rights usage terms, copyright info URL and creator website are not [handle: `grep -rniE "rights" engine/src/mcp/defs-*.ts` and the same for `website` find nothing, 2026-10-27] |
| `set_ai_metadata` | `lr_set_ai_metadata` | have | |
| `get_ai_metadata` | `lr_get_ai_metadata` | ours+ | Also the `avg_edit` stamp an accepted session writes (#218 row 9) |
| `list_folders` | `lr_list_folders` | have | |
| `get_folder_photos` | `lr_search_photos` | have | `folder` with `include_subfolders` |
| `list_collections` | `lr_list_collections` | have | |
| `create_collection` | `lr_create_collection` | have | |
| `create_smart_collection` | `lr_create_smart_collection` | have | From `lr_search_photos` filters; no folder or collection rule (#218) |
| `add_to_collection` | `lr_add_to_collection` | have | |
| `get_collection_photos` | `lr_search_photos` | have | `collection_id` or `collection` by name |
| `remove_from_collection` | `lr_add_to_collection` | have | `remove: true` |
| `delete_collection` | `lr_delete_collection` | have | `confirm: true` |
| `set_keywords` | `lr_set_keywords` | have | Keyword paths |
| `remove_keyword_subtree` | `lr_remove_keyword_subtree` | have | |
| `list_keywords` | `lr_list_keywords` | have | |
| `rename_keyword` | `lr_rename_keyword` | have | |
| `undo_last_step` | none | decision D2 | Global undo against the Abort guarantee |
| `set_rating` | `lr_set_rating` | have | |
| `set_flag` | `lr_set_flag` | have | |
| `set_color_label` | `lr_set_color_label` | have | |
| `remove_photos_from_catalog` | none | decision D3 | #218 row 10 waits for it |
| `import_photos` | `lr_import_photos` | have | Upstream's list of file types (#218 row 11) |
| `export_photos` | `lr_export_photos` | have | |
| `export_photo_metadata` | `lr_export_metadata` | have | |
| `list_develop_presets` | `lr_list_presets` | have | |
| `get_develop_preset` | `lr_get_preset` | have | |
| `compare_develop_presets` | `lr_compare_presets` | have | |
| `create_develop_preset` | `lr_create_checkpoint`, `lr_create_preset_from_active` | have | Checkpoint hidden from the Presets panel; the second one makes a visible preset |
| `export_develop_preset` | `lr_export_preset` | have | |
| `apply_develop_preset` | `lr_apply_preset` | ours+ | Snapshot per photo first, before/after values (#215) |
| `copy_develop_settings` | `lr_sync_series` | ours+ | Snapshot per photo, optional brightness matching; masks are not carried yet (planned #217) |
| `set_develop_settings` | `lr_step` (canonical names) | decision D1 | `lr_step` writes the canonical map with limits and guardrails; free SDK-key writes wait for D1 |
| `set_process_version` | `lr_set_process_version` | have | `confirm: true`; a masked downgrade is skipped |
| `create_virtual_copies` | `lr_create_virtual_copies` | have | |
| `list_develop_snapshots` | `lr_list_snapshots` | ours+ | Marks LrC-AVG's snapshots and the session that needs one |
| `create_develop_snapshot` | `lr_create_snapshot` | have | Named `AVG <name>` |
| `apply_develop_snapshot` | `lr_apply_snapshot` | ours+ | Takes an `AVG pre-apply` snapshot first |
| `delete_develop_snapshot` | `lr_delete_snapshot` | ours+ | Refuses a snapshot a session still needs |
| `apply_auto_adjustments` | `lr_apply_auto` | have | Snapshot first |
| `reset_develop_adjustments` | `lr_reset` | have | `confirm: true`, snapshot first |
| `apply_denoise` | `lr_apply_denoise` | have | Ported in PR #191 |
| `list_masks` | `lr_list_masks` | have | A colour range's stored `sample` {l, a, b} and a depth range's trapezoid (#210) |
| `create_gradient_mask` | `lr_create_mask` | have | Linear and radial |
| `update_gradient_mask` | `lr_edit_mask` | have | |
| `create_brush_mask` | `lr_create_mask` | planned #217 | Brush from strokes exists; feather, density and erase do not |
| `add_brush_strokes` | none | planned #217 | |
| `create_range_mask` | `lr_create_mask` | have | Luminance, colour and depth; the colour as `copy_sample_from` or `geometry.sample` {l, a, b} (#210); the engine's own point sample (the preview's RGB) stays until `npm run masks:verify`, flagged [unverified] in the tool text |
| `delete_masks` | `lr_delete_mask` | have | One mask per call |
| `delete_empty_masks` | `lr_delete_empty_masks` | have | Lightroom's own `catalog:deleteAllEmptyMasks`, a snapshot first, the mask count before and after (#217) |
| `set_mask_adjustments` | `lr_edit_mask` | have | |
| `get_mask_adjustments` | `lr_list_masks` | have | |
| `invert_mask` | `lr_edit_mask` | planned #217 | In place with `inverted`; inverting as a copy does not exist |
| `create_mask` | `lr_create_mask` | have | Subject, sky, background |
| `create_mask_batch` | none | planned #217 | One AI mask on many photos |
| `create_people_mask` | `lr_create_mask` | have | People parts by kind; one-person kinds under check in #210 (`npm run masks:verify`); a mirrored photo refuses points and geometry until the same check |
| `create_landscape_mask` | `lr_create_mask` | have | |
| `set_mask_curves` | none | planned #217 | |
| `get_mask_curves` | none | planned #217 | |
| `edit_mask_point_colors` | none | planned #217 | |
| `get_mask_point_colors` | none | planned #217 | |
| `combine_mask` | `lr_edit_mask` | have | `combine` add, subtract, intersect, in the forms checked in Lightroom |

Count: 47 `have`, 9 `ours+`, 9 `planned` (#217: 8, #218: 1), 3 `decision` [handle: `engine/tests/parity-map.test.ts` pins these counts].

## LrC-AVG tools with no upstream counterpart

The edit loop and its records: `lr_help`, `lr_begin_session`, `lr_step`, `lr_probe`, `lr_set_regions`, `lr_select_variant`, `lr_approve_pass`, `lr_end_session`, `lr_get_session_log`. The look library: `lr_list_intents`, `lr_get_intent`, `lr_save_intent`, `lr_delete_intent`. Upstream's nearest is a prompt-level skill with no pass cap, guardrails or session state [handle: `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` section 6.1].

## Using both servers

The two Lightroom plug-ins have different identities and ports:

| | Automaat/lightroom-mcp | LrC-AVG |
|---|---|---|
| Toolkit id | `com.lightroom.mcp` [handle: upstream `plugin/LightroomMCP.lrplugin/Info.lua:5` at `1040453`] | `com.lrcavg.gateway` from the setup, `com.lrcavg.gateway.dev` from this repo [handle: `tools/setup/plugin-id.ts:8-11`; `plugin/LrC-AVG.lrplugin/Info.lua:35`] |
| Plug-in name | "Lightroom MCP" [handle: upstream `Info.lua:6`] | "LrC-AVG (Autonomous Vision Gateway)", or "LrC-AVG (dev)" [handle: `tools/setup/plugin-id.ts:10-11`; `plugin/LrC-AVG.lrplugin/Info.lua:36`] |
| Ports (127.0.0.1) | 58763 request, 58764 response [handle: upstream `plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua:44-45`, `server/src/ports.ts:1`] | 8765 commands, 8766 responses, changeable in Plug-in Manager [handle: `plugin/LrC-AVG.lrplugin/Bridge.lua:2-3`, `Prefs.lua:44`; `engine/src/bridge/endpoint.ts:19-20`] |
| Platforms | macOS and Windows | Windows |

So both can be added in File > Plug-in Manager at once without a clash of id or port [inference: neither the ids nor the ports overlap; running both together has not been tried, `[unverified]`]. Upstream names MIDI2LR as a plug-in that also takes 58763/58764 [upstream claim: `server/src/port-owner.ts:192`].

**Cautions** (all `[inference]`, none observed):

- **Tool count.** With both servers on, the AI sees about 129 tools (68 + 61). Long tool lists cost context and make a wrong pick likelier; see issue #165 and decision D6.
- **Guardrails can be bypassed.** During an LrC-AVG edit session the AI could call upstream's `set_develop_settings`, `apply_develop_preset`, `reset_develop_adjustments` or `undo_last_step` on the same photo. Those writes do not pass LrC-AVG's limits, clipping checks or named History steps, and LrC-AVG's pass measurements would then describe settings it did not make. **Abort** still applies the `AVG pre-session …` snapshot.
- **Two plug-ins moving the view.** Both switch Lightroom to Develop and change the selection for some tools (Denoise, Auto, snapshots, virtual copies). Two such calls at the same moment, one per server, could interleave.
- **Private metadata is per plug-in.** Upstream's `aiScore`/`aiReason` and ours are separate fields under separate toolkit ids, so a score written by one server is not read by the other.

**Which server for which job:**

| Job | Use |
|---|---|
| Editing a photo with a look, measured passes, the HUD and Abort | LrC-AVG alone: turn the Automaat server off in the AI app for that chat (where each app keeps its server list: [`CLIENTS.md`](CLIENTS.md)) |
| Search, keywords, collections, IPTC, ratings, import, export, presets, snapshots | Either; LrC-AVG returns the earlier values and an undo hint with each write |
| Mask curves, Point Color, one AI mask on many photos, deleting empty masks, brush feather or erase | Automaat, outside an LrC-AVG session, until #217 lands |
| Raw SDK-key writes, global undo, removing photos from the catalog | Automaat, until Jim decides D1, D2 and D3 |
| macOS | Automaat; LrC-AVG is Windows only (decision D4) |
