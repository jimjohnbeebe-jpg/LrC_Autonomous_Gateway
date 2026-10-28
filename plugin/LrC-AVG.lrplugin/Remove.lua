-- Bridge command remove_photos { photo_uuids, confirm = true } (decision D3 of epic #207, issue #218 row 10
-- [stated: Jim, 2026-10-28, "Go with recommendations"]): a port of upstream's remove_photos_from_catalog
-- [upstream claim: Automaat/lightroom-mcp 1040453, plugin\LightroomMCP.lrplugin\HandlerRemoveFromCatalog.lua, PR #424],
-- rewritten. LrSelection.removeFromCatalog() "Removes the selection from the catalog. First supported in version 14.3"
-- [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrSelection.html:641-643], so it acts on the
-- selection, and this command makes the selection exactly the photos named:
--   1. refuses below 14.3 (Needs.check), and refuses a master whose virtual copies are not all named, before
--      Lightroom moves (virtualCopies: "All virtual copies of this photo" [handle: API Reference\modules\LrPhoto.html
--      getRawMetadata]);
--   2. under the selection lock (Catalog.exclusive) notes the module, the sources and the selection, opens the
--      Library grid on All Photographs and selects the photos [upstream claim: HandlerRemoveFromCatalog.lua];
--   3. removes only when the selection reads back as exactly those photos, Library is still the module and the lock
--      is still held, then waits until none of them is found;
--   4. puts back the module, the sources and the selection's surviving photos (DevelopSession.restoreView), except
--      when removeFromCatalog ran and the photos are still there: the grid then stays on exactly those photos, so a
--      confirm dialog Lightroom may be showing removes only them, never the user's own selection put back [inference:
--      removeFromCatalog acts on the selection, LrSelection.html:641-643; whether Lightroom asks is unverified, below].
-- Files stay on disk [upstream claim: tool-contracts.ts remove_photos_from_catalog]. Whether Lightroom asks the user
-- first is [unverified] (LR_SDK_NOTES "Recorded in Phase 8.5 — 2026-10-12") until Jim's `npm run develop-catalog:check`.

local LrApplication = import 'LrApplication'
local LrApplicationView = import 'LrApplicationView'
local LrSelection = import 'LrSelection'
local LrTasks = import 'LrTasks'

local Catalog = require 'Catalog'
local DevelopSession = require 'DevelopSession'
local Log = require 'Log'
local Needs = require 'Needs'
local Photos = require 'Photos'

local Remove = {}

Remove.MAX = 100
-- Upstream's waits for the selection and for the removal [upstream claim: HandlerRemoveFromCatalog.lua, 10 s each].
local SELECT_SECONDS, GONE_SECONDS = 10, 10

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function idSet(list)
    local s = {}
    for _, p in ipairs(list or {}) do s[p.localIdentifier] = true end
    return s
end

-- The selection is exactly `photos`, with the first one active.
local function exactly(catalog, photos)
    local active = catalog:getTargetPhoto()
    if not active or active.localIdentifier ~= photos[1].localIdentifier then return false end
    local selected = catalog:getTargetPhotos() or {}
    if #selected ~= #photos then return false end
    local want = idSet(photos)
    for _, p in ipairs(selected) do if not want[p.localIdentifier] then return false end end
    return true
end

-- The photos of `list` still in the catalog: a removed photo's batch row has no uuid [upstream claim:
-- HandlerRemoveFromCatalog.lua surviving]. Outside any gate, as Photos.describePage reads batches.
local function surviving(catalog, list)
    if #list == 0 then return {} end
    local ok, raw = LrTasks.pcall(function() return catalog:batchGetRawMetadata(list, { "uuid" }) or {} end)
    local out = {}
    for _, p in ipairs(list) do
        if not ok or type((raw[p] or {}).uuid) == "string" then out[#out + 1] = p end
    end
    return out
end

-- The photos named, found by uuid (duplicates once), and the uuids no photo has. Nil plus an error for a failed lookup.
local function resolve(catalog, uuids)
    local photos, uuidOf, missing = {}, {}, {}
    for i, uuid in ipairs(uuids) do
        if i > 1 then LrTasks.yield() end -- PRD NFR-1
        local photo, d = Photos.find(catalog, uuid)
        if photo then
            if not uuidOf[photo.localIdentifier] then photos[#photos + 1] = photo end
            uuidOf[photo.localIdentifier] = d.uuid
        elseif d.code == "unknown_photo" then
            missing[#missing + 1] = uuid
        else
            return nil, d
        end
    end
    return photos, uuidOf, missing
end

-- An error naming the first master whose virtual copies are not all among `photos`, or nil.
local function copiesLeft(catalog, photos, uuidOf)
    local ok, raw = LrTasks.pcall(function() return catalog:batchGetRawMetadata(photos, { "virtualCopies" }) or {} end)
    if not ok then return { code = "lookup_failed", recoverable = true, message = "reading the virtual copies failed, nothing was removed: " .. tostring(raw) } end
    for _, photo in ipairs(photos) do
        local left = 0
        for _, copy in ipairs((raw[photo] or {}).virtualCopies or {}) do
            if not uuidOf[copy.localIdentifier] then left = left + 1 end
        end
        if left > 0 then
            return { code = "copies_not_included", recoverable = false, message = string.format(
                "%s is the master of %d virtual cop%s not named here: name every copy to remove a master, or leave the master out. Nothing was removed.",
                uuidOf[photo.localIdentifier], left, left == 1 and "y" or "ies") }
        end
    end
    return nil
end

-- Steps 2-3 under the lock; returns { status, reason? }, the photos left, and true when the selection must stay (step 4).
local function removeSelected(catalog, photos, owns)
    LrApplicationView.switchToModule("library")
    LrApplicationView.gridView()
    catalog:setActiveSources({ catalog.kAllPhotos })
    catalog:setSelectedPhotos(photos[1], photos)
    if not DevelopSession.waitFor(function() return exactly(catalog, photos) end, SELECT_SECONDS) then
        return { status = "failed", reason = "Lightroom did not select exactly these photos; nothing was removed" }, photos
    end
    if LrApplicationView.getCurrentModuleName() ~= "library" or not exactly(catalog, photos) or not owns() then
        return { status = "failed", reason = "the selection or the module changed before the removal; nothing was removed" }, photos
    end
    LrSelection.removeFromCatalog()
    local gone = DevelopSession.waitFor(function() return #surviving(catalog, photos) == 0 end, GONE_SECONDS)
    if gone then return { status = "removed" }, {} end
    return { status = "failed", reason = "Lightroom did not remove every photo within " .. GONE_SECONDS .. " s (it may be asking to confirm); the Library grid stays on these photos so that a confirm removes only them; check the catalog before trying again" }, surviving(catalog, photos), true
end

function Remove.photos(payload)
    if payload.confirm ~= true then return fail("bad_request", "confirm must be true: removing photos loses their catalog edits and metadata") end
    local uuids = payload.photo_uuids
    if type(uuids) ~= "table" or #uuids < 1 or #uuids > Remove.MAX then return fail("bad_request", "photo_uuids must hold 1 to " .. Remove.MAX .. " uuids") end
    local present, unavailable = Needs.check("Removing photos from the catalog", "14.3", "LrSelection.", LrSelection, { "removeFromCatalog" })
    if not present then return nil, unavailable end
    local catalog = LrApplication.activeCatalog()
    local photos, uuidOf, missing = resolve(catalog, uuids)
    if not photos then return nil, uuidOf end
    if #photos == 0 then return fail("unknown_photo", "no photo in the catalog has any of these uuids; nothing was removed") end
    local refused = copiesLeft(catalog, photos, uuidOf)
    if refused then return nil, refused end
    local result, busy = Catalog.exclusive("remove_photos", function(owns)
        local view = DevelopSession.captureView(catalog)
        local ok, answer, left, stay = LrTasks.pcall(removeSelected, catalog, photos, owns)
        if not (ok and stay) then
            local kept = surviving(catalog, view.selection or {})
            local keep = idSet(kept)
            view.active = (view.active and keep[view.active.localIdentifier]) and view.active or kept[1]
            view.selection = #kept > 0 and kept or nil
            DevelopSession.restoreView(catalog, view, true)
        end
        if not ok then error(answer, 0) end
        local leftIds = idSet(left)
        answer.removed, answer.not_removed = {}, {}
        for _, p in ipairs(photos) do
            local list = leftIds[p.localIdentifier] and answer.not_removed or answer.removed
            list[#list + 1] = uuidOf[p.localIdentifier]
        end
        return answer
    end)
    if not result then return nil, busy end
    result.missing = missing
    Log.info(string.format("remove_photos: %s, %d removed, %d not, %d missing (%s)", result.status, #result.removed, #result.not_removed, #missing, tostring(result.reason or "")))
    return result
end

return Remove
