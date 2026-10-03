-- The bridge's two LrSocket listeners (ARCHITECTURE section 3, AVG-004), moved out of Bridge.lua in
-- PHASE4_PLAN row 6. Against a fake Lightroom, main's bridge and this one bound, re-armed and rebound
-- their sockets at the same steps [handle: docs\reports\phase4\variants-plugin-smoke\smoke.txt
-- "== Bridge", "same socket history"]:
--   receive socket (8765): commands from the engine; each line is handed to a new task
--   send socket    (8766): responses and events to the engine
-- The rules they follow (P-13 re-arm and rebind, generation counters) are described at the top of
-- Bridge.lua, whose monitor loop calls the two rebind functions below.
--
-- `B` is the running bridge: { context, generation, S (state), receivePort, sendPort, current(), onLine(line),
-- onSendConnected() }. Callbacks only set flags in `S`; the monitor loop acts on them.

local LrDate = import 'LrDate'
local LrSocket = import 'LrSocket'
local LrTasks = import 'LrTasks'

local Log = require 'Log'

local Sockets = {}

local function isNoClientError(err)
    return err == "timeout" or err:find("failed to open", 1, true) ~= nil
end

-- "failed to open" is also what LrSocket reports when something else already listens on the port:
-- another process, or an instance of the plugin that Reload Plug-in left running [upstream claim:
-- Automaat commit 923f27d, PluginInfoProvider.lua:95-108, 118-127, 461-462, 518-519]. Recovery stays
-- the same (re-arm), but the failure is logged, at most once per BIND_LOG_SECONDS per socket, with the
-- bridge generation, since an old and a new instance write to the same log (GitHub issue #60). The
-- times live in this generation's state `S`: a new generation logs its own failures, so nothing needs
-- to survive on _G. Whether a clean, idle Lightroom on Windows reports "failed to open" while it
-- re-arms is [unverified]; Automaat saw none on macOS [upstream claim: commit 923f27d message].
local BIND_LOG_SECONDS = 10

local function logBindFailure(B, side, port, err)
    if not err:find("failed to open", 1, true) then return end
    local now, S = LrDate.currentTime(), B.S
    S.bindLoggedAt = S.bindLoggedAt or {}
    if S.bindLoggedAt[side] and now - S.bindLoggedAt[side] < BIND_LOG_SECONDS then return end
    S.bindLoggedAt[side] = now
    Log.warn(string.format("bridge: %s port %d failed to open (%s, generation %d); if this repeats, another "
        .. "process or a leftover instance of this plugin may hold it", side, port, err, B.generation))
end

local function bindReceive(B, myGen)
    local S = B.S
    local function live() return S.receiveGen == myGen and B.current() end
    return LrSocket.bind {
        functionContext = B.context,
        plugin = _PLUGIN,
        port = B.receivePort,
        mode = "receive",
        onConnected = function()
            if not live() then return end
            S.receiveConnected = true
            S.lastInbound = LrDate.currentTime()
            -- A new engine connection. If the send socket still looks connected, that is the
            -- old client it never noticed leaving (P-13): rebind it for the new one.
            if S.sendConnected then
                S.sendConnected = false
                S.sendNeedsRebind = true
            end
            Log.info("bridge: receive: engine connected")
        end,
        -- onMessage runs in a non-yielding context, so it only hands the line to a new task
        -- [upstream claim: PluginInfoProvider.lua:419-426].
        onMessage = function(_, message)
            if not live() then return end
            S.lastInbound = LrDate.currentTime()
            LrTasks.startAsyncTask(function() B.onLine(message) end)
        end,
        onClosed = function()
            if not live() then return end
            S.receiveConnected = false
            S.receiveNeedsReconnect = true
            Log.info("bridge: receive: closed")
        end,
        onError = function(_, err)
            if not live() then return end
            local e = tostring(err)
            logBindFailure(B, "receive", B.receivePort, e)
            if isNoClientError(e) then
                if not S.receiveConnected then S.receiveNeedsReconnect = true end
            else
                S.receiveConnected = false
                S.receiveNeedsReconnect = true
                Log.warn("bridge: receive: error " .. e)
            end
        end,
    }
end

local function bindSend(B, myGen)
    local S = B.S
    local function live() return S.sendGen == myGen and B.current() end
    return LrSocket.bind {
        functionContext = B.context,
        plugin = _PLUGIN,
        port = B.sendPort,
        mode = "send",
        onConnected = function()
            if not live() then return end
            S.sendConnected = true
            Log.info("bridge: send: engine connected")
            LrTasks.startAsyncTask(B.onSendConnected)
        end,
        onClosed = function()
            if not live() then return end
            S.sendConnected = false
            S.sendNeedsRebind = true
            Log.info("bridge: send: closed")
        end,
        onError = function(_, err)
            if not live() then return end
            local e = tostring(err)
            logBindFailure(B, "send", B.sendPort, e)
            if isNoClientError(e) then
                if not S.sendConnected then S.sendNeedsReconnect = true end
            else
                S.sendConnected = false
                S.sendNeedsRebind = true
                Log.warn("bridge: send: error " .. e)
            end
        end,
    }
end

-- Close and bind again. The generation is bumped before close() so a callback fired during
-- close sees itself as stale [upstream claim: PluginInfoProvider.lua:462-467, 520-526].
-- The old socket is dropped before binding, so a bind that raises leaves no socket and the
-- next tick binds again.
function Sockets.rebindReceive(B)
    local S = B.S
    S.receiveGen = S.receiveGen + 1
    if S.receiveSocket then LrTasks.pcall(function() S.receiveSocket:close() end) end
    S.receiveSocket, S.receiveConnected = nil, false
    LrTasks.sleep(0.1)
    S.receiveSocket = bindReceive(B, S.receiveGen)
    S.receiveNeedsRebind, S.receiveNeedsReconnect = false, false
end

function Sockets.rebindSend(B)
    local S = B.S
    S.sendGen = S.sendGen + 1
    if S.sendSocket then LrTasks.pcall(function() S.sendSocket:close() end) end
    S.sendSocket, S.sendConnected = nil, false
    LrTasks.sleep(0.1)
    S.sendSocket = bindSend(B, S.sendGen)
    S.sendNeedsRebind, S.sendNeedsReconnect = false, false
end

return Sockets
