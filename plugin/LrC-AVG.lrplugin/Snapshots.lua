-- Develop snapshots by name for the snapshot tools (issue #214; upstream's list/create/apply/delete_develop_snapshot
-- [upstream claim: Automaat/lightroom-mcp 1040453, plugin\LightroomMCP.lrplugin\HandlerSnapshots.lua, PR #405], rewritten).
-- create_snapshot stays Develop.createSnapshot: it reads the new snapshot after its write gate returns, which is when
-- Lightroom publishes it [upstream claim: HandlerSnapshots.lua create, "Lightroom publishes the new snapshot only after
-- the write gate returns"].
--   list_snapshots { photo_uuid }: { uuid, snapshots = { { id, name, id_global } } }, read only.
--   delete_snapshot { photo_uuid, snapshot_id }: deleteDevelopSnapshot(snapshotID) in a write gate, as spike S5 did
--     [handle: plugin\spikes\S5.lrplugin\S5WriteTests.lua:233; docs\reports\phase0\S5.md:109, "removed it"], then
--     read back gone. Upstream deletes by id_global in Develop [upstream claim: HandlerSnapshots.lua delete]; the
--     SDK names the parameter "ID of the snapshot" only [handle: API Reference\modules\LrPhoto.html deleteDevelopSnapshot].
--   apply_snapshot { ..., restore_view = true }: Develop.applySnapshot on the photo made active in Develop, then the
--     module, the sources and the selection put back (DevelopSession.withPhoto); without restore_view it is
--     Develop.applySnapshot as the session uses it (Lightroom stays in Develop).

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local DevelopSession = require 'DevelopSession'
local Gate = require 'Gate'
local Photos = require 'Photos'

local Snapshots = {}

local DELETE_SECONDS = 5 -- upstream waits 5 s for the deletion to show [upstream claim: HandlerSnapshots.lua delete]

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function list(catalog, photo)
    local out = {}
    catalog:withReadAccessDo(function()
        for _, s in ipairs(photo:getDevelopSnapshots() or {}) do
            out[#out + 1] = { id = tostring(s.snapshotID), name = s.name, id_global = s.id_global and tostring(s.id_global) or nil }
        end
    end)
    return out
end

local function has(catalog, photo, id)
    for _, s in ipairs(list(catalog, photo)) do if s.id == id then return true end end
    return false
end

function Snapshots.list(payload)
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    return { uuid = found.uuid, snapshots = list(catalog, photo) }
end

function Snapshots.delete(payload)
    local id = payload.snapshot_id
    if type(id) ~= "string" or id == "" then return fail("bad_request", "snapshot_id must be a non-empty string") end
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    if not has(catalog, photo, id) then return fail("unknown_snapshot", "the photo has no snapshot with id " .. id) end
    local gated, busy = Gate.write(catalog, "AVG delete snapshot", function() photo:deleteDevelopSnapshot(id) end)
    if not gated then return nil, busy end
    if not DevelopSession.waitFor(function() return not has(catalog, photo, id) end, DELETE_SECONDS) then
        return fail("delete_failed", "Lightroom still lists snapshot " .. id .. " after deleting it", true)
    end
    return { uuid = found.uuid, snapshot_id = id }
end

function Snapshots.apply(payload)
    if payload.restore_view ~= true then return Develop.applySnapshot(payload) end
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    local applied, err
    local result, busy = DevelopSession.withPhoto("apply_snapshot", catalog, photo, function()
        local ok, raised = LrTasks.pcall(function() applied, err = Develop.applySnapshot(payload) end)
        if not ok then err = { code = "plugin_error", message = tostring(raised), recoverable = false } end
        return { status = applied and "applied" or "failed" }
    end)
    if not result then return nil, busy end
    if applied then return applied end
    if err then return nil, err end
    return fail("not_applied", "the snapshot was not applied: " .. tostring(result.reason), true)
end

return Snapshots
