-- AVG-S8 shared helpers: the output folder, times, whole-file reads and writes, the request file the
-- menu items write for the loop, the loop's view file, and saving a result.
-- Output goes to <temp>\LrC-AVG\S8\ (rule 03-lightroom "Plugin hygiene"); Claude Code collects it
-- with spikes\S8\collect.ts, Jim copies nothing.

local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'

local SpikeJson = require 'SpikeJson'

local Common = {}

Common.REQUEST_FILE = "s8_request.txt"
Common.LOOP_VIEW_FILE = "s8_loop_view.json"
Common.PANEL_VIEW_FILE = "s8_panel_view.json"
-- The loop rewrites its view file every 2 s (S8Loop.lua); older than this means it is not running.
Common.LOOP_STALE_SECONDS = 8

function Common.outDir()
    local dir = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "S8")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

function Common.path(file)
    return LrPathUtils.child(Common.outDir(), file)
end

function Common.stamp()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H-%M-%S")
end

function Common.localTime()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d %H:%M:%S") .. " (local time)"
end

function Common.clock()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S")
end

-- The whole file, or nil.
function Common.readFile(path)
    local fh = io.open(path, "rb")
    if not fh then return nil end
    local text = fh:read("*a")
    fh:close()
    return text
end

-- Write the whole file. Returns ok, err; a failed write or close is a failure (Greptile, PR #30).
function Common.writeFile(path, text)
    local fh, err = io.open(path, "wb")
    if not fh then return false, tostring(err) end
    local wrote, writeErr = fh:write(text)
    local closed, closeErr = fh:close()
    if not wrote then return false, "write failed: " .. tostring(writeErr) end
    if not closed then return false, "close failed: " .. tostring(closeErr) end
    return true
end

-- A request for the loop: one line "<id> <action>", written whole. The loop acts on each id once.
function Common.writeRequest(id, action)
    return Common.writeFile(Common.path(Common.REQUEST_FILE), id .. " " .. action .. "\n")
end

-- The request on disk: id, action; or nil when there is none.
function Common.readRequest()
    local text = Common.readFile(Common.path(Common.REQUEST_FILE))
    if not text then return nil end
    local id, action = text:match("^(%S+) (%S+)")
    return id, action
end

-- What the loop wrote last, as the raw JSON text and its age in seconds (from its updated_epoch).
-- The menu items read single fields out of it with a pattern: SpikeJson only encodes.
function Common.loopView()
    local text = Common.readFile(Common.path(Common.LOOP_VIEW_FILE))
    if not text then return nil, nil end
    local epoch = tonumber(text:match('"updated_epoch": (%d+)'))
    return text, epoch and (os.time() - epoch) or nil
end

-- One string field of a SpikeJson object as text (keys are unique in the files S8 writes).
function Common.field(text, key)
    if not text then return nil end
    return text:match('"' .. key .. '": "([^"]*)"')
end

-- The plugin's preferences as a plain table. prefs:pairs(), not pairs(prefs)
-- [handle: https://lrc.mcor.dev/modules/LrPrefs.html, read 2026-09-28].
function Common.prefsTable()
    local out = {}
    for k, v in LrPrefs.prefsForPlugin():pairs() do out[tostring(k)] = v end
    return out
end

-- Save one result as JSON and add a line to s8_log.txt. Returns ok, err.
function Common.save(prefix, result)
    local path = Common.path(prefix .. "_" .. Common.stamp() .. ".json")
    local ok, err = SpikeJson.writeFile(path, result)
    local fh = io.open(Common.path("s8_log.txt"), "a")
    if fh then
        fh:write(prefix, " ", tostring(result.run_at), ": ", ok and path or ("SAVE FAILED: " .. tostring(err)), "\n")
        fh:close()
    end
    return ok, err
end

function Common.saveLine(ok, err)
    if ok then return "Saved automatically - nothing to copy." end
    return "SAVE FAILED: " .. tostring(err) .. " - tell Claude Code."
end

return Common
