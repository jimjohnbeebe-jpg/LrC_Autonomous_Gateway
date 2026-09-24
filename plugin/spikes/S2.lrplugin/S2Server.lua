-- AVG-S2 echo server. Lightroom is the listener: one LrSocket in mode "receive" on
-- RECEIVE_PORT (client -> Lightroom) and one in mode "send" on SEND_PORT
-- (Lightroom -> client). Every message received is echoed on the send socket as
--   <byte length of message as received>:<message>\n
-- so the client can check both the length and the payload.
--
-- Pattern follows Automaat (vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua):
-- onMessage only hands off to an async task (non-yielding context, :419-426); reconnects are
-- flagged in callbacks and performed from the monitor loop, never from onError (:512-545).

local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrSocket = import 'LrSocket'
local LrTasks = import 'LrTasks'

local RECEIVE_PORT = 8765
local SEND_PORT = 8766
local RUN_SECONDS = 900 -- stop by itself after 15 minutes
local LOG_KEEP = 200

local M = {}

if not _G.AVG_S2 then
    _G.AVG_S2 = { running = false, generation = 0, log = {}, received = 0, echoed = 0 }
end
local S = _G.AVG_S2

-- Resolved once, so socket callbacks only ever do a plain io.open/append.
local LOG_PATH
local function logPath()
    if not LOG_PATH then
        local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
        LrFileUtils.createAllDirectories(dir)
        LOG_PATH = LrPathUtils.child(dir, "s2_log.txt")
    end
    return LOG_PATH
end
logPath()

function M.log(msg)
    local line = LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S") .. string.format(".%03d ", math.floor((LrDate.currentTime() % 1) * 1000)) .. msg
    table.insert(S.log, line)
    if #S.log > LOG_KEEP then table.remove(S.log, 1) end
    local fh = io.open(logPath(), "a")
    if fh then
        fh:write(line, "\n")
        fh:close()
    end
end

local function isNoClientError(err)
    return err == "timeout" or err:find("failed to open", 1, true) ~= nil
end

local function echo(message)
    S.received = S.received + 1
    local reply = tostring(#message) .. ":" .. message .. "\n"
    if not (S.sendSocket and S.sendConnected) then
        M.log(string.format("DROP echo of %d bytes: send socket not connected", #message))
        return
    end
    local t0 = LrDate.currentTime()
    local ok, err = pcall(function() S.sendSocket:send(reply) end)
    local ms = (LrDate.currentTime() - t0) * 1000
    if ok then
        S.echoed = S.echoed + 1
        M.log(string.format("echo %d bytes (send() returned after %.1f ms)", #message, ms))
    else
        M.log(string.format("send() FAILED for %d bytes: %s", #message, tostring(err)))
    end
end

function M.start()
    if S.running then
        M.log("start ignored: already running")
        return
    end
    S.running = true
    S.generation = S.generation + 1
    local gen = S.generation
    S.received, S.echoed = 0, 0
    M.log(string.format("starting (gen %d): receive %d, send %d", gen, RECEIVE_PORT, SEND_PORT))

    LrFunctionContext.postAsyncTaskWithContext("AVG S2 server", function(context)
        context:addCleanupHandler(function()
            if S.generation ~= gen then return end
            if S.receiveSocket then pcall(function() S.receiveSocket:close() end) end
            if S.sendSocket then pcall(function() S.sendSocket:close() end) end
            S.receiveSocket, S.sendSocket = nil, nil
            S.receiveConnected, S.sendConnected = false, false
            S.running = false
            M.log("sockets closed (context cleanup)")
        end)

        S.receiveSocket = LrSocket.bind {
            functionContext = context,
            plugin = _PLUGIN,
            port = RECEIVE_PORT,
            mode = "receive",
            onConnecting = function() M.log("receive: listening on " .. RECEIVE_PORT) end,
            onConnected = function()
                S.receiveConnected = true
                M.log("receive: client connected")
            end,
            onMessage = function(_, message)
                LrTasks.startAsyncTask(function() echo(message) end)
            end,
            onClosed = function()
                S.receiveConnected = false
                S.receiveNeedsReconnect = true
                M.log("receive: closed")
            end,
            onError = function(_, err)
                local e = tostring(err)
                if isNoClientError(e) then
                    if not S.receiveConnected then S.receiveNeedsReconnect = true end
                else
                    S.receiveConnected = false
                    S.receiveNeedsReconnect = true
                    M.log("receive: error " .. e)
                end
            end,
        }

        S.sendSocket = LrSocket.bind {
            functionContext = context,
            plugin = _PLUGIN,
            port = SEND_PORT,
            mode = "send",
            onConnecting = function() M.log("send: listening on " .. SEND_PORT) end,
            onConnected = function()
                S.sendConnected = true
                M.log("send: client connected")
            end,
            onClosed = function()
                S.sendConnected = false
                S.sendNeedsReconnect = true
                M.log("send: closed")
            end,
            onError = function(_, err)
                local e = tostring(err)
                if isNoClientError(e) then
                    if not S.sendConnected then S.sendNeedsReconnect = true end
                else
                    S.sendConnected = false
                    S.sendNeedsReconnect = true
                    M.log("send: error " .. e)
                end
            end,
        }

        local started = LrDate.currentTime()
        while S.running and S.generation == gen and (LrDate.currentTime() - started) < RUN_SECONDS do
            if S.receiveNeedsReconnect and S.receiveSocket then
                S.receiveNeedsReconnect = false
                S.receiveSocket:reconnect()
            end
            if S.sendNeedsReconnect and S.sendSocket then
                S.sendNeedsReconnect = false
                S.sendSocket:reconnect()
            end
            LrTasks.sleep(0.2)
        end
        M.log(string.format("server loop exiting (received %d, echoed %d)", S.received, S.echoed))
    end)
end

function M.stop()
    if not S.running then
        M.log("stop ignored: not running")
        return
    end
    M.log("stop requested")
    S.running = false
end

function M.statusText()
    local lines = {
        "Running: " .. tostring(S.running),
        "Receive socket (" .. RECEIVE_PORT .. ") connected: " .. tostring(S.receiveConnected == true),
        "Send socket (" .. SEND_PORT .. ") connected: " .. tostring(S.sendConnected == true),
        "Messages received: " .. tostring(S.received) .. ", echoed: " .. tostring(S.echoed),
        "Log file: " .. logPath(),
        "",
        "Recent log:",
    }
    for i = math.max(1, #S.log - 25), #S.log do
        table.insert(lines, "  " .. S.log[i])
    end
    return table.concat(lines, "\n")
end

return M
