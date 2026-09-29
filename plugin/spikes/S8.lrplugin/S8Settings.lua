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
-- Run 1's questions (one set of fields, the "12" test) are in its saved files; since fix/s8-settings
-- the questions are per group A, B, C (S8InfoProvider.lua).

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

-- The questions of the settings rerun (fix/s8-settings: groups A, B, C in S8InfoProvider.lua).
local QUESTIONS = {
    before_restart = {
        { key = "page_showed_groups", text = "The S8 section in Plug-in Manager showed three groups, A, B and C, each with Mode and Max passes" },
        { key = "a_showed_values", text = "Before I changed anything, group A showed autonomous and 4 (not blank)" },
        { key = "b_showed_values", text = "Before I changed anything, group B showed autonomous and 4 (not blank)" },
        { key = "c_showed_values", text = "Before I changed anything, group C showed autonomous and 4 (not blank)" },
    },
    after_restart = {
        { key = "a_kept", text = "After the restart, BEFORE any S8 menu item, group A showed approve_each_pass and 6" },
        { key = "b_kept", text = "After the restart, BEFORE any S8 menu item, group B showed approve_each_pass and 6" },
        { key = "c_kept", text = "After the restart, BEFORE any S8 menu item, group C showed approve_each_pass and 6" },
    },
}

-- Whether group g's two settings hold what the README has Jim enter.
local function groupSaved(p, g)
    return p[g .. "_mode"] == "approve_each_pass" and p[g .. "_maxPasses"] == 6
end

-- Why the panel's marks cannot be compared, or nil: no loop mark, the panel file was not written
-- (S8InfoProvider keeps the error in prefs), or the panel has not rendered since this Lightroom
-- start, so its file holds an earlier start's marks (Greptile, PR #40).
local function panelInconclusive(viewText)
    if not Common.field(viewText, "init_mark") then return "the loop's mark could not be read" end
    local err = Common.prefsTable().s8_panel_view_error
    if err then return "the panel view was not written: " .. tostring(err) end
    local panel = Common.readFile(Common.path(Common.PANEL_VIEW_FILE))
    if not panel then return "no panel view file (Plug-in Manager not opened)" end
    local rendered = tonumber(panel:match('"rendered_epoch": (%d+)'))
    local started = tonumber(viewText:match('"started_epoch": (%d+)'))
    if not rendered or not started or rendered < started then
        return "Plug-in Manager not opened since Lightroom started"
    end
    return nil
end

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
    local why = panelInconclusive(viewText)
    if why then
        m.init_to_panel_via_G, m.init_to_panel_via_module = "inconclusive: " .. why, "inconclusive: " .. why
    else
        local panel = Common.readFile(Common.path(Common.PANEL_VIEW_FILE))
        m.panel_rendered_at = Common.field(panel, "rendered_at")
        m.init_to_panel_via_G = Common.field(panel, "init_mark_on_G") == loopMark
        m.init_to_panel_via_module = Common.field(panel, "init_mark_in_module") == loopMark
    end
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
        local lines = { "S8 loop running: " .. yesNo(m.loop_running) }
        for _, g in ipairs({ "a", "b", "c" }) do
            lines[#lines + 1] = string.format("Group %s saved approve_each_pass and 6: %s (mode %s, max passes %s)",
                g:upper(), yesNo(groupSaved(p, g)), tostring(p[g .. "_mode"]), tostring(p[g .. "_maxPasses"]))
        end
        lines[#lines + 1] = "Shared with this menu item: _G " .. yesNo(m.init_to_menu_via_G) .. ", module " .. yesNo(m.init_to_menu_via_module)
        lines[#lines + 1] = ""
        lines[#lines + 1] = Common.saveLine(ok, err)
        LrDialogs.message(ok and "AVG S8 settings: SAVED" or "AVG S8 settings: SAVE FAILED", table.concat(lines, "\n"), ok and "info" or "critical")
    end)
end

return Settings
