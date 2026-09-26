-- File > Plug-in Extras > "LrC-AVG - Bridge status". Reads the status file the bridge task writes
-- every 2 s (<temp>\LrC-AVG\bridge_status.json) rather than shared memory (Phase 0, P-15), and says
-- plainly whether the bridge runs and whether the engine is connected.

local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'

local Bridge = require 'Bridge'
local Json = require 'Json'
local Log = require 'Log'

local STALE_SECONDS = 10 -- the bridge rewrites the file every 2 s; older means its loop is not running

LrTasks.startAsyncTask(function()
    local text = Log.readFile(Bridge.STATUS_FILE)
    local ok, status = false, nil
    if text then ok, status = pcall(Json.decode, text) end
    if not ok or type(status) ~= "table" then
        LrDialogs.message("LrC-AVG bridge: NOT RUNNING",
            "No bridge status file was found.\n\nRestart Lightroom (File > Exit, then open it again), then choose this menu item again.\n\nLog: " .. Log.path(),
            "warning")
        return
    end

    local age = os.time() - (tonumber(status.updated_epoch) or 0)
    local lines = {}
    local headline, kind
    if age > STALE_SECONDS then
        headline, kind = "LrC-AVG bridge: NOT RUNNING", "warning"
        lines[#lines + 1] = "The bridge last reported " .. age .. " s ago."
    elseif status.engine_connected then
        headline, kind = "LrC-AVG bridge: ENGINE CONNECTED", "info"
    else
        headline, kind = "LrC-AVG bridge: RUNNING, engine NOT connected", "info"
    end
    lines[#lines + 1] = string.format("Ports: receive %s, send %s", tostring(status.ports and status.ports.receive), tostring(status.ports and status.ports.send))
    lines[#lines + 1] = "Receive socket connected: " .. (status.receive_connected and "YES" or "NO")
    lines[#lines + 1] = "Send socket connected: " .. (status.send_connected and "YES" or "NO")
    lines[#lines + 1] = string.format("Commands handled: %s, failed: %s, refused for a wrong token: %s, malformed lines: %s",
        tostring(status.commands_handled), tostring(status.commands_failed), tostring(status.commands_unauthorized),
        tostring(status.lines_malformed))
    lines[#lines + 1] = "Token file written: " .. (status.token_written and "YES" or "NO") .. " (" .. tostring(status.token_file) .. ")"
    lines[#lines + 1] = "Plugin " .. tostring(status.plugin_version) .. " on Lightroom " .. tostring(status.lrc_version)
    lines[#lines + 1] = ""
    lines[#lines + 1] = "Recent log:"
    for _, line in ipairs(status.log_tail or {}) do
        lines[#lines + 1] = "  " .. tostring(line)
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = "Log file: " .. Log.path()
    LrDialogs.message(headline, table.concat(lines, "\n"), kind)
end)
