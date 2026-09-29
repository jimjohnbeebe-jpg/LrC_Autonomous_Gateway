-- The HUD (PRD section 6.3, PHASE5_PLAN row 4): a floating window that shows the engine's session as
-- hud_update sends it (HudState.lua checks it; HudView.lua lays the window out and fills it), with
-- Abort, Accept, Pick A-C and Approve buttons that send hud_* events (Events.lua), and the menu
-- items' Abort and Accept (FR-1.1). What S8 showed in Lightroom 15.5.1, and how it is used here [handle: LR_SDK_NOTES
-- "Recorded in Phase 5", Floating dialog; docs\reports\phase5\S8.md "Consequences", row 4]:
--   - a button's action cannot yield, so Hud.click only checks and marks the click pending, and a
--     task it starts sends the event;
--   - the window takes the keyboard when it opens, so it opens by itself only when an update asks
--     (`open`, sent once at lr_begin_session) and it is not already open (decision 6 [stated: Jim,
--     2026-09-28, "Opens by itself, once (Recommended)"]), and otherwise from the menu;
--   - closeFloatingDialogsForPlugin(_PLUGIN) closes it inside the call: at a session's end it shows
--     the outcome for HudState.CLOSE_AFTER_SECONDS, then closes itself (decision 1 [stated: Jim,
--     2026-09-29, "Go with recommended"]);
--   - selectionChangeObserver is called once per selection change: it drives "Target changed".
-- Its state lives on _G (rule 03: it must survive a Reload Plug-in running this module again), and
-- the bridge task's updates, the window's task, its ticker and menu items all reach it there.

local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'
local LrView = import 'LrView'

local Events = require 'Events'
local HudState = require 'HudState'
local HudView = require 'HudView'
local Log = require 'Log'
local Prefs = require 'Prefs'

local Hud = {}

Hud.TITLE = "LrC-AVG - Vision Gateway"
local TICK_SECONDS = 1
local OPEN_WAIT_SECONDS = 10 -- a window whose onShow never came is given up after this long [inference]

-- state: the last update taken; seen: every session id taken; window: a counter, one per window;
-- open / opening: the window is shown / its task is posted; props: its property table; pending: the
-- click waiting for the engine; checks: a counter, one per selection check.
local H = _G.LrCAVG_Hud or { seen = {}, window = 0, checks = 0 }
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

local function pageSettings()
    local values = Prefs.read()
    local wire = {}
    for _, spec in ipairs(Prefs.SPECS) do wire[spec.wire] = values[spec.key] end
    return wire
end

-- Copies the view into the window's property table, when there is a window. Never yields.
local function refresh()
    local props = H.props
    if not props then return end
    local v = HudView.props(H.state, Events.connection(), livePending(), pageSettings())
    v.lastAction = H.lastAction or ""
    v.targetChanged = H.targetChanged or ""
    for key, value in pairs(v) do
        if props[key] ~= value then props[key] = value end
    end
end

-- The selected photo's uuid and name, "file (copy name)" for a virtual copy, which shares its
-- master's file [inference: a virtual copy has no file of its own] (nil, nil when none). The query runs outside any gate, the metadata reads inside the
-- read gate with LrTasks.pcall (rule 03; Photos.lua describe).
local function selectedPhoto()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then return nil, nil end
    local uuid, name
    catalog:withReadAccessDo(function()
        local okUuid, u = LrTasks.pcall(photo.getRawMetadata, photo, "uuid")
        local okName, n = LrTasks.pcall(photo.getFormattedMetadata, photo, "fileName")
        local okCopy, c = LrTasks.pcall(photo.getFormattedMetadata, photo, "copyName")
        uuid = okUuid and u or nil
        name = okName and n or nil
        if name and okCopy and type(c) == "string" and c ~= "" then name = name .. " (" .. c .. ")" end
    end)
    return uuid, name
end

-- Runs in a task. The catalog calls may yield, and a newer check may start meanwhile (a selection
-- change, an update): only the newest check writes its line.
local function checkSelection()
    H.checks = H.checks + 1
    local mine = H.checks
    local ok, uuid, name = LrTasks.pcall(selectedPhoto)
    if mine ~= H.checks then return end
    if not ok then
        Log.warn("hud: could not read the selected photo: " .. tostring(uuid))
        return
    end
    H.targetChanged = HudState.targetChangedLine(H.state, uuid, name)
    refresh()
end

-- Logged before the call: the window closes inside it (S8, handle at the top), and windowWillClose
-- logs "closed".
function Hud.close(reason)
    Log.info("hud: closing, " .. reason)
    local ok, err = LrTasks.pcall(LrDialogs.closeFloatingDialogsForPlugin, _PLUGIN)
    if not ok then Log.error("hud: closeFloatingDialogsForPlugin failed: " .. tostring(err)) end
end

-- While window `mine` is open: expire a pending click, close after a session's end, and refresh the
-- connection line once a second (it comes from the bridge, not from the engine's updates).
local function ticker(mine)
    while H.window == mine and H.open do
        if H.closeAt and LrDate.currentTime() >= H.closeAt then
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
        selectionChangeObserver = function() LrTasks.startAsyncTask(checkSelection) end,
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

-- The half that runs in a task: send, and say what happened. Returns sent, the line shown.
local function finish(p)
    local ok, why = Events.send(p.name, p.payload)
    if ok then
        H.lastAction = p.label .. " sent at " .. clock() .. "; waiting for the engine"
    else
        if H.pending == p then H.pending = nil end
        H.lastAction = p.label .. " NOT sent: " .. why
    end
    Log.info("hud: " .. p.name .. " " .. p.click_id .. " from the " .. p.payload.source .. (ok and ": sent" or (": not sent, " .. why)))
    refresh()
    return ok, H.lastAction
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

-- Menu items Abort Session / Accept Session (FR-1.1, decision 7). Runs in a task; the outcome is
-- stated in a message with a plain headline (rule 04).
function Hud.menuEvent(name)
    local p, why = begin(name, nil, "menu")
    local ok, line = false, why
    if p then ok, line = finish(p) end
    local label = string.upper(HudState.eventLabel(name, nil, H.state))
    LrDialogs.message("LrC-AVG: " .. label .. (ok and " SENT" or " NOT SENT"), line, ok and "info" or "warning")
end

return Hud
