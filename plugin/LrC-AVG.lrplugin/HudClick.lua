-- The HUD's clicks and menu items (PRD section 6.3, FR-1.1; PHASE5_PLAN row 4), moved out of Hud.lua
-- in fix/hud-p1 (module size, rule 01). A click is checked and marked pending where nothing can
-- yield, then sent from a task (Events.lua); a menu item runs in a task and may wait for the engine.
-- Hud.lua owns the window and passes `refresh` (copy the view into the window) and `show` (open it).
-- The HUD's state is on _G (rule 03), shared with Hud.lua.

local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Events = require 'Events'
local HudState = require 'HudState'
local Log = require 'Log'

local HudClick = {}

local H = _G.LrCAVG_Hud or { seen = {}, window = 0 }
_G.LrCAVG_Hud = H

local function clock()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S")
end
HudClick.clock = clock

-- The pending click, or nil once it has waited HudState.PENDING_SECONDS: then the buttons come back.
function HudClick.livePending()
    local p = H.pending
    if p and LrDate.currentTime() - p.at >= HudState.PENDING_SECONDS then
        H.pending = nil
        H.lastAction = p.label .. ": no answer from the engine within " .. HudState.PENDING_SECONDS .. " s; the buttons are on again"
        Log.warn("hud: " .. p.name .. " " .. p.click_id .. " got no answer")
        return nil
    end
    return p
end

-- The half of a click or menu item that must not yield: the checks, then the click marked pending
-- (the buttons go off). Returns the pending click, or nil and why not.
local function begin(name, variant, source)
    local s = H.state
    local label = HudState.eventLabel(name, variant, s)
    local refusal = HudState.refusal(s, name, variant)
    if refusal then return nil, label .. " NOT sent: " .. refusal end
    local p = HudClick.livePending()
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
local function finish(p, refresh)
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
function HudClick.click(name, variant, refresh)
    local p, why = begin(name, variant, "hud")
    if not p then
        H.lastAction = why
        refresh()
        return
    end
    refresh()
    LrTasks.startAsyncTask(function() finish(p, refresh) end)
end

-- Menu items Abort Session / Accept Session (FR-1.1, decision 7). Runs in a task.
-- In the row 4 probe both found the engine "not connected": the plugin logged nothing while Jim used
-- the menu, and the engine dropped on its heartbeat [handle: repo logs\probe-hud-2026-09-29\
-- (gitignored), bridge-log-excerpt.txt 05:56:09-05:58:49]; Lightroom pausing the plugin's tasks
-- while a menu or message box is open is [inference]. So the item waits up to MENU_WAIT_SECONDS for
-- the engine, then sends, and its outcome goes to the HUD's line (opening the HUD): the message box
-- used before opened behind the HUD [stated: Jim, 2026-09-29].
HudClick.MENU_WAIT_SECONDS = 20

function HudClick.menuEvent(name, refresh, show)
    local line
    local refusal = HudState.refusal(H.state, name, nil)
    if refusal then
        line = HudState.eventLabel(name, nil, H.state) .. " NOT sent: " .. refusal
        H.lastAction = line
    else
        local chosen, waited = H.state.session_id, 0
        while not Events.connection().engine and waited < HudClick.MENU_WAIT_SECONDS do
            LrTasks.sleep(0.5)
            waited = waited + 0.5
        end
        -- Chosen for that session: never sent to one that began during the wait (Greptile, PR #46).
        local p, why = nil, HudState.eventLabel(name, nil, H.state) .. " NOT sent: the session changed while waiting for the engine"
        if H.state.session_id == chosen then p, why = begin(name, nil, "menu") end
        if p then
            local _, sent = finish(p, refresh) -- finish shows its own line while the click is current (PR #45)
            line = sent
        else
            line = why .. (waited >= HudClick.MENU_WAIT_SECONDS and (" (waited " .. HudClick.MENU_WAIT_SECONDS .. " s)") or "")
            H.lastAction = line
        end
    end
    Log.info("hud: menu " .. name .. ": " .. line)
    show()
    refresh()
end

return HudClick
