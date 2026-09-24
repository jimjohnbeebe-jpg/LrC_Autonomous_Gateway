-- AVG-S5 write test: applyDevelopSettings { CameraProfile = <string Jim types>,
-- EnableLensCorrections = true } on the target photo, then read back.
-- Result -> <temp>\LrC-AVG\s5_writetest_<filename>.json with before / requested / after
-- for CameraProfile, EnableLensCorrections and LensProfileEnable, plus every key that changed.
-- Undo: History panel ("AVG S5 write test") or Ctrl+Z.

local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrView = import 'LrView'

local S5 = require 'S5Common'

local WATCHED = { "CameraProfile", "EnableLensCorrections", "LensProfileEnable" }

LrFunctionContext.postAsyncTaskWithContext("AVG S5 write test", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then
        LrDialogs.message("AVG S5", "Select one photo first (it becomes the target).", "warning")
        return
    end

    local before, meta = S5.snapshot(catalog, photo)

    local props = LrBinding.makePropertyTable(context)
    props.profile = tostring(before.CameraProfile or "")
    local f = LrView.osFactory()
    local choice = LrDialogs.presentModalDialog {
        title = "AVG S5 - write test",
        actionVerb = "Apply",
        contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),
            f:static_text { title = "Photo: " .. tostring(meta.filename) },
            f:static_text { title = "Current CameraProfile: " .. tostring(before.CameraProfile) },
            f:static_text { title = "Current EnableLensCorrections: " .. tostring(before.EnableLensCorrections) ..
                "   LensProfileEnable: " .. tostring(before.LensProfileEnable) },
            f:static_text { title = "CameraProfile to write (paste a DIFFERENT string from s5_profiles.log):" },
            f:edit_field { value = LrView.bind("profile"), width_in_chars = 48 },
            f:static_text { title = "Will apply: { CameraProfile = <above>, EnableLensCorrections = true }" },
        },
    }
    if choice ~= "ok" then return end

    local requested = { CameraProfile = props.profile, EnableLensCorrections = true }
    catalog:withWriteAccessDo("AVG S5 write test", function()
        photo:applyDevelopSettings(requested, "AVG S5 write test")
    end)
    local after = S5.snapshot(catalog, photo)

    local watched = {}
    local lines = {}
    for _, key in ipairs(WATCHED) do
        watched[key] = { before = before[key], requested = requested[key], after = after[key] }
        table.insert(lines, string.format("%s: %s -> %s (requested %s)",
            key, tostring(before[key]), tostring(after[key]), tostring(requested[key])))
    end
    local changes = S5.diff(before, after)
    local changedKeys = {}
    for k in pairs(changes) do table.insert(changedKeys, k) end
    table.sort(changedKeys)

    local path = LrPathUtils.child(S5.outDir(), "s5_writetest_" .. S5.safeName(meta.filename) .. ".json")
    S5.writeJson(path, { meta = meta, requested = requested, watched = watched, changed_keys = changes })

    LrDialogs.message("AVG S5 write test",
        table.concat(lines, "\n") ..
        "\n\nKeys that changed (" .. #changedKeys .. "): " .. table.concat(changedKeys, ", ") ..
        "\n\nResult: " .. path .. "\nUndo via the History panel if wanted.", "info")
end)
