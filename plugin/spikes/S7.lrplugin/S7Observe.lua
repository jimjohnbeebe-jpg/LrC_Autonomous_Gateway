-- AVG-S7 menu items 2 and 3: what Lightroom knows about the three presets BEFORE and AFTER a
-- restart, and what Jim saw in the Develop Presets panel (tick boxes, rule 04 "Steps for Jim").
-- After the restart it also applies each preset it can find to the "AVG S7 unselected" copy and
-- compares the result with the preset's own settings, then selects the two S7 copies for removal
-- (the S6 pattern: it reads the selection back and says whether removing is safe).
-- Saves s7_before_<time>.json / s7_after_<time>.json.
-- Menu items 5 and 6 do the same for the preset-file re-run (item 4) with two presets, the reference
-- and the file, and no copies: instead they compare the file preset's settings with the reference's
-- and check the file on disk. They save s7_xmp_before_<time>.json / s7_xmp_after_<time>.json.

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

-- run: after menu item 1. xmp: after the preset-file re-run, menu item 4.
local KINDS = {
    run = { state_file = Common.STATE_FILE, prefix = "s7_", first = "AVG S7 - 1", plugin = true, copies = true, done = "S7 done" },
    xmp = { state_file = Common.XMP_STATE_FILE, prefix = "s7_xmp_", first = "AVG S7 - 4", plugin = false, copies = false, done = "S7 re-run done" },
}

-- The presets by role, with the names the run gave its presets (the state file). uuid_kind says
-- which uuid was recorded: the SDK's (getUuid) or the one written in the preset file.
local function roles(kind, state)
    local all = {
        { role = "reference", name = S7Presets.REFERENCE, uuid_key = "reference_uuid", uuid_kind = "sdk" },
        { role = "plugin", name = state.plugin_name or "", uuid_key = "plugin_preset_uuid", uuid_kind = "sdk" },
        { role = "xmp", name = state.xmp_name or "", uuid_key = "xmp_uuid", uuid_kind = "file" },
    }
    local out = {}
    for _, r in ipairs(all) do
        if r.role ~= "plugin" or kind.plugin then table.insert(out, r) end
    end
    return out
end

-- For each role: the preset's name, the group Lightroom lists it in (or false), and whether
-- developPresetByUuid finds it by the uuid the run recorded.
local function lookups(index, kind, state)
    local out = {}
    for _, r in ipairs(roles(kind, state)) do
        local hit = index[r.name]
        local entry = { name = r.name, listed_in = hit and hit.where or false, uuid_kind = r.uuid_kind }
        local uuid = state[r.uuid_key]
        if uuid and uuid ~= "" then
            local ok, preset = LrTasks.pcall(function() return LrApplication.developPresetByUuid(uuid) end)
            if ok then entry.found_by_uuid = (preset ~= nil) else entry.found_by_uuid = "error: " .. tostring(preset) end
        end
        out[r.role] = entry
    end
    return out
end

-- One tick box per role; the answers are saved as saw_<role>.
local function ask(context, when, kind, state)
    local rs = roles(kind, state)
    local props = LrBinding.makePropertyTable(context)
    local f = LrView.osFactory()
    local column = { bind_to_object = props, spacing = f:control_spacing(),
        f:static_text { title = "In Develop > Presets, which of these names did you see?" } }
    for _, r in ipairs(rs) do
        props[r.role] = false
        table.insert(column, f:checkbox { title = r.name, value = LrView.bind(r.role) })
    end
    table.insert(column, f:static_text { title = "Leave a name unticked if you did not see it.\nNot sure? Click Cancel, look again, and run this menu item again." })
    local choice = LrDialogs.presentModalDialog {
        title = "AVG S7 - the Presets panel, " .. (when == "before" and "BEFORE" or "AFTER") .. " the restart",
        actionVerb = "Save",
        contents = f:column(column),
    }
    if choice ~= "ok" then return { answered = false } end
    local out = { answered = true }
    for _, r in ipairs(rs) do out["saw_" .. r.role] = props[r.role] == true end
    return out
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

-- The file preset's settings as Lightroom read them, against the reference's (the file is a copy of
-- the reference's with a new name and uuid). nil when either is not listed.
local function versusReference(index, state)
    local ref, xmp = index[S7Presets.REFERENCE], index[state.xmp_name]
    if not (ref and xmp) then return nil end
    local _, refSettings = S7Presets.describe(ref.preset)
    local _, xmpSettings = S7Presets.describe(xmp.preset)
    if not (refSettings and xmpSettings) then return nil end
    local out = {}
    out.differences, out.compared, out.skipped = S7Presets.compare(refSettings, xmpSettings)
    return out
end

local function applyAll(catalog, state, index)
    local copy, err = copyFromState(catalog, state.unselected_copy_uuid, S7Photos.UNSELECTED_COPY)
    if not copy then return { error = err } end
    return {
        plugin = applyOne(catalog, copy, index[state.plugin_name], true, "AVG S7 apply plugin preset"),
        xmp = applyOne(catalog, copy, index[state.xmp_name], false, "AVG S7 apply xmp preset"),
        xmp_vs_reference = versusReference(index, state),
    }
end

-- The preset file on disk now: still there, as many bytes as written, and still carrying the uuid it
-- was written with (so whether Lightroom rewrote it).
local function onDisk(state)
    if not state.xmp_path or state.xmp_path == "" then return { exists = false, note = "no file was written" } end
    local text = Common.readFile(state.xmp_path)
    if not text then return { exists = false } end
    return { exists = true, bytes = #text, bytes_as_written = tonumber(state.xmp_bytes),
        uuid_as_written = text:find('crs:UUID="' .. tostring(state.xmp_uuid) .. '"', 1, true) ~= nil }
end

-- Leave exactly the S7 copies selected (S6 pattern) and read the selection back. Removal is called
-- safe only when every copy step 1 made was found and selected, and nothing else (Greptile, PR #29).
local function selectCopies(catalog, state)
    local copies, out = {}, { selected_for_removal = false, expected = 0, count = 0, missing = {} }
    for _, spec in ipairs({ { state.crop_copy_uuid, S7Photos.CROP_COPY }, { state.unselected_copy_uuid, S7Photos.UNSELECTED_COPY } }) do
        if spec[1] and spec[1] ~= "" then
            out.expected = out.expected + 1
            local photo, err = copyFromState(catalog, spec[1], spec[2])
            if photo then table.insert(copies, photo) else table.insert(out.missing, spec[2] .. ": " .. tostring(err)) end
        end
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
    out.selected_for_removal = ok and exact and #copies == out.expected
    return out
end

local function yesNo(v) return v and "YES" or "NO" end

local function message(result, when, kind)
    local listed = {}
    for _, r in ipairs(roles(kind, result.state)) do
        table.insert(listed, r.role .. " " .. yesNo(result.found[r.role].listed_in))
    end
    local lines = {
        "Your answers: " .. (result.jim.answered and "SAVED" or "NOT ANSWERED - look again and run this menu item again"),
        "Lightroom lists: " .. table.concat(listed, ", "),
    }
    if when == "before" then
        table.insert(lines, "\nNext: quit Lightroom (File > Exit), start it again, then follow the README.")
        return table.concat(lines, "\n")
    end
    if not kind.copies then
        table.insert(lines, "\nThen delete the AVG S7 presets as the README says, and tell Claude Code \"" .. kind.done .. "\".")
        return table.concat(lines, "\n")
    end
    local c = result.cleanup
    if c.selected_for_removal then
        table.insert(lines, "\nThe " .. c.count .. " S7 copies (and nothing else) are now selected. To remove them: Photo > Remove Photos... > Remove.")
    elseif c.expected == 0 then
        table.insert(lines, "\nStep 1 made no S7 copies, so there is nothing to remove.")
    else
        table.insert(lines, "\nCOULD NOT SELECT all " .. c.expected .. " S7 copies (found " .. c.count .. "). Don't remove anything - tell Claude Code.")
    end
    table.insert(lines, "Then delete the AVG S7 presets as the README says, and tell Claude Code \"" .. kind.done .. "\".")
    return table.concat(lines, "\n")
end

local STEPS = { run = { before = "2-before-restart", after = "3-after-restart" }, xmp = { before = "5-xmp-before-restart", after = "6-xmp-after-restart" } }

-- when: "before" or "after"; kindName: "run" (menu items 2 and 3, the default) or "xmp" (5 and 6).
function S7Observe.run(when, kindName)
    local kind = KINDS[kindName or "run"]
    LrFunctionContext.postAsyncTaskWithContext("AVG S7 presets " .. when, function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local catalog = LrApplication.activeCatalog()
        local state = Common.loadState(kind.state_file)
        if not state then
            LrDialogs.message("AVG S7 - nothing to check yet", "Run \"" .. kind.first .. "\" first.", "warning")
            return
        end
        local result = { spike = "S7", step = STEPS[kindName or "run"][when],
            run_at = Common.localTime(), lr_version = LrApplication.versionString(), state = state }
        local listing, index = S7Presets.list()
        result.presets, result.found = listing, lookups(index, kind, state)
        result.jim = ask(context, when, kind, state)
        if not kind.copies then
            result.xmp_vs_reference = versusReference(index, state)
            result.file_on_disk = onDisk(state)
        elseif when == "after" then
            result.apply = applyAll(catalog, state, index)
            result.cleanup = selectCopies(catalog, state)
        end
        local ok, err = Common.save(kind.prefix .. when, result)
        local cleanupProblem = result.cleanup and not result.cleanup.selected_for_removal and result.cleanup.expected > 0
        LrDialogs.message("AVG S7 - presets " .. (when == "before" and "BEFORE" or "AFTER") .. " the restart",
            message(result, when, kind) .. "\n\n" .. Common.saveLine(ok, err),
            (ok and result.jim.answered and not cleanupProblem) and "info" or "warning")
    end)
end

return S7Observe
