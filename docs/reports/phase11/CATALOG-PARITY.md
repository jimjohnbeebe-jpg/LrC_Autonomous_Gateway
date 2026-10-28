---
report: CATALOG-PARITY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (Observed, Numbers, verdict)"
date: 2026-10-27
---

# CATALOG-PARITY: issue #218's catalog and metadata tools in Lightroom

## Purpose

GitHub issue #218 (epic #207, Automaat parity) adds upstream's catalog and metadata tools under our names, each write with its `before` values and an undo hint, rows 1-9 and 11 (row 10, removing photos from the catalog, waits for Jim's decision D3 and is not built). Upstream observed its tools on macOS Lightroom Classic 15.6 `[upstream claim]`; nothing here has run in Lightroom yet. The question: **on Windows, in a throwaway or copied catalog, does each new tool do what its description says, and does `catalog:check` put the photo back?**

Acceptance (issue #218): "Each row: schema, annotations, tests against the fake plugin, a Lightroom check by Jim in a copy of a catalog or a throwaway one, report." How the answer reads (an inference, the verdict is Jim's): **Go** when the window ends `Catalog check: WORKED` and `put back: YES`; **Conditional** when a step is NO for a reason Lightroom gives (for example the focal length filter, which is not on the SDK's criteria list); **No-go** when a write lands on the wrong photo or the put-back fails.

| Row | Tool | What it does |
|---|---|---|
| 1 | `lr_search_photos` | new filters: camera, lens (exact indexed names), iso, focal_length, flag, color_label, edited, file_type; `collection` by name |
| 2 | `lr_set_color_label` | red, yellow, green, blue, purple, none; before/after |
| 3 | `lr_set_iptc` | adds creator, copyright, sublocation, city, state, country, iso_country_code |
| 4 | `lr_set_iptc`, `lr_get_metadata` | alt_text, extended_description (13.2+); label, rating, capture_time, path, copy_name, virtual_copy read |
| 5 | `lr_rename_keyword`, `lr_remove_keyword_subtree` | rename in place (case-only too); subtree off the named/selected photos, or catalog-wide with confirm |
| 6 | `lr_list_folders` | paged folder tree with direct counts (a folder's photos: `lr_search_photos` folder) |
| 7 | `lr_create_smart_collection`, `lr_delete_collection` | smart collection from the search filters; delete with confirm, photos stay |
| 8 | `lr_export_metadata` | one new JSON file per call, never overwrites |
| 9 | `lr_set_ai_metadata`, `lr_get_ai_metadata`; the AVG stamp | an AI score (0-100) and reason in the plugin's private metadata (upstream's `aiScore`, `aiReason`, schema version 1); an accepted session stamps its photo with AVG session, AVG look and AVG edit date, fields Lightroom can show and search |
| 11 | `lr_import_photos` | upstream's full list of file types |

## Harness

`npm run catalog:check`. Files: `engine\src\devtools\catalog-check.ts` (the steps, the put-back, the verdict), `catalog-check-cli.ts` (connects, asks Jim, saves); test `engine\tests\catalog-check.test.ts`. The steps call the tools through the `Tools` class, as Claude Desktop does, on the one photo selected in Lightroom:

1. `lr_get_metadata` reads the photo's label, text fields and keywords (kept for the put-back).
2. `lr_list_folders` lists at most 5 folders.
3. `lr_set_color_label` sets red (green if it was red); `lr_search_photos` with that `color_label` finds the photo.
4. `lr_search_photos` with a camera, lens, ISO 1 and 1 mm that no photo has (expects 0 each, no error), `edited` true and false (the photo in exactly one), `flag` none, `file_type` DNG and RAW (counts recorded).
5. `lr_set_iptc` writes creator, copyright, sublocation, city, state, country, ISO code.
6. `lr_set_keywords` adds "AVG catalog check kw|Child"; `lr_rename_keyword` renames it "Child renamed", then "child renamed" (case only); `lr_remove_keyword_subtree` takes "AVG catalog check kw" and its children off the photo.
7. `lr_create_smart_collection` "AVG catalog check smart" with the step 3 label; `lr_search_photos` by that collection name finds the photo; `lr_delete_collection` deletes it.
8. `lr_create_collection` "AVG catalog check", the photo added, `lr_delete_collection` by name returns the photo's uuid in `member_uuids`.
9. `lr_export_metadata` writes the photo's metadata to `%TEMP%\LrC-AVG\catalog-check\`.
10. Row 9: `lr_set_ai_metadata` keeps score 42 and the reason "AVG catalog check"; `lr_get_ai_metadata` reads them back.
11. Put back: the AI score and reason as step 10 read them first, the label and the text fields as step 1 read them, any "AVG catalog check" collection left, then one read that compares label, text fields and keywords with step 1.

Four questions in the PowerShell window (the last two for row 9: no error dialog at Reload Plug-in, and the three AVG fields listed under the Metadata panel's "All Plug-in Metadata"), then `Catalog check: WORKED/FAILED` and `put back: YES/NO`. Results under `%TEMP%\LrC-AVG\catalog-check\`: `catalog_check_<time>.json`, the exported `lrc-avg-metadata-<time>.json`, and the tool log `catalog_check_tools_<time>`; Claude Code collects them into `docs\reports\phase11\CATALOG-PARITY\`. Not run: `lr_remove_keyword_subtree` catalog-wide (the throwaway catalog's other photos may hold the keyword), alt_text and extended_description (13.2+ only; step 1 records whether they read), import (row 11 adds file types only).

## Pre-run findings (Claude Code)

- The SDK pages for each call the plugin now makes: `createSmartCollection`, `batchGetRawMetadata`, `getFolders` [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCatalog.html`]; `collection:delete`, `getSearchDescription` [handle: `modules\LrCollection.html`]; `folder:getChildren`, `getPath`, `getPhotos(includeChildren)` [handle: `modules\LrFolder.html`]; `keyword:setAttributes` "returns false if there is already a keyword which has the same name and parent" [handle: `modules\LrKeyword.html`]; `colorNameForLabel`, the IPTC location keys and, "first supported in version 13.2", `altTextAccessibility` and `extDescrAccessibility` [handle: `modules\LrPhoto.html`]. The findPhotos criteria `camera`, `lens` "(string, with exact match)", `isoSpeedRating`, `pick`, `labelColor`, `hasAdjustments`, `fileFormat` are on the LrCatalog page; `focalLength` is not, and is `[upstream claim]` only.
- A smart collection's `getPhotos` now runs outside the read gate in `Library.lua`, `Transfer.lua` and `CollectionEdit.lua`: upstream found it deadlocks inside the gate on Windows `[upstream claim: Automaat/lightroom-mcp@1040453 HandlerCollections.lua:443-446]`.
- Against the simulated plugin (stand-in handlers for the new commands): `engine\tests\catalog-parity.test.ts` 17 tests, `catalog-check.test.ts` 2 tests and (row 9) `catalog-ai-metadata.test.ts` 5 tests pass [handle: `npx vitest run tests/catalog-parity.test.ts tests/catalog-check.test.ts tests/catalog-ai-metadata.test.ts` in `engine\`, 2026-10-27]. The stand-ins answer what the tests tell them, so this shows the engine side, not what Lightroom does.
- The commands are new in the plugin of this branch; the engine has no version gate for them: a plugin without them answers `unknown_command`, which reaches Claude as `FEATURE_UNAVAILABLE` "this LrC-AVG plugin does not know it" [handle: `engine\src\mcp\errors.ts` `fromBridge`].

## Steps for Jim

1. Quit Claude Desktop (File > Exit; this check takes the engine's lock).
2. In Lightroom Classic: File > Open Catalog, open a throwaway catalog or a copy of one (not your real catalog). It needs at least one photo.
3. File > Plug-in Manager, select LrC-AVG, click **Reload Plug-in**, close the dialog.
4. In the Library grid, click one photo so that exactly one is selected.
5. In PowerShell, from `D:\Developer\LrC_Autonomous_Gateway`:

   ```powershell
   npm run catalog:check
   ```

6. Answer `y` to "Is Lightroom running a throwaway or copied catalog". The steps run for about a minute; Lightroom's Collections panel shows two collections appear and go.
7. Answer the four y/n questions in the window (the Collections panel; the photo's label and IPTC Creator/Location in the Metadata panel; whether step 3's Reload Plug-in ended without an error dialog; the AVG fields under the Metadata panel's "All Plug-in Metadata").
8. You should see `Catalog check: WORKED` and `put back: YES`. Tell Claude Code "done".

### If something goes wrong

- If the window says "Reload Plug-in", do step 3 again, then step 5.
- If it says "select exactly one photo", click one photo in the Library grid, then step 5.
- If it says "could not connect to Lightroom", wait 10 seconds after Lightroom has opened the catalog, then step 5.
- If `put back: NO`: tell Claude Code "done" anyway; the results file names what was not put back. The keywords "AVG catalog check kw" stay in the Keyword List in every case (no tool deletes a keyword).

## Observed (Jim)

## Numbers

| Item | Value |
|---|---|
| Lightroom Classic version, plugin version | |
| Steps YES / total | |
| `edited` true / false: the photo in exactly one | |
| Focal length 1 mm: count, or the error | |
| Accessibility fields read (13.2+) | |
| Put back | |
| Jim's answers | |

## Verdict

## Consequences / open questions

- `[unverified]` until this run: every Lightroom-side behaviour above, in particular `focalLength` as a findPhotos criterion, `hasAdjustments` with `isTrue`/`isFalse`, `labelColor` with `"none"`, `getPhotos(true)` for a folder's subfolders (from issue #139), the case-only rename through a temporary name, `createSmartCollection` inside a collection set made in the same gate, and whether Edit > Undo takes a deleted collection back.
- Row 9 is its own commit, so it can be dropped alone: `Info.lua`'s new `LrMetadataProvider` (`MetadataDefinition.lua`) makes Lightroom update the plug-in metadata of the catalog when it loads the plugin `[unverified]`. Also `[unverified]`: whether a field without a title (`aiScore`, `aiReason`) stays hidden, whether "All Plug-in Metadata" is where the AVG fields show, whether the shipped plugin (`com.lrcavg.gateway`) and the development one (`com.lrcavg.gateway.dev`) keep separate values `[inference]`, and the accepted-session stamp in Lightroom (the check runs no session; `engine\tests\catalog-ai-metadata.test.ts` covers it against the simulator).
- README's user guide still says "No tool deletes a collection" and lists only title, caption and headline; the documentation child of #207 updates it with the parity table.
