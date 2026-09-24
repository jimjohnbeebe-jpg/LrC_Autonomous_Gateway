# 03 — Lightroom (Lua plugin and anything that names SDK keys)

**Read `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LR_SDK_NOTES.md` before touching Lua.** Also relevant: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\ARCHITECTURE.md` §1–3, 5, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PRD.md` §6.4 and NFR-1, and `docs\AUTOMAAT_SURVEY.md` §4 for patterns that are proven in Automaat.

## Tasks and catalog access

- Every catalog write runs inside `catalog:withWriteAccessDo(name, fn)`, called from an async task (`LrTasks.startAsyncTask` or `LrFunctionContext.postAsyncTaskWithContext`), never from a UI callback directly.
- `photo:getDevelopSettings()` must run in a task (LR_SDK_NOTES, LrPhoto). Read develop settings inside `catalog:withReadAccessDo` (the Automaat pattern, `vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerMetadata.lua:55-72`).
- **Keep yielding catalog queries outside the read gate** (`getTargetPhoto(s)`, `findPhotos`, `setSelectedPhotos`). Nesting them inside it deadlocks on Windows [upstream claim: `HandlerSelection.lua:30-38`, `HandlerSearch.lua:102-114`].
- In batch operations, call `LrTasks.yield()` between photos (PRD NFR-1). Automaat does not; we do.
- Every `applyDevelopSettings` call passes a History name: `AVG <session_short_id> pass n/N` (PRD FR-4.4); spikes use `AVG S<n>`.
- Hold the object returned by `requestJpegThumbnail` until its callback fires (LR_SDK_NOTES).
- `LrSocket` `onMessage` runs in a non-yielding context: hand work off with `LrTasks.startAsyncTask`. Set reconnect flags in callbacks and act on them from a monitor loop, never call `:reconnect()` inside `onError` [upstream claim: `PluginInfoProvider.lua:419-426, 511-545`].
- Use `LrTasks.pcall` (not `xpcall`/`debug.traceback`) in task code [upstream claim: `PluginInfoProvider.lua:272-275`].
- Never open a blocking modal from bridge code paths. Exports use a non-`ask` `LR_collisionHandling` [upstream claim: `HandlerExport.lua:11-21`].

## SDK key names

- **The canonical parameter map (`engine\src\params\`) is the only path from canonical names (`exposure`, `hsl.orange.sat`, …) to SDK keys.** No other module writes an SDK key string.
- **The only source of SDK key names is a live `getDevelopSettings()` dump** (spike S5 → `spikes\S5\pin.ts` → `engine\src\params\sdk-keys.lrc15.json`). **Never copy key names from documentation, the lrc.mcor.dev pages, forum posts or other projects, Automaat's allowlist included.** The SDK docs contain typos such as `HueAdjustmentMagenha` (LR_SDK_NOTES).
- Reject unknown or out-of-range keys; never guess (PRD FR-4.2). `SdkKeyMap.get()` throws `UnknownSdkKeyError`.
- Legacy process versions are refused, not mapped (ARCHITECTURE §5).

## Plugin hygiene

- Plugin state that must survive re-execution of a module body lives on `_G` (Automaat pattern, `PluginInfoProvider.lua:46-76`).
- Each `.lrplugin` can only `require` files inside its own folder.
- Logs and temp output go under `LrPathUtils.getStandardFilePath("temp")\LrC-AVG\` (dev) or the configured log folder; never next to the originals. No pixel baking, no writes to original files (PRD §3).
