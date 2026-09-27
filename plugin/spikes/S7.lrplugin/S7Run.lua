-- AVG-S7 menu item 1, on the selected photo (the master): item 3 (crop on a virtual copy), item 4
-- (write and export an unselected copy), item 2 (removal probe), item 1 (the two presets, and the
-- plugin preset applied to a copy). Saves s7_run_<time>.json and the state file that menu items 2
-- and 3 read after the restart, then says plainly what worked and where to look for the presets.
-- Before changing anything it checks that a master is selected and that "AVG S7 reference" exists.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'

local Common = require 'S7Common'
local S7Photos = require 'S7Photos'
local S7Presets = require 'S7Presets'
local S7Probe = require 'S7Probe'

local S7Run = {}

-- Returns a problem text, or nil and the reference preset's index entry.
local function precheck(catalog, master)
    if not master then return "Select 20260907-_OZ80093.NEF in Library first." end
    if Common.describePhoto(catalog, master).is_virtual_copy == true then
        return "The selected photo is a virtual copy. Select the original 20260907-_OZ80093.NEF (no folded-corner badge)."
    end
    local _, index = S7Presets.list()
    local ref = index[S7Presets.REFERENCE]
    if not ref then
        return "There is no preset named \"" .. S7Presets.REFERENCE .. "\". Create it as spikes\\S7\\README.md says, then run this again."
    end
    return nil, ref
end

local function presets(catalog, ref, copy)
    local out = { reference = (S7Presets.describe(ref.preset)), reference_group = ref.where, plugin = {}, xmp = {} }
    local preset = S7Presets.createPluginPreset(catalog, out.plugin)
    S7Presets.writeXmp(ref.preset, out.xmp)
    local listing, index = S7Presets.list()
    out.listed_after = listing
    out.plugin_listed_as = index[S7Presets.PLUGIN] and index[S7Presets.PLUGIN].where or false
    out.xmp_listed_as = index[S7Presets.XMP] and index[S7Presets.XMP].where or false
    if preset and copy then
        local ok, err = S7Presets.apply(catalog, copy, preset, true, "AVG S7 apply plugin preset")
        local back = Common.pick(Common.settings(catalog, copy), { "Exposure2012", "Vibrance" })
        local want = S7Presets.PLUGIN_VALUES
        out.plugin_apply = { ok = ok, error = (not ok) and tostring(err) or nil, read_back = back,
            matches = ok and Common.near(back.Exposure2012, want.Exposure2012) and Common.near(back.Vibrance, want.Vibrance) }
    end
    return out
end

local function uuidOf(record)
    return record and tostring(record.uuid) or ""
end

local function stateOf(result)
    local p = result.presets
    return {
        run_at = result.run_at,
        master_uuid = uuidOf(result.master),
        crop_copy_uuid = uuidOf(result.crop.copy),
        unselected_copy_uuid = uuidOf(result.unselected.copy),
        reference_uuid = uuidOf(p.reference),
        reference_group = tostring(p.reference_group),
        plugin_preset_uuid = uuidOf(p.plugin.preset),
        plugin_group = p.plugin.preset and tostring(p.plugin.preset.parent) or "",
        xmp_uuid = p.xmp.uuid or "",
        xmp_path = p.xmp.path or "",
    }
end

local function line(label, worked, why)
    if worked then return label .. ": WORKED" end
    return label .. ": FAILED" .. (why and (" - " .. tostring(why)) or "")
end

local function unselectedWhy(u)
    if u.error then return u.error end
    if u.export and u.export.error then return u.export.error end
    if u.write and not u.write.read_back_matches then return "the value read back is not the value written" end
    if u.selection_unchanged == false then return "the selection changed" end
    if u.master_unchanged == false then return "the master's exposure changed" end
    return nil
end

-- Returns the text and whether everything worked.
local function summary(result)
    local c, u, p, probe = result.crop, result.unselected, result.presets, result.removal_probe
    local lines = {
        line("Crop on a virtual copy", c.worked, c.error or (c.export and c.export.error) or "the crop read back differently"),
        line("Write + export, photo not selected", u.worked, unselectedWhy(u)),
        "Removal probe: " .. (probe.found > 0 and (probe.found .. " undocumented removal-like name(s) found") or "no undocumented removal call found") .. " (nothing was called)",
        "Plugin preset \"" .. S7Presets.PLUGIN .. "\": " .. (p.plugin.preset and "CREATED" or ("FAILED - " .. tostring(p.plugin.error))),
        "Preset file \"" .. S7Presets.XMP .. "\": " .. (p.xmp.path and "WRITTEN" or ("NOT WRITTEN - " .. tostring(p.xmp.error))),
    }
    local all = c.worked and u.worked and p.plugin.preset ~= nil and p.xmp.path ~= nil
    return table.concat(lines, "\n"), all
end

local function whereToLook(p)
    local pluginGroup = p.plugin.preset and p.plugin.preset.parent
    if type(pluginGroup) ~= "string" or pluginGroup:find("^error: ") or pluginGroup == "<nil>" then pluginGroup = "Plugin Develop Presets" end
    return "Next: press D, and in the Presets panel (left) open these groups and look for the names:\n" ..
        "  \"" .. S7Presets.REFERENCE .. "\" and \"" .. S7Presets.XMP .. "\" - group \"" .. tostring(p.reference_group) .. "\"\n" ..
        "  \"" .. S7Presets.PLUGIN .. "\" - group \"" .. pluginGroup .. "\"\n" ..
        "Then run \"AVG S7 - 2\" and tick what you saw."
end

function S7Run.run()
    LrFunctionContext.postAsyncTaskWithContext("AVG S7 step 1", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local catalog = LrApplication.activeCatalog()
        local master = catalog:getTargetPhoto() -- outside any gate (rule 03)
        local problem, ref = precheck(catalog, master)
        if problem then
            LrDialogs.message("AVG S7 - stopped before changing anything", problem, "warning")
            return
        end
        local result = { spike = "S7", step = "1-run", run_at = Common.localTime(), lr_version = LrApplication.versionString() }
        result.master = Common.describePhoto(catalog, master)
        local cropCopy, unselectedCopy
        result.crop, cropCopy = S7Photos.crop(catalog, master)
        result.unselected, unselectedCopy = S7Photos.unselected(catalog, master)
        result.removal_probe = S7Probe.run(catalog, master)
        result.presets = presets(catalog, ref, unselectedCopy or cropCopy)
        result.selection_at_end = Common.selection(catalog)
        local stateOk, stateErr = Common.saveState(stateOf(result))
        result.state_saved = stateOk or tostring(stateErr)
        local ok, err = Common.save("s7_run", result)
        local text, all = summary(result)
        local saveLine = Common.saveLine(ok and stateOk, err or stateErr)
        LrDialogs.message("AVG S7 - checks run", text .. "\n\n" .. whereToLook(result.presets) .. "\n\n" .. saveLine,
            (all and ok and stateOk) and "info" or "warning")
    end)
end

return S7Run
