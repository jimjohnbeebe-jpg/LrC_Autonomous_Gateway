-- AVG-S7 shared helpers: the output folder, metadata and settings reads, one write, the JPEG
-- export, the selection, the state file that carries uuids across the Lightroom restart, and saving.
-- Output goes to <temp>\LrC-AVG\S7\ (rule 03-lightroom "Plugin hygiene"); Claude Code collects it
-- with spikes\S7\summarize.ts, Jim copies nothing.

local LrDate = import 'LrDate'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local SpikeJson = require 'SpikeJson'

local Common = {}

Common.EXPORT_LONG_EDGE = 1600

function Common.outDir()
    local dir = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "S7")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

function Common.stamp()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H-%M-%S")
end

-- The run's date and time, YYYYMMDD-HHMMSS: the suffix of the run's preset names (S7Presets.names).
-- The date is in it so a run on a later day at the same time gets other names (Greptile, PR #29).
function Common.runTag()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y%m%d-%H%M%S")
end

function Common.localTime()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d %H:%M:%S") .. " (local time)"
end

-- Metadata reads use LrTasks.pcall inside the read gate: a plain pcall raised "Yielding is not
-- allowed" [handle: LR_SDK_NOTES "Recorded in Phase 1", metadata reads]. A refused key is recorded
-- as "error: ...", a nil value as "<nil>", so neither drops out of the JSON.
local function readKeys(catalog, photo, method, keys)
    local out = {}
    catalog:withReadAccessDo(function()
        for _, key in ipairs(keys) do
            local ok, value = LrTasks.pcall(method, photo, key)
            if not ok then
                out[key] = "error: " .. tostring(value)
            elseif value == nil then
                out[key] = "<nil>"
            else
                out[key] = value
            end
        end
    end)
    return out
end

function Common.raw(catalog, photo, keys)
    return readKeys(catalog, photo, photo.getRawMetadata, keys)
end

function Common.formatted(catalog, photo, keys)
    return readKeys(catalog, photo, photo.getFormattedMetadata, keys)
end

-- The fields S6 recorded, plus the uuid.
function Common.describePhoto(catalog, photo)
    local raw = Common.raw(catalog, photo, { "uuid", "isVirtualCopy", "masterPhoto" })
    local fmt = Common.formatted(catalog, photo, { "copyName", "fileName" })
    local master = raw.masterPhoto
    local masterId
    if master ~= nil and type(master) ~= "string" then masterId = master.localIdentifier end
    return {
        local_id = photo.localIdentifier,
        uuid = raw.uuid,
        is_virtual_copy = raw.isVirtualCopy,
        master_local_id = masterId,
        copy_name = fmt.copyName,
        file_name = fmt.fileName,
    }
end

-- getDevelopSettings runs in a task, inside the read gate (rule 03).
function Common.settings(catalog, photo)
    local settings
    catalog:withReadAccessDo(function() settings = photo:getDevelopSettings() end)
    return settings or {}
end

function Common.pick(t, keys)
    local out = {}
    for _, k in ipairs(keys) do out[k] = t[k] end
    return out
end

function Common.near(a, b)
    return type(a) == "number" and type(b) == "number" and math.abs(a - b) < 0.001
end

-- One write, one History step named "AVG S7 ..." (rule 03). Returns ok, err.
function Common.apply(catalog, photo, settings, historyName)
    return LrTasks.pcall(function()
        catalog:withWriteAccessDo(historyName, function()
            photo:applyDevelopSettings(settings, historyName)
        end)
    end)
end

-- Yielding catalog queries stay outside any gate (rule 03).
function Common.selection(catalog)
    local target = catalog:getTargetPhoto()
    local ids = {}
    for _, p in ipairs(catalog:getTargetPhotos() or {}) do table.insert(ids, p.localIdentifier) end
    return { target_local_id = target and target.localIdentifier or nil, selected_local_ids = ids }
end

function Common.onlySelected(selection, photo)
    local ids = selection.selected_local_ids
    return selection.target_local_id == photo.localIdentifier and #ids == 1 and ids[1] == photo.localIdentifier
end

-- findPhotoByUuid must run in a task [handle: https://lrc.mcor.dev/modules/LrCatalog.html]. It
-- stays outside any gate like the other catalog queries [inference: the page does not say whether
-- it yields].
function Common.findByUuid(catalog, uuid)
    if type(uuid) ~= "string" or uuid == "" then return nil, "no uuid" end
    local ok, photo = LrTasks.pcall(function() return catalog:findPhotoByUuid(uuid) end)
    if not ok then return nil, "findPhotoByUuid: " .. tostring(photo) end
    if not photo then return nil, "findPhotoByUuid found nothing" end
    return photo
end

-- The LrExportSession settings of plugin\LrC-AVG.lrplugin\Preview.lua, which exported on 15.5.1
-- in Phases 2 and 3 [handle: LR_SDK_NOTES "Recorded in Phase 2"]. Each export gets a new folder,
-- so the one JPEG in it is this export.
function Common.export(photo, label)
    local dir = LrPathUtils.child(Common.outDir(), "export_" .. label .. "_" .. Common.stamp())
    LrFileUtils.createAllDirectories(dir)
    local t0 = LrDate.currentTime()
    local ok, err = LrTasks.pcall(function()
        local session = LrExportSession {
            photosToExport = { photo },
            exportSettings = {
                LR_export_destinationType = "specificFolder",
                LR_export_destinationPathPrefix = dir,
                LR_export_useSubfolder = false,
                LR_format = "JPEG",
                LR_jpeg_quality = 0.75,
                LR_export_colorSpace = "sRGB",
                LR_size_doConstrain = true,
                LR_size_resizeType = "longEdge",
                LR_size_maxWidth = Common.EXPORT_LONG_EDGE,
                LR_size_maxHeight = Common.EXPORT_LONG_EDGE,
                LR_size_units = "pixels",
                LR_outputSharpeningOn = false,
                LR_collisionHandling = "overwrite",
                LR_reimportExportedPhoto = false,
            },
        }
        session:doExportOnCurrentTask()
    end)
    local out = { ms = (LrDate.currentTime() - t0) * 1000, long_edge = Common.EXPORT_LONG_EDGE }
    for file in LrFileUtils.files(dir) do
        if file:lower():match("%.jpe?g$") then out.path = file end
    end
    if not ok then
        out.error = tostring(err)
    elseif not out.path then
        out.error = "no JPEG in " .. dir
    end
    return out
end

-- The state files: key=value lines. Menu item 1 writes s7_state.txt, which items 2 and 3 read after a
-- restart; the preset-file re-run (item 4) writes s7_xmp_state.txt, which items 5 and 6 read, so the
-- re-run never overwrites the first run's state.
Common.STATE_FILE = "s7_state.txt"
Common.XMP_STATE_FILE = "s7_xmp_state.txt"

local function statePath(file)
    return LrPathUtils.child(Common.outDir(), file or Common.STATE_FILE)
end

function Common.saveState(state, file)
    local keys = {}
    for k in pairs(state) do table.insert(keys, k) end
    table.sort(keys)
    local fh, err = io.open(statePath(file), "wb")
    if not fh then return false, tostring(err) end
    for _, k in ipairs(keys) do fh:write(k, "=", tostring(state[k]), "\n") end
    fh:close()
    return true
end

function Common.loadState(file)
    local fh = io.open(statePath(file), "rb")
    if not fh then return nil end
    local state = {}
    for line in fh:lines() do
        local k, v = line:match("^([%w_]+)=(.*)$")
        if k then state[k] = v end
    end
    fh:close()
    return state
end

-- Save one step's result as JSON and add a line to s7_log.txt. Returns ok, err.
function Common.save(prefix, result)
    local path = LrPathUtils.child(Common.outDir(), prefix .. "_" .. Common.stamp() .. ".json")
    local ok, err = SpikeJson.writeFile(path, result)
    local fh = io.open(LrPathUtils.child(Common.outDir(), "s7_log.txt"), "a")
    if fh then
        fh:write(prefix, " ", tostring(result.run_at), ": ", ok and path or ("SAVE FAILED: " .. tostring(err)), "\n")
        fh:close()
    end
    return ok, err
end

-- The whole file, or nil.
function Common.readFile(path)
    local fh = io.open(path, "rb")
    if not fh then return nil end
    local text = fh:read("*a")
    fh:close()
    return text
end

-- Write the whole file, bytes as given. Returns ok, err.
function Common.writeFile(path, text)
    local fh, err = io.open(path, "wb")
    if not fh then return false, tostring(err) end
    fh:write(text)
    fh:close()
    return true
end

function Common.saveLine(ok, err)
    if ok then return "Saved automatically - nothing to copy." end
    return "SAVE FAILED: " .. tostring(err) .. " - tell Claude Code."
end

return Common
