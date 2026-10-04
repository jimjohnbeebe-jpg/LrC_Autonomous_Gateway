-- Bridge commands that read and write the target photo's Develop settings (ARCHITECTURE section 3).
-- Each handler runs in its own task (Dispatch.lua) and returns a result table, or nil plus an error
-- table { code, message, recoverable } (PRD NFR-7).
--
-- Catalog rules (.claude\rules\03-lightroom.md):
--   * catalog:getTargetPhoto() is a yielding query and runs outside any read gate: nesting it
--     inside one deadlocks on Windows [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSelection.lua:30-38].
--     findPhotoByUuid (Photos.lua) runs outside a gate too.
--   * getDevelopSettings() runs inside withReadAccessDo; writes run inside Gate.write (Gate.lua: a
--     write gate that waits up to 60 s for the catalog, and answers gate_busy when it stays held).
--   * Every applyDevelopSettings call passes a History name, and the name starts with "AVG " (PRD FR-4.4).
--   * Writes are read back and the read-back is returned, so the engine can verify them (Phase 0, P-12):
--     Lightroom silently ignored a malformed CameraProfile [handle: docs\reports\phase0\S5.md "Part 1 analysis"].
--   * Snapshots are applied by snapshotID [handle: docs\reports\phase0\S5.md "Part 2 analysis"] (P-05).
--   * apply_settings, create_snapshot and apply_snapshot are refused with ai_compute_pending while
--     Lightroom still computes an AI mask on the photo (Pending.lua, plugin 0.16.0, D16).
-- The engine validates settings against the canonical map before sending them
-- (engine\src\params\map.ts); this side does not second-guess key names.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'
local Pending = require 'Pending'
local Photos = require 'Photos'

local Develop = {}

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- target(), then the AI-mask guard (Pending.lua) for a command that writes to the photo.
local function writeTarget(payload)
    local catalog, photo, uuid, err = Develop.target(payload)
    if err then return nil, nil, nil, err end
    local refused = Pending.refusal(catalog, photo, uuid)
    if refused then return nil, nil, nil, refused end
    return catalog, photo, uuid, nil
end

-- The photo a command acts on, and its uuid:
--   * payload.photo_uuid set (plugin 0.4.0, PHASE4_PLAN row 8): that photo, found by uuid and
--     checked against payload.expect (Photos.lua), selected or not; the selection is not touched.
--     S7 wrote to and exported a photo found this way without selecting it, and the selection did
--     not change [handle: docs\reports\phase4\S7.md Verdict 4]; on virtual copies only, so the same
--     on an original is [unverified].
--   * else the selected photo. With payload.target_uuid set, a different selected photo is refused,
--     so a change of selection can never redirect a write.
local function target(payload)
    local catalog = LrApplication.activeCatalog()
    if payload.photo_uuid ~= nil then
        if payload.target_uuid ~= nil then
            return nil, nil, nil, { code = "bad_request", recoverable = false,
                message = "name the photo with photo_uuid or target_uuid, not both" }
        end
        local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
        if not photo then return nil, nil, nil, found end
        return catalog, photo, found.uuid, nil
    end
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
-- Preview.lua exports the same target photo.
Develop.target = target

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

-- Metadata keys from LR_SDK_NOTES "LrPhoto", plus lens and cameraModel (all 13 read in Phase 1 run 3
-- [handle: docs\reports\phase1\PHASE1.md "Numbers", metadata keys refused 0 of 13]), plus rating,
-- pickStatus and colorNameForLabel for MCP_TOOLS' rating / pick / label (Phase 2) [unverified until
-- npm run phase2:check reads them]. A key the SDK rejects is listed in metadata_errors instead of
-- failing the whole command. Each read is guarded
-- with LrTasks.pcall, because a plain pcall around them raised "Yielding is not allowed within a C
-- or metamethod call" for all 13 keys in Jim's Phase 1 runs 1-2
-- [handle: docs\reports\phase1\P1\p1_check_2026-09-26T20-28-20-636Z.json photo.metadata_errors].
-- The reads stay inside the read gate: the same calls, unwrapped and inside withReadAccessDo, ran on
-- LrC 15.5.1 without a hang in spikes S5 and S6 [handle: plugin\spikes\S5.lrplugin\S5Common.lua:77-88,
-- whose recorder files hold file_format "RAW"; plugin\spikes\S6.lrplugin\S6Run.lua:36-41] and for the
-- uuid in runs 1-2. That is also the Automaat pattern rule 03 names (HandlerMetadata.lua:55-72). Rule
-- 03's deadlock warning is about catalog queries such as getTargetPhoto, which stay outside (target()).
-- croppedDimensions ({ width, height }) is the size after a Lightroom crop, and the full size when
-- uncropped; width and height stay at the full size after a crop [handle: docs\reports\phase4\S7.md
-- Verdict 3; S7\s7_run_2026-09-27T12-53-05.json crop.master_size, crop.size_after_crop]. The engine's
-- region preview takes the photo's size from it (engine\src\mcp\tools-context.ts photoSize).
local RAW_KEYS = {
    path = "path", file_format = "fileFormat", is_virtual_copy = "isVirtualCopy",
    iso = "isoSpeedRating", shutter = "shutterSpeed", aperture = "aperture", focal_length = "focalLength",
    width = "width", height = "height", cropped_dimensions = "croppedDimensions",
    rating = "rating", pick = "pickStatus", label = "colorNameForLabel",
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
    local tCommand = LrDate.currentTime()
    local catalog, photo, uuid, err = writeTarget(payload)
    if err then return nil, err end
    local t0 = LrDate.currentTime()
    local gated, busy = Gate.write(catalog, historyName, function()
        photo:applyDevelopSettings(payload.settings, historyName)
    end)
    if not gated then return nil, busy end
    local t1 = LrDate.currentTime()
    local readBack = readSettings(catalog, photo)
    local t2 = LrDate.currentTime()
    -- apply_ms: the write gate; read_ms: the read-back; command_ms: this whole handler (target check
    -- included). PHASE1.md "Consequences" asks for the write command's own duration.
    return { uuid = uuid, apply_ms = (t1 - t0) * 1000, read_ms = (t2 - t1) * 1000, command_ms = (t2 - tCommand) * 1000,
        read_back = readBack }
end

function Develop.createSnapshot(payload)
    local name = payload.name
    if type(name) ~= "string" or name:sub(1, 4) ~= "AVG " then
        return fail("bad_request", "name must start with 'AVG '")
    end
    local catalog, photo, uuid, err = writeTarget(payload)
    if err then return nil, err end
    local created
    local gated, busy = Gate.write(catalog, "AVG snapshot", function()
        created = photo:createDevelopSnapshot(name, true)
    end)
    if not gated then return nil, busy end
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
    local catalog, photo, uuid, err = writeTarget(payload)
    if err then return nil, err end
    if #findSnapshots(catalog, photo, "snapshotID", id) == 0 then
        return fail("unknown_snapshot", "the target photo has no snapshot with id " .. id)
    end
    local gated, busy = Gate.write(catalog, "AVG restore snapshot", function()
        photo:applyDevelopSnapshot(id)
    end)
    if not gated then return nil, busy end
    return { uuid = uuid, read_back = readSettings(catalog, photo) }
end

return Develop
