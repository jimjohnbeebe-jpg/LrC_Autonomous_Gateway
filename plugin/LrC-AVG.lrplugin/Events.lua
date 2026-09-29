-- Events to the engine, and the bridge's connection state, for code outside the bridge task: the
-- HUD's buttons and the menu items (PHASE5_PLAN row 4; ARCHITECTURE section 3, events plugin ->
-- engine). The running bridge leaves a handle on _G when it starts (Bridge.lua start); state that must
-- survive a module body running again lives on _G (rule 03). The init script's task, menu item
-- scripts and the plug-in info provider share _G [handle: LR_SDK_NOTES "Recorded in Phase 5", Shared
-- state; docs\reports\phase5\S8.md Numbers, "_G shared"]. This module does not require Bridge.lua,
-- which requires the dispatch and so the HUD: that would be a require loop.

local Events = {}

local function live()
    local handle = _G.LrCAVG_BridgeLive
    if handle and handle.current() then return handle end
    return nil
end

-- { running, engine }: running, a bridge generation is live; engine, both sockets are connected and
-- the engine spoke within the last 6 s (Bridge.lua ENGINE_QUIET_SECONDS, PRD FR-1.3).
function Events.connection()
    local handle = live()
    if not handle then return { running = false, engine = false } end
    return { running = true, engine = handle.engineConnected() == true }
end

-- Sends one event. Runs in a task: the bridge's send may wait up to 5 s for its send socket
-- (Bridge.lua SEND_WAIT_SECONDS). Returns true, or false and why, in words the HUD shows.
function Events.send(name, payload)
    local handle = live()
    if not handle then return false, "the LrC-AVG bridge is not running" end
    if handle.engineConnected() ~= true then return false, "the engine is not connected" end
    local ok, why = handle.sendEvent(name, payload)
    if ok then return true end
    if why == "encode" then return false, "the event could not be encoded" end
    return false, "the engine is not connected"
end

return Events
