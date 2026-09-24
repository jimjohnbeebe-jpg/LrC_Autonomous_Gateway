-- AVG-S5 dump: getDevelopSettings() of the target photo -> <temp>\LrC-AVG\s5_<filename>.json
-- and one line appended to s5_profiles.log (so repeated dumps after changing the camera
-- profile by hand keep every CameraProfile string even though the JSON is overwritten).

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'

local S5 = require 'S5Common'

LrFunctionContext.postAsyncTaskWithContext("AVG S5 dump", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto() -- outside the read gate (yields; Automaat HandlerSelection.lua:30-38)
    if not photo then
        LrDialogs.message("AVG S5", "Select one photo first (it becomes the target).", "warning")
        return
    end

    local settings, meta = S5.snapshot(catalog, photo)
    local dir = S5.outDir()
    local stem = S5.safeName(meta.filename)
    if meta.is_virtual_copy and meta.copy_name then
        stem = stem .. "__" .. S5.safeName(meta.copy_name)
    end
    local jsonPath = LrPathUtils.child(dir, "s5_" .. stem .. ".json")
    S5.writeJson(jsonPath, { meta = meta, settings = settings })

    -- Every key whose name contains "Profile" (no key names assumed beyond CameraProfile).
    local profileFields = {}
    for k, v in pairs(settings) do
        local name = tostring(k)
        if name:find("Profile", 1, true) and type(v) ~= "table" then
            table.insert(profileFields, name .. "=" .. tostring(v))
        end
    end
    table.sort(profileFields)
    local profileLine = table.concat({
        meta.captured_at,
        tostring(meta.filename),
        "ProcessVersion=" .. tostring(settings.ProcessVersion),
        "keys=" .. tostring(meta.key_count),
        table.concat(profileFields, "\t"),
    }, "\t")
    local profilesPath = LrPathUtils.child(dir, "s5_profiles.log")
    S5.writeText(profilesPath, profileLine .. "\n", "ab")

    LrDialogs.message("AVG S5 dump written",
        string.format("%d keys from %s\nCameraProfile = %s\nProcessVersion = %s\n\nJSON: %s\nProfile log: %s",
            meta.key_count, tostring(meta.filename), tostring(settings.CameraProfile),
            tostring(settings.ProcessVersion), jsonPath, profilesPath), "info")
end)
