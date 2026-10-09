-- Shared helpers for the S10 menu scripts: S5Common.lua (plugin\spikes\S5.lrplugin) with S10's
-- folder, kept as a copy because a plugin can only require files inside its own folder
-- (.claude\rules\03-lightroom.md "Plugin hygiene").

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'

local SpikeJson = require 'SpikeJson'

local S10 = {}

S10.DECLARED_SDK_VERSION = 13.0 -- keep in step with Info.lua

-- Results folder <temp>\LrC-AVG\S10\<sub>. Plugin output stays in the temp folder; `npm run s10:check`
-- reads the recorder's files from S10\run1, and Claude Code collects everything with
-- spikes\S10\collect.ts, so Jim never handles files.
function S10.resultsDir(sub)
    local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
    dir = LrPathUtils.child(LrPathUtils.child(dir, "S10"), sub)
    LrFileUtils.createAllDirectories(dir)
    return dir
end

-- Name of the applied Look (Adobe Raw and creative profiles are Looks over a base
-- CameraProfile). Field names Name / UUID as observed in the live dump
-- docs\reports\phase0\S5\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json ("Look").
function S10.lookName(settings)
    local look = settings.Look
    if type(look) == "table" and type(look.Name) == "string" and look.Name ~= "" then return look.Name end
    return nil
end

function S10.lookUuid(settings)
    local look = settings.Look
    if type(look) == "table" and type(look.UUID) == "string" then return look.UUID end
    return nil
end

-- What the Profile field in Develop would show, in plain words; "+ B&W" when ConvertToGrayscale is set.
function S10.profileLabel(cameraProfile, lookName, grayscale)
    local base = tostring(cameraProfile)
    if lookName then base = lookName .. " (base: " .. base .. ")" end
    if grayscale then base = base .. " + B&W" end
    return base
end

function S10.safeName(s)
    return (tostring(s):gsub('[\\/:%*%?"<>|]', "_"))
end

function S10.now()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H:%M:%S")
end

function S10.writeJson(path, value)
    local fh, err = io.open(path, "wb")
    if not fh then error("cannot write " .. path .. ": " .. tostring(err)) end
    fh:write(SpikeJson.encode(value) .. "\n")
    fh:close()
end

-- Photo identity + settings, read inside one read gate (Automaat reads develop settings
-- inside withReadAccessDo: HandlerMetadata.lua:55-72).
function S10.snapshot(catalog, photo)
    local settings, meta
    catalog:withReadAccessDo(function()
        settings = photo:getDevelopSettings()
        meta = {
            spike = "S10",
            filename = photo:getFormattedMetadata("fileName"),
            copy_name = photo:getFormattedMetadata("copyName"),
            uuid = photo:getRawMetadata("uuid"),
            local_identifier = photo.localIdentifier,
            is_virtual_copy = photo:getRawMetadata("isVirtualCopy"),
            file_format = photo:getRawMetadata("fileFormat"),
        }
    end)
    meta.lr_version = LrApplication.versionString()
    meta.declared_sdk_version = S10.DECLARED_SDK_VERSION
    meta.captured_at = S10.now() .. " (local time)"
    local count = 0
    for _ in pairs(settings) do count = count + 1 end
    meta.key_count = count
    return settings, meta
end

return S10
