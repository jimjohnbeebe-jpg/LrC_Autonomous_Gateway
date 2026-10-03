-- The HUD's clicks and menu items (PRD section 6.3, FR-1.1; PHASE5_PLAN row 4), moved out of Hud.lua
-- in fix/hud-p1 (module size, rule 01). A click is checked and marked pending where nothing can
-- yield, then sent from a task (Events.lua); a menu item runs in a task and may wait for the engine.
-- Hud.lua owns the window and passes `refresh` (copy the view into the window) and `show` (open it).
-- The HUD's state is on _G (rule 03), shared with Hud.lua. Every line it writes is HudText's.

local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Events = require 'Events'
local HudState = require 'HudState'
local HudText = require 'HudText'
local Log = require 'Log'

local HudClick = {}

local H = _G.LrCAVG_Hud or { seen = {}, window = 0 }
_G.LrCAVG_Hud = H

local R, CLICK, notSent = HudText.REASON, HudText.CLICK, HudText.notSent

-- The pending click, or nil once it has waited HudState.PENDING_SECONDS: then the buttons come back.
function HudClick.livePending()
    local p = H.pending
    if p and LrDate.currentTime() - p.at >= HudState.PENDING_SECONDS then
        H.pending = nil
        H.lastAction = string.format(CLICK.no_answer, p.label, HudState.PENDING_SECONDS)
        Log.warn("hud: " .. p.name .. " " .. p.click_id .. " got no answer")
        return nil
    end
    return p
end

-- The half of a click or menu item that must not yield: the checks, then the click marked pending
-- (the buttons go off). Returns the pending click, or nil, its label and why not. An edit marked
-- unknown at an engine connection (Hud.markUnknown) is not sent to: the engine may not know it.
local function begin(name, variant, source)
    local s = H.state
    local label = HudState.eventLabel(name, variant, s)
    local refusal = HudState.refusal(s, name, variant)
    if refusal then return nil, label, refusal end
    local p = HudClick.livePending()
    if p then return nil, label, string.format(R.pending, p.label) end
    local conn = Events.connection()
    if not conn.engine then return nil, label, conn.running and R.not_connected or R.not_running end
    if H.unknownAt then return nil, label, R.gone end
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
        return false, notSent(p.label, R.changed)
    end
    local ok, why = Events.send(p.name, p.payload)
    local line = ok and string.format(CLICK.sent, p.label) or notSent(p.label, why)
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
    local p, label, why = begin(name, variant, "hud")
    if not p then
        H.lastAction = notSent(label, why)
        refresh()
        return
    end
    refresh()
    LrTasks.startAsyncTask(function() finish(p, refresh) end)
end

-- The menu items (FR-1.1, decision 7; Approve Pass and Pick A-C from fix/hud-p1 P1-4). Run in a task.
-- In the row 4 probe the menu items found the engine "not connected": the plugin logged nothing
-- while Jim used the menu, and the engine dropped on its heartbeat [handle: repo
-- logs\probe-hud-2026-09-29\ (gitignored), bridge-log-excerpt.txt 05:56:09-05:58:49]; Lightroom
-- pausing the plugin's tasks while a menu or message box is open is [inference]. So an item waits up
-- to MENU_WAIT_SECONDS for the engine, and for an edit being checked after a connection, then sends,
-- and its outcome goes to the HUD's feedback line (opening the HUD): the message box used before
-- opened behind the HUD [stated: Jim, 2026-09-29].
HudClick.MENU_WAIT_SECONDS = 20

local function mustWait()
    return not Events.connection().engine or HudState.unknown(H.unknownAt, LrDate.currentTime()) == "checking"
end

function HudClick.menuEvent(name, variant, refresh, show)
    local label = HudState.eventLabel(name, variant, H.state)
    local line
    local refusal = HudState.refusal(H.state, name, variant)
    if refusal then
        line = notSent(label, refusal)
        H.lastAction = line
    else
        local chosen, waited = H.state.session_id, 0
        while mustWait() and waited < HudClick.MENU_WAIT_SECONDS do
            LrTasks.sleep(0.5)
            waited = waited + 0.5
        end
        -- Chosen for that session: never sent to one that began during the wait (Greptile, PR #46).
        local p, why = nil, R.changed
        if H.state.session_id == chosen then p, label, why = begin(name, variant, "menu") end
        if p then
            local _, sent = finish(p, refresh) -- finish shows its own line while the click is current (PR #45)
            line = sent
        else
            local waitedText = waited >= HudClick.MENU_WAIT_SECONDS and string.format(CLICK.waited, HudClick.MENU_WAIT_SECONDS) or ""
            line = notSent(label, why .. waitedText)
            H.lastAction = line
        end
    end
    Log.info("hud: menu " .. name .. ": " .. line)
    show()
    refresh()
end

return HudClick
