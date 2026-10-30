# LrC-AVG and Automaat/lightroom-mcp: tool map and coexistence

LrC-AVG started as a fork of [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp) (MIT, Marcin Skalski) and is meant as a **complement** to it: the same reach into the Lightroom Classic catalog under `lr_*` names, plus a guarded, measured edit loop that upstream does not have (epic #207, decision D7: keep the `lr_*` names, offer no upstream aliases, and publish this table [stated: Jim, 2026-10-28, "Go with recommendations" on D6 and D7]).

- Upstream compared: `Automaat/lightroom-mcp@1040453` (2026-10-26), **68 tools** [handle: `docs/parity/upstream-tools-1040453.txt`, extracted from upstream `server/src/tool-contracts.ts`; `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` section 1].
- LrC-AVG: `main` at engine 1.7.0 (after PR #249), **65 tools** [handle: `grep -ohE 'name: "lr_[a-z_]+"' engine/src/mcp/defs-*.ts | sort -u | wc -l` = 65; `TOOL_DEFS` in `engine/src/mcp/server.ts`].
- **Profiles** (decision D6, issue #165): every `lr_*` tool on this page is in the `full` profile, the default. The `edit` profile (`LRC_AVG_TOOLS=edit`) has only the edit loop: `lr_help`, `lr_get_active_photo_context`, `lr_get_preview`, `lr_list_intents`, `lr_begin_session`, `lr_step`, `lr_set_regions`, `lr_approve_pass`, `lr_select_variant`, `lr_end_session` and the four mask tools. A row below whose LrC-AVG tool is not in that list needs `full` [handle: `EDIT_TOOLS` in `engine/src/mcp/profiles.ts`; README "Tool profiles"].
- Kept current by `engine/tests/parity-map.test.ts`: it fails when a pinned upstream name has no row below, when a row names an `lr_` tool the server does not register, or when a registered tool is not named anywhere on this page. How to renew the pin: [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md).

Most rows marked `have` or `ours+` were added on this branch (#214-#218) and are tested against the simulated Lightroom only; whether each works in Lightroom is `[unverified]` until Jim's checks in [`reports/phase11/PARITY-BATCH1-CHECKS.md`](reports/phase11/PARITY-BATCH1-CHECKS.md) are observed. The rows of decisions D1-D3 (`lr_set_develop_settings`, `lr_undo_last_step`, `lr_remove_photos`) are `[unverified]` in Lightroom until `npm run develop-catalog:check` ([`reports/phase11/DEVELOP-CATALOG-D123.md`](reports/phase11/DEVELOP-CATALOG-D123.md)).

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
| `list_keywords` | `lr_list_keywords` | have | The plugin keeps the walked tree 2 minutes, dropped on its own keyword writes; `refresh: true` reads it again (2026-10-28, PERF.md) |
| `rename_keyword` | `lr_rename_keyword` | have | |
| `undo_last_step` | `lr_undo_last_step` | have | `confirm: true`; refused while a session is open or left open (D2) |
| `set_rating` | `lr_set_rating` | have | |
| `set_flag` | `lr_set_flag` | have | |
| `set_color_label` | `lr_set_color_label` | have | |
| `remove_photos_from_catalog` | `lr_remove_photos` | have | `confirm: true`, Lightroom Classic 14.3 or later, a master refused without all its virtual copies; unpicked Variants copies after `lr_end_session` (D3, #218 row 10) |
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
| `set_develop_settings` | `lr_set_develop_settings`, `lr_step` (canonical names) | ours+ | Keys of the pinned dump only, the canonical ones range-checked; snapshot first, written in Develop, read back, put back when a key is not taken (D1). `lr_step` keeps the per-pass limits and clipping guard |
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
| `create_brush_mask` | `lr_create_mask` | have | Strokes with radius (fraction of the long edge), flow, feather, density and erase (#217); Size, a screen size, is not offered |
| `add_brush_strokes` | `lr_edit_mask` | have | `geometry.strokes` on a brush adds strokes after its own, erase strokes included (#217) |
| `create_range_mask` | `lr_create_mask` | have | Luminance, colour and depth; the colour as `copy_sample_from` or `geometry.sample` {l, a, b} (#210); the engine's own point sample (the preview's RGB) is refused since `npm run masks:verify` (2026-10-28: it missed the red asked for on one photo of two) |
| `delete_masks` | `lr_delete_mask` | have | One mask per call |
| `delete_empty_masks` | `lr_delete_empty_masks` | have | Lightroom's own `catalog:deleteAllEmptyMasks`, a snapshot first, the mask count before and after (#217) |
| `set_mask_adjustments` | `lr_edit_mask` | have | |
| `get_mask_adjustments` | `lr_list_masks` | have | |
| `invert_mask` | `lr_edit_mask` | have | In place with `inverted`; as a copy with `copy: true`, one-part masks, an AI copy computed afresh (#217) |
| `create_mask` | `lr_create_mask` | have | Subject, sky, background |
| `create_mask_batch` | none | planned #217 | One AI mask on many photos |
| `create_people_mask` | `lr_create_mask` | have | People parts by kind; one-person kinds under check in #210 (`npm run masks:verify`); a mirrored photo refuses points and geometry until the same check |
| `create_landscape_mask` | `lr_create_mask` | have | |
| `set_mask_curves` | `lr_edit_mask` | have | `curves` main, red, green, blue as [input, output] points, through `LrDevelopController` on the photo open in Develop, each read back (#217); in Lightroom [unverified] until `docs/reports/phase11/MASK-CONTROLLER.md` |
| `get_mask_curves` | `lr_list_masks` | have | `live_mask_id`: one mask's curves and swatches read through `LrDevelopController` (#217) |
| `edit_mask_point_colors` | `lr_edit_mask` | have | `point_colors` add, update, delete or clear, through `LrDevelopController` on the photo open in Develop (#217; the mask-table route did not show in Lightroom); in Lightroom [unverified] until `docs/reports/phase11/MASK-CONTROLLER.md` |
| `get_mask_point_colors` | `lr_list_masks` | have | `point_colors` of each mask from the mask table; `live_mask_id` reads one mask's from Lightroom (#217) |
| `combine_mask` | `lr_edit_mask` | have | `combine` add, subtract, intersect, in the forms checked in Lightroom |

Count: 56 `have`, 10 `ours+`, 2 `planned` (#217: 1, #218: 1) [handle: `engine/tests/parity-map.test.ts` pins these counts].

## LrC-AVG tools with no upstream counterpart

The edit loop and its records: `lr_help`, `lr_begin_session`, `lr_step`, `lr_probe`, `lr_set_regions`, `lr_crop` (issue #115), `lr_select_variant`, `lr_approve_pass`, `lr_end_session`, `lr_get_session_log`. The look library: `lr_list_intents`, `lr_get_intent`, `lr_save_intent`, `lr_delete_intent`. Upstream's nearest is a prompt-level skill with no pass cap, guardrails or session state [handle: `docs/reports/phase10/AUTOMAAT_COMPARE_2026-10-26.md` section 6.1].

## Using both servers

The two Lightroom plug-ins have different identities and ports:

| | Automaat/lightroom-mcp | LrC-AVG |
|---|---|---|
| Toolkit id | `com.lightroom.mcp` [handle: upstream `plugin/LightroomMCP.lrplugin/Info.lua:5` at `1040453`] | `com.lrcavg.gateway` from the setup and the release zip, `com.lrcavg.gateway.dev` from this repo [handle: `engine/src/setup/plugin-id.ts:8-11`; `plugin/LrC-AVG.lrplugin/Info.lua:36`] |
| Plug-in name | "Lightroom MCP" [handle: upstream `Info.lua:6`] | "LrC-AVG (Autonomous Vision Gateway)", or "LrC-AVG (dev)" [handle: `engine/src/setup/plugin-id.ts:10-11`; `plugin/LrC-AVG.lrplugin/Info.lua:37`] |
| Ports (127.0.0.1) | 58763 request, 58764 response [handle: upstream `plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua:44-45`, `server/src/ports.ts:1`] | 8765 commands, 8766 responses, changeable in Plug-in Manager [handle: `plugin/LrC-AVG.lrplugin/Bridge.lua:2-3`, `Prefs.lua:44`; `engine/src/bridge/endpoint.ts:19-20`] |
| Platforms | macOS and Windows | Windows |

So both can be added in File > Plug-in Manager at once without a clash of id or port [inference: neither the ids nor the ports overlap; running both together has not been tried, `[unverified]`]. Upstream names MIDI2LR as a plug-in that also takes 58763/58764 [upstream claim: `server/src/port-owner.ts:192`].

**Cautions** (all `[inference]`, none observed):

- **Tool count.** With both servers on, the AI sees about 133 tools (68 + 65), or 82 with LrC-AVG's `edit` profile (68 + 14). Long tool lists cost context and make a wrong pick likelier; see issue #165 and decision D6 (README "Tool profiles").
- **Guardrails can be bypassed.** During an LrC-AVG edit session the AI could call upstream's `set_develop_settings`, `apply_develop_preset`, `reset_develop_adjustments` or `undo_last_step` on the same photo. Those writes do not pass LrC-AVG's limits, clipping checks or named History steps, and LrC-AVG's pass measurements would then describe settings it did not make. **Abort** still applies the `AVG pre-session …` snapshot.
- **Two plug-ins moving the view.** Both switch Lightroom to Develop and change the selection for some tools (Denoise, Auto, snapshots, virtual copies). Two such calls at the same moment, one per server, could interleave.
- **Private metadata is per plug-in.** Upstream's `aiScore`/`aiReason` and ours are separate fields under separate toolkit ids, so a score written by one server is not read by the other.

**Which server for which job:**

| Job | Use |
|---|---|
| Editing a photo with a look, measured passes, the HUD and Abort | LrC-AVG alone: turn the Automaat server off in the AI app for that chat (where each app keeps its server list: [`CLIENTS.md`](CLIENTS.md)) |
| Search, keywords, collections, IPTC, ratings, import, export, presets, snapshots | Either; LrC-AVG returns the earlier values and an undo hint with each write |
| One AI mask on many photos | Automaat, outside an LrC-AVG session, until the rest of #217 lands |
| macOS | Automaat; LrC-AVG is Windows only (decision D4) |
