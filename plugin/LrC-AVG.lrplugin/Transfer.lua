-- Automaat's file and collection commands, added back (GitHub issue #55 [stated: Jim, 2026-10-02, "Need
-- to add back original Automaat functionality that was dropped": export_photos, create_collection,
-- add_to_collection, import_photos]; plugin 0.17.0). Each handler runs in its own task (Dispatch.lua)
-- and returns a result table, or nil plus an error table { code, message, recoverable } (PRD NFR-7).
--
-- create_collection { name, set_path }: the collection `name` inside the collection sets `set_path`
--   (a list of names, top level first; empty for the top level), each made when missing. An existing
--   one, matched case aside as KeywordTree.fold does, is returned with created = false, not made again.
-- collection_photos { collection_id, uuids, remove }: puts the photos into the collection, or takes
--   them out with remove = true; `before_in` and `after_in` list which of them were in it before and
--   after, as lr_set_rating reads before and after (Library.lua).
-- export_photo { photo_uuid, format, quality, long_edge | width + height, bit_depth }: one photo,
--   exported by LrExportSession into a new folder of its own under <temp>\LrC-AVG\exports, as
--   Preview.lua exports a preview; the engine moves the files into the user's folder
--   (engine\src\library\files.ts), so a name already there is handled by engine code, not by
--   Lightroom's collision setting.
-- import_photo { path }: one file added in place with addPhoto, unless the catalog already holds a
--   photo at that path (status "already").
--
-- SDK facts: createCollection(name, parent, canReturnPrior), createCollectionSet(name, parent,
-- canReturnPrior) and addPhoto(path, ...) need write access; findPhotoByPath(path, caseSensitivity)
-- and getCollectionByLocalIdentifier need a task [handle: https://lrc.mcor.dev/modules/LrCatalog.html,
-- read 2026-10-04]. LrCollection addPhotos and removePhotos need write access and do nothing to a
-- smart collection [handle: https://lrc.mcor.dev/modules/LrCollection.html, read 2026-10-04]. The SDK
-- pages list no call that removes a photo from the catalog [handle: the LrCatalog page above], so an
-- import cannot be undone from code. Export settings: format "JPEG", "PNG", "TIFF" and size_resizeType
-- "wh" are the values Lightroom wrote into its own presets, jpeg_quality on a 0-1 scale, and
-- export_bitDepth a key it writes (16) [handle: %APPDATA%\Adobe\Lightroom\Export Presets\ "User
-- Presets\PNG Preset.lrtemplate", "Lightroom Presets\For Email (Hard Drive).lrtemplate", "Lightroom
-- Presets\Burn Full-Sized JPEGs.lrtemplate", read 2026-10-04]; "ORIGINAL" is [upstream claim:
-- vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerExport.lua:23-28]. The rest is Preview.lua's.
-- Collection and set getters run in read gates, as Library.listCollections reads them.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Gate = require 'Gate'
local KeywordTree = require 'KeywordTree'
local Photos = require 'Photos'

local Transfer = {}

-- The most photos one collection_photos command takes (engine\src\library\files.ts MAX_COLLECTION_PHOTOS).
Transfer.MAX_UUIDS = 500
Transfer.MAX_EDGE = 65000

local FORMATS = { jpeg = "JPEG", png = "PNG", tiff = "TIFF", original = "ORIGINAL" }

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function whole(v, min, max)
    return type(v) == "number" and v == math.floor(v) and v >= min and v <= max
end

local function nonEmpty(s)
    return type(s) == "string" and s:match("%S") ~= nil
end

function Transfer.exportDirectory()
    return LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "exports")
end

-- --- Collections.

-- The child of `owner` (the catalog or a collection set) named `name`, case aside; sets or collections.
-- Called inside a read gate.
local function childNamed(owner, name, sets)
    local list = sets and owner:getChildCollectionSets() or owner:getChildCollections()
    local want = KeywordTree.fold(name)
    for _, child in ipairs(list or {}) do
        if KeywordTree.fold(child:getName()) == want then return child end
    end
    return nil
end

-- The collection's id, name, set path ("Set / Subset", nil at the top level), smart flag and photo count.
local function describeCollection(catalog, collection)
    local d = { local_id = collection.localIdentifier }
    catalog:withReadAccessDo(function()
        d.name = collection:getName()
        d.smart = collection:type() == "LrSmartCollection"
        d.photo_count = #(collection:getPhotos() or {})
        local names, parent = {}, collection:getParent()
        while parent do
            table.insert(names, 1, parent:getName())
            parent = parent:getParent()
        end
        if #names > 0 then d.set_path = table.concat(names, " / ") end
    end)
    return d
end

function Transfer.createCollection(payload)
    local name, setPath = payload.name, payload.set_path or {}
    if not nonEmpty(name) then return fail("bad_request", "name must be a non-empty string") end
    if type(setPath) ~= "table" then return fail("bad_request", "set_path must be a list of names") end
    for _, level in ipairs(setPath) do
        if not nonEmpty(level) then return fail("bad_request", "every set_path level must be a non-empty string") end
    end
    local catalog = LrApplication.activeCatalog()
    local existing
    catalog:withReadAccessDo(function()
        local owner = catalog
        for _, level in ipairs(setPath) do
            owner = childNamed(owner, level, true)
            if not owner then return end
        end
        existing = childNamed(owner, name, false)
    end)
    if existing then
        local d = describeCollection(catalog, existing)
        if d.smart then return fail("smart_collection", "a smart collection named " .. d.name .. " is already there") end
        d.created = false
        return d
    end
    local made
    local status, err = Gate.write(catalog, "AVG create collection", function()
        local parent = nil
        for _, level in ipairs(setPath) do parent = catalog:createCollectionSet(level, parent, true) end
        made = catalog:createCollection(name, parent, true)
    end)
    if not status then return nil, err end
    if not made then return fail("create_failed", "Lightroom made no collection named " .. name, true) end
    local d = describeCollection(catalog, made)
    d.created = true
    return d
end

-- The uuids, among `found`, of the photos in the collection; or nil plus the error text.
local function membersOf(catalog, collection, found)
    local ok, inIds = LrTasks.pcall(function()
        local ids = {}
        catalog:withReadAccessDo(function()
            for _, photo in ipairs(collection:getPhotos() or {}) do ids[photo.localIdentifier] = true end
        end)
        return ids
    end)
    if not ok then return nil, tostring(inIds) end
    local uuids = {}
    for _, f in ipairs(found) do
        if inIds[f.photo.localIdentifier] then uuids[#uuids + 1] = f.uuid end
    end
    return uuids
end

-- Once `before_in` is read the command answers ok, as Library.lua's writes do: a write gate that
-- raises comes back as `write_error`, a failed read-back as `after_error`.
function Transfer.collectionPhotos(payload)
    local id, uuids, remove = payload.collection_id, payload.uuids, payload.remove == true
    if not whole(id, 0, math.huge) then return fail("bad_request", "collection_id must be a whole number") end
    if type(uuids) ~= "table" or #uuids == 0 or #uuids > Transfer.MAX_UUIDS then
        return fail("bad_request", "uuids must list 1 to " .. Transfer.MAX_UUIDS .. " photos")
    end
    local catalog = LrApplication.activeCatalog()
    local collection = catalog:getCollectionByLocalIdentifier(id)
    if not collection then return fail("unknown_collection", "no collection has id " .. tostring(id)) end
    local kind
    catalog:withReadAccessDo(function() kind = collection:type() end)
    if kind == "LrSmartCollection" then return fail("smart_collection", "collection " .. tostring(id) .. " is a smart collection: Lightroom fills it by its rules") end
    if kind ~= "LrCollection" then return fail("unknown_collection", "id " .. tostring(id) .. " is a " .. tostring(kind) .. ", not a collection") end
    local found, notFound = {}, {}
    for i, uuid in ipairs(uuids) do
        if i > 1 then LrTasks.yield() end -- PRD NFR-1: yield between photos
        local ok, photo = LrTasks.pcall(function() return type(uuid) == "string" and catalog:findPhotoByUuid(uuid) or nil end)
        if ok and photo then found[#found + 1] = { uuid = uuid, photo = photo } else notFound[#notFound + 1] = tostring(uuid) end
    end
    local beforeIn, err = membersOf(catalog, collection, found)
    if not beforeIn then return fail("read_failed", "collection photos: " .. err, true) end
    local isIn = {}
    for _, uuid in ipairs(beforeIn) do isIn[uuid] = true end
    local change = {}
    for _, f in ipairs(found) do
        if (isIn[f.uuid] == true) == remove then change[#change + 1] = f.photo end
    end
    local writeErr
    if #change > 0 then
        local ok, raised = LrTasks.pcall(Gate.run, catalog, remove and "AVG remove from collection" or "AVG add to collection", function()
            if remove then collection:removePhotos(change) else collection:addPhotos(change) end
        end)
        if not ok then writeErr = tostring(raised) end
    end
    local afterIn, afterErr = membersOf(catalog, collection, found)
    local d = describeCollection(catalog, collection)
    return { collection_id = id, name = d.name, before_in = beforeIn, after_in = afterIn, not_found = notFound,
        write_error = writeErr, after_error = afterErr }
end

-- --- Export.

local function exportSettings(payload, dir, format)
    local s = {
        LR_export_destinationType = "specificFolder",
        LR_export_destinationPathPrefix = dir,
        LR_export_useSubfolder = false,
        LR_format = format,
        LR_export_colorSpace = "sRGB",
        LR_size_units = "pixels",
        LR_outputSharpeningOn = false,
        LR_collisionHandling = "overwrite", -- the folder is new and empty: nothing to collide with
        LR_reimportExportedPhoto = false,
        LR_size_doConstrain = false,
    }
    if format == "JPEG" then s.LR_jpeg_quality = (payload.quality or 90) / 100 end
    if format == "PNG" or format == "TIFF" then s.LR_export_bitDepth = payload.bit_depth or 8 end
    if payload.long_edge then
        s.LR_size_doConstrain, s.LR_size_resizeType = true, "longEdge"
        s.LR_size_maxWidth, s.LR_size_maxHeight = payload.long_edge, payload.long_edge
    elseif payload.width then
        s.LR_size_doConstrain, s.LR_size_resizeType = true, "wh"
        s.LR_size_maxWidth, s.LR_size_maxHeight = payload.width, payload.height
    end
    return s
end

local function badExport(payload)
    if not FORMATS[payload.format] then return "format must be jpeg, png, tiff or original" end
    if payload.quality ~= nil and not whole(payload.quality, 1, 100) then return "quality must be a whole number from 1 to 100" end
    if payload.bit_depth ~= nil and payload.bit_depth ~= 8 and payload.bit_depth ~= 16 then return "bit_depth must be 8 or 16" end
    if payload.long_edge ~= nil and not whole(payload.long_edge, 1, Transfer.MAX_EDGE) then return "long_edge must be a whole number of pixels" end
    if (payload.width == nil) ~= (payload.height == nil) then return "width and height go together" end
    if payload.width ~= nil and not (whole(payload.width, 1, Transfer.MAX_EDGE) and whole(payload.height, 1, Transfer.MAX_EDGE)) then
        return "width and height must be whole numbers of pixels"
    end
    if payload.width ~= nil and payload.long_edge ~= nil then return "give long_edge or width and height, not both" end
    return nil
end

function Transfer.exportPhoto(payload)
    local why = badExport(payload)
    if why then return fail("bad_request", why) end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local missing = Photos.missing(catalog, photo)
    if missing then return nil, missing end
    local dir = LrPathUtils.child(Transfer.exportDirectory(), LrUUID.generateUUID())
    LrFileUtils.createAllDirectories(dir)
    local t0 = LrDate.currentTime()
    -- No write gate: an export does not write to the catalog (Preview.lua).
    local session = LrExportSession { photosToExport = { photo }, exportSettings = exportSettings(payload, dir, FORMATS[payload.format]) }
    session:doExportOnCurrentTask()
    local files = {}
    for file in LrFileUtils.files(dir) do files[#files + 1] = file end
    if #files == 0 then return fail("export_failed", "Lightroom's export wrote no file for " .. tostring(d.filename), true) end
    return { uuid = d.uuid, filename = d.filename, dir = dir, files = files, export_ms = (LrDate.currentTime() - t0) * 1000 }
end

-- --- Import.

function Transfer.importPhoto(payload)
    local path = payload.path
    if not nonEmpty(path) then return fail("bad_request", "path must be a non-empty string") end
    if LrFileUtils.exists(path) ~= "file" then return fail("not_found", "no file at " .. path) end
    local catalog = LrApplication.activeCatalog()
    local okFind, existing = LrTasks.pcall(function() return catalog:findPhotoByPath(path) end)
    if not okFind then return fail("lookup_failed", "findPhotoByPath: " .. tostring(existing), true) end
    if existing then
        local d = Photos.describe(catalog, existing)
        return { status = "already", uuid = d.uuid, filename = d.filename }
    end
    local photo
    local okAdd, status, err = LrTasks.pcall(Gate.write, catalog, "AVG import photo", function() photo = catalog:addPhoto(path) end)
    if not okAdd then return fail("import_failed", "Lightroom did not import " .. path .. ": " .. tostring(status)) end
    if not status then return nil, err end
    if not photo then return fail("import_failed", "Lightroom added no photo for " .. path, true) end
    local d = Photos.describe(catalog, photo)
    return { status = "imported", uuid = d.uuid, filename = d.filename }
end

return Transfer
