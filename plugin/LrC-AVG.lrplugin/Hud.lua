-- The HUD (PRD section 6.3, PHASE5_PLAN row 4): a floating window that shows the engine's session as
-- hud_update sends it (HudState.lua checks it; HudView.lua lays the window out and fills it), with
-- Pick A-C, Approve, Accept and Abort buttons that send hud_* events (Events.lua), and the menu
-- items' (FR-1.1); the clicks and menu items are in HudClick.lua. What S8 showed in Lightroom
-- 15.5.1, and how it is used here [handle: LR_SDK_NOTES "Recorded in Phase 5", Floating dialog;
-- docs\reports\phase5\S8.md "Consequences", row 4]:
--   - a button's action cannot yield, so a click only checks and marks the click pending, and a
--     task it starts sends the event;
--   - the window takes the keyboard when it opens, so it opens by itself only when an update asks
--     (`open`, sent once at lr_begin_session) and it is not already open (decision 6 [stated: Jim,
--     2026-09-28, "Opens by itself, once (Recommended)"]), and otherwise from the menu;
--   - selectionChangeObserver is called once per selection change: it drives the selection line
--     ("Target changed"; HudSelection.lua, with the checks added after the row 4 probe).
-- At an edit's end the window stays open, showing the outcome, until it is closed or the next
-- session's update replaces it [stated: Jim, 2026-10-03, D2 "Stay open (Recommended)"]; the close
-- after 5 s (decision 1) is gone.
-- At each engine connection the edit shown is marked unknown until an update for it arrives
-- (markUnknown, fix/hud-p1 P1-3): the buttons go off, and after HudState.UNKNOWN_SECONDS the
-- headline says the edit is no longer open in Claude.
-- Its state lives on _G (rule 03: it must survive a Reload Plug-in running this module again), and
-- the bridge task's updates, the window's task, its ticker and menu items all reach it there.

local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Events = require 'Events'
local HudClick = require 'HudClick'
local HudSelection = require 'HudSelection'
local HudState = require 'HudState'
local HudView = require 'HudView'
local Log = require 'Log'

local Hud = {}

Hud.TITLE = "LrC-AVG - Vision Gateway"
local TICK_SECONDS = 1
local OPEN_WAIT_SECONDS = 10 -- a window whose onShow never came is given up after this long [inference]

-- state: the last update taken; seen: every session id taken; window: a counter, one per window;
-- open / opening: the window is shown / its task is posted; props: its property table; pending: the
-- click waiting for the engine and lastAction: the click line (HudClick.lua); targetChanged: the
-- selection line; unknownAt: when an engine connection made the shown edit unknown (nil once an
-- update has come since).
local H = _G.LrCAVG_Hud or { seen = {}, window = 0 }
_G.LrCAVG_Hud = H

function Hud.isOpen()
    return H.open == true or H.opening == true
end

-- Copies the view into the window's property table, when there is a window. Never yields.
local function refresh()
    local props = H.props
    if not props then return end
    local pending = HudClick.livePending() -- first: an expired click writes its line
    local hud = { click = H.lastAction, selection = H.targetChanged, unknown = HudState.unknown(H.unknownAt, LrDate.currentTime()) }
    local v = HudView.props(H.state, Events.connection(), pending, HudView.pageSettings(), hud)
    for key, value in pairs(v) do
        if props[key] ~= value then props[key] = value end
    end
end

local function currentState() return H.state end
local function showSelection(line)
    H.targetChanged = line
    refresh()
end

-- Runs in a task (HudSelection.lua).
local function checkSelection()
    HudSelection.check(currentState, showSelection)
end

-- While window `mine` is open: check the selection every HudSelection.PERIOD_SECONDS while a session
-- is open, and refresh once a second, which expires a pending click, turns an unknown edit's
-- "checking" into "no longer open", and shows the connection (it comes from the bridge, not from
-- the engine's updates).
local function ticker(mine)
    local lastCheck = LrDate.currentTime()
    while H.window == mine and H.open do
        local now = LrDate.currentTime()
        if H.state and not HudState.isEnd(H.state.stage) and now - lastCheck >= HudSelection.PERIOD_SECONDS then
            lastCheck = now
            LrTasks.startAsyncTask(checkSelection)
        end
        refresh()
        LrTasks.sleep(TICK_SECONDS)
    end
end

local function present(context, mine)
    local props = LrBinding.makePropertyTable(context)
    H.props = props
    refresh()
    LrDialogs.presentFloatingDialog(_PLUGIN, {
        title = Hud.TITLE,
        contents = HudView.contents(LrView.osFactory(), props, Hud.click),
        blockTask = true,
        onShow = function()
            if H.window ~= mine then return end
            H.open, H.opening = true, false
            Log.info("hud: shown")
            LrTasks.startAsyncTask(function() ticker(mine) end)
            LrTasks.startAsyncTask(checkSelection)
        end,
        windowWillClose = function()
            if H.window ~= mine then return end
            H.open, H.opening, H.props = false, false, nil
            Log.info("hud: closed")
        end,
        selectionChangeObserver = function() HudSelection.onChange(currentState, showSelection) end,
    })
    -- With blockTask the call returned only when the window closed [handle: docs\reports\phase0\S4.md
    -- Verdict; docs\reports\phase5\S8.md Numbers, "presentFloatingDialog (blockTask) returned"].
    -- Should it return early, this task, and so the property table's context, stays alive while the
    -- window is open.
    local waited = 0
    while H.window == mine and (H.open or (H.opening and waited < OPEN_WAIT_SECONDS)) do
        LrTasks.sleep(0.5)
        waited = waited + 0.5
    end
end

-- Opens the window unless it is open or opening; returns true when it opened one. It only posts the
-- window's task, so it never yields: the bridge's update handler and menu items call it directly.
-- The flag is set before the task is posted, so two callers cannot both open a window.
function Hud.show()
    if Hud.isOpen() then return false end
    H.opening = true
    H.window = H.window + 1
    local mine = H.window
    local posted, postErr = pcall(LrFunctionContext.postAsyncTaskWithContext, "LrC-AVG HUD", function(context) -- plain pcall: a menu item calls this outside a task, and posting does not yield
        local ok, err = LrTasks.pcall(present, context, mine)
        if not ok then Log.error("hud: the window failed: " .. tostring(err)) end
        if H.window == mine then H.open, H.opening, H.props = false, false, nil end
    end)
    if not posted then
        -- Without this the flag would stay set and no window could open again.
        H.opening = false
        Log.error("hud: could not start the window's task: " .. tostring(postErr))
        return false
    end
    return true
end

-- At each engine connection (Bridge.lua, the hello command, before its reply): the edit shown, if it
-- has not ended, is unknown until an update for it arrives. The same engine sends its session's
-- state again once connected (engine\src\hud\publisher.ts:68-74), and it is connected only after
-- the hello reply (engine\src\bridge\client.ts:237-246), so that update comes after this mark; an
-- engine without the session (Claude Desktop restarted it) sends none (publisher.ts:69, no
-- channel). Marking at the send socket's connection instead could race that update [inference:
-- Sockets.lua starts onSendConnected in its own task]. Never yields.
function Hud.markUnknown()
    local s = H.state
    if s == nil or HudState.isEnd(s.stage) then return end
    H.unknownAt = LrDate.currentTime()
    Log.info("hud: session " .. s.session_id .. " unknown until the engine sends it")
    refresh()
end

-- Bridge command hud_update (engine\src\bridge\protocol.ts COMMANDS.hud_update). Runs in the
-- bridge line's task and never yields; the selection check it starts runs in its own task.
function Hud.update(payload)
    local s, err = HudState.check(payload)
    if not s then return nil, err end
    local stale = HudState.staleReason(H.state, H.seen, s)
    if stale then
        Log.warn("hud: ignored an update: " .. stale)
        return { applied = false, shown = Hud.isOpen(), opened = false, reason = stale }
    end
    local newSession = H.state == nil or H.state.session_id ~= s.session_id
    H.seen[s.session_id] = true
    if newSession then
        H.targetChanged = ""
        Log.info("hud: session " .. s.session_id)
    elseif s.snapshot == nil then
        s.snapshot = H.state.snapshot -- the snapshot's name is kept for the whole session
    end
    local p = H.pending
    if p and (newSession or HudState.isEnd(s.stage) or s.answered_click_id == p.click_id) then H.pending = nil end
    -- A taken update clears the click line unless a click is still pending; the update's note shows.
    if H.pending == nil then H.lastAction = nil end
    H.state, H.unknownAt = s, nil
    local opened = s.open == true and Hud.show()
    refresh()
    if H.open then LrTasks.startAsyncTask(checkSelection) end
    return { applied = true, shown = Hud.isOpen(), opened = opened }
end

-- A button's action (HudView.lua), and the menu items with the event's variant (Pick A-C): HudClick.lua.
function Hud.click(name, variant)
    HudClick.click(name, variant, refresh)
end

function Hud.menuEvent(name, variant)
    HudClick.menuEvent(name, variant, refresh, Hud.show)
end

return Hud
