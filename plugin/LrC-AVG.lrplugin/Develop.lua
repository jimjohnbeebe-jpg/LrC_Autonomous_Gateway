-- Bridge commands that read and write the target photo's Develop settings (ARCHITECTURE section 3).
-- Each handler runs in its own task (Bridge.lua) and returns a result table, or nil plus an error
-- table { code, message, recoverable } (PRD NFR-7).
--
-- Catalog rules (.claude\rules\03-lightroom.md):
--   * catalog:getTargetPhoto() is a yielding query and runs outside any read gate: nesting it
--     inside one deadlocks on Windows [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSelection.lua:30-38].
--   * getDevelopSettings() runs inside withReadAccessDo; writes run inside withWriteAccessDo.
--   * Every applyDevelopSettings call passes a History name, and the name starts with "AVG " (PRD FR-4.4).
--   * Writes are read back and the read-back is returned, so the engine can verify them (Phase 0, P-12):
--     Lightroom silently ignored a malformed CameraProfile [handle: docs\reports\phase0\S5.md "Part 1 analysis"].
--   * Snapshots are applied by snapshotID [handle: docs\reports\phase0\S5.md "Part 2 analysis"] (P-05).
-- The engine validates settings against the canonical map before sending them
-- (engine\src\params\map.ts); this side does not second-guess key names.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local Develop = {}

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- The photo Lightroom is acting on, and its uuid. With payload.target_uuid set, a different
-- selected photo is refused, so a change of selection can never redirect a write.
local function target(payload)
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then
        return nil, nil, nil, { code = "no_target_photo", message = "No photo is selected in Lightroom", recoverable = true }
    end
    local uuid
    catalog:withReadAccessDo(function() uuid = photo:getRawMetadata("uuid") end)
    if payload.target_uuid ~= nil and payload.target_uuid ~= uuid then
        return nil, nil, nil, { code = "target_mismatch", recoverable = true,
            message = "The selected photo (" .. tostring(uuid) .. ") is not the target (" .. tostring(payload.target_uuid) .. ")" }
    end
    return catalog, photo, uuid, nil
end

local function readSettings(catalog, photo)
    local settings
    catalog:withReadAccessDo(function() settings = photo:getDevelopSettings() end)
    return settings
end

local function findSnapshots(catalog, photo, field, value)
    local matches = {}
    catalog:withReadAccessDo(function()
        for _, s in ipairs(photo:getDevelopSnapshots() or {}) do
            if s[field] == value then matches[#matches + 1] = s end
        end
    end)
    return matches
end

-- Metadata keys from LR_SDK_NOTES "LrPhoto", plus lens and cameraModel [unverified]. A key the SDK
-- rejects is listed in metadata_errors instead of failing the whole command. Each read is guarded
-- with LrTasks.pcall: these calls yield, and plain pcall raised "Yielding is not allowed within a C
-- or metamethod call" for all 13 keys in Jim's first Phase 1 run
-- [handle: docs\reports\phase1\P1\p1_check_2026-09-26T20-28-20-636Z.json photo.metadata_errors].
local RAW_KEYS = {
    path = "path", file_format = "fileFormat", is_virtual_copy = "isVirtualCopy",
    iso = "isoSpeedRating", shutter = "shutterSpeed", aperture = "aperture", focal_length = "focalLength",
    width = "width", height = "height",
}
local FORMATTED_KEYS = { filename = "fileName", copy_name = "copyName", lens = "lens", camera = "cameraModel" }

function Develop.getContext(payload)
    local catalog, photo, uuid, err = target(payload)
    if err then return nil, err end
    local ctx = { uuid = uuid, local_id = photo.localIdentifier, lrc_version = LrApplication.versionString() }
    local errors = {}
    catalog:withReadAccessDo(function()
        for field, key in pairs(RAW_KEYS) do
            local ok, value = LrTasks.pcall(photo.getRawMetadata, photo, key)
            if ok then ctx[field] = value else errors[#errors + 1] = key .. ": " .. tostring(value) end
        end
        for field, key in pairs(FORMATTED_KEYS) do
            local ok, value = LrTasks.pcall(photo.getFormattedMetadata, photo, key)
            if ok then ctx[field] = value else errors[#errors + 1] = key .. ": " .. tostring(value) end
        end
    end)
    if #errors > 0 then ctx.metadata_errors = errors end
    return ctx
end

function Develop.getSettings(payload)
    local catalog, photo, uuid, err = target(payload)
    if err then return nil, err end
    return { uuid = uuid, settings = readSettings(catalog, photo) }
end

function Develop.applySettings(payload)
    if type(payload.settings) ~= "table" or next(payload.settings) == nil then
        return fail("bad_request", "settings must be a non-empty object")
    end
    local historyName = payload.history_name
    if type(historyName) ~= "string" or historyName:sub(1, 4) ~= "AVG " then
        return fail("bad_request", "history_name must start with 'AVG ' (PRD FR-4.4)")
    end
    local catalog, photo, uuid, err = target(payload)
    if err then return nil, err end
    local t0 = LrDate.currentTime()
    catalog:withWriteAccessDo(historyName, function()
        photo:applyDevelopSettings(payload.settings, historyName)
    end)
    local applyMs = (LrDate.currentTime() - t0) * 1000
    return { uuid = uuid, apply_ms = applyMs, read_back = readSettings(catalog, photo) }
end

function Develop.createSnapshot(payload)
    local name = payload.name
    if type(name) ~= "string" or name:sub(1, 4) ~= "AVG " then
        return fail("bad_request", "name must start with 'AVG '")
    end
    local catalog, photo, uuid, err = target(payload)
    if err then return nil, err end
    local created
    catalog:withWriteAccessDo("AVG snapshot", function()
        created = photo:createDevelopSnapshot(name, true)
    end)
    -- createDevelopSnapshot returned true in S5 [handle: docs\reports\phase0\S5.md "Part 2 analysis"].
    if created ~= true then return fail("snapshot_failed", "createDevelopSnapshot returned " .. tostring(created)) end
    local matches = findSnapshots(catalog, photo, "name", name)
    local snap = matches[#matches]
    if not snap then return fail("snapshot_failed", "the new snapshot was not found by name") end
    return { uuid = uuid, snapshot_id = snap.snapshotID, id_global = snap.id_global, name = name, same_name_count = #matches }
end

function Develop.applySnapshot(payload)
    local id = payload.snapshot_id
    if type(id) ~= "string" or id == "" then return fail("bad_request", "snapshot_id must be a non-empty string") end
    local catalog, photo, uuid, err = target(payload)
    if err then return nil, err end
    if #findSnapshots(catalog, photo, "snapshotID", id) == 0 then
        return fail("unknown_snapshot", "the target photo has no snapshot with id " .. id)
    end
    catalog:withWriteAccessDo("AVG restore snapshot", function()
        photo:applyDevelopSnapshot(id)
    end)
    return { uuid = uuid, read_back = readSettings(catalog, photo) }
end

return Develop
