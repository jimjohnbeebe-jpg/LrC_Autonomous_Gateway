---
report: CATALOG-PARITY
phase: "11"
status: accepted
authored_by: "Claude Code (purpose, harness, pre-run findings, steps; Observed and Numbers copied from the run files, 2026-10-27, runs 1 and 2); Jim (the run, his answers, verdict)"
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

### Run 1, 2026-10-27: FAILED (3 of 10 steps and 2 of 4 put-back lines NO)

Jim ran `npm run catalog:check` in a throwaway catalog (one folder, `G:\Media\Photos\Temp`, 70 photos) on the photo `20210114_0113.CR2` (`76F23BE2`), and said it completed [stated: Jim, 2026-10-27, "npm run catalog:check completed."]. The results file ends `headline: FAILED` [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`]:

```text
NO  lr_get_metadata reads label, the new text fields, rating and copy name
YES lr_list_folders lists the catalog's folders
YES lr_set_color_label writes a label and lr_search_photos finds it
YES lr_search_photos' new filters answer (no-such camera, lens, ISO 1, 1 mm find nothing; edited true/false split)
YES lr_set_iptc writes creator, copyright and the location fields
YES lr_rename_keyword (and a case-only rename), lr_remove_keyword_subtree
NO  lr_create_smart_collection, its members by name, lr_delete_collection
YES lr_delete_collection by name gives back its member uuids
YES lr_export_metadata writes a JSON file
YES lr_set_ai_metadata keeps a score and reason, lr_get_ai_metadata reads them
NO  label put back
YES AI score and reason put back
YES text fields put back
NO  the photo reads as before
YES Jim's answer 1: y
YES Jim's answer 2: y
YES Jim's answer 3: y
YES Jim's answer 4: y
```

What each NO shows (Claude Code's reading of the file and the code):

- **Unlabelled photo reads "gray", and the label was not put back.** `lr_get_metadata` read the photo's label as **"gray"** before the check [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`, first step, `detail.label`]. The develop check's photo read "gray" too [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`, `lr_get_metadata raw`, `label`]. The plugin passes `getRawMetadata("colorNameForLabel")` through, using "none" only when it is nil [handle: `plugin\LrC-AVG.lrplugin\Metadata.lua:94`], so Lightroom 15.6 itself returned "gray" for a photo with no label [inference: that the photos had no label; Jim's answer 2 below]. `lr_set_color_label` accepts only red, yellow, green, blue, purple and none [handle: `engine\src\library\metadata.ts:78`], so putting "gray" back failed. **The photo was left with the red label the check wrote**, and "the photo reads as before" is NO for that reason [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`, `put_back`; `engine\src\devtools\catalog-check.ts:157` and `:164-167`].
- **The smart collection was reported as not smart.** `lr_create_smart_collection` made collection 3048 with the rule `labelColor == 1`; it found the photo. But both its own answer and the delete's `before` say `smart: false`, and the delete stored member uuids, not the rules [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`, step 7]. The plugin decides "smart" by `collection:type() == "LrSmartCollection"` [handle: `plugin\LrC-AVG.lrplugin\Transfer.lua:91`, `plugin\LrC-AVG.lrplugin\CollectionEdit.lua:102-103`]. The SDK documents `collection:isSmartCollection()` for this question, and `type()` only as "Reports the type of this object" [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCollection.html`]. So on 15.6, `type()` did not return "LrSmartCollection" for a smart collection [inference: what it did return was not recorded].
- **The first step's NO** is the harness's own test: it requires the keys `label`, `creator`, `sublocation`, `copy_name` and `rating` in the answer [handle: `engine\src\devtools\catalog-check.ts:38`]. `copy_name` is missing from the step's detail; a master photo (not a virtual copy) likely has none [inference]. Which key was missing is not recorded.

Everything else worked: the folder list, colour label write and search, the new search filters, IPTC and location, keyword rename (case-only too) and subtree removal, the regular collection's delete with member uuids, the metadata export, and the AI score and reason [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`].

**Jim's answers** (all y) [handle: `engine\src\devtools\catalog-check-cli.ts:76-80`]: 1, no collection starting "AVG catalog check" is left; 2, the colour label and IPTC Creator and Location read as before; 3, the plugin reloaded without an error dialog; 4, "AVG session", "AVG look" and "AVG edit date" are listed under "All Plug-in Metadata". **Answer 2 and the file disagree on the label:** the file says the label stayed red. Settled after the run: Jim looked again and the photo still has the red label [stated: Jim, 2026-10-27, "Yes, there is still a red label on the image."], so the file is right and answer 2 was given before the label was checked closely [inference].

### Run 2, 2026-10-27: FAILED (1 of 10 steps NO: a harness defect)

After the fix PR #240 (`a6f9bb5`), Jim reloaded the plugin and ran `npm run catalog:check` again in the same throwaway catalog on the same photo (`76F23BE2`) [stated: Jim, 2026-10-27, "Done"]. LrC 15.6, plugin 1.5.0, engine 1.5.0. The results file ends `headline: FAILED` [handle: `docs\reports\phase11\CATALOG-PARITY\run2\catalog_check_2026-10-28T04-15-41-490Z.json`]:

```text
YES lr_get_metadata reads label, the new text fields, rating and copy name
YES lr_list_folders lists the catalog's folders
YES lr_set_color_label writes a label and lr_search_photos finds it
YES lr_search_photos' new filters answer (no-such camera, lens, ISO 1, 1 mm find nothing; edited true/false split)
YES lr_set_iptc writes creator, copyright and the location fields
NO  lr_rename_keyword (and a case-only rename), lr_remove_keyword_subtree
YES lr_create_smart_collection, its members by name, lr_delete_collection
YES lr_delete_collection by name gives back its member uuids
YES lr_export_metadata writes a JSON file
YES lr_set_ai_metadata keeps a score and reason, lr_get_ai_metadata reads them
YES label put back
YES AI score and reason put back
YES text fields put back
YES test keywords taken off
YES the photo reads as before
YES Jim's answers 1-4: y, y, y, y
```

- **Run 1's three NOs are gone.** The first step read the label as "none" with no key missing; the smart collection (3610) reads `smart: true` in its own answer and in the delete's `before`, which now holds its rule (`labelColor == 1`); the label went back and the photo reads as before [handle: the run 2 file, `steps` 1 and 7, `put_back`]. The photo's label read "none" at the start, although run 1 left it red; how it was cleared between the runs is not recorded.
- **The new NO is the harness, not the tool.** `lr_rename_keyword` refused "Child" -> "Child renamed" with "a keyword AVG catalog check kw|child renamed is already there: a rename cannot merge keywords" [handle: the run 2 file, step 6]. Run 1 left that keyword in the catalog (the check takes its test keywords off the photo but deletes no keyword, by design: "Steps for Jim", "If something goes wrong"), and the harness uses the same names every run [handle: `engine\src\devtools\catalog-check.ts:78-80`]. So the plugin's clash check worked as written [handle: `plugin\LrC-AVG.lrplugin\KeywordEdit.lua:76-81`], and the case-insensitive match is Lightroom's [inference: `KeywordTree.findChild` found "child renamed" for "Child renamed"]. The rename and subtree removal themselves worked in run 1. Because the step stopped at the refusal, `lr_remove_keyword_subtree` did not run this time; the put-back still took the test keyword off the photo.
## Numbers

| Item | Value |
|---|---|
| Lightroom Classic version, plugin version | 15.6, plugin 1.5.0 |
| Steps YES / total | Run 1: 7 / 10. Run 2: 9 / 10 (the NO is the harness reusing run 1's keyword names) |
| `edited` true / false: the photo in exactly one | yes: `edited` true 70 (the photo among them), false 0 |
| Focal length 1 mm: count, or the error | 0, no error |
| Accessibility fields read (13.2+) | yes: `alt_text` read ("") |
| Put back | Run 1: AI score and reason YES, text fields YES, label **NO** (left red), reads as before **NO**. Run 2: all five YES |
| Jim's answers | Run 1: y, y, y, y. Run 2: y, y, y, y |

Run 1 from `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`; run 2 from `docs\reports\phase11\CATALOG-PARITY\run2\catalog_check_2026-10-28T04-15-41-490Z.json`.

## Verdict

**Go** after run 2, with no rerun: the one NO is the harness reusing run 1's keyword names, and the next code PR gives the test keywords a name per run [stated: Jim, 2026-10-27, "Go with recommendations"]. Run 1 was:

**Conditional** [stated: Jim, 2026-10-27, "Go with recommendations. 5. Agreed"]: on a rerun after the fix PR (unlabelled "gray" read as "none", `isSmartCollection()`, the first step's key test).

## Consequences / open questions

- Settled by run 1 [handle: `docs\reports\phase11\CATALOG-PARITY\run1\catalog_check_2026-10-28T02-32-41-166Z.json`]: `focalLength` works as a findPhotos criterion (0 found, no error); `hasAdjustments` with true/false splits the photos (70 / 0); the case-only rename works; the plugin's metadata fields show under "All Plug-in Metadata" (Jim, answer 4).
- **Open from run 1, closed by run 2:** Lightroom's "gray" for an unlabelled photo (now read as "none"); `isSmartCollection()` against `type()` (now `smart: true`); the first step's missing key (none missing); Jim's answer 2 against the file on the label (settled: the label was red).
- **Open from run 2:** the harness reuses fixed keyword names, so a second run in the same catalog meets run 1's "child renamed" and the rename is refused. Also learned: `lr_rename_keyword` refuses a rename onto an existing sibling, and that match ignores case [handle: the run 2 file, step 6; inference on the case].
- Was `[unverified]` before this run: every Lightroom-side behaviour above, in particular `focalLength` as a findPhotos criterion, `hasAdjustments` with `isTrue`/`isFalse`, `labelColor` with `"none"`, `getPhotos(true)` for a folder's subfolders (from issue #139), the case-only rename through a temporary name, `createSmartCollection` inside a collection set made in the same gate, and whether Edit > Undo takes a deleted collection back.
- Row 9 is its own commit, so it can be dropped alone: `Info.lua`'s new `LrMetadataProvider` (`MetadataDefinition.lua`) makes Lightroom update the plug-in metadata of the catalog when it loads the plugin `[unverified]`. Also `[unverified]`: whether a field without a title (`aiScore`, `aiReason`) stays hidden, whether "All Plug-in Metadata" is where the AVG fields show, whether the shipped plugin (`com.lrcavg.gateway`) and the development one (`com.lrcavg.gateway.dev`) keep separate values `[inference]`, and the accepted-session stamp in Lightroom (the check runs no session; `engine\tests\catalog-ai-metadata.test.ts` covers it against the simulator).
- README's user guide still says "No tool deletes a collection" and lists only title, caption and headline; the documentation child of #207 updates it with the parity table.
