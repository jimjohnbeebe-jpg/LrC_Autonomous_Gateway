-- AVG-S5 write test B: applyDevelopSettings { LensProfileEnable = 1 }, read back.
-- Why: Automaat allowlists "LensProfileEnable" (vendor\automaat\server\src\tool-contracts.ts:81)
-- while LR_SDK_NOTES and the directive use "EnableLensCorrections"; both may exist with
-- different meanings [unverified]. This isolates the second key.
-- Result -> <temp>\LrC-AVG\s5_writetestB_<filename>.json. Undo via History ("AVG S5 write test B").

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'

local S5 = require 'S5Common'

LrFunctionContext.postAsyncTaskWithContext("AVG S5 write test B", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then
        LrDialogs.message("AVG S5", "Select one photo first (it becomes the target).", "warning")
        return
    end

    local before, meta = S5.snapshot(catalog, photo)
    local requested = { LensProfileEnable = 1 }
    catalog:withWriteAccessDo("AVG S5 write test B", function()
        photo:applyDevelopSettings(requested, "AVG S5 write test B")
    end)
    local after = S5.snapshot(catalog, photo)

    local changes = S5.diff(before, after)
    local changedKeys = {}
    for k in pairs(changes) do table.insert(changedKeys, k) end
    table.sort(changedKeys)

    local path = LrPathUtils.child(S5.outDir(), "s5_writetestB_" .. S5.safeName(meta.filename) .. ".json")
    S5.writeJson(path, { meta = meta, requested = requested, changed_keys = changes })

    LrDialogs.message("AVG S5 write test B",
        string.format("LensProfileEnable: %s -> %s\nEnableLensCorrections: %s -> %s\n\nKeys that changed (%d): %s\n\nResult: %s",
            tostring(before.LensProfileEnable), tostring(after.LensProfileEnable),
            tostring(before.EnableLensCorrections), tostring(after.EnableLensCorrections),
            #changedKeys, table.concat(changedKeys, ", "), path), "info")
end)
