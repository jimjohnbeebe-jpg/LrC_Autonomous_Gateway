-- Bridge command dispatch (ARCHITECTURE section 3): the table of command handlers, and one line
-- from the engine decoded, its token checked (C-8) and its handler run. Moved out of Bridge.lua in
-- PHASE4_PLAN row 6; Bridge.lua owns the sockets and the counters in its state `S`. Against a fake
-- Lightroom, main's bridge and this one sent the same replies and wrote the same log for the same
-- commands [handle: docs\reports\phase4\variants-plugin-smoke\smoke.txt "== Bridge"].
--
-- Handlers return a result table, or nil plus an error table { code, message, recoverable }
-- (PRD NFR-7). engine\tests\lua-plugin.test.ts checks that HANDLERS names exactly the commands in
-- engine\src\bridge\protocol.ts COMMANDS.

local LrTasks = import 'LrTasks'

local Catalog = require 'Catalog'
local Develop = require 'Develop'
local Json = require 'Json'
local Log = require 'Log'
local Preview = require 'Preview'

local Dispatch = {}

-- `hello` answers with the bridge's ports, so Bridge.lua passes it in.
function Dispatch.handlers(hello)
    local HANDLERS = {
        hello = hello,
        ping = function(payload) return { pong = true, nonce = payload.nonce } end,
        get_context = Develop.getContext,
        get_settings = Develop.getSettings,
        apply_settings = Develop.applySettings,
        create_snapshot = Develop.createSnapshot,
        apply_snapshot = Develop.applySnapshot,
        export_preview = Preview.exportPreview,
        create_virtual_copies = Catalog.createVirtualCopies,
        select_photo = Catalog.selectPhoto,
        get_selection = Catalog.getSelection,
    }
    return HANDLERS
end

-- A line that is not a command envelope: counted, logged, and answered when it carries an id.
local function refuseMalformed(S, respond, line, okDecode, msg)
    S.malformed = S.malformed + 1
    Log.warn("bridge: ignored a line that is not a command (" .. #line .. " bytes)" ..
        (okDecode and "" or ": " .. tostring(msg)))
    local id = (okDecode and type(msg) == "table" and type(msg.id) == "string" and msg.id)
        or line:match('"id"%s*:%s*"([^"]+)"')
    if id then
        respond(id, "?", false, { code = "bad_request", message = "not a valid command envelope", recoverable = false })
    end
end

-- Runs in its own task, one per line. `S` holds the token, the token file's path and the counters;
-- `respond(id, name, ok, body)` sends the response.
function Dispatch.handleLine(S, handlers, respond, line)
    local okDecode, msg = pcall(Json.decode, line) -- plain pcall: pure Lua, no yield
    if not okDecode or type(msg) ~= "table" or msg.type ~= "cmd" or type(msg.id) ~= "string"
        or type(msg.name) ~= "string" then
        refuseMalformed(S, respond, line, okDecode, msg)
        return
    end
    if S.token == nil or msg.token ~= S.token then
        S.unauthorized = S.unauthorized + 1
        Log.warn("bridge: refused " .. msg.name .. " " .. msg.id .. " (missing or wrong token)")
        respond(msg.id, msg.name, false, { code = "unauthorized", recoverable = true,
            message = "missing or wrong bridge token; the engine reads it from " .. S.tokenFile })
        return
    end
    local handler = handlers[msg.name]
    if not handler then
        S.failed = S.failed + 1
        respond(msg.id, msg.name, false, { code = "unknown_command", message = "unknown command " .. msg.name, recoverable = false })
        return
    end
    if msg.name ~= "ping" then Log.info("bridge: " .. msg.name .. " " .. msg.id) end
    local payload = type(msg.payload) == "table" and msg.payload or {}
    -- LrTasks.pcall, not xpcall [upstream claim: PluginInfoProvider.lua:272-275].
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

return Dispatch
