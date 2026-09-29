-- The files the engine reads before each connection (ARCHITECTURE section 3), both in
-- %USERPROFILE%\.lrc-avg\:
--   bridge_token        the token every command must carry (C-8; Bridge.lua's header has the why)
--   bridge_ports.json   the ports this bridge listens on (PHASE5_PLAN decision 2e, row 3). A port
--                       changed on the settings page applies when the bridge next starts (it binds
--                       once, at start), and the engine finds it here, as it finds the token.
-- Moved out of Bridge.lua in PHASE5_PLAN row 3. LrPathUtils.getStandardFilePath("home") is the
-- folder Node's os.homedir() gives [handle: LR_SDK_NOTES "Recorded in Phase 1", Standard paths].
-- Both are plain file writes in the bridge task; a program running as the same Windows user can
-- read them [inference: the files carry no access control of their own].

local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrUUID = import 'LrUUID'

local Json = require 'Json'
local Log = require 'Log'

local Endpoint = {}

function Endpoint.dir()
    return LrPathUtils.child(LrPathUtils.getStandardFilePath("home"), ".lrc-avg")
end

function Endpoint.tokenPath()
    return LrPathUtils.child(Endpoint.dir(), "bridge_token")
end

function Endpoint.portsPath()
    return LrPathUtils.child(Endpoint.dir(), "bridge_ports.json")
end

local function write(path, text)
    LrFileUtils.createAllDirectories(LrPathUtils.parent(path))
    local fh, err = io.open(path, "w")
    if not fh then return nil, err end
    fh:write(text)
    fh:close()
    return path
end

-- A fresh 256-bit token (two UUIDs without dashes), written for the engine to read. Returns the
-- token, or nil if the file cannot be written; then every command is refused.
function Endpoint.newToken()
    local token = (LrUUID.generateUUID() .. LrUUID.generateUUID()):gsub("-", ""):lower()
    local path = Endpoint.tokenPath()
    local ok, err = write(path, token)
    if not ok then
        Log.error("bridge: cannot write the token file " .. path .. ": " .. tostring(err) .. "; every command will be refused")
        return nil
    end
    Log.info("bridge: token written to " .. path)
    return token
end

-- The ports this bridge binds, for the engine (engine\src\bridge\endpoint.ts readPortsFile).
-- Returns the path, or nil if the file cannot be written; the engine then reads an older file or,
-- without one, keeps to its defaults.
function Endpoint.writePorts(receivePort, sendPort, pluginVersion)
    local path = Endpoint.portsPath()
    local text = Json.encode({
        receive = receivePort,
        send = sendPort,
        plugin_version = pluginVersion,
        written_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    })
    local ok, err = write(path, text)
    if not ok then
        Log.error("bridge: cannot write the ports file " .. path .. ": " .. tostring(err) .. "; the engine will use an older file's ports, or 8765/8766")
        return nil
    end
    Log.info(string.format("bridge: ports %d/%d written to %s", receivePort, sendPort, path))
    return path
end

return Endpoint
