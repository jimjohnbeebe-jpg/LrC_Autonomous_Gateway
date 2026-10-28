-- Bridge command delete_empty_masks (plugin 1.6.0, GitHub issue #217 row 1): upstream's delete_empty_masks
-- [upstream claim: Automaat/lightroom-mcp 1040453, plugin\LightroomMCP.lrplugin\HandlerMaskDelete.lua:402-436],
-- rewritten. One photo per command, named by photo_uuid; the engine loops over the photos and counts the masks in
-- the settings before and in `read_back` (engine\src\mcp\tools-develop.ts), so this side names no mask field (rule 03).
--
-- delete_empty_masks { photo_uuid, snapshot_name }:
--   * refuses a photo whose AI mask Lightroom still computes (Develop.writeTarget, Pending.lua) or a Lightroom without
--     the call (Needs.check);
--   * takes the snapshot `snapshot_name` ("AVG ...") first (AVG-005);
--   * calls catalog:deleteAllEmptyMasks({ photo }) in its own write gate. The SDK reference: "Deletes all empty masks
--     for a set of photos. Must be called from within a withWriteAccessDo or withProlongedWriteAccessDo gate. First
--     supported in version 14.0"; given no photos "it will delete from all target photos", so the photo is always
--     passed [handle: API Reference\modules\LrCatalog.html:861-870, SDK 15.2]. A catalog call, so the photo need not
--     be active in Develop [inference: upstream calls it the same way, HandlerMaskDelete.lua:423-425];
--   * waits up to CHANGE_SECONDS for the settings to change, since whether the read right after the gate already
--     shows the deletion is [unverified]; when they still read back exactly as before (nothing was empty), deletes
--     the snapshot again, or keeps it and says why in `reason` when that delete fails;
--   * answers { uuid, status = "deleted" | "unchanged", snapshot?, reason?, read_back, ms }.
-- What Lightroom counts as an empty mask, and how soon the read shows the deletion, are [unverified]: no current
-- check settles them, as `npm run masks:parity` makes no empty mask (docs\reports\phase11\MASK-PARITY.md).

local LrDate = import 'LrDate'

local Develop = require 'Develop'
local DevelopSession = require 'DevelopSession'
local DevelopTools = require 'DevelopTools'
local Gate = require 'Gate'
local Log = require 'Log'
local Needs = require 'Needs'
local Snapshots = require 'Snapshots'

local MaskClean = {}

-- How long a read may lag the gate before "unchanged" is decided [inference: the figure; DevelopTools SETTLE_SECONDS is 0.5].
local CHANGE_SECONDS = 1

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

function MaskClean.deleteEmptyMasks(payload)
    if type(payload.photo_uuid) ~= "string" then return fail("bad_request", "photo_uuid must name the photo") end
    local name = payload.snapshot_name
    if type(name) ~= "string" or name:sub(1, 4) ~= "AVG " then return fail("bad_request", "snapshot_name must start with 'AVG '") end
    local catalog, photo, uuid, err = Develop.writeTarget(payload)
    if err then return nil, err end
    local present, unavailable = Needs.check("Deleting empty masks", "14.0", "catalog:", catalog, { "deleteAllEmptyMasks" })
    if not present then return nil, unavailable end
    local t0 = LrDate.currentTime()
    local before = Develop.readSettings(catalog, photo)
    local snap, snapErr = Develop.createSnapshot({ photo_uuid = uuid, name = name })
    if not snap then return nil, snapErr end
    local gated, busy = Gate.write(catalog, "AVG delete empty masks", function() catalog:deleteAllEmptyMasks({ photo }) end)
    if not gated then return nil, busy end
    local after
    local changed = DevelopSession.waitFor(function()
        after = Develop.readSettings(catalog, photo)
        return not DevelopTools.same(before, after)
    end, CHANGE_SECONDS)
    local result = { uuid = uuid, status = "deleted", snapshot = { id = snap.snapshot_id, name = name }, read_back = after }
    if not changed then
        result.status = "unchanged"
        local gone, delErr = Snapshots.delete({ photo_uuid = uuid, snapshot_id = snap.snapshot_id })
        if gone then result.snapshot = nil
        else result.reason = "unchanged; the snapshot could not be deleted: " .. tostring(delErr and delErr.message) end
    end
    result.ms = math.floor((LrDate.currentTime() - t0) * 1000)
    Log.info(string.format("delete_empty_masks: %s %s", uuid, result.status))
    return result
end

return MaskClean
