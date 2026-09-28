-- AVG-S8 menu items 3 and 4: what the settings page saved, before and after a Lightroom restart
-- (question 6), and whether a menu item, the loop and the Plug-in Manager section share module and
-- _G state (question 5, S8State.lua).
--   - Reads the prefs as this menu item sees them, and keeps a copy of the loop's view file (the
--     prefs the long-running task saw, and when each change reached it).
--   - Compares the init mark on _G and in S8State with the one the loop wrote: shared from the
--     init script to this menu item?
--   - Sets a menu mark on _G and in S8State, waits for the loop to write its view twice, and reads
--     whether the loop saw it: shared from a menu item to the long-running task?
--   - Asks Jim what the page showed, and saves s8_settings_<before|after>_restart_<time>.json.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Ask = require 'S8Ask'
local Common = require 'S8Common'
local State = require 'S8State'

local Settings = {}

local WAIT_FOR_LOOP_SECONDS = 5 -- the loop writes its view every 2 s (S8Loop.lua)

local QUESTIONS = {
    before_restart = {
        { key = "page_showed_fields", text = "The S8 section in Plug-in Manager showed Mode, Max passes, Highlight clip guardrail, Log folder and Temp preview folder" },
        { key = "field_kept_12", text = "When I typed 12 in Max passes and pressed Tab, the field still showed 12" },
        { key = "warning_on_12", text = "A warning or error message appeared when I typed 12 in Max passes" },
    },
    after_restart = {
        { key = "page_kept_values", text = "After the restart, the S8 section still showed approve_each_pass, the Highlight clip value 0.3 and the Log folder text I typed" },
    },
}

local function marks()
    local viewText, age = Common.loopView()
    local loopMark = Common.field(viewText, "init_mark")
    local m = {
        loop_running = age ~= nil and age <= Common.LOOP_STALE_SECONDS,
        loop_view_age_s = age,
        loop_init_mark = loopMark,
        menu_sees_init_mark_on_G = _G.S8_initMark,
        menu_sees_init_mark_in_module = State.initMark,
    }
    m.init_to_menu_via_G = loopMark ~= nil and _G.S8_initMark == loopMark
    m.init_to_menu_via_module = loopMark ~= nil and State.initMark == loopMark
    local menuMark = "menu-" .. LrUUID.generateUUID()
    _G.S8_menuMark = menuMark
    State.menuMark = menuMark
    m.menu_mark = menuMark
    LrTasks.sleep(WAIT_FOR_LOOP_SECONDS)
    local after = Common.loopView()
    m.menu_to_loop_via_G = Common.field(after, "menu_mark_on_G") == menuMark
    m.menu_to_loop_via_module = Common.field(after, "menu_mark_in_module") == menuMark
    local panel = Common.readFile(Common.path(Common.PANEL_VIEW_FILE))
    m.panel_rendered_at = Common.field(panel, "rendered_at")
    m.init_to_panel_via_G = loopMark ~= nil and Common.field(panel, "init_mark_on_G") == loopMark
    m.init_to_panel_via_module = loopMark ~= nil and Common.field(panel, "init_mark_in_module") == loopMark
    return m, after
end

local function yesNo(v) return v and "YES" or "NO" end

function Settings.run(step)
    LrFunctionContext.postAsyncTaskWithContext("AVG S8 settings", function(context)
        local result = { spike = "S8", step = step, run_at = Common.localTime(), lr_version = LrApplication.versionString() }
        result.prefs_in_menu_item = Common.prefsTable()
        local m, loopViewText = marks()
        result.marks = m
        local copy = "s8_loop_view_" .. step .. "_" .. Common.stamp() .. ".json"
        result.loop_view_copy = copy
        if loopViewText then Common.writeFile(Common.path(copy), loopViewText) end
        result.answered, result.observations = Ask.ticks(context, "AVG S8 - what did the settings page show?", QUESTIONS[step])
        local ok, err = Common.save("s8_settings_" .. step, result)
        local p = result.prefs_in_menu_item
        local lines = {
            "S8 loop running: " .. yesNo(m.loop_running),
            string.format("Saved settings: mode %s, max passes %s, highlight clip %s, log folder \"%s\"",
                tostring(p.mode), tostring(p.maxPasses), tostring(p.clipHighPct), tostring(p.logFolder)),
            "Shared with this menu item: _G " .. yesNo(m.init_to_menu_via_G) .. ", module " .. yesNo(m.init_to_menu_via_module),
            "",
            Common.saveLine(ok, err),
        }
        LrDialogs.message(ok and "AVG S8 settings: SAVED" or "AVG S8 settings: SAVE FAILED", table.concat(lines, "\n"), ok and "info" or "critical")
    end)
end

return Settings
