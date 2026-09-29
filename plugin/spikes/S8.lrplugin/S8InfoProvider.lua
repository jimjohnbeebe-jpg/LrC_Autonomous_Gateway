-- AVG-S8 question 6: a Plug-in Manager section whose fields are saved in LrPrefs.
--
-- Run 1 (2026-09-28) showed that the first version saved nothing: its fields had no bind_to_object,
-- and the observers that were to copy each change into the prefs never fired. The prefs held only
-- the defaults the section writes when it renders [handle: docs\reports\phase5\S8\
-- s8_settings_before_restart_2026-09-28T19-00-56.json prefs_in_menu_item, observed_log null (in
-- s8_summary_run1.json); stated: Jim, 2026-09-28, "I don't beleive that the settings were saved at
-- all"]. Why the observers never fired is [inference]: without bind_to_object the fields were bound
-- to no table S8 watched. A Plug-in Manager section's controls need an explicit bind_to_object
-- [community: https://community.adobe.com/questions-675/binding-problem-in-lrplugininfoprovider-
-- sectionsforbottomofdialog-949485, "try adding 'bind_to_object = propertyTable,' to the row"].
--
-- This version shows three groups side by side (fix/s8-settings, Jim's choice [stated: "Fix harness,
-- rerun settings only (Recommended)"]), each with a Mode popup and a whole-number Max passes field
-- (1-8), under its own keys:
--   A  a_mode, a_maxPasses: bound to the section's property table (bind_to_object = propertyTable),
--      an observer copies each change into the prefs (Automaat's pattern [upstream claim: vendor\
--      automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua:678-698], with the bind object
--      made explicit). Each value an observer receives is appended to prefs.s8_observed.
--   B  b_mode, b_maxPasses: bound straight to the prefs table (bind_to_object = prefs) [community:
--      https://github.com/kyl191/lr-stash/blob/master/PluginInfoProvider.lua, `bind_to_object = prefs`
--      on each row].
--   C  c_mode, c_maxPasses: bound to the property table; startDialog copies the prefs in and
--      endDialog copies the values back out. startDialog and endDialog "run when your plug-in is
--      selected or deselected in the Plug-in Manager dialog" [community: Lightroom SDK Guide, as
--      reproduced at https://www.yumpu.com/en/document/view/36018599/lightroom-sdk-guide/33]; their
--      arguments (propertyTable, why) are [unverified]. Each call is logged in prefs.s8_dialog_log.
-- `precision` makes an edit field numeric; `min`/`max` bound it [handle:
-- https://lrc.mcor.dev/modules/LrView%20edit%20view%20properties.html, read 2026-09-28].
-- Rendering the section also records which of question 5's marks this module sees
-- (s8_panel_view.json).

local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'
local LrView = import 'LrView'

local Common = require 'S8Common'
local SpikeJson = require 'SpikeJson'
local State = require 'S8State'

local Provider = {}

local DEFAULT_MODE, DEFAULT_MAX_PASSES = "autonomous", 4
local GROUPS = { "a", "b", "c" }
local MAX_LOG_CHARS = 3000

local function append(prefs, key, line)
    local log = prefs[key]
    log = (type(log) == "string" and log ~= "") and (log .. "; " .. line) or line
    if #log > MAX_LOG_CHARS then log = log:sub(-MAX_LOG_CHARS) end
    prefs[key] = log
end

local function recordPanelView(propertyTable)
    return SpikeJson.writeFile(Common.path(Common.PANEL_VIEW_FILE), {
        spike = "S8",
        rendered_at = Common.localTime(),
        rendered_epoch = os.time(),
        panel_sees = {
            init_mark_on_G = _G.S8_initMark,
            init_mark_in_module = State.initMark,
            menu_mark_on_G = _G.S8_menuMark,
            menu_mark_in_module = State.menuMark,
        },
        property_table_type = type(propertyTable),
        prefs = Common.prefsTable(),
    })
end

-- Fill in missing prefs so every field starts at the defaults (menu items 3 and 4 then show whether
-- a changed value was saved).
local function ensureDefaults(prefs)
    for _, g in ipairs(GROUPS) do
        if prefs[g .. "_mode"] == nil then prefs[g .. "_mode"] = DEFAULT_MODE end
        if prefs[g .. "_maxPasses"] == nil then prefs[g .. "_maxPasses"] = DEFAULT_MAX_PASSES end
    end
end

function Provider.startDialog(propertyTable)
    local prefs = LrPrefs.prefsForPlugin()
    ensureDefaults(prefs)
    propertyTable.c_mode = prefs.c_mode
    propertyTable.c_maxPasses = prefs.c_maxPasses
    append(prefs, "s8_dialog_log", "startDialog at " .. Common.clock())
end

function Provider.endDialog(propertyTable, why)
    local prefs = LrPrefs.prefsForPlugin()
    -- Only values the dialog holds: a nil here (startDialog never ran) must not erase the prefs.
    if propertyTable.c_mode ~= nil then prefs.c_mode = propertyTable.c_mode end
    if propertyTable.c_maxPasses ~= nil then prefs.c_maxPasses = propertyTable.c_maxPasses end
    append(prefs, "s8_dialog_log", "endDialog(" .. tostring(why) .. ") c_mode=" .. tostring(propertyTable.c_mode) ..
        " c_maxPasses=" .. tostring(propertyTable.c_maxPasses) .. " at " .. Common.clock())
end

-- `object`, when given, is set as the row's bind_to_object too (the lr-stash pattern sets it on each
-- row), so the binding does not depend on inheritance through the group box [inference].
local function row(f, label, control, object)
    return f:row { bind_to_object = object, f:static_text { title = label, width_in_chars = 22 }, control }
end

-- One group: a Mode popup and a Max passes field, bound to `object` under keys <g>_mode, <g>_maxPasses.
local function group(f, g, title, object)
    return f:group_box {
        title = title,
        bind_to_object = object,
        fill_horizontal = 1,
        row(f, "Mode:", f:popup_menu {
            value = LrView.bind(g .. "_mode"),
            items = {
                { title = "autonomous", value = "autonomous" },
                { title = "approve_each_pass", value = "approve_each_pass" },
            },
        }, object),
        row(f, "Max passes (1-8):", f:edit_field { value = LrView.bind(g .. "_maxPasses"), precision = 0, min = 1, max = 8, width_in_chars = 5 }, object),
    }
end

function Provider.sectionsForTopOfDialog(f, propertyTable)
    local prefs = LrPrefs.prefsForPlugin()
    ensureDefaults(prefs)
    -- A failed write is kept in prefs.s8_panel_view_error, so S8Settings reports the panel's marks
    -- as inconclusive rather than "not shared" (Greptile, PR #40).
    local ranOk, written, writeErr = pcall(recordPanelView, propertyTable) -- plain pcall: the panel render is not a task, and a file write does not yield [inference]
    if ranOk and written then
        prefs.s8_panel_view_error = nil
    else
        prefs.s8_panel_view_error = tostring(ranOk and writeErr or written) .. " at " .. Common.clock()
    end
    for _, key in ipairs({ "a_mode", "a_maxPasses" }) do
        propertyTable[key] = prefs[key]
        propertyTable:addObserver(key, function(_, _, value)
            prefs[key] = value
            append(prefs, "s8_observed", key .. "=" .. tostring(value) .. " (" .. type(value) .. ") at " .. Common.clock())
        end)
    end
    local temp = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "previews")
    return {
        {
            title = "AVG S8 settings test",
            f:static_text { title = "Three ways of saving the same two settings. Change each group the same way (README).", width_in_chars = 70 },
            group(f, "a", "A: property table + observer", propertyTable),
            group(f, "b", "B: bound to the saved settings", prefs),
            group(f, "c", "C: saved when Plug-in Manager closes", propertyTable),
            row(f, "Temp preview folder:", f:static_text { title = temp, width_in_chars = 50 }),
            f:static_text { title = "Nothing here touches your photos.", width_in_chars = 70 },
        },
    }
end

return Provider
