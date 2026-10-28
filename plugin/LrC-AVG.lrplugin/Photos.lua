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
-- passed [handle: docs\reports\phase4\S7.md "Numbers", item 4]. Single metadata reads run inside a read
-- gate with LrTasks.pcall, as in Develop.lua getContext; descriptions are read in batches (describePage).

local LrFileUtils = import 'LrFileUtils'
local LrTasks = import 'LrTasks'

local Log = require 'Log'

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
-- opts.where (plugin 0.21.0, issue #139; only the listings, Library.lua search_photos and Catalog.lua
-- get_selection, pass it): gps and path as well.
--
-- Issue #212 item 2: a page of photos is read with one catalog:batchGetRawMetadata and one
-- batchGetFormattedMetadata call per BATCH photos, which take "array of LrPhoto" and the getRawMetadata /
-- getFormattedMetadata keys and return { [photo] = { key = value } } [handle: D:\Developer\LightRoom Classic
-- Dev Kit\API Reference\modules\LrCatalog.html, batchGetRawMetadata, batchGetFormattedMetadata]. Before, each
-- photo took 7-9 getters, each in its own LrTasks.pcall, in a read gate of its own; upstream measured each
-- getter at about 0.1-1 ms and each pcall at about 1 ms [upstream claim: Automaat/lightroom-mcp 37a8ad5, CLAUDE.md].
-- The batch reads run outside any gate, as CollectionEdit.lua and KeywordEdit.lua run batchGetRawMetadata,
-- which Jim's catalog:check exercised [handle: docs\reports\phase11\CATALOG-PARITY.md run 2, step 8], and as
-- upstream does ("Batch reads are not catalog queries and need no read gate (verified live)" [upstream claim:
-- 37a8ad5 message]). Whether they yield is [unverified]; outside the gate that cannot deadlock (rule 03).
-- One LrTasks.pcall per batch; if a batch raises, its photos are read one by one as before (readOne), so
-- the answer keeps its shape. A photo whose batch row is missing or has no string uuid is read by readOne too,
-- and logged: upstream keeps only photos whose batched uuid is non-nil, since the batch reads give nil for a
-- dangling photo [upstream claim: Automaat/lightroom-mcp 37a8ad5, CLAUDE.md line 24]. Photos.describe (one
-- photo: the P-18 identity check in Photos.find and Catalog.lua copyOnce) stays on readOne: masterPhoto,
-- isVirtualCopy and copyName read through the batch calls, and a just-created virtual copy read that way, are
-- [unverified] in Lightroom; upstream reads masterPhoto one at a time
-- [upstream claim: Automaat/lightroom-mcp 1040453, plugin/LightroomMCP.lrplugin/HandlerMetadata.lua:125].

-- Photos per batch call, with LrTasks.yield() between batches (PRD NFR-1) [inference: the figure].
Photos.BATCH = 100

local RAW_KEYS = { "uuid", "isVirtualCopy", "masterPhoto", "rating" }
local WHERE_KEYS = { "gps", "path" }
local FORMATTED_KEYS = { "copyName", "fileName", "dateTimeOriginal" }

-- One description from the photo's raw and formatted values (tables keyed by SDK key).
local function described(photo, raw, formatted, where)
    local d = { local_id = photo.localIdentifier, uuid = raw.uuid, is_virtual_copy = raw.isVirtualCopy,
        copy_name = formatted.copyName, filename = formatted.fileName, rating = raw.rating,
        capture_time = formatted.dateTimeOriginal }
    local master = raw.masterPhoto
    if type(master) ~= "string" and master ~= nil then d.master_local_id = master.localIdentifier end
    if where then
        d.gps = Photos.position(raw.gps)
        d.path = raw.path
    end
    return d
end

-- The fallback: one photo, each getter on its own, in a read gate (the reads before issue #212).
local function readOne(catalog, photo, where)
    local raw, formatted = {}, {}
    catalog:withReadAccessDo(function()
        for _, key in ipairs(RAW_KEYS) do raw[key] = read(photo, photo.getRawMetadata, key) end
        if where then for _, key in ipairs(WHERE_KEYS) do raw[key] = read(photo, photo.getRawMetadata, key) end end
        for _, key in ipairs(FORMATTED_KEYS) do formatted[key] = read(photo, photo.getFormattedMetadata, key) end
    end)
    return described(photo, raw, formatted, where)
end

-- `photos` described, in order (a list of descriptions as Photos.describe gives).
function Photos.describePage(catalog, photos, opts)
    local where = opts ~= nil and opts.where == true
    local rawKeys = { unpack(RAW_KEYS) }
    if where then for _, key in ipairs(WHERE_KEYS) do rawKeys[#rawKeys + 1] = key end end
    local out = {}
    for first = 1, #photos, Photos.BATCH do
        if first > 1 then LrTasks.yield() end -- PRD NFR-1
        local slice = {}
        for i = first, math.min(first + Photos.BATCH - 1, #photos) do slice[#slice + 1] = photos[i] end
        local ok, raw, formatted = LrTasks.pcall(function()
            return catalog:batchGetRawMetadata(slice, rawKeys) or {}, catalog:batchGetFormattedMetadata(slice, FORMATTED_KEYS) or {}
        end)
        if not ok then Log.warn("photos: a batch read of " .. #slice .. " failed, reading them one by one: " .. tostring(raw)) end
        for _, photo in ipairs(slice) do
            local row = ok and raw[photo] or nil
            if ok and (row == nil or type(row.uuid) ~= "string") then
                Log.warn("photos: no batch row with a uuid for photo " .. tostring(photo.localIdentifier) .. ", reading it alone")
            end
            out[#out + 1] = row ~= nil and type(row.uuid) == "string" and described(photo, row, formatted[photo] or {}, where)
                or readOne(catalog, photo, where)
        end
    end
    return out
end

-- One photo, read getter by getter (readOne; the comment above describePage says why it is not batched).
function Photos.describe(catalog, photo, opts)
    return readOne(catalog, photo, opts ~= nil and opts.where == true)
end

-- A GPS table as { latitude, longitude }, or nil for none. getRawMetadata("gps") is "(table) The
-- location of this photo (for example, { latitude = 37.9362, longitude = 27.3451 })" [handle: LrPhoto
-- page above]; nil for a photo without one [inference].
function Photos.position(value)
    if type(value) ~= "table" or type(value.latitude) ~= "number" or type(value.longitude) ~= "number" then return nil end
    return { latitude = value.latitude, longitude = value.longitude }
end

-- A colour label's name as the tools use it, "none" for no label. The SDK lists only 'red' ... 'purple' and 'none'
-- [handle: LrPhoto.html, getRawMetadata colorNameForLabel], but LrC 15.6 read "gray" for unlabelled photos in two
-- catalogs, which lr_set_color_label could not write back [handle: docs\reports\phase11\CATALOG-PARITY.md run 1].
function Photos.labelName(raw)
    if raw == nil or string.lower(tostring(raw)) == "gray" then return "none" end
    return raw
end

-- A photo's GPS position { latitude, longitude }, false for none, or nil plus the error (set_gps,
-- Library.lua; it lived there until plugin 0.21.0).
function Photos.gpsOf(catalog, photo)
    local ok, value
    catalog:withReadAccessDo(function() ok, value = LrTasks.pcall(photo.getRawMetadata, photo, "gps") end)
    if not ok then return nil, tostring(value) end
    return Photos.position(value) or false
end

-- Whether the photo's original file is there: true, false, or nil when neither signal could be read.
-- Two signals, and a photo is missing when either says so (plugin 0.19.1, fix/offline-file-exists):
--   * checkPhotoAvailability "Reports whether this photo is believed to be present on disk at this
--     time" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read 2026-10-09]. It is Lightroom's
--     belief, and it was stale once: it said true for a TIFF that was not on disk, then false 46 s later
--     [handle: docs\reports\phase8\offline\offline_check_2026-10-10T03-53-44-109Z.json vs
--     ..._03-54-30-473Z.json `contexts.missing.available`; `Test-Path` on its path printed False].
--   * LrFileUtils.exists on getRawMetadata("path"), "The current path to the photo file if available;
--     otherwise, the last known path": 'file', 'directory' or false [handle: the LrPhoto page above;
--     https://lrc.mcor.dev/modules/LrFileUtils.html exists, read 2026-10-09].
-- Returns available, error, signals { sdk_available, file_exists } for get_context. Both run outside
-- the read gate, the path read inside it (rule 03); whether checkPhotoAvailability yields is [unverified].
function Photos.available(catalog, photo)
    local signals, errors = {}, {}
    local ok, value = LrTasks.pcall(photo.checkPhotoAvailability, photo)
    if ok and type(value) == "boolean" then signals.sdk_available = value
    else errors[#errors + 1] = "checkPhotoAvailability: " .. tostring(value) end
    local path
    catalog:withReadAccessDo(function() path = read(photo, photo.getRawMetadata, "path") end)
    if type(path) == "string" and path ~= "" then
        local okExists, exists = LrTasks.pcall(LrFileUtils.exists, path)
        if okExists then signals.file_exists = exists == "file"
        else errors[#errors + 1] = "LrFileUtils.exists: " .. tostring(exists) end
    else
        errors[#errors + 1] = "no path"
    end
    local available = nil
    if signals.sdk_available == false or signals.file_exists == false then available = false
    elseif signals.sdk_available == true or signals.file_exists == true then available = true end
    return available, (#errors > 0 and table.concat(errors, "; ") or nil), signals
end

-- The refusal for a photo whose original file is missing, or nil when it is there (or the check
-- failed). An offline original took every write unchecked and exported nothing in S10 [handle:
-- docs\reports\phase8\S10.md "Consequences" item 8], so apply_settings and the exports refuse it.
-- The menu item: "There is a menu item under Library that says 'Find all missing photos'" [stated: Jim,
-- 2026-10-09]; its capitals as written here are [inference: Lightroom's menus use title case].
function Photos.missing(catalog, photo)
    if Photos.available(catalog, photo) ~= false then return nil end
    local name, path
    catalog:withReadAccessDo(function()
        name = read(photo, photo.getFormattedMetadata, "fileName")
        path = read(photo, photo.getRawMetadata, "path")
    end)
    return { code = "original_missing", recoverable = true,
        message = "The original file of " .. tostring(name) .. " is missing (last known at " .. tostring(path) ..
            "), so Lightroom cannot edit or export it. Reconnect the file in Lightroom (Library > Find All Missing Photos), then try again." }
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
