-- AVG-S7 item 1: two ways to make a Develop preset, for lr_create_preset_from_active (PRD 6.11, OQ-3).
-- (Each run's two presets are named "AVG S7 plugin <run date-time>" and "AVG S7 xmp <run date-time>", Presets.names.)
--   "AVG S7 plugin": LrApplication.addDevelopPresetForPlugin, which "adds a preset hidden within a
--     plug-in ... stored in a special folder called 'Plugin Develop Presets'" [handle:
--     https://lrc.mcor.dev/modules/LrApplication.html]. Automaat marks such presets not visible in
--     Develop [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerDevelop.lua:600].
--   "AVG S7 xmp": a preset file written next to "AVG S7 reference", a preset Jim made by hand in
--     Lightroom first; the file is Lightroom's own with a new name and uuid, so neither the file
--     format nor the folder is guessed [stated: Jim, 2026-09-27, chose this option].
-- Preset calls (developPresetFolders, getDevelopPresets, getName/getUuid/getFile/getSetting/getParent,
-- getDevelopPresetsForPlugin, applyDevelopPreset) are on the lrc.mcor.dev LrApplication,
-- LrDevelopPresetFolder, LrDevelopPreset and LrPhoto pages [handle, read 2026-09-27].

local LrApplication = import 'LrApplication'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Common = require 'S7Common'

local Presets = {}

Presets.REFERENCE = "AVG S7 reference"
-- Key names from engine\src\params\sdk-keys.lrc15.json; values inside canonical.ts's ranges.
Presets.PLUGIN_VALUES = { Exposure2012 = 0.35, Vibrance = 17 }

-- The two presets a run makes carry the run's date and time, so a second run never replaces or shadows the
-- first run's presets (Greptile, PR #29), and every lookup is by the names in the state file.
function Presets.names(tag)
    return { plugin = "AVG S7 plugin " .. tag, xmp = "AVG S7 xmp " .. tag }
end

-- obj:method(), or "error: ..." when Lightroom refuses it.
local function call(obj, method)
    local ok, v = LrTasks.pcall(function() return obj[method](obj) end)
    if ok then return v end
    return "error: " .. tostring(v)
end

-- Returns the record and the preset's settings table (or nil).
function Presets.describe(preset)
    local d = { name = call(preset, "getName"), uuid = call(preset, "getUuid"), file = call(preset, "getFile") }
    local parent = call(preset, "getParent")
    if parent ~= nil and type(parent) ~= "string" then d.parent = call(parent, "getName") else d.parent = parent end
    local settings = call(preset, "getSetting")
    if type(settings) ~= "table" then
        d.settings_error = tostring(settings)
        return d, nil
    end
    local n = 0
    for _ in pairs(settings) do n = n + 1 end
    d.setting_count = n
    d.settings_sample = Common.pick(settings, { "Exposure2012", "Vibrance" })
    return d, settings
end

local function isOurs(name)
    return type(name) == "string" and name:find("AVG S7", 1, true) == 1
end

-- Every preset folder (name, path, how many presets) with its "AVG S7 ..." presets, and the
-- plugin's presets. Other presets' names are not recorded. Returns the record and name -> hit.
function Presets.list()
    local out, index = { folders = {}, plugin_presets = {} }, {}
    local ok, err = LrTasks.pcall(function()
        for _, folder in ipairs(LrApplication.developPresetFolders()) do
            local f = { name = call(folder, "getName"), path = call(folder, "getPath"), count = 0, avg_s7 = {} }
            for _, preset in ipairs(folder:getDevelopPresets()) do
                f.count = f.count + 1
                local name = call(preset, "getName")
                if isOurs(name) then
                    table.insert(f.avg_s7, (Presets.describe(preset)))
                    index[name] = index[name] or { preset = preset, where = f.name }
                end
            end
            table.insert(out.folders, f)
        end
    end)
    if not ok then out.folders_error = tostring(err) end
    local okP, errP = LrTasks.pcall(function()
        for _, preset in ipairs(LrApplication.getDevelopPresetsForPlugin(_PLUGIN) or {}) do
            local d = Presets.describe(preset)
            table.insert(out.plugin_presets, d)
            if isOurs(d.name) then index[d.name] = index[d.name] or { preset = preset, where = "getDevelopPresetsForPlugin" } end
        end
    end)
    if not okP then out.plugin_presets_error = tostring(errP) end
    return out, index
end

-- Whether it needs a write gate is not documented: first without one (Automaat calls it outside
-- any gate [upstream claim: HandlerDevelop.lua:593]), then inside one. Returns the preset or nil.
function Presets.createPluginPreset(catalog, name, out)
    local ok, preset = LrTasks.pcall(function()
        return LrApplication.addDevelopPresetForPlugin(_PLUGIN, name, Presets.PLUGIN_VALUES)
    end)
    out.how = "outside write gate"
    if not ok then
        out.outside_gate_error = tostring(preset)
        local created
        ok, preset = LrTasks.pcall(function()
            catalog:withWriteAccessDo("AVG S7 plugin preset", function()
                created = LrApplication.addDevelopPresetForPlugin(_PLUGIN, name, Presets.PLUGIN_VALUES)
            end)
        end)
        out.how = "inside withWriteAccessDo"
        if ok then preset = created else out.error = tostring(preset) preset = nil end
    end
    if preset == nil and not out.error then out.error = "addDevelopPresetForPlugin returned nil" end
    if preset ~= nil then out.preset = (Presets.describe(preset)) end
    return preset
end

-- Plain-text replace (no Lua patterns). Returns the new text and the count.
local function replaceAll(text, old, new)
    local escaped = old:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")
    return text:gsub(escaped, (new:gsub("%%", "%%%%")))
end

-- The preset's uuid as its own file writes it: the one crs:UUID attribute. It is not the uuid the SDK
-- reports: in S7 run 1, getUuid() gave 221C89F4724E30813B7A73553BD53357 for "AVG S7 reference" while
-- its file says crs:UUID="94B7E167ED8FC14591B3B0CF685F6019", so run 1 wrote no file [handle:
-- %TEMP%\LrC-AVG\S7\s7_run_2026-09-27T11-22-33.json presets.xmp, and line 7 of the reference file].
-- Returns the file's uuid and a new one in the same form (hex digits, same length and case), or nil
-- and why.
local function fileUuid(text)
    local count = select(2, text:gsub('crs:UUID="', ""))
    if count ~= 1 then return nil, nil, "the reference file has " .. count .. " crs:UUID attributes, not 1" end
    local old = text:match('crs:UUID="(%x+)"')
    if not old then return nil, nil, "the reference file's crs:UUID is not hexadecimal" end
    local new = (LrUUID.generateUUID():gsub("-", ""))
    if old == old:upper() then new = new:upper() else new = new:lower() end
    if #new ~= #old or not new:match("^%x+$") then return nil, nil, "LrUUID.generateUUID gave " .. new .. ", not the file's form" end
    return old, new
end

-- Write the preset file `name` next to the reference's file, never over an existing file: the
-- reference's text with a new crs:UUID and name. Returns the path and the new uuid, or nil.
function Presets.writeXmp(refPreset, name, out)
    local file = call(refPreset, "getFile")
    out.reference_file = file
    out.reference_uuid = call(refPreset, "getUuid") -- the SDK's uuid, recorded, not used
    if type(file) ~= "string" or LrFileUtils.exists(file) ~= "file" then out.error = "the reference preset has no file" return nil end
    local text = Common.readFile(file)
    if not text then out.error = "could not read " .. file return nil end
    local old, new, why = fileUuid(text)
    if not old then out.error = why return nil end
    out.reference_file_uuid = old
    out.sdk_uuid_is_file_uuid = type(out.reference_uuid) == "string" and (out.reference_uuid:gsub("-", "")):upper() == old:upper()
    local renamed, nUuid = replaceAll(text, 'crs:UUID="' .. old .. '"', 'crs:UUID="' .. new .. '"')
    local final, nName = replaceAll(renamed, Presets.REFERENCE, name)
    out.uuid, out.uuid_replacements, out.name_replacements = new, nUuid, nName
    if nName < 1 then out.error = "the reference file does not contain its name as text" return nil end
    local path = LrPathUtils.child(LrPathUtils.parent(file), name .. "." .. LrPathUtils.extension(file))
    if LrFileUtils.exists(path) then out.error = "a file is already there: " .. path return nil end
    local fh, openErr = io.open(path, "wb")
    if not fh then out.error = "could not write " .. path .. ": " .. tostring(openErr) return nil end
    fh:write(final)
    fh:close()
    out.path, out.bytes = path, #final
    return path, new
end

-- applyDevelopPreset must run inside a write gate [handle: https://lrc.mcor.dev/modules/LrPhoto.html];
-- a plugin preset is applied with _PLUGIN (Automaat, HandlerDevelop.lua:677). Returns ok, err.
function Presets.apply(catalog, photo, preset, isPluginPreset, historyName)
    return LrTasks.pcall(function()
        catalog:withWriteAccessDo(historyName, function()
            if isPluginPreset then photo:applyDevelopPreset(preset, _PLUGIN) else photo:applyDevelopPreset(preset) end
        end)
    end)
end

-- Keys of `expected` whose value differs in `actual` (numbers within 0.001). Table values (curves,
-- looks) are skipped and counted. Returns the differing keys, how many were compared, how many skipped.
function Presets.compare(expected, actual)
    local diffs, compared, skipped = {}, 0, 0
    for k, v in pairs(expected) do
        if type(v) == "table" then
            skipped = skipped + 1
        else
            compared = compared + 1
            if not (v == actual[k] or Common.near(v, actual[k])) then table.insert(diffs, tostring(k)) end
        end
    end
    table.sort(diffs)
    return diffs, compared, skipped
end

return Presets
