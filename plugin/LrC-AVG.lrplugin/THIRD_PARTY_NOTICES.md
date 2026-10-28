# Third-party notices: LrC-AVG Lightroom plugin

Parts of this plugin are derived from **Automaat/lightroom-mcp** (https://github.com/Automaat/lightroom-mcp), commit `a160e7aa250b3264694d88e51418f7f512f417de`, vendored read-only in the repository at `vendor\automaat\`. The repo survey is `docs\AUTOMAAT_SURVEY.md`.

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `Json.lua` | `plugin/LightroomMCP.lrplugin/JSON.lua` | The encoder/decoder structure, the UTF-8 code-point and surrogate handling. Escaping, number output and error handling changed; see the file header. |
| `Bridge.lua` | `plugin/LightroomMCP.lrplugin/PluginInfoProvider.lua` (lines 87-127, 313-319, 384-589) | The dual `LrSocket` pattern: callbacks set flags and a monitor loop acts on them, the generation-guarded rebind of a socket, and the rebind of the send socket on a new receive-side client. The per-start token written to a file in the home folder and checked on every command. |
| `PluginInit.lua` | `plugin/LightroomMCP.lrplugin/PluginInit.lua` | Starting the server in its own function context from the init script. |
| `Preview.lua` | `plugin/LightroomMCP.lrplugin/HandlerExport.lua` (lines 71-104) | The `LrExportSession` settings for a JPEG in a chosen folder without a collision prompt, as spike S1 ran them (`plugin\spikes\S1.lrplugin\S1Run.lua`). |

From upstream commits after the snapshot (plugin 0.10.0, GitHub issue #60), rewritten, not copied; the commits are listed in `engine\THIRD_PARTY_NOTICES.md`:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `KeywordTree.lua`, `Library.lua` (`setKeywords`, `listKeywords`) | `KeywordTree.lua`, `HandlerKeywords.lua`, `HandlerOrganization.lua` at `11c0b93` | Keyword paths with `\|`, missing levels created one write gate per depth, case-aside matching, the sorted depth-first walk. |
| `Library.lua` (`setGps`) | `HandlerMetadata.lua` at `9ba2ed6` | `setRawMetadata("gps", { latitude, longitude })` in a write gate, with range checks. |
| `Sockets.lua` (`logBindFailure`) | `PluginInfoProvider.lua` at `923f27d` | The throttled log line for a socket that failed to open. |
| `Presets.lua` | `HandlerDevelop.lua` at `1040453` (preset handlers from `92b0b55`, the AI-mask note from `efce08f`) | Listing `developPresetFolders` and `getDevelopPresetsForPlugin` presets, a plain copy of `getSetting()`, `applyDevelopPreset` with `_PLUGIN` for a checkpoint and without `updateAISettings`, `addDevelopPresetForPlugin` refused over an existing name. |
| `Preview.lua` (`thumbnailPreview`, issue #216) | `HandlerPreview.lua` at `1040453` | `requestJpegThumbnail` held until its first callback, polled with `LrTasks.sleep`, within a 20 s wait. |

From upstream commit `05b7a39` (PR #288; GitHub issue #190, plugin 1.1.0), rewritten, not copied:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `Denoise.lua` | `HandlerDevelop.lua` at `05b7a39` (`apply_denoise`) | AI Denoise through `LrDevelopController` on the photo active in Develop, one photo per command, the amount read back. |

From upstream at `1040453` (2026-10-26; GitHub issue #214), rewritten, not copied:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `DevelopSession.lua` (used by `Denoise.lua`) | `DevelopSession.lua` | One photo at a time in Develop: select it alone, retried, through All Photographs when outside the source; the module, sources and selection put back. |
| `DevelopTools.lua` | `HandlerDevelop.lua` (`applyAutoAdjustments`, `resetDevelopAdjustments`, `setProcessVersion`) | Auto Tone / Auto WB with the settle wait (2 s, 1 s still, 8 s), Reset, `getProcessVersion`/`setProcessVersion` with "Version N" and the masked-downgrade refusal. |
| `Snapshots.lua` | `HandlerSnapshots.lua` | Listing, applying in Develop and deleting snapshots by id, with the deletion read back. |
| `Copies.lua` | `HandlerVirtualCopies.lua` | One virtual copy per photo with an optional name, the selection and source put back. |

From upstream commit `1040453` (plugin 1.5.0, GitHub issue #218), rewritten, not copied:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `CollectionEdit.lua` | `HandlerCollections.lua` (`createSmartCollection`, `deleteCollection`, `getCollectionPhotos`) | A smart collection from a search descriptor; deleting a collection in a write gate; a smart collection's `getPhotos` outside the read gate (also in `Library.lua`, `Transfer.lua`). |
| `Folders.lua` | `HandlerFolders.lua` (`listFolders`) | The depth-first folder walk from `getFolders` with each folder's own photo count. |
| `KeywordEdit.lua` | `HandlerKeywords.lua` (`renameKeyword`), `HandlerOrganization.lua` (`removeKeywordSubtree`) | Rename by `setAttributes({ keywordName })`, the sibling clash check, the case-only rename through a temporary name; the subtree's photos for a catalog-wide removal. |
| `MetadataDefinition.lua`, `PluginMetadata.lua` | `AiMetadataDefinition.lua`, `HandlerAiMetadata.lua` | The private fields `aiScore` and `aiReason` (schema version 1) and writing them with `setPropertyForPlugin`, nil to clear. |
| `Metadata.lua` (`setIptc`, `setColorLabel`) | `HandlerMetadata.lua` (`setMetadata`, `setLocation`), `HandlerOrganization.lua` (`setColorLabel`) | The creator, copyright, location and accessibility keys, the 13.2 accessibility gate, `colorNameForLabel`. |

From upstream at `1040453` (plugin 1.6.0, GitHub issue #217), rewritten, not copied; the commits are listed in `engine\THIRD_PARTY_NOTICES.md`:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `MaskClean.lua` | `HandlerMaskDelete.lua` (`deleteEmptyMasks`) | `catalog:deleteAllEmptyMasks` with the photos always passed, in a write gate, checked to exist first. |
| `MaskControl.lua` | `MaskSelection.lua`, `HandlerMaskCurves.lua`, `MaskCurves.lua`, `MaskSettle.lua` (commit `581ad7c`, #328) | Selecting a mask by id in Develop (listed by `getAllMasks`, Masking opened, `selectMask` again each second until it reads selected, the mask before put back); a local curve set with `setValue` and confirmed by `getValue` within 1, tried twice, every curve put back on a failure, `stopTracking(true)`, the wait for the photo's settings to change. Here the names and values come from the engine. |
| `MaskSwatches.lua` | `HandlerMaskPointColors.lua`, `MaskPointColors.lua` (commit `581ad7c`, #328) | Point Color add, update, delete and clear through the `*PointColorSwatch` calls with `isForMasking`, each confirmed by `getValue("local_PointColors")` within 0.01, a swatch Lightroom did not keep deleted again or put back. Here the field names come from the engine. |

From upstream at `1040453` (decisions D1-D3 of GitHub epic #207; issues #214, #218), rewritten, not copied:

| File in this plugin | Derived from | What was taken |
|---|---|---|
| `DevelopTools.lua` (`setSettings`, `undoLastStep`) | `HandlerDevelop.lua` (`setDevelopSettings`), `HandlerUndo.lua` (`undoLastStep`) | Writing Develop settings by SDK key; one `LrUndo.undo()` behind `confirm`, answering `undone` and `can_undo`. |
| `Remove.lua` | `HandlerRemoveFromCatalog.lua` (`removePhotos`, PR #424) | `LrSelection.removeFromCatalog` behind `confirm` and the 14.3 check, 100 photos at most, a master refused without all its virtual copies, the Library grid on All Photographs, the selection read back as exactly the photos before and the removal waited for after, the surviving selection put back. |

The engine's derived files are listed in `engine\THIRD_PARTY_NOTICES.md`.

## Automaat/lightroom-mcp licence

```
MIT License

Copyright (c) 2026 Marcin Skalski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
