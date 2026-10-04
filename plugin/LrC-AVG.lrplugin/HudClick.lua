-- The HUD's clicks and menu items (PRD section 6.3, FR-1.1; PHASE5_PLAN row 4), moved out of Hud.lua
-- in fix/hud-p1 (module size, rule 01). A click is checked and marked pending where nothing can
-- yield, then sent from a task (Events.lua); a menu item runs in a task and may wait for the engine.
-- Hud.lua owns the window and passes `refresh` (copy the view into the window) and `show` (open it).
-- The HUD's state is on _G (rule 03), shared with Hud.lua. Every line it writes is HudText's.
-- Put back (plugin 0.12.0) is a click with no event: the plugin applies the snapshot itself (below).

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Events = require 'Events'
local Gate = require 'Gate'
local HudState = require 'HudState'
local HudText = require 'HudText'
local Log = require 'Log'
local Photos = require 'Photos'

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

-- Put back (plugin 0.12.0, PR C step 2b; HudState.canPutBack says when it is on): the update's
-- `put_back` snapshot applied to its photo by uuid, as lr_end_session "revert" does
-- (engine\src\session\end.ts; Develop.lua applySnapshot), selected or not (Photos.find). Steps:
--   - the snapshot is looked up first, so a missing one is said plainly;
--   - the write goes through Gate.write, which waits up to Gate.WAIT_SECONDS for write access, so a
--     put-back clicked while Lightroom shows a message inside another gate runs once the user clicks
--     OK there, instead of failing at once as a gate without timeoutParams does ("blocked by another
--     write access call, and no timeout parameters were provided" [handle:
--     %TEMP%\LrC-AVG\bridge.log 2026-10-03 19:22:58, quoted in repo logs\masks-step2b-plan.md
--     (gitignored), "What failed"]). Gate.lua says what the SDK returns; that the wait holds behind
--     Lightroom's own message is [unverified];
--   - the photo's settings are read back. The plugin holds no copy of the settings before the edit,
--     so "done" means the snapshot applied and the photo reads; applyDevelopSnapshot restored all six
--     fixtures with 0 settings differing [handle: LR_SDK_NOTES "Recorded in Phase 3", the run
--     `fixtures[*].ac2`]. Whether a read gate also waits behind such a message is [unverified].
-- No dialog opens (LR_SDK_NOTES "The HUD in use": a message box opened behind the HUD); the outcome
-- is the feedback line, and every step is in bridge.log. After "done" the window closes itself
-- CLOSE_SECONDS later, Claude Code's choice for Jim to confirm: he found the HUD left open on a dead
-- edit (Hud.lua header), and the stay-open rule (D2) is for edits the engine ends [inference]. It
-- does not close once an update has come since the click (the engine is back, Hud.lua update), and
-- after a failure it stays open with the way to do it by hand.
HudClick.PUT_BACK = "put_back"
HudClick.CLOSE_SECONDS = 5

local PB, PB_REASON = HudText.PUT_BACK, HudText.PUT_BACK_REASON

-- Runs in a task. Returns true, or nil, the reason (HudText) and a detail for the log.
local function putBackTo(pb)
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, pb.photo_uuid)
    if not photo then return nil, PB_REASON.no_photo, found.message end
    local known = false
    catalog:withReadAccessDo(function()
        for _, snap in ipairs(photo:getDevelopSnapshots() or {}) do
            if snap.snapshotID == pb.snapshot_id then known = true end
        end
    end)
    if not known then return nil, PB_REASON.no_snapshot, "no snapshot " .. pb.snapshot_id end
    local gated, busy = Gate.write(catalog, "AVG put back", function() photo:applyDevelopSnapshot(pb.snapshot_id) end)
    if not gated then return nil, string.format(PB_REASON.busy, Gate.WAIT_SECONDS), busy.message end
    local settings
    catalog:withReadAccessDo(function() settings = photo:getDevelopSettings() end)
    if type(settings) ~= "table" or next(settings) == nil then return nil, PB_REASON.read_back, "no settings read back" end
    return true
end

local function putBack(refresh)
    local s = H.state
    local pb = s and s.put_back
    -- The button is greyed otherwise; this also stops a second click while one runs.
    if not pb or (H.putBack and H.putBack.state ~= "failed") then return end
    local attempt = { state = "running", line = PB.running, seq = s.seq }
    H.putBack = attempt
    Log.info("hud: put back " .. pb.photo_uuid .. " to snapshot " .. pb.snapshot_id .. " (" .. pb.snapshot_name .. "), session " .. s.session_id)
    refresh()
    LrTasks.startAsyncTask(function()
        local t0 = LrDate.currentTime()
        local ok, done, reason, detail = LrTasks.pcall(putBackTo, pb)
        if not ok then done, reason, detail = nil, PB_REASON.error, done end
        local ms = tostring(math.floor((LrDate.currentTime() - t0) * 1000 + 0.5))
        if done then
            attempt.state, attempt.line = "done", PB.done
            Log.info("hud: put back done in " .. ms .. " ms")
        else
            attempt.state, attempt.line = "failed", string.format(PB.failed, reason, pb.snapshot_name)
            Log.warn("hud: put back not possible after " .. ms .. " ms: " .. reason .. " (" .. tostring(detail) .. ")")
        end
        refresh()
        if not done then return end
        LrTasks.sleep(HudClick.CLOSE_SECONDS)
        if H.putBack == attempt and H.open and H.state and H.state.seq == attempt.seq then
            Log.info("hud: closing after the put-back")
            LrDialogs.closeFloatingDialogsForPlugin(_PLUGIN)
        end
    end)
end

-- A button's action (HudView.lua). It cannot yield (S8), so the send (or the put-back) runs in a task.
function HudClick.click(name, variant, refresh)
    if name == HudClick.PUT_BACK then return putBack(refresh) end
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
