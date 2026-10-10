-- LrC-AVG bridge (ARCHITECTURE sections 2-3, AVG-004). Lightroom listens; the engine connects.
--   receive socket, port 8765: commands from the engine
--   send socket,    port 8766: responses and events to the engine
-- One JSON object per line, UTF-8. Envelope: { id, type = "cmd" | "res" | "evt", name, ts, payload }.
-- A response carries the command's id and name plus ok; on failure it has
-- error = { code, message, recoverable } instead of a payload (PRD NFR-7).
-- The listeners are in Sockets.lua and the command handlers in Dispatch.lua (split out in
-- PHASE4_PLAN row 6), the token and ports files in Endpoint.lua (PHASE5_PLAN row 3); this file holds
-- the bridge's state, its replies, its status file and the monitor loop. The ports come from the
-- settings page, checked by Prefs.lua; a change applies when the bridge next starts.
--
-- Socket handling follows spike S2 (plugin\spikes\S2.lrplugin\S2Server.lua), which ran on LrC 15.5.1,
-- and Automaat (vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua:384-589, MIT, see
-- THIRD_PARTY_NOTICES.md), with the Phase 0 rules accepted by Jim 2026-09-26:
--   P-13  Listeners are re-armed from the monitor loop, never from a callback. With no client they
--         cycle about every 10 s. The send socket did not fire onClosed when its client left, so it is
--         rebound when a new client connects on the receive side while it still looks connected
--         [handle: docs\reports\phase0\S2.md "Consequences"]. The engine pings every 2 s (FR-1.3).
--   P-15  Bridge state lives in the one long-running task started here, not in _G shared with menu
--         scripts. The menu item reads the status file <temp>\LrC-AVG\bridge_status.json instead.
--         Since plugin 0.6.0 (PHASE5_PLAN row 4) the task also leaves a small handle on _G, so the
--         HUD's buttons and the menu items can send events and read the connection (Events.lua):
--         S8 found menu items and the task sharing _G [handle: LR_SDK_NOTES "Recorded in Phase 5",
--         Shared state].
--
-- Token: every command must carry the token this bridge wrote at start to
-- %USERPROFILE%\.lrc-avg\bridge_token; any other command is refused with "unauthorized". Without it,
-- any local program, or a web page posting to 127.0.0.1:8765, could send Develop commands (Greptile,
-- PR #14). The pattern and the home-folder location follow Automaat
-- [upstream claim: PluginInfoProvider.lua:87-127, 313-319]; Jim chose it on 2026-09-26 [stated].
-- A program running as the same Windows user can still read the file.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Dispatch = require 'Dispatch'
local Endpoint = require 'Endpoint'
local Hud = require 'Hud'
local Json = require 'Json'
local Log = require 'Log'
local Prefs = require 'Prefs'
local Sockets = require 'Sockets'

local Bridge = {}

Bridge.PROTOCOL = 1
Bridge.PLUGIN_VERSION = "0.19.1"
Bridge.SDK_DECLARED = 13.0 -- Info.lua LrSdkVersion; the SDK version LrC 15.5.1 ships is [unverified]
Bridge.STATUS_FILE = "bridge_status.json"

local LOOP_SECONDS = 0.2
local ENGINE_QUIET_SECONDS = 6     -- three missed 2 s heartbeats (PRD FR-1.3)
local STALE_REBIND_SECONDS = 20    -- silent this long while connected: rebind both sockets [inference]
local SEND_WAIT_SECONDS = 5        -- how long a reply waits for the send socket to be connected
local STATUS_EVERY_SECONDS = 2
local SETTLE_SECONDS = 0.6         -- lets a replaced instance close its sockets before we bind

-- Only a generation number lives on _G. A Reload Plug-in runs the init script again in the same Lua
-- state [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInit.lua:8-15]; the old
-- monitor loop sees that it has been replaced and stops (rule 03: state that must survive
-- re-execution of a module body lives on _G). On LrC 15.6 the reload started a fresh _G instead, so
-- the monitor also stops when the token file shows a newer start (replacedOnDisk below).
_G.LrCAVG_BridgeGeneration = _G.LrCAVG_BridgeGeneration or 0

local function isoNow()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

-- When this Lua state first loaded the bridge (plugin 0.16.0, D16): a Lightroom restart starts a new one
-- [inference: _G is per Lua state], so the engine reads another value in hello as a restart
-- (engine\src\session\restart.ts). On LrC 15.6 a Reload Plug-in started a fresh _G too (see the
-- generation note above), so a reload also reads as a restart. One second's resolution.
_G.LrCAVG_ProcessStartedAt = _G.LrCAVG_ProcessStartedAt or isoNow()

function Bridge.helloPayload(receivePort, sendPort)
    return {
        protocol = Bridge.PROTOCOL,
        plugin_version = Bridge.PLUGIN_VERSION,
        lrc_version = LrApplication.versionString(),
        sdk_declared = Bridge.SDK_DECLARED,
        ports = { receive = receivePort, send = sendPort },
        process_started_at = _G.LrCAVG_ProcessStartedAt,
    }
end

-- Runs from the context's cleanup handler, which may not be a task, so it keeps the plain
-- pcall of spike S2 (plugin\spikes\S2.lrplugin\S2Server.lua:93-100).
local function closeAll(S, reason)
    if S.receiveSocket then pcall(function() S.receiveSocket:close() end) end -- plain pcall: cleanup handler
    if S.sendSocket then pcall(function() S.sendSocket:close() end) end -- plain pcall: cleanup handler
    S.receiveSocket, S.sendSocket = nil, nil
    S.receiveConnected, S.sendConnected = false, false
    Log.info("bridge: sockets closed (" .. reason .. ")")
end

-- Runs in a task (it may sleep while the send socket settles).
-- Returns true, or false plus "encode" (with the error) or "socket".
local function send(B, envelope)
    local S = B.S
    envelope.ts = isoNow()
    local okEncode, line = pcall(Json.encode, envelope) -- plain pcall: pure Lua, no yield
    if not okEncode then
        Log.error("bridge: cannot encode " .. tostring(envelope.name) .. ": " .. tostring(line))
        return false, "encode", tostring(line)
    end
    local waited = 0
    while not (S.sendSocket and S.sendConnected) and waited < SEND_WAIT_SECONDS and B.current() do
        LrTasks.sleep(0.1)
        waited = waited + 0.1
    end
    if not (S.sendSocket and S.sendConnected) then
        Log.warn("bridge: dropped " .. envelope.type .. " " .. tostring(envelope.name) .. " (send socket not connected)")
        return false, "socket"
    end
    -- LrTasks.pcall (rule 03): a plain pcall would turn a yield inside send() into a silent failure.
    local sent, err = LrTasks.pcall(function() S.sendSocket:send(line .. "\n") end)
    if not sent then
        Log.error("bridge: send failed: " .. tostring(err))
        S.sendConnected = false
        S.sendNeedsRebind = true
        return false, "socket"
    end
    return true
end

local function respond(B, id, name, ok, body)
    local envelope = { id = id, type = "res", name = name, ok = ok }
    if ok then envelope.payload = body else envelope.error = body end
    local sent, why, detail = send(B, envelope)
    if not sent and why == "encode" then
        -- The result held something JSON cannot carry: tell the engine instead of going silent.
        sent = send(B, { id = id, type = "res", name = name, ok = false,
            error = { code = "encode_failed", message = detail, recoverable = false } })
    end
    return sent
end

-- Both sockets connected and a message within ENGINE_QUIET_SECONDS: the status file's
-- engine_connected, and the HUD's (Events.lua).
local function engineConnected(S)
    local quiet = S.lastInbound and (LrDate.currentTime() - S.lastInbound) or nil
    return (S.receiveConnected and S.sendConnected and quiet ~= nil and quiet < ENGINE_QUIET_SECONDS) == true
end

local function writeStatus(B)
    local S = B.S
    local now = LrDate.currentTime()
    local quiet = S.lastInbound and (now - S.lastInbound) or nil
    local status = {
        generation = B.generation,
        running = true,
        updated_at = isoNow(),
        updated_epoch = os.time(),
        started_at = S.startedAt,
        plugin_version = Bridge.PLUGIN_VERSION,
        lrc_version = LrApplication.versionString(),
        ports = { receive = B.receivePort, send = B.sendPort },
        receive_connected = S.receiveConnected,
        send_connected = S.sendConnected,
        engine_connected = engineConnected(S),
        seconds_since_last_message = quiet,
        commands_handled = S.handled,
        commands_failed = S.failed,
        commands_unauthorized = S.unauthorized,
        lines_malformed = S.malformed,
        token_file = S.tokenFile,
        token_written = S.token ~= nil,
        ports_file = S.portsFile,
        ports_written = S.portsWritten,
        log_tail = Log.tail(20),
    }
    local okEncode, text = pcall(Json.encode, status) -- plain pcall: pure Lua, no yield
    if okEncode then Log.writeFile(Bridge.STATUS_FILE, text) end
    B.lastStatus = now
end

-- Binds or re-arms the sockets as their flags ask. A bind or re-arm that raises (e.g. the port is
-- still held) is logged and retried on a later tick instead of ending the bridge task. `onFail`
-- puts back the work that must be retried.
local function tendSockets(B)
    local S = B.S
    local function safely(what, fn, onFail)
        local ok, err = LrTasks.pcall(fn)
        if not ok then
            Log.error("bridge: " .. what .. " failed: " .. tostring(err) .. "; retrying in 2 s")
            B.retryAt = LrDate.currentTime() + 2
            if onFail then onFail() end
        end
    end
    if S.receiveNeedsRebind or not S.receiveSocket then
        safely("receive bind", function() Sockets.rebindReceive(B) end)
    elseif S.receiveNeedsReconnect then
        S.receiveNeedsReconnect = false
        -- If re-arming fails, bind afresh on the next try rather than dropping the retry.
        safely("receive re-arm", function() S.receiveSocket:reconnect() end,
            function() S.receiveNeedsRebind = true end)
    end
    if S.sendNeedsRebind or not S.sendSocket then
        safely("send bind", function() Sockets.rebindSend(B) end)
    elseif S.sendNeedsReconnect then
        S.sendNeedsReconnect = false
        safely("send re-arm", function() S.sendSocket:reconnect() end,
            function() S.sendNeedsRebind = true end)
    end
end

-- True once a newer bridge has started: the token file no longer holds this bridge's token (every
-- start writes its own, Endpoint.newToken). The _G generation alone did not stop an old bridge on
-- LrC 15.6: after Reload Plug-in both bridges said "starting generation 1" and both answered on
-- 8765/8766, one refusing the other's token [handle: %TEMP%\LrC-AVG\bridge.log 2026-10-04 12:12:04
-- and 12:32:36 "starting generation 1", then "refused hello ... (missing or wrong token)" alternating
-- with "hello" from 12:33:31; copied into docs\reports\phase6\automaat-files-check\check.txt]. An
-- unreadable or empty file is not taken as a replacement.
local function replacedOnDisk(S)
    if not S.token then return false end
    local fh = io.open(S.tokenFile, "r")
    if not fh then return false end
    local text = fh:read("*a")
    fh:close()
    return type(text) == "string" and text ~= "" and text ~= S.token
end

local function monitor(B)
    local S = B.S
    while B.current() do
        if LrDate.currentTime() - B.lastStatus >= STATUS_EVERY_SECONDS and replacedOnDisk(S) then
            Log.info("bridge: generation " .. B.generation .. " replaced by a newer start (token file)")
            return
        end
        if LrDate.currentTime() >= B.retryAt then tendSockets(B) end
        -- Windows may not report a vanished engine at all [upstream claim: PluginInfoProvider.lua:558-560].
        -- The engine pings every 2 s, so a long silence means it is gone: start both sockets afresh.
        if S.receiveConnected and S.lastInbound and (LrDate.currentTime() - S.lastInbound) > STALE_REBIND_SECONDS then
            Log.warn("bridge: no message for " .. STALE_REBIND_SECONDS .. " s; rebinding both sockets")
            S.lastInbound = nil
            S.receiveNeedsRebind, S.sendNeedsRebind = true, true
        end
        if LrDate.currentTime() - B.lastStatus >= STATUS_EVERY_SECONDS then writeStatus(B) end
        LrTasks.sleep(LOOP_SECONDS)
    end
end

function Bridge.start()
    _G.LrCAVG_BridgeGeneration = _G.LrCAVG_BridgeGeneration + 1
    local generation = _G.LrCAVG_BridgeGeneration
    local receivePort, sendPort = Prefs.ports()
    local B = {
        generation = generation, receivePort = receivePort, sendPort = sendPort,
        current = function() return _G.LrCAVG_BridgeGeneration == generation end,
        lastStatus = 0, retryAt = 0,
        S = {
            receiveSocket = nil, sendSocket = nil,
            receiveGen = 0, sendGen = 0,
            receiveConnected = false, sendConnected = false,
            receiveNeedsReconnect = false, sendNeedsReconnect = false,
            receiveNeedsRebind = false, sendNeedsRebind = false,
            lastInbound = nil, handled = 0, failed = 0, malformed = 0, unauthorized = 0,
            startedAt = isoNow(),
            token = nil, tokenFile = Endpoint.tokenPath(),
            portsFile = Endpoint.portsPath(), portsWritten = false,
        },
    }
    Log.info(string.format("bridge: starting generation %d (receive %d, send %d)", generation, receivePort, sendPort))

    LrFunctionContext.postAsyncTaskWithContext("LrC-AVG bridge", function(context)
        B.context = context
        context:addCleanupHandler(function() closeAll(B.S, "task ended") end)
        -- The engine sends hello once per connection (engine\src\bridge\client.ts:237): the HUD
        -- marks its open edit unknown before the reply (Hud.markUnknown says why there, fix/hud-p1).
        -- A HUD error must not fail the handshake, or no command would work (fix/hud-p1 review).
        local handlers = Dispatch.handlers(function()
            local ok, err = LrTasks.pcall(Hud.markUnknown)
            if not ok then Log.error("hud: markUnknown failed: " .. tostring(err)) end
            return Bridge.helloPayload(receivePort, sendPort)
        end)
        local function reply(id, name, ok, body) return respond(B, id, name, ok, body) end
        B.onLine = function(line) Dispatch.handleLine(B.S, handlers, reply, line) end
        B.onSendConnected = function()
            send(B, { id = LrUUID.generateUUID(), type = "evt", name = "hello",
                payload = Bridge.helloPayload(receivePort, sendPort) })
        end
        -- The handle Events.lua reads: this generation's event sender and connection state. A
        -- replaced generation's handle answers current() false, so nothing is sent through it.
        _G.LrCAVG_BridgeLive = {
            current = B.current,
            engineConnected = function() return engineConnected(B.S) end,
            sendEvent = function(name, payload)
                return send(B, { id = LrUUID.generateUUID(), type = "evt", name = name, payload = payload })
            end,
        }

        LrTasks.sleep(SETTLE_SECONDS)
        if not B.current() then return end
        local okToken, tokenOrErr = LrTasks.pcall(Endpoint.newToken)
        B.S.token = okToken and tokenOrErr or nil
        -- No token: every command would be refused, and a bridge without one could never see a newer
        -- start (replacedOnDisk), so it would keep the ports through a reload (CodeRabbit, PR #73).
        -- It does not start; Endpoint.newToken has logged why when it returned nil.
        if not B.S.token then
            Log.error("bridge: no token (" .. tostring(okToken and "not written" or tokenOrErr) .. "); the bridge is not started")
            return
        end
        local okPorts, portsOrErr = LrTasks.pcall(Endpoint.writePorts, receivePort, sendPort, Bridge.PLUGIN_VERSION, B.S.token)
        B.S.portsWritten = okPorts and portsOrErr ~= nil
        if not okPorts then Log.error("bridge: ports file failed: " .. tostring(portsOrErr)) end
        Log.info("bridge: listening (generation " .. generation .. ")")
        monitor(B)
        Log.info("bridge: generation " .. generation .. " replaced; loop exiting")
    end)
end

return Bridge
