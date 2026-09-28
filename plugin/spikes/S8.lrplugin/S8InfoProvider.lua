-- AVG-S8 question 6: a Plug-in Manager section whose fields are saved in LrPrefs, of the kinds the
-- Phase 5 settings page needs (PRD section 6.2; PHASE5_PLAN decision 2): a popup menu (mode), a
-- whole-number field with a range (max passes 1-8), a one-decimal field (a guardrail), a text field (a
-- folder) and a read-only line (the temp preview folder, decision 2c).
-- The pattern is Automaat's: each field is bound to the section's property table, and an observer
-- copies every change into the plugin's prefs [upstream claim: vendor\automaat\plugin\
-- LightroomMCP.lrplugin\PluginInfoProvider.lua:678-698, 727-752]. The plug-in info provider is not on
-- the SDK reference site (https://lrc.mcor.dev/modules/LrPlugin.html, read 2026-09-28).
-- `precision` makes an edit field numeric; `min`/`max` bound it [handle:
-- https://lrc.mcor.dev/modules/LrView%20edit%20view%20properties.html, read 2026-09-28]. What
-- Lightroom does with a value outside min/max is [unverified]: every value an observer receives is
-- appended to prefs.s8_observed, so the saved files show it.
-- Rendering the section also records which of question 5's marks this module sees
-- (s8_panel_view.json).

local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'
local LrView = import 'LrView'

local Common = require 'S8Common'
local SpikeJson = require 'SpikeJson'
local State = require 'S8State'

local Provider = {}

local DEFAULTS = { mode = "autonomous", maxPasses = 4, clipHighPct = 0.5, logFolder = "" }
local FIELDS = { "mode", "maxPasses", "clipHighPct", "logFolder" }
local MAX_OBSERVED_CHARS = 3000

local function note(prefs, key, value)
    local line = key .. "=" .. tostring(value) .. " (" .. type(value) .. ") at " .. Common.clock()
    local log = prefs.s8_observed
    log = (type(log) == "string" and log ~= "") and (log .. "; " .. line) or line
    if #log > MAX_OBSERVED_CHARS then log = log:sub(-MAX_OBSERVED_CHARS) end
    prefs.s8_observed = log
end

local function recordPanelView()
    SpikeJson.writeFile(Common.path(Common.PANEL_VIEW_FILE), {
        spike = "S8",
        rendered_at = Common.localTime(),
        rendered_epoch = os.time(),
        panel_sees = {
            init_mark_on_G = _G.S8_initMark,
            init_mark_in_module = State.initMark,
            menu_mark_on_G = _G.S8_menuMark,
            menu_mark_in_module = State.menuMark,
        },
        prefs = Common.prefsTable(),
    })
end

local function label(f, text)
    return f:static_text { title = text, width_in_chars = 26 }
end

function Provider.sectionsForTopOfDialog(f, propertyTable)
    local prefs = LrPrefs.prefsForPlugin()
    pcall(recordPanelView) -- plain pcall: the panel render is not a task, and a file write does not yield [inference]
    for _, key in ipairs(FIELDS) do
        if prefs[key] == nil then prefs[key] = DEFAULTS[key] end
        propertyTable[key] = prefs[key]
        propertyTable:addObserver(key, function(_, _, value)
            prefs[key] = value
            note(prefs, key, value)
        end)
    end
    local temp = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "previews")
    return {
        {
            title = "AVG S8 settings test",
            f:row {
                label(f, "Mode:"),
                f:popup_menu {
                    value = LrView.bind("mode"),
                    items = {
                        { title = "autonomous", value = "autonomous" },
                        { title = "approve_each_pass", value = "approve_each_pass" },
                    },
                },
            },
            f:row {
                label(f, "Max passes (1-8):"),
                f:edit_field { value = LrView.bind("maxPasses"), precision = 0, min = 1, max = 8, width_in_chars = 5 },
            },
            f:row {
                label(f, "Highlight clip guardrail (%):"),
                f:edit_field { value = LrView.bind("clipHighPct"), precision = 1, min = 0, max = 100, width_in_chars = 6 },
            },
            f:row {
                label(f, "Log folder:"),
                f:edit_field { value = LrView.bind("logFolder"), width_in_chars = 40 },
            },
            f:row {
                label(f, "Temp preview folder:"),
                f:static_text { title = temp, width_in_chars = 50 },
            },
            f:static_text { title = "S8 saves each value as you change it. Nothing here touches your photos.", width_in_chars = 70 },
        },
    }
end

return Provider
