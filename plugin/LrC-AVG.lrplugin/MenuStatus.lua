-- File > Plug-in Extras > "LrC-AVG - Status" (Phase 9, D10): one dialog for "is it working?". A headline,
-- then the plugin's version and the folder it loaded from, the bridge (the status file the bridge task
-- writes every 2 s, <temp>\LrC-AVG\bridge_status.json, rather than shared memory, Phase 0 P-15), the
-- engine (last-start.json, which the engine writes at each start), the Claude Desktop entry the
-- installer made (setup-result.json), whether the Deck is installed and the log folders. The same text
-- goes to %LOCALAPPDATA%\LrC-AVG\status.txt, to attach to a GitHub issue.
-- The decisions (what the headline says, when to ask for a restart) are made here only because they are
-- words for the dialog; the engine compares versions for its own notices (engine\src\bridge\version.ts).

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local Bridge = require 'Bridge'
local Json = require 'Json'
local Log = require 'Log'
local Prefs = require 'Prefs'

local STALE_SECONDS = 10 -- the bridge rewrites the file every 2 s; older means its loop is not running
local LOG_LINES = 10     -- lines of the plugin log in the dialog; the bridge keeps 20

local function join(root, ...)
    for _, part in ipairs({ ... }) do root = LrPathUtils.child(root, part) end
    return root
end

-- %LOCALAPPDATA% or %APPDATA%: os.getenv when Lightroom's Lua has it [unverified], else the default folder
-- under the home folder [handle: LR_SDK_NOTES "Recorded in Phase 1", Standard paths: "home" is Node's
-- os.homedir()]. A profile whose folders were moved is then missed [inference].
local function profileDir(name, ...)
    local value = os.getenv and os.getenv(name)
    if value and value ~= "" then return value end
    return join(LrPathUtils.getStandardFilePath("home"), ...)
end

local function decode(text)
    if not text then return nil end
    local ok, value = pcall(Json.decode, (text:gsub("^\239\187\191", ""))) -- plain pcall: pure Lua, no yield; the gsub drops a UTF-8 BOM
    if ok and type(value) == "table" then return value end
    return nil
end

local function readJson(path)
    local fh = io.open(path, "r")
    if not fh then return nil end
    local text = fh:read("*a")
    fh:close()
    return decode(text)
end

-- The engine's record of its latest start. Under Claude Desktop from the Microsoft Store (MSIX) the engine
-- writes to a copy of %LOCALAPPDATA% inside the app's package [handle: LR_SDK_NOTES "Under Claude Desktop
-- from the Microsoft Store (MSIX), the engine's %LOCALAPPDATA% is redirected", seen for the intents folder;
-- that last-start.json goes there too is an inference], so the newest record of both places counts.
local function lastStart(localAppData)
    local best
    local function consider(path)
        local rec = readJson(path)
        if rec and (not best or tostring(rec.time or "") > tostring(best.time or "")) then best = rec end
    end
    consider(join(localAppData, "LrC-AVG", "last-start.json"))
    local packages = join(localAppData, "Packages")
    LrTasks.pcall(function()
        if LrFileUtils.exists(packages) ~= "directory" then return end
        for entry in LrFileUtils.directoryEntries(packages) do
            if LrPathUtils.leafName(entry):find("^Claude_") then
                consider(join(entry, "LocalCache", "Local", "LrC-AVG", "last-start.json"))
            end
        end
    end)
    return best
end

local function installedFrom(pluginPath, roaming)
    local function norm(p) return (tostring(p):gsub("/", "\\"):lower()) end
    local modules = norm(join(roaming, "Adobe", "Lightroom", "Modules")) .. "\\"
    if norm(pluginPath):sub(1, #modules) == modules then return "Modules (installed)" end
    return "added in Plug-in Manager"
end

local function bridgeLines(status, age)
    if not status then
        return { "Bridge: no status file was found in " .. Log.outDir() }
    end
    local lines = {}
    if age > STALE_SECONDS then lines[#lines + 1] = "The bridge last reported " .. age .. " s ago." end
    lines[#lines + 1] = string.format("Ports: receive %s, send %s", tostring(status.ports and status.ports.receive), tostring(status.ports and status.ports.send))
    lines[#lines + 1] = "Receive socket connected: " .. (status.receive_connected and "YES" or "NO")
    lines[#lines + 1] = "Send socket connected: " .. (status.send_connected and "YES" or "NO")
    lines[#lines + 1] = string.format("Commands handled: %s, failed: %s, refused for a wrong token: %s, malformed lines: %s",
        tostring(status.commands_handled), tostring(status.commands_failed), tostring(status.commands_unauthorized),
        tostring(status.lines_malformed))
    lines[#lines + 1] = "Token file written: " .. (status.token_written and "YES" or "NO") .. " (" .. tostring(status.token_file) .. ")"
    lines[#lines + 1] = "Engine connected: " .. (status.engine_connected and "YES" or "NO")
    return lines
end

local function engineLine(start)
    if not start then return "Engine: the AI client has not started LrC-AVG yet" end
    local client = start.client_name and (tostring(start.client_name) .. (start.client_version and (" " .. tostring(start.client_version)) or "")) or "an AI client"
    return string.format("Engine: %s, last started %s by %s", tostring(start.engine_version or "unknown version"), tostring(start.time or "at an unknown time"), client)
end

local function entryLines(setup)
    if not setup then
        return { "Claude Desktop entry: no installer record (setup-result.json); the installer has not run here, or LrC-AVG was set up by hand" }
    end
    local lines = { string.format("Claude Desktop entry: %s (%s, %s)", tostring(setup.outcome or "unknown"), tostring(setup.action or "setup"), tostring(setup.time or "at an unknown time")) }
    if setup.config_path then lines[#lines + 1] = "  config: " .. tostring(setup.config_path) end
    if setup.message then lines[#lines + 1] = "  " .. tostring(setup.message) end
    return lines
end

LrTasks.startAsyncTask(function()
    local localAppData = profileDir("LOCALAPPDATA", "AppData", "Local")
    local appDir = join(localAppData, "LrC-AVG")
    local statusPath = join(appDir, "status.txt")

    local status = decode(Log.readFile(Bridge.STATUS_FILE))
    local age = status and (os.time() - (tonumber(status.updated_epoch) or 0)) or nil
    local running = status ~= nil and age <= STALE_SECONDS
    local start = lastStart(localAppData)
    local engineVersion = start and type(start.engine_version) == "string" and start.engine_version or nil
    local mismatch = engineVersion ~= nil and engineVersion ~= Bridge.PLUGIN_VERSION

    local headline, kind
    if not running then
        headline, kind = "BRIDGE NOT RUNNING", "warning"
    elseif mismatch then
        headline, kind = "RESTART LIGHTROOM TO FINISH THE UPDATE", "warning"
    elseif status.engine_connected then
        headline, kind = "READY", "info"
    else
        headline, kind = "ENGINE NOT CONNECTED (normal outside a chat)", "info"
    end
    headline = "LrC-AVG status: " .. headline

    local lines = {}
    local function add(line) lines[#lines + 1] = line end
    if not running then
        add("Restart Lightroom (File > Exit, then open it again), then choose this menu item again.")
        add("")
    elseif mismatch then
        add("Lightroom runs plugin " .. Bridge.PLUGIN_VERSION .. "; the engine the AI client started is " .. engineVersion .. ".")
        add("File > Exit, then open Lightroom again. If this still shows afterwards, quit your AI client (Claude Desktop) and open it again.")
        add("")
    end
    local pluginPath = _PLUGIN and _PLUGIN.path or "unknown"
    add("Plugin: " .. Bridge.PLUGIN_VERSION .. ", loaded from " .. tostring(pluginPath) .. " (" .. installedFrom(pluginPath, profileDir("APPDATA", "AppData", "Roaming")) .. ")")
    add("Lightroom Classic: " .. tostring(LrApplication.versionString()))
    for _, line in ipairs(bridgeLines(status, age)) do add(line) end
    add(engineLine(start))
    for _, line in ipairs(entryLines(readJson(join(appDir, "setup-result.json")))) do add(line) end
    add("Deck installed: " .. (LrFileUtils.exists(join(appDir, "LrC-AVG Deck.exe")) == "file" and "YES" or "NO"))
    local logFolder = Prefs.read().logFolder
    add("Session logs: " .. ((logFolder and logFolder ~= "") and logFolder or join(appDir, "logs")))
    add("Plugin log: " .. Log.path())
    local tail = status and status.log_tail or {}
    if #tail > 0 then
        add("")
        add("Recent log:")
        for i = math.max(1, #tail - LOG_LINES + 1), #tail do add("  " .. tostring(tail[i])) end
    end

    local body = table.concat(lines, "\n")
    LrFileUtils.createAllDirectories(appDir)
    local saved = "Saved as " .. statusPath .. ". Attach status.txt to a GitHub issue."
    local fh, err = io.open(statusPath, "w")
    if fh then
        fh:write(headline, "\n\n", body, "\n\n", saved, "\n")
        fh:close()
    else
        saved = "Could not save " .. statusPath .. ": " .. tostring(err)
    end
    LrDialogs.message(headline, body .. "\n\n" .. saved, kind)
end)
