-- Shared helpers for the S5 menu scripts.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'

local SpikeJson = require 'SpikeJson'

local S5 = {}

S5.DECLARED_SDK_VERSION = 13.0 -- keep in step with Info.lua

function S5.outDir()
    local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

function S5.safeName(s)
    return (tostring(s):gsub('[\\/:%*%?"<>|]', "_"))
end

function S5.now()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H:%M:%S")
end

function S5.writeText(path, text, mode)
    local fh, err = io.open(path, mode or "wb")
    if not fh then error("cannot write " .. path .. ": " .. tostring(err)) end
    fh:write(text)
    fh:close()
end

function S5.writeJson(path, value)
    S5.writeText(path, SpikeJson.encode(value) .. "\n")
end

function S5.encode(value)
    return SpikeJson.encode(value)
end

-- Photo identity + settings, read inside one read gate (Automaat reads develop settings
-- inside withReadAccessDo: HandlerMetadata.lua:55-72).
function S5.snapshot(catalog, photo)
    local settings, meta
    catalog:withReadAccessDo(function()
        settings = photo:getDevelopSettings()
        meta = {
            spike = "S5",
            filename = photo:getFormattedMetadata("fileName"),
            copy_name = photo:getFormattedMetadata("copyName"),
            uuid = photo:getRawMetadata("uuid"),
            local_identifier = photo.localIdentifier,
            is_virtual_copy = photo:getRawMetadata("isVirtualCopy"),
            file_format = photo:getRawMetadata("fileFormat"),
            camera_model = photo:getFormattedMetadata("cameraModel"),
            lens = photo:getFormattedMetadata("lens"),
        }
    end)
    meta.lr_version = LrApplication.versionString()
    meta.declared_sdk_version = S5.DECLARED_SDK_VERSION
    meta.captured_at = S5.now() .. " (local time)"
    local count = 0
    for _ in pairs(settings) do count = count + 1 end
    meta.key_count = count
    meta.encoding_notes = "empty Lua tables are written as []; non-finite numbers as strings"
    return settings, meta
end

-- Shallow diff of two settings tables; table values compared by their JSON encoding.
function S5.diff(before, after)
    local changes = {}
    local seen = {}
    local function same(a, b)
        if type(a) == "table" and type(b) == "table" then return S5.encode(a) == S5.encode(b) end
        return a == b
    end
    for k, v in pairs(after) do
        seen[k] = true
        if not same(before[k], v) then
            changes[tostring(k)] = { before = before[k], after = v }
        end
    end
    for k, v in pairs(before) do
        if not seen[k] then changes[tostring(k)] = { before = v, after = "<absent>" } end
    end
    return changes
end

return S5
