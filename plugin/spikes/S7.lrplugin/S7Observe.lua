-- AVG-S7 menu items 2 and 3: what Lightroom knows about the three presets BEFORE and AFTER a
-- restart, and what Jim saw in the Develop Presets panel (tick boxes, rule 04 "Steps for Jim").
-- After the restart it also applies each preset it can find to the "AVG S7 unselected" copy and
-- compares the result with the preset's own settings, then selects the two S7 copies for removal
-- (the S6 pattern: it reads the selection back and says whether removing is safe).
-- Saves s7_before_<time>.json / s7_after_<time>.json.

local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Common = require 'S7Common'
local S7Photos = require 'S7Photos'
local S7Presets = require 'S7Presets'

local S7Observe = {}

local NAMES = { S7Presets.REFERENCE, S7Presets.PLUGIN, S7Presets.XMP }

local function lookups(index, state)
    local out = { by_name = {}, by_uuid = {} }
    for _, name in ipairs(NAMES) do
        local hit = index[name]
        out.by_name[name] = hit and hit.where or false
    end
    for _, key in ipairs({ "reference_uuid", "plugin_preset_uuid", "xmp_uuid" }) do
        local uuid = state[key]
        if uuid and uuid ~= "" then
            local ok, preset = LrTasks.pcall(function() return LrApplication.developPresetByUuid(uuid) end)
            if ok then out.by_uuid[key] = (preset ~= nil) else out.by_uuid[key] = "error: " .. tostring(preset) end
        end
    end
    return out
end

local function ask(context, when)
    local props = LrBinding.makePropertyTable(context)
    props.reference, props.plugin, props.xmp = false, false, false
    local f = LrView.osFactory()
    local choice = LrDialogs.presentModalDialog {
        title = "AVG S7 - the Presets panel, " .. (when == "before" and "BEFORE" or "AFTER") .. " the restart",
        actionVerb = "Save",
        contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),
            f:static_text { title = "In Develop > Presets, which of these names did you see?" },
            f:checkbox { title = S7Presets.REFERENCE, value = LrView.bind("reference") },
            f:checkbox { title = S7Presets.PLUGIN, value = LrView.bind("plugin") },
            f:checkbox { title = S7Presets.XMP, value = LrView.bind("xmp") },
            f:static_text { title = "Leave a name unticked if you did not see it.\nNot sure? Click Cancel, look again, and run this menu item again." },
        },
    }
    if choice ~= "ok" then return { answered = false } end
    return { answered = true, saw_reference = props.reference == true, saw_plugin = props.plugin == true, saw_xmp = props.xmp == true }
end

-- The copy from the state file, checked by its name (P-18). Returns the photo or nil and why.
local function copyFromState(catalog, uuid, name)
    local photo, err = Common.findByUuid(catalog, uuid)
    if not photo then return nil, err end
    if Common.describePhoto(catalog, photo).copy_name ~= name then return nil, "the photo with that uuid is not \"" .. name .. "\"" end
    return photo
end

local function applyOne(catalog, copy, hit, isPluginPreset, historyName)
    if not hit then return { listed = false } end
    local ok, err = S7Presets.apply(catalog, copy, hit.preset, isPluginPreset, historyName)
    local out = { listed = true, applied = ok, error = (not ok) and tostring(err) or nil }
    local _, settings = S7Presets.describe(hit.preset)
    if ok and settings then
        out.differences, out.compared, out.skipped = S7Presets.compare(settings, Common.settings(catalog, copy))
    end
    return out
end

local function applyAll(catalog, state, index)
    local copy, err = copyFromState(catalog, state.unselected_copy_uuid, S7Photos.UNSELECTED_COPY)
    if not copy then return { error = err } end
    local out = {
        plugin = applyOne(catalog, copy, index[S7Presets.PLUGIN], true, "AVG S7 apply plugin preset"),
        xmp = applyOne(catalog, copy, index[S7Presets.XMP], false, "AVG S7 apply xmp preset"),
    }
    local ref, xmp = index[S7Presets.REFERENCE], index[S7Presets.XMP]
    if ref and xmp then
        local _, refSettings = S7Presets.describe(ref.preset)
        local _, xmpSettings = S7Presets.describe(xmp.preset)
        if refSettings and xmpSettings then
            out.xmp_vs_reference = {}
            out.xmp_vs_reference.differences, out.xmp_vs_reference.compared = S7Presets.compare(refSettings, xmpSettings)
        end
    end
    return out
end

-- Leave exactly the S7 copies selected (S6 pattern), read the selection back.
local function selectCopies(catalog, state)
    local copies, out = {}, { selected_for_removal = false, count = 0, missing = {} }
    for _, spec in ipairs({ { state.crop_copy_uuid, S7Photos.CROP_COPY }, { state.unselected_copy_uuid, S7Photos.UNSELECTED_COPY } }) do
        local photo, err = copyFromState(catalog, spec[1], spec[2])
        if photo then table.insert(copies, photo) else table.insert(out.missing, spec[2] .. ": " .. tostring(err)) end
    end
    if #copies == 0 then return out end
    local ok, err = LrTasks.pcall(function() catalog:setSelectedPhotos(copies[1], copies) end)
    if not ok then out.error = tostring(err) end
    local want = {}
    for _, p in ipairs(copies) do want[p.localIdentifier] = true end
    local sel = Common.selection(catalog)
    local exact = #sel.selected_local_ids == #copies
    for _, id in ipairs(sel.selected_local_ids) do
        if not want[id] then exact = false end
    end
    out.selection = sel
    out.count = #copies
    out.selected_for_removal = ok and exact
    return out
end

local function yesNo(v) return v and "YES" or "NO" end

local function message(result, when)
    local f = result.found.by_name
    local lines = {
        "Your answers: " .. (result.jim.answered and "SAVED" or "NOT ANSWERED - look again and run this menu item again"),
        "Lightroom lists: reference " .. yesNo(f[S7Presets.REFERENCE]) .. ", plugin " .. yesNo(f[S7Presets.PLUGIN]) .. ", xmp " .. yesNo(f[S7Presets.XMP]),
    }
    if when == "before" then
        table.insert(lines, "\nNext: quit Lightroom (File > Exit), start it again, then follow the README.")
        return table.concat(lines, "\n")
    end
    local c = result.cleanup
    if c.selected_for_removal then
        table.insert(lines, "\nThe " .. c.count .. " S7 copies (and nothing else) are now selected. To remove them: Photo > Remove Photos... > Remove.")
    elseif (c.count or 0) == 0 then
        table.insert(lines, "\nNo S7 copies were found, so there is nothing to remove.")
    else
        table.insert(lines, "\nCOULD NOT SELECT the S7 copies. Don't remove anything - tell Claude Code.")
    end
    table.insert(lines, "Then delete the AVG S7 presets as the README says, and tell Claude Code \"S7 done\".")
    return table.concat(lines, "\n")
end

-- when: "before" (menu item 2) or "after" (menu item 3).
function S7Observe.run(when)
    LrFunctionContext.postAsyncTaskWithContext("AVG S7 presets " .. when, function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local catalog = LrApplication.activeCatalog()
        local state = Common.loadState()
        if not state then
            LrDialogs.message("AVG S7 - nothing to check yet", "Run \"AVG S7 - 1\" first.", "warning")
            return
        end
        local result = { spike = "S7", step = when == "before" and "2-before-restart" or "3-after-restart",
            run_at = Common.localTime(), lr_version = LrApplication.versionString(), state = state }
        local listing, index = S7Presets.list()
        result.presets, result.found = listing, lookups(index, state)
        result.jim = ask(context, when)
        if when == "after" then
            result.apply = applyAll(catalog, state, index)
            result.cleanup = selectCopies(catalog, state)
        end
        local ok, err = Common.save(when == "before" and "s7_before" or "s7_after", result)
        LrDialogs.message("AVG S7 - presets " .. (when == "before" and "BEFORE" or "AFTER") .. " the restart",
            message(result, when) .. "\n\n" .. Common.saveLine(ok, err), (ok and result.jim.answered) and "info" or "warning")
    end)
end

return S7Observe
