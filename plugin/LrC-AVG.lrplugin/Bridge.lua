-- LrC-AVG bridge (ARCHITECTURE sections 2-3, AVG-004). Lightroom listens; the engine connects.
--   receive socket, port 8765: commands from the engine
--   send socket,    port 8766: responses and events to the engine
-- One JSON object per line, UTF-8. Envelope: { id, type = "cmd" | "res" | "evt", name, ts, payload }.
-- A response carries the command's id and name plus ok; on failure it has
-- error = { code, message, recoverable } instead of a payload (PRD NFR-7).
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
-- onMessage runs in a non-yielding context, so it only hands the line to a new task
-- [upstream claim: PluginInfoProvider.lua:419-426].
--
-- Token: every command must carry the token this bridge wrote at start to
-- %USERPROFILE%\.lrc-avg\bridge_token; any other command is refused with "unauthorized". Without it,
-- any local program, or a web page posting to 127.0.0.1:8765, could send Develop commands (Greptile,
-- PR #14). The pattern and the home-folder location follow Automaat
-- [upstream claim: PluginInfoProvider.lua:87-127, 313-319]; Jim chose it on 2026-09-26 [stated].
-- A program running as the same Windows user can still read the file.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'
local LrSocket = import 'LrSocket'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Develop = require 'Develop'
local Json = require 'Json'
local Log = require 'Log'

local Bridge = {}

Bridge.PROTOCOL = 1
Bridge.PLUGIN_VERSION = "0.1.0"
Bridge.SDK_DECLARED = 13.0 -- Info.lua LrSdkVersion; the SDK version LrC 15.5.1 ships is [unverified]
Bridge.DEFAULT_RECEIVE_PORT = 8765
Bridge.DEFAULT_SEND_PORT = 8766
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
-- re-execution of a module body lives on _G).
_G.LrCAVG_BridgeGeneration = _G.LrCAVG_BridgeGeneration or 0

local function isNoClientError(err)
    return err == "timeout" or err:find("failed to open", 1, true) ~= nil
end

local function validPort(n)
    return type(n) == "number" and n == math.floor(n) and n >= 1 and n <= 65535
end

local function readPorts()
    local prefs = LrPrefs.prefsForPlugin()
    local receive, send = tonumber(prefs.receivePort), tonumber(prefs.sendPort)
    if not validPort(receive) then receive = Bridge.DEFAULT_RECEIVE_PORT end
    if not validPort(send) then send = Bridge.DEFAULT_SEND_PORT end
    return receive, send
end

local function isoNow()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function Bridge.tokenPath()
    return LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("home"), ".lrc-avg"), "bridge_token")
end

-- A fresh 256-bit token (two UUIDs without dashes), written for the engine to read. Returns the
-- token, or nil if the file cannot be written; then every command is refused.
local function newToken()
    local token = (LrUUID.generateUUID() .. LrUUID.generateUUID()):gsub("-", ""):lower()
    local path = Bridge.tokenPath()
    LrFileUtils.createAllDirectories(LrPathUtils.parent(path))
    local fh, err = io.open(path, "w")
    if not fh then
        Log.error("bridge: cannot write the token file " .. path .. ": " .. tostring(err) .. "; every command will be refused")
        return nil
    end
    fh:write(token)
    fh:close()
    Log.info("bridge: token written to " .. path)
    return token
end

function Bridge.helloPayload(receivePort, sendPort)
    return {
        protocol = Bridge.PROTOCOL,
        plugin_version = Bridge.PLUGIN_VERSION,
        lrc_version = LrApplication.versionString(),
        sdk_declared = Bridge.SDK_DECLARED,
        ports = { receive = receivePort, send = sendPort },
    }
end

function Bridge.start()
    _G.LrCAVG_BridgeGeneration = _G.LrCAVG_BridgeGeneration + 1
    local generation = _G.LrCAVG_BridgeGeneration
    local function current() return _G.LrCAVG_BridgeGeneration == generation end

    local receivePort, sendPort = readPorts()
    local S = {
        receiveSocket = nil, sendSocket = nil,
        receiveGen = 0, sendGen = 0,
        receiveConnected = false, sendConnected = false,
        receiveNeedsReconnect = false, sendNeedsReconnect = false,
        receiveNeedsRebind = false, sendNeedsRebind = false,
        lastInbound = nil, handled = 0, failed = 0, malformed = 0, unauthorized = 0,
        startedAt = isoNow(),
        token = nil,
    }
    Log.info(string.format("bridge: starting generation %d (receive %d, send %d)", generation, receivePort, sendPort))

    LrFunctionContext.postAsyncTaskWithContext("LrC-AVG bridge", function(context)
        local function closeAll(reason)
            if S.receiveSocket then pcall(function() S.receiveSocket:close() end) end
            if S.sendSocket then pcall(function() S.sendSocket:close() end) end
            S.receiveSocket, S.sendSocket = nil, nil
            S.receiveConnected, S.sendConnected = false, false
            Log.info("bridge: sockets closed (" .. reason .. ")")
        end
        context:addCleanupHandler(function() closeAll("task ended") end)

        -- Runs in a task (it may sleep while the send socket settles).
        -- Returns true, or false plus "encode" (with the error) or "socket".
        local function send(envelope)
            envelope.ts = isoNow()
            local okEncode, line = pcall(Json.encode, envelope)
            if not okEncode then
                Log.error("bridge: cannot encode " .. tostring(envelope.name) .. ": " .. tostring(line))
                return false, "encode", tostring(line)
            end
            local waited = 0
            while not (S.sendSocket and S.sendConnected) and waited < SEND_WAIT_SECONDS and current() do
                LrTasks.sleep(0.1)
                waited = waited + 0.1
            end
            if not (S.sendSocket and S.sendConnected) then
                Log.warn("bridge: dropped " .. envelope.type .. " " .. tostring(envelope.name) .. " (send socket not connected)")
                return false, "socket"
            end
            local sent, err = pcall(function() S.sendSocket:send(line .. "\n") end)
            if not sent then
                Log.error("bridge: send failed: " .. tostring(err))
                S.sendConnected = false
                S.sendNeedsRebind = true
                return false, "socket"
            end
            return true
        end

        local function respond(id, name, ok, body)
            local envelope = { id = id, type = "res", name = name, ok = ok }
            if ok then envelope.payload = body else envelope.error = body end
            local sent, why, detail = send(envelope)
            if not sent and why == "encode" then
                -- The result held something JSON cannot carry: tell the engine instead of going silent.
                sent = send({ id = id, type = "res", name = name, ok = false,
                    error = { code = "encode_failed", message = detail, recoverable = false } })
            end
            return sent
        end

        local HANDLERS = {
            hello = function() return Bridge.helloPayload(receivePort, sendPort) end,
            ping = function(payload) return { pong = true, nonce = payload.nonce } end,
            get_context = Develop.getContext,
            get_settings = Develop.getSettings,
            apply_settings = Develop.applySettings,
            create_snapshot = Develop.createSnapshot,
            apply_snapshot = Develop.applySnapshot,
        }

        -- Runs in its own task, one per line.
        local function handleLine(line)
            local okDecode, msg = pcall(Json.decode, line)
            if not okDecode or type(msg) ~= "table" or msg.type ~= "cmd" or type(msg.id) ~= "string"
                or type(msg.name) ~= "string" then
                S.malformed = S.malformed + 1
                Log.warn("bridge: ignored a line that is not a command (" .. #line .. " bytes)" ..
                    (okDecode and "" or ": " .. tostring(msg)))
                local id = (okDecode and type(msg) == "table" and type(msg.id) == "string" and msg.id)
                    or line:match('"id"%s*:%s*"([^"]+)"')
                if id then
                    respond(id, "?", false, { code = "bad_request", message = "not a valid command envelope", recoverable = false })
                end
                return
            end
            if S.token == nil or msg.token ~= S.token then
                S.unauthorized = S.unauthorized + 1
                Log.warn("bridge: refused " .. msg.name .. " " .. msg.id .. " (missing or wrong token)")
                respond(msg.id, msg.name, false, { code = "unauthorized", recoverable = true,
                    message = "missing or wrong bridge token; the engine reads it from " .. Bridge.tokenPath() })
                return
            end
            local handler = HANDLERS[msg.name]
            if not handler then
                S.failed = S.failed + 1
                respond(msg.id, msg.name, false, { code = "unknown_command", message = "unknown command " .. msg.name, recoverable = false })
                return
            end
            if msg.name ~= "ping" then Log.info("bridge: " .. msg.name .. " " .. msg.id) end
            local payload = type(msg.payload) == "table" and msg.payload or {}
            -- LrTasks.pcall, not xpcall [upstream claim: PluginInfoProvider.lua:272-275].
            -- Handlers return a result table, or nil plus an error table.
            local okRun, result, handlerErr = LrTasks.pcall(handler, payload)
            if not okRun then
                S.failed = S.failed + 1
                Log.error("bridge: " .. msg.name .. " raised: " .. tostring(result))
                respond(msg.id, msg.name, false, { code = "plugin_error", message = tostring(result), recoverable = false })
            elseif result == nil then
                S.failed = S.failed + 1
                local e = handlerErr or { code = "plugin_error", message = "no result", recoverable = false }
                Log.warn("bridge: " .. msg.name .. " failed: " .. tostring(e.code) .. " " .. tostring(e.message))
                respond(msg.id, msg.name, false, e)
            else
                S.handled = S.handled + 1
                respond(msg.id, msg.name, true, result)
            end
        end

        local function bindReceive(myGen)
            local function live() return S.receiveGen == myGen and current() end
            return LrSocket.bind {
                functionContext = context,
                plugin = _PLUGIN,
                port = receivePort,
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
                onMessage = function(_, message)
                    if not live() then return end
                    S.lastInbound = LrDate.currentTime()
                    LrTasks.startAsyncTask(function() handleLine(message) end)
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

        local function bindSend(myGen)
            local function live() return S.sendGen == myGen and current() end
            return LrSocket.bind {
                functionContext = context,
                plugin = _PLUGIN,
                port = sendPort,
                mode = "send",
                onConnected = function()
                    if not live() then return end
                    S.sendConnected = true
                    Log.info("bridge: send: engine connected")
                    LrTasks.startAsyncTask(function()
                        send({ id = LrUUID.generateUUID(), type = "evt", name = "hello",
                            payload = Bridge.helloPayload(receivePort, sendPort) })
                    end)
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
        local function rebindReceive()
            S.receiveGen = S.receiveGen + 1
            if S.receiveSocket then pcall(function() S.receiveSocket:close() end) end
            S.receiveSocket, S.receiveConnected = nil, false
            LrTasks.sleep(0.1)
            S.receiveSocket = bindReceive(S.receiveGen)
            S.receiveNeedsRebind, S.receiveNeedsReconnect = false, false
        end
        local function rebindSend()
            S.sendGen = S.sendGen + 1
            if S.sendSocket then pcall(function() S.sendSocket:close() end) end
            S.sendSocket, S.sendConnected = nil, false
            LrTasks.sleep(0.1)
            S.sendSocket = bindSend(S.sendGen)
            S.sendNeedsRebind, S.sendNeedsReconnect = false, false
        end

        local lastStatus = 0
        local function writeStatus()
            local now = LrDate.currentTime()
            local quiet = S.lastInbound and (now - S.lastInbound) or nil
            local status = {
                generation = generation,
                running = true,
                updated_at = isoNow(),
                updated_epoch = os.time(),
                started_at = S.startedAt,
                plugin_version = Bridge.PLUGIN_VERSION,
                lrc_version = LrApplication.versionString(),
                ports = { receive = receivePort, send = sendPort },
                receive_connected = S.receiveConnected,
                send_connected = S.sendConnected,
                engine_connected = S.receiveConnected and S.sendConnected and quiet ~= nil and quiet < ENGINE_QUIET_SECONDS,
                seconds_since_last_message = quiet,
                commands_handled = S.handled,
                commands_failed = S.failed,
                commands_unauthorized = S.unauthorized,
                lines_malformed = S.malformed,
                token_file = Bridge.tokenPath(),
                token_written = S.token ~= nil,
                log_tail = Log.tail(20),
            }
            local okEncode, text = pcall(Json.encode, status)
            if okEncode then Log.writeFile(Bridge.STATUS_FILE, text) end
            lastStatus = now
        end

        -- A bind or re-arm that raises (e.g. the port is still held) is logged and retried on a later
        -- tick instead of ending the bridge task. `onFail` puts back the work that must be retried.
        local retryAt = 0
        local function safely(what, fn, onFail)
            local ok, err = LrTasks.pcall(fn)
            if not ok then
                Log.error("bridge: " .. what .. " failed: " .. tostring(err) .. "; retrying in 2 s")
                retryAt = LrDate.currentTime() + 2
                if onFail then onFail() end
            end
        end

        LrTasks.sleep(SETTLE_SECONDS)
        if not current() then return end
        local okToken, tokenOrErr = LrTasks.pcall(newToken)
        S.token = okToken and tokenOrErr or nil
        if not okToken then Log.error("bridge: token failed: " .. tostring(tokenOrErr) .. "; every command will be refused") end
        Log.info("bridge: listening (generation " .. generation .. ")")

        while current() do
            if LrDate.currentTime() >= retryAt then
                if S.receiveNeedsRebind or not S.receiveSocket then
                    safely("receive bind", rebindReceive)
                elseif S.receiveNeedsReconnect then
                    S.receiveNeedsReconnect = false
                    -- If re-arming fails, bind afresh on the next try rather than dropping the retry.
                    safely("receive re-arm", function() S.receiveSocket:reconnect() end,
                        function() S.receiveNeedsRebind = true end)
                end
                if S.sendNeedsRebind or not S.sendSocket then
                    safely("send bind", rebindSend)
                elseif S.sendNeedsReconnect then
                    S.sendNeedsReconnect = false
                    safely("send re-arm", function() S.sendSocket:reconnect() end,
                        function() S.sendNeedsRebind = true end)
                end
            end
            -- Windows may not report a vanished engine at all [upstream claim: PluginInfoProvider.lua:558-560].
            -- The engine pings every 2 s, so a long silence means it is gone: start both sockets afresh.
            if S.receiveConnected and S.lastInbound and (LrDate.currentTime() - S.lastInbound) > STALE_REBIND_SECONDS then
                Log.warn("bridge: no message for " .. STALE_REBIND_SECONDS .. " s; rebinding both sockets")
                S.lastInbound = nil
                S.receiveNeedsRebind, S.sendNeedsRebind = true, true
            end
            if LrDate.currentTime() - lastStatus >= STATUS_EVERY_SECONDS then writeStatus() end
            LrTasks.sleep(LOOP_SECONDS)
        end
        Log.info("bridge: generation " .. generation .. " replaced; loop exiting")
    end)
end

return Bridge
