-- The HUD (PRD section 6.3, PHASE5_PLAN row 4): a floating window that shows the engine's session as
-- hud_update sends it (HudState.lua checks it; HudView.lua lays the window out and fills it), with
-- Abort, Accept, Pick A-C and Approve buttons that send hud_* events (Events.lua), and the menu
-- items' Abort and Accept (FR-1.1). What S8 showed in Lightroom 15.5.1, and how it is used here
-- [handle: LR_SDK_NOTES "Recorded in Phase 5", Floating dialog; docs\reports\phase5\S8.md
-- "Consequences", row 4]:
--   - a button's action cannot yield, so Hud.click only checks and marks the click pending, and a
--     task it starts sends the event;
--   - the window takes the keyboard when it opens, so it opens by itself only when an update asks
--     (`open`, sent once at lr_begin_session) and it is not already open (decision 6 [stated: Jim,
--     2026-09-28, "Opens by itself, once (Recommended)"]), and otherwise from the menu;
--   - closeFloatingDialogsForPlugin(_PLUGIN) closes it inside the call: at a session's end it shows
--     the outcome for HudState.CLOSE_AFTER_SECONDS, then closes itself (decision 1 [stated: Jim,
--     2026-09-29, "Go with recommended"]);
--   - selectionChangeObserver is called once per selection change: it drives the selection line
--     ("Target changed"; HudSelection.lua, with the checks added after the row 4 probe).
-- Its state lives on _G (rule 03: it must survive a Reload Plug-in running this module again), and
-- the bridge task's updates, the window's task, its ticker and menu items all reach it there.

local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'
local LrView = import 'LrView'

local Events = require 'Events'
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
-- click waiting for the engine.
local H = _G.LrCAVG_Hud or { seen = {}, window = 0 }
_G.LrCAVG_Hud = H

local function clock()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S")
end

function Hud.isOpen()
    return H.open == true or H.opening == true
end

-- The pending click, or nil once it has waited HudState.PENDING_SECONDS: then the buttons come back.
local function livePending()
    local p = H.pending
    if p and LrDate.currentTime() - p.at >= HudState.PENDING_SECONDS then
        H.pending = nil
        H.lastAction = p.label .. ": no answer from the engine within " .. HudState.PENDING_SECONDS .. " s; the buttons are on again"
        Log.warn("hud: " .. p.name .. " " .. p.click_id .. " got no answer")
        return nil
    end
    return p
end

-- Copies the view into the window's property table, when there is a window. Never yields.
local function refresh()
    local props = H.props
    if not props then return end
    local v = HudView.props(H.state, Events.connection(), livePending(), HudView.pageSettings())
    v.lastAction = H.lastAction or ""
    v.targetChanged = H.targetChanged or ""
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

-- Logged before the call: the window closes inside it (S8, handle at the top), and windowWillClose
-- logs "closed".
function Hud.close(reason)
    Log.info("hud: closing, " .. reason)
    local ok, err = LrTasks.pcall(LrDialogs.closeFloatingDialogsForPlugin, _PLUGIN)
    if not ok then Log.error("hud: closeFloatingDialogsForPlugin failed: " .. tostring(err)) end
end

-- While window `mine` is open: expire a pending click, close after a session's end, check the
-- selection every HudSelection.PERIOD_SECONDS while a session is open, and refresh the connection
-- line once a second (it comes from the bridge, not from the engine's updates).
local function ticker(mine)
    local lastCheck = LrDate.currentTime()
    while H.window == mine and H.open do
        local now = LrDate.currentTime()
        if H.state and not HudState.isEnd(H.state.stage) and now - lastCheck >= HudSelection.PERIOD_SECONDS then
            lastCheck = now
            LrTasks.startAsyncTask(checkSelection)
        end
        if H.closeAt and now >= H.closeAt then
            local s = H.state
            H.closeAt = nil
            -- Only the session that ended: a newer session's update cancels the close.
            if s and s.session_id == H.closeFor and HudState.isEnd(s.stage) then Hud.close("the session ended (" .. s.stage .. ")") end
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
            H.open, H.opening, H.props, H.closeAt = false, false, nil, nil
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
        H.lastAction, H.targetChanged = nil, ""
        Log.info("hud: session " .. s.session_id)
    end
    local p = H.pending
    if p and (newSession or HudState.isEnd(s.stage) or s.answered_click_id == p.click_id) then
        H.pending = nil
        if not newSession then H.lastAction = p.label .. ": answered by the engine at " .. clock() end
    end
    H.state = s
    -- Close at the end only a window open now; one opened later from the menu stays open. A newer
    -- session's update cancels the close: the ticker closes only while this session's end is shown.
    if HudState.isEnd(s.stage) and Hud.isOpen() then
        H.closeAt, H.closeFor = LrDate.currentTime() + HudState.CLOSE_AFTER_SECONDS, s.session_id
    end
    local opened = s.open == true and Hud.show()
    refresh()
    if H.open then LrTasks.startAsyncTask(checkSelection) end
    return { applied = true, shown = Hud.isOpen(), opened = opened }
end

-- The half of a click or menu item that must not yield: the checks, then the click marked pending
-- (the buttons go off). Returns the pending click, or nil and why not.
local function begin(name, variant, source)
    local s = H.state
    local label = HudState.eventLabel(name, variant, s)
    local refusal = HudState.refusal(s, name, variant)
    if refusal then return nil, label .. " NOT sent: " .. refusal end
    local p = livePending()
    if p then return nil, label .. " NOT sent: the " .. p.label .. " is still waiting for the engine" end
    local conn = Events.connection()
    if not conn.engine then
        return nil, label .. " NOT sent: " .. (conn.running and "the engine is not connected" or "the LrC-AVG bridge is not running")
    end
    local payload = HudState.eventPayload(s, name, variant, source)
    payload.click_id = LrUUID.generateUUID()
    H.pending = { name = name, label = label, click_id = payload.click_id, at = LrDate.currentTime(), payload = payload }
    return H.pending
end

-- The half that runs in a task: send, and say what happened. Returns sent, and the line for it.
-- The click must still be the pending one (Greptile, PR #45): an update that ran before this task
-- (a new session, an end stage) cleared it, and then nothing is sent. Once sent, the line is shown
-- only while the click is still pending: an update that came during the send (the engine's answer)
-- keeps the line it wrote. The send itself may wait up to 5 s for the send socket (Events.send),
-- and an event already on its way is not called back; the engine checks each event against its
-- open session (PHASE5_PLAN row 5).
local function finish(p)
    if H.pending ~= p then
        Log.info("hud: " .. p.name .. " " .. p.click_id .. " from the " .. p.payload.source .. ": not sent, no longer pending")
        return false, p.label .. " NOT sent: the session changed before it could be sent"
    end
    local ok, why = Events.send(p.name, p.payload)
    local line = ok and (p.label .. " sent at " .. clock() .. "; waiting for the engine") or (p.label .. " NOT sent: " .. why)
    Log.info("hud: " .. p.name .. " " .. p.click_id .. " from the " .. p.payload.source .. (ok and ": sent" or (": not sent, " .. why)))
    local current = H.pending == p
    if current and not ok then H.pending = nil end
    if current then
        H.lastAction = line
        refresh()
    end
    return ok, line
end

-- A button's action (HudView.lua). It cannot yield (S8), so the send runs in a task.
function Hud.click(name, variant)
    local p, why = begin(name, variant, "hud")
    if not p then
        H.lastAction = why
        refresh()
        return
    end
    refresh()
    LrTasks.startAsyncTask(function() finish(p) end)
end

-- Menu items Abort Session / Accept Session (FR-1.1, decision 7). Runs in a task.
-- In the row 4 probe both found the engine "not connected": the plugin logged nothing while Jim used
-- the menu, and the engine dropped on its heartbeat [handle: repo logs\probe-hud-2026-09-29\
-- (gitignored), bridge-log-excerpt.txt 05:56:09-05:58:49]; Lightroom pausing the plugin's tasks
-- while a menu or message box is open is [inference]. So the item waits up to MENU_WAIT_SECONDS for
-- the engine, then sends, and its outcome goes to the HUD's line (opening the HUD): the message box
-- used before opened behind the HUD [stated: Jim, 2026-09-29].
Hud.MENU_WAIT_SECONDS = 20

function Hud.menuEvent(name)
    local line
    local refusal = HudState.refusal(H.state, name, nil)
    if refusal then
        line = HudState.eventLabel(name, nil, H.state) .. " NOT sent: " .. refusal
        H.lastAction = line
    else
        local chosen, waited = H.state.session_id, 0
        while not Events.connection().engine and waited < Hud.MENU_WAIT_SECONDS do
            LrTasks.sleep(0.5)
            waited = waited + 0.5
        end
        -- Chosen for that session: never sent to one that began during the wait (Greptile, PR #46).
        local p, why = nil, HudState.eventLabel(name, nil, H.state) .. " NOT sent: the session changed while waiting for the engine"
        if H.state.session_id == chosen then p, why = begin(name, nil, "menu") end
        if p then
            local _, sent = finish(p) -- finish shows its own line while the click is current (PR #45)
            line = sent
        else
            line = why .. (waited >= Hud.MENU_WAIT_SECONDS and (" (waited " .. Hud.MENU_WAIT_SECONDS .. " s)") or "")
            H.lastAction = line
        end
    end
    Log.info("hud: menu " .. name .. ": " .. line)
    Hud.show()
    refresh()
end

return Hud
