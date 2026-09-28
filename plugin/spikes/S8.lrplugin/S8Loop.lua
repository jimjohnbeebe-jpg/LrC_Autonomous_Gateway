-- AVG-S8: the long-running task S8Init.lua starts, standing in for the bridge task of
-- plugin\LrC-AVG.lrplugin\Bridge.lua. Every 0.25 s it reads the request file the menu items write
-- (S8Common.writeRequest):
--   "open"  -> 5 s later it presents the HUD (S8Hud.lua) from a task of its own, as the bridge would
--              at lr_begin_session (PHASE5_PLAN decision 6). The delay lets Jim click into the main
--              window first, for the focus question.
--   "close" -> it cancels an open still waiting out its 5 s, and calls
--              LrDialogs.closeFloatingDialogsForPlugin. That call is not on the SDK reference
--              page (https://lrc.mcor.dev/modules/LrDialogs.html, read 2026-09-28); it is listed among
--              the LR5 additions [community: LR_SDK_NOTES "LrDialogs / LrView"]. Its argument is
--              [unverified]: the loop tries (_PLUGIN), then no argument, and records both.
-- Every 2 s it writes what it sees to s8_loop_view.json: the plugin's preferences (did an edit on
-- the Plug-in Manager page reach this task without a restart?) and the marks of question 5
-- (S8State.lua). A request already on disk when the loop starts is from before a restart and is
-- not acted on.

local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'

local Common = require 'S8Common'
local S8Hud = require 'S8Hud'
local SpikeJson = require 'SpikeJson'
local State = require 'S8State'

local Loop = {}

local TICK_SECONDS = 0.25
local VIEW_EVERY_SECONDS = 2
local OPEN_DELAY_SECONDS = 5
local MAX_HISTORY = 50

-- `run` is the open HUD's record, or nil. `closed_during_call` is true when the HUD's
-- windowWillClose fired inside the call itself: then nothing but the call can have closed it
-- (Greptile, PR #40: a close with the X soon after the call must not count as a close from code).
local function tryClose(run)
    local fn = LrDialogs.closeFloatingDialogsForPlugin
    local rec = { exists = type(fn) == "function", at = Common.clock(), epoch = LrDate.currentTime(), tries = {},
        hud_open_before_call = run ~= nil and run.open == true }
    if not rec.exists then return rec end
    local ok, err = LrTasks.pcall(fn, _PLUGIN)
    table.insert(rec.tries, { argument = "_PLUGIN", ok = ok, error = (not ok) and tostring(err) or nil })
    if not ok then
        local ok2, err2 = LrTasks.pcall(fn)
        table.insert(rec.tries, { argument = "none", ok = ok2, error = (not ok2) and tostring(err2) or nil })
    end
    rec.closed_during_call = rec.hud_open_before_call and run.open == false
    return rec
end

local function openHud(run)
    run.open_started_at = Common.clock()
    LrFunctionContext.postAsyncTaskWithContext("AVG S8 HUD", function(context)
        S8Hud.run(context, run)
    end)
end

-- One pass of the loop. `L` is the loop's state.
local function tick(L)
    local id, action = Common.readRequest()
    if id and id ~= L.lastId then
        L.lastId = id
        table.insert(L.requests, { id = id, action = action, seen_at = Common.clock() })
        if action == "open" then
            if L.run and L.run.open ~= false then
                L.requests[#L.requests].ignored = "a HUD is already open"
            else
                L.run = { request_id = id, requested_at = Common.localTime(), requested_epoch = LrDate.currentTime(),
                    opened_from = "the S8 loop task (started by the init script), as the bridge task would open it",
                    clicks = {}, selection_change_times = {} }
                L.openAt = LrDate.currentTime() + OPEN_DELAY_SECONDS
            end
        elseif action == "close" then
            if L.openAt then
                -- A close during the 5 s delay: the HUD must not appear afterwards (Greptile, PR #40).
                L.openAt = nil
                L.run.open = false
                L.run.open_cancelled_by_close = Common.clock()
            end
            local rec = tryClose(L.run)
            if L.run then L.run.close = rec else L.closeWithoutHud = rec end
        end
    end
    if L.openAt and LrDate.currentTime() >= L.openAt then
        L.openAt = nil
        openHud(L.run)
    end
    local prefs = Common.prefsTable()
    local encoded = SpikeJson.encode(prefs)
    if encoded ~= L.lastPrefs then
        L.lastPrefs = encoded
        table.insert(L.prefsHistory, { seen_at = Common.localTime(), prefs = prefs })
        if #L.prefsHistory > MAX_HISTORY then table.remove(L.prefsHistory, 1) end
    end
end

local function writeView(L)
    SpikeJson.writeFile(Common.path(Common.LOOP_VIEW_FILE), {
        spike = "S8",
        generation = L.generation,
        init_mark = L.mark,
        started_at = L.startedAt,
        started_epoch = L.startedEpoch,
        updated_at = Common.localTime(),
        updated_epoch = os.time(),
        loop_sees = {
            init_mark_on_G = _G.S8_initMark,
            init_mark_in_module = State.initMark,
            menu_mark_on_G = _G.S8_menuMark,
            menu_mark_in_module = State.menuMark,
        },
        prefs_history = L.prefsHistory,
        requests = L.requests,
        hud = L.run and { request_id = L.run.request_id, open = L.run.open, shown_at = L.run.shown_at, closed_at = L.run.closed_at } or nil,
        close_without_hud = L.closeWithoutHud,
        errors = L.errors,
    })
end

function Loop.run(generation, mark)
    local L = {
        generation = generation, mark = mark, startedAt = Common.localTime(), startedEpoch = os.time(),
        lastId = Common.readRequest(), requests = {}, prefsHistory = {}, errors = {},
        lastView = 0,
    }
    while _G.S8_generation == generation do
        local ok, err = LrTasks.pcall(tick, L)
        if not ok and #L.errors < 20 then table.insert(L.errors, Common.clock() .. " " .. tostring(err)) end
        if LrDate.currentTime() - L.lastView >= VIEW_EVERY_SECONDS then
            L.lastView = LrDate.currentTime()
            LrTasks.pcall(writeView, L)
        end
        LrTasks.sleep(TICK_SECONDS)
    end
end

return Loop
