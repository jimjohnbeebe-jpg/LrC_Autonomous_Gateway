-- Photos named by uuid (PHASE4_PLAN rows 6 and 8): find one with findPhotoByUuid, describe its
-- identity, and check it is the photo the engine means (Phase 0, P-18). Catalog.lua's select_photo
-- and Develop.lua's commands with `photo_uuid` both use it; Catalog.lua held it until row 8.
--
-- findPhotoByUuid "must be called from within an asynchronous task started using LrTasks"
-- [handle: https://lrc.mcor.dev/modules/LrCatalog.html findPhotoByUuid]; every bridge line runs in
-- its own task [handle: plugin\LrC-AVG.lrplugin\Sockets.lua:50, LrTasks.startAsyncTask in onMessage].
-- It runs outside any read gate, as rule 03 asks of yielding catalog
-- queries; whether it yields is [unverified], and S7 ran it outside a gate too [handle:
-- plugin\spikes\S7.lrplugin\S7Common.lua:122-131]. S7 found its photos and their identity check
-- passed [handle: docs\reports\phase4\S7.md "Numbers", item 4]. Metadata reads run inside a read
-- gate with LrTasks.pcall, as in Develop.lua getContext.

local LrTasks = import 'LrTasks'

local Photos = {}

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function read(photo, method, key)
    local ok, value = LrTasks.pcall(method, photo, key)
    if ok then return value end
    return nil
end

-- A photo's identity. For a photo that is not a virtual copy, masterPhoto is the photo itself and
-- copyName is nil [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json "master"].
-- fileName (plugin 0.4.0) is the key Develop.lua getContext reads as `filename`, read without error
-- in Phase 1 [handle: docs\reports\phase1\PHASE1.md "Numbers", metadata keys refused 0 of 13].
-- rating and capture_time (plugin 0.8.0, Library.lua's listings): getRawMetadata("rating") is "either
-- nil or number of stars", nil for none; getFormattedMetadata("dateTimeOriginal") is "the date and time
-- of capture (for example, "09/15/2005 17:32:50")" [handle: https://lrc.mcor.dev/modules/LrPhoto.html].
function Photos.describe(catalog, photo)
    local d = { local_id = photo.localIdentifier }
    catalog:withReadAccessDo(function()
        d.uuid = read(photo, photo.getRawMetadata, "uuid")
        d.is_virtual_copy = read(photo, photo.getRawMetadata, "isVirtualCopy")
        local master = read(photo, photo.getRawMetadata, "masterPhoto")
        if type(master) ~= "string" and master ~= nil then d.master_local_id = master.localIdentifier end
        d.copy_name = read(photo, photo.getFormattedMetadata, "copyName")
        d.filename = read(photo, photo.getFormattedMetadata, "fileName")
        d.rating = read(photo, photo.getRawMetadata, "rating")
        d.capture_time = read(photo, photo.getFormattedMetadata, "dateTimeOriginal")
    end)
    return d
end

-- Whether the photo's original file is there (plugin 0.19.0, fix/offline-original): true, false, or
-- nil plus the error when the call failed. checkPhotoAvailability "Reports whether this photo is
-- believed to be present on disk at this time" [handle: https://lrc.mcor.dev/modules/LrPhoto.html,
-- read 2026-10-09]. It runs outside the read gate, as rule 03 asks of a call that may yield; whether
-- it yields, and what it answers for an offline photo with a smart preview, are [unverified] until
-- npm run offline:check (docs\reports\phase8\offline.md).
function Photos.available(photo)
    local ok, value = LrTasks.pcall(photo.checkPhotoAvailability, photo)
    if not ok then return nil, tostring(value) end
    if type(value) ~= "boolean" then return nil, "checkPhotoAvailability returned " .. tostring(value) end
    return value, nil
end

-- The refusal for a photo whose original file is missing, or nil when it is there (or the check
-- failed). An offline original took every write unchecked and exported nothing in S10 [handle:
-- docs\reports\phase8\S10.md "Consequences" item 8], so apply_settings and the exports refuse it.
-- The menu path Library > Find Missing Photos is [unverified] until npm run offline:check asks Jim.
function Photos.missing(catalog, photo)
    if Photos.available(photo) ~= false then return nil end
    local name, path
    catalog:withReadAccessDo(function()
        name = read(photo, photo.getFormattedMetadata, "fileName")
        path = read(photo, photo.getRawMetadata, "path")
    end)
    return { code = "original_missing", recoverable = true,
        message = "The original file of " .. tostring(name) .. " is missing (last known at " .. tostring(path) ..
            "), so Lightroom cannot edit or export it. Reconnect the file in Lightroom (Library > Find Missing Photos), then try again." }
end

-- The first way `d` differs from what the engine expects, or nil.
function Photos.mismatch(d, uuid, expect)
    if d.uuid ~= uuid then return "uuid " .. tostring(d.uuid) end
    for _, field in ipairs({ "copy_name", "master_local_id", "is_virtual_copy" }) do
        if expect[field] ~= nil and d[field] ~= expect[field] then
            return field .. " " .. tostring(d[field]) .. ", expected " .. tostring(expect[field])
        end
    end
    return nil
end

-- The photo with this uuid and its description, checked against `expect` (copy_name,
-- master_local_id, is_virtual_copy; each optional). Returns photo, description; or nil, error.
function Photos.find(catalog, uuid, expect)
    if type(uuid) ~= "string" or uuid == "" then return fail("bad_request", "uuid must be a non-empty string") end
    if expect == nil then expect = {} end
    if type(expect) ~= "table" then return fail("bad_request", "expect must be an object") end
    local ok, photo = LrTasks.pcall(function() return catalog:findPhotoByUuid(uuid) end)
    if not ok then return fail("lookup_failed", "findPhotoByUuid: " .. tostring(photo), true) end
    if not photo then return fail("unknown_photo", "no photo in the catalog has uuid " .. uuid) end
    local d = Photos.describe(catalog, photo)
    local wrong = Photos.mismatch(d, uuid, expect)
    if wrong then return fail("identity_mismatch", "the photo with uuid " .. uuid .. " has " .. wrong) end
    return photo, d
end

return Photos
