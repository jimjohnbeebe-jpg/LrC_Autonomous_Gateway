-- Plugin log and output folder: <temp>\LrC-AVG\ (rule 03-lightroom "Plugin hygiene"), where
-- <temp> is LrPathUtils.getStandardFilePath("temp"). Lines go to bridge.log there, and the last
-- LOG_KEEP lines stay in memory for the status file. Automaat keeps its own file sink because
-- LrLogger alone was unreliable on Windows [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\Log.lua:3-9].

local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'

local Log = {}

local LOG_KEEP = 200
local MAX_LOG_BYTES = 5 * 1024 * 1024

local outDir, logPath
local recent = {}

function Log.outDir()
    if not outDir then
        outDir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
        LrFileUtils.createAllDirectories(outDir)
    end
    return outDir
end

function Log.path()
    if not logPath then
        logPath = LrPathUtils.child(Log.outDir(), "bridge.log")
        -- Start over when the file has grown large; one plugin session is plenty to keep.
        -- (The fileSize field name is [unverified]; if it is absent the file is simply kept.)
        local size = LrFileUtils.fileAttributes(logPath)
        if size and size.fileSize and size.fileSize > MAX_LOG_BYTES then
            LrFileUtils.delete(logPath)
        end
    end
    return logPath
end

function Log.timestamp()
    local now = LrDate.currentTime()
    return LrDate.timeToUserFormat(now, "%Y-%m-%d %H:%M:%S") .. string.format(".%03d", math.floor((now % 1) * 1000))
end

-- Plain io.open/append only, so it is safe from socket callbacks (no yielding).
function Log.line(level, msg)
    local line = Log.timestamp() .. " " .. level .. " " .. tostring(msg)
    recent[#recent + 1] = line
    if #recent > LOG_KEEP then table.remove(recent, 1) end
    local fh = io.open(Log.path(), "a")
    if fh then
        fh:write(line, "\n")
        fh:close()
    end
end

function Log.info(msg) Log.line("INFO ", msg) end
function Log.warn(msg) Log.line("WARN ", msg) end
function Log.error(msg) Log.line("ERROR", msg) end

function Log.tail(n)
    local out = {}
    for i = math.max(1, #recent - (n or 30) + 1), #recent do out[#out + 1] = recent[i] end
    return out
end

-- Replace <temp>\LrC-AVG\<name> with `text`. Returns the path, or nil if the file cannot be opened.
function Log.writeFile(name, text)
    local path = LrPathUtils.child(Log.outDir(), name)
    local fh = io.open(path, "w")
    if not fh then return nil end
    fh:write(text)
    fh:close()
    return path
end

function Log.readFile(name)
    local fh = io.open(LrPathUtils.child(Log.outDir(), name), "r")
    if not fh then return nil end
    local text = fh:read("*a")
    fh:close()
    return text
end

return Log
