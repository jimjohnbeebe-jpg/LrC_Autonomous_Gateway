-- Shared helpers for spike S11: the results folder, one guarded call, one guarded read, and the
-- record of the values to put back.

local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'
local LrTasks = import 'LrTasks'

local SpikeJson = require 'SpikeJson'

local S11 = {}

-- Results folder <temp>\LrC-AVG\S11 (rule 03: plugin output stays in temp); Claude Code collects it.
function S11.resultsDir()
    local dir = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "S11")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

function S11.now()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H:%M:%S")
end

function S11.writeJson(path, value)
    local fh, err = io.open(path, "wb")
    if not fh then error("cannot write " .. path .. ": " .. tostring(err)) end
    fh:write(SpikeJson.encode(value) .. "\n")
    fh:close()
end

-- fn() under LrTasks.pcall (rule 03), timed in ms. Returns ok, value, and the record
-- { ok, ms, error } that goes into the results.
function S11.call(fn)
    local t0 = LrDate.currentTime()
    local ok, value = LrTasks.pcall(fn)
    local rec = { ok = ok, ms = math.floor((LrDate.currentTime() - t0) * 1000 + 0.5) }
    if not ok then rec.error = tostring(value) end
    return ok, value, rec
end

-- Keys the SDK lists under getFormattedMetadata, not getRawMetadata [handle: SDK 15.2 API
-- Reference, modules\LrPhoto.html, the two key lists]; every other key here is a raw one.
local FORMATTED = { title = true, caption = true, headline = true }

-- One metadata key read in a read gate, through the call the SDK lists it under.
-- Returns { value, via } or { error }.
function S11.readKey(catalog, photo, key)
    local via = FORMATTED[key] and "formatted" or "raw"
    local out
    catalog:withReadAccessDo(function()
        local ok, v = LrTasks.pcall(function()
            if FORMATTED[key] then return photo:getFormattedMetadata(key) end
            return photo:getRawMetadata(key)
        end)
        out = ok and { value = v, via = via } or { error = via .. ": " .. tostring(v) }
    end)
    return out
end

-- Waiting for write access instead of failing at once when the bridge is writing [handle:
-- modules\LrCatalog.html withWriteAccessDo timeoutParams]; the figure is ours [inference].
S11.WRITE_TIMEOUT = { timeout = 10 }

-- The values to put back live in the plugin's prefs, which keep tables of strings, numbers and
-- Booleans across a restart [handle: SDK 15.2 API Reference, modules\LrPrefs.html prefsForPlugin],
-- so a run that stopped is put back on the next start. nil is stored as { is_nil = true }.
function S11.pending()
    return LrPrefs.prefsForPlugin().pending
end

function S11.setPending(value)
    LrPrefs.prefsForPlugin().pending = value -- whole-table assignment, as the SDK page asks
end

return S11
