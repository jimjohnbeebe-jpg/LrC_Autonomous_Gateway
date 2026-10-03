-- Catalog commands kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2, decision 3 [stated: Jim,
-- 2026-10-01, "Go with A"]; plugin 0.8.0): search_photos, list_collections, set_rating and
-- set_keywords; plugin 0.10.0 (GitHub issue #60 [stated: Jim, 2026-10-03, "Keyword hierarchy,
-- set_gps"]) adds keyword paths (KeywordTree.lua), list_keywords and set_gps. lr_get_selected_photos
-- uses Catalog.lua's get_selection. Each handler runs in its own task (Dispatch.lua) and returns a
-- result table, or nil plus an error table { code, message, recoverable } (PRD NFR-7).
--
-- search_photos { criteria, collection_id, offset, limit }: the engine builds the search descriptor's
--   entries (engine\src\library\search.ts); this side runs them, intersected, through findPhotos.
--   With no criteria and no collection, every photo (getAllPhotos), as Automaat does [upstream claim:
--   vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSearch.lua:110-114]. `count` is how many
--   matched; `photos` describes those from offset + 1, at most `limit`.
-- list_collections {}: every collection, top level and inside collection sets, with the set path.
-- list_keywords { query, offset, limit }: the keyword tree's paths, paged as search_photos.
-- set_rating { photo_uuid, rating }, set_keywords { photo_uuid, add, remove } and set_gps
--   { photo_uuid, latitude, longitude } or { photo_uuid, clear }: one photo per command, written in a
--   named write gate and read back; the engine loops over the photos (engine\src\library\write.ts).
--   A photo that already holds what was asked is not written.
--
-- Catalog rules (.claude\rules\03-lightroom.md): findPhotos, getAllPhotos and
-- getCollectionByLocalIdentifier "must be called from within" a task [handle: https://lrc.mcor.dev/modules/LrCatalog.html
-- findPhotos, getAllPhotos, getCollectionByLocalIdentifier] and run outside any read gate, as
-- Automaat runs findPhotos [upstream claim: HandlerSearch.lua:102-114]. The photos of a page are
-- described one by one (Photos.describe, one read gate each) with LrTasks.yield() between them (PRD
-- NFR-1). Collections are read inside one read gate, as Automaat does [upstream claim:
-- vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerCollections.lua:18-44].

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local KeywordTree = require 'KeywordTree'
local Photos = require 'Photos'

local Library = {}

-- The largest page the engine asks for (engine\src\library\search.ts MAX_PAGE).
Library.MAX_PAGE = 500

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function wholeNumber(v, min, max)
    return type(v) == "number" and v == math.floor(v) and v >= min and (max == nil or v <= max)
end

-- The photos of the collection with this local id, or nil plus an error. getCollectionByLocalIdentifier
-- also finds collection sets [inference: a local identifier is "unique within this catalog",
-- https://lrc.mcor.dev/modules/LrCollection.html localIdentifier], so the type is checked.
local function collectionPhotos(catalog, id)
    local collection = catalog:getCollectionByLocalIdentifier(id)
    if not collection then return fail("unknown_collection", "no collection has id " .. tostring(id)) end
    local kind, photos
    catalog:withReadAccessDo(function()
        kind = collection:type()
        if kind == "LrCollection" or kind == "LrSmartCollection" then photos = collection:getPhotos() end
    end)
    if not photos then return fail("unknown_collection", "id " .. tostring(id) .. " is a " .. tostring(kind) .. ", not a collection") end
    return photos
end

local function intersect(photos, within)
    local keep = {}
    for _, photo in ipairs(within) do keep[photo.localIdentifier] = true end
    local out = {}
    for _, photo in ipairs(photos) do
        if keep[photo.localIdentifier] then out[#out + 1] = photo end
    end
    return out
end

local function validCriteria(criteria)
    if type(criteria) ~= "table" then return false end
    for _, c in ipairs(criteria) do
        if type(c) ~= "table" or type(c.criteria) ~= "string" or type(c.operation) ~= "string" then return false end
    end
    return true
end

function Library.searchPhotos(payload)
    local criteria = payload.criteria or {}
    local offset, limit, collectionId = payload.offset or 0, payload.limit or 100, payload.collection_id
    if not validCriteria(criteria) then return fail("bad_request", "criteria must be a list of { criteria, operation, value }") end
    if not wholeNumber(offset, 0) or not wholeNumber(limit, 1, Library.MAX_PAGE) then
        return fail("bad_request", "offset must be a whole number from 0, limit from 1 to " .. Library.MAX_PAGE)
    end
    if collectionId ~= nil and not wholeNumber(collectionId, 0) then return fail("bad_request", "collection_id must be a whole number") end
    local catalog = LrApplication.activeCatalog()
    local matches
    if #criteria > 0 then
        local desc = { combine = "intersect" }
        for i, c in ipairs(criteria) do desc[i] = c end
        matches = catalog:findPhotos { searchDesc = desc } or {}
    end
    if collectionId ~= nil then
        local inCollection, err = collectionPhotos(catalog, collectionId)
        if not inCollection then return nil, err end
        matches = matches and intersect(matches, inCollection) or inCollection
    end
    if not matches then matches = catalog:getAllPhotos() or {} end
    local photos = {}
    for i = offset + 1, math.min(offset + limit, #matches) do
        if i > offset + 1 then LrTasks.yield() end -- PRD NFR-1: yield between photos
        photos[#photos + 1] = Photos.describe(catalog, matches[i])
    end
    return { count = #matches, photos = photos }
end

function Library.listCollections()
    local catalog = LrApplication.activeCatalog()
    local list = {}
    local function add(collection, setPath)
        list[#list + 1] = { local_id = collection.localIdentifier, name = collection:getName(), set_path = setPath,
            smart = collection:isSmartCollection() == true, photo_count = #(collection:getPhotos() or {}) }
    end
    local function walk(set, setPath)
        for _, collection in ipairs(set:getChildCollections() or {}) do add(collection, setPath) end
        for _, child in ipairs(set:getChildCollectionSets() or {}) do walk(child, setPath .. " / " .. child:getName()) end
    end
    catalog:withReadAccessDo(function()
        for _, collection in ipairs(catalog:getChildCollections() or {}) do add(collection, nil) end
        for _, set in ipairs(catalog:getChildCollectionSets() or {}) do walk(set, set:getName()) end
    end)
    return { collections = list }
end

-- The whole tree is walked (outside any gate, KeywordTree.lua says why) and then filtered: `query`
-- keeps the paths that contain it, case aside.
function Library.listKeywords(payload)
    local offset, limit, query = payload.offset or 0, payload.limit or 100, payload.query
    if not wholeNumber(offset, 0) or not wholeNumber(limit, 1, Library.MAX_PAGE) then
        return fail("bad_request", "offset must be a whole number from 0, limit from 1 to " .. Library.MAX_PAGE)
    end
    if query ~= nil and (type(query) ~= "string" or query == "") then return fail("bad_request", "query must be a non-empty string") end
    local ok, all = LrTasks.pcall(KeywordTree.walk, LrApplication.activeCatalog(), nil, "", {})
    if not ok then return fail("read_failed", "keywords: " .. tostring(all), true) end
    local folded = query and KeywordTree.fold(query)
    local count, page = 0, {}
    for _, path in ipairs(all) do
        if not folded or KeywordTree.fold(path):find(folded, 1, true) then
            count = count + 1
            if count > offset and #page < limit then page[#page + 1] = path end
        end
    end
    return { count = count, keywords = page }
end

-- Once a photo's earlier value is read, the command answers ok, so the engine always gets that value
-- back to put the photo back (Greptile, PR #57): a write gate that raises comes back as
-- `write_error`, a read-back that fails as `after_error` with no `after`. Returns the write's error
-- text, or nil.
local function written(fn)
    local ok, err = LrTasks.pcall(fn)
    if not ok then return tostring(err) end
    return nil
end

-- A photo's rating, 0 for none: getRawMetadata("rating") is "either nil or number of stars" [handle:
-- https://lrc.mcor.dev/modules/LrPhoto.html getRawMetadata], and returned nil for an unrated photo
-- [handle: LR_SDK_NOTES "Recorded in Phase 2", metadata keys]. Returns rating, or nil plus the error.
local function ratingOf(catalog, photo)
    local ok, value
    catalog:withReadAccessDo(function() ok, value = LrTasks.pcall(photo.getRawMetadata, photo, "rating") end)
    if not ok then return nil, tostring(value) end
    return value or 0
end

function Library.setRating(payload)
    local rating = payload.rating
    if not wholeNumber(rating, 0, 5) then return fail("bad_request", "rating must be a whole number from 0 to 5") end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = ratingOf(catalog, photo)
    if not before then return fail("read_failed", "rating: " .. err, true) end
    local writeErr
    if before ~= rating then
        writeErr = written(function()
            catalog:withWriteAccessDo("AVG set rating", function()
                -- nil clears it: the SDK's rating is "either nil or number of stars" [handle: LrPhoto page,
                -- setRawMetadata], and Automaat writes nil for 0 [upstream claim: HandlerOrganization.lua:116-118].
                photo:setRawMetadata("rating", rating > 0 and rating or nil)
            end)
        end)
    end
    local after, afterErr = ratingOf(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, before = before, after = after, write_error = writeErr, after_error = afterErr }
end

-- A photo's keywords: { paths, objects } in the same order, or nil plus the error. getRawMetadata
-- ("keywords") is "the list of keyword objects for the photo" [handle: LrPhoto page], read in the read
-- gate as every metadata read here; the paths (getName, getParent) are read outside it, by
-- KeywordTree.lua's rule for keyword getters.
local function keywordsOf(catalog, photo)
    local ok, list
    catalog:withReadAccessDo(function() ok, list = LrTasks.pcall(photo.getRawMetadata, photo, "keywords") end)
    if not ok then return nil, tostring(list) end
    local paths, objects = {}, {}
    for _, keyword in ipairs(list or {}) do
        local okPath, path = LrTasks.pcall(KeywordTree.pathOf, keyword)
        if not okPath then return nil, tostring(path) end
        paths[#paths + 1] = path
        objects[#objects + 1] = keyword
    end
    return { paths = paths, objects = objects }
end

-- Each added path's missing parents first, and its last level found case aside (KeywordTree.resolve),
-- then one gate adds and removes. A last level not found is made by createKeyword with returnExisting
-- true, which returns "an LrKeyword instance ... when a keyword with the specified name and parent
-- already exists" [handle: https://lrc.mcor.dev/modules/LrCatalog.html createKeyword], else creates
-- it. Removing takes a keyword off the photo only; the catalog keeps it (the SDK pages list no call
-- that deletes a keyword [handle: LrCatalog and LrKeyword pages above]).
local function writeKeywords(catalog, photo, toAdd, toRemove)
    local parents, leaves = KeywordTree.resolve(catalog, toAdd)
    catalog:withWriteAccessDo("AVG set keywords", function()
        for i, parts in ipairs(toAdd) do
            -- createKeyword(name, synonyms, includeOnExport, parent, returnExisting) [handle: LrCatalog page].
            local keyword = leaves[i] or catalog:createKeyword(parts[#parts], {}, true, parents[i], true)
            if keyword then photo:addKeyword(keyword) end -- a nil shows in the read-back
        end
        for _, keyword in ipairs(toRemove) do photo:removeKeyword(keyword) end
    end)
end

-- `before` and `after` are the photo's keywords as paths ("Parent|Child"; a top-level one is its name).
-- A one-level name means the top-level keyword, to add and to remove (KeywordTree.changes).
function Library.setKeywords(payload)
    local add, whyAdd = KeywordTree.parseList(payload.add)
    local remove, whyRemove = KeywordTree.parseList(payload.remove)
    if not add or not remove then return fail("bad_request", "add and remove: " .. tostring(whyAdd or whyRemove)) end
    if #add + #remove == 0 then return fail("bad_request", "name at least one keyword to add or remove") end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = keywordsOf(catalog, photo)
    if not before then return fail("read_failed", "keywords: " .. err, true) end
    local toAdd, removeAt = KeywordTree.changes(before.paths, add, remove)
    local toRemove = {}
    for _, i in ipairs(removeAt) do toRemove[#toRemove + 1] = before.objects[i] end
    local writeErr
    if #toAdd + #toRemove > 0 then
        writeErr = written(function() writeKeywords(catalog, photo, toAdd, toRemove) end)
    end
    local after, afterErr = keywordsOf(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, before = before.paths, after = after and after.paths,
        write_error = writeErr, after_error = afterErr }
end

-- A photo's GPS position { latitude, longitude }, false for none, or nil plus the error.
-- getRawMetadata("gps") is "(table) The location of this photo (for example, { latitude = 37.9362,
-- longitude = 27.3451 })" [handle: LrPhoto page]; nil for a photo without one [inference].
local function gpsOf(catalog, photo)
    local ok, value
    catalog:withReadAccessDo(function() ok, value = LrTasks.pcall(photo.getRawMetadata, photo, "gps") end)
    if not ok then return nil, tostring(value) end
    if type(value) ~= "table" or type(value.latitude) ~= "number" or type(value.longitude) ~= "number" then return false end
    return { latitude = value.latitude, longitude = value.longitude }
end

local function coordinate(v, limit)
    return type(v) == "number" and v == v and v >= -limit and v <= limit
end

-- setRawMetadata("gps", { latitude, longitude }) in a write gate, as Automaat writes it [upstream
-- claim: plugin/LightroomMCP.lrplugin/HandlerMetadata.lua:217-223 at commit 9ba2ed6]; nil removes
-- the position: "Pass nil to 'unset'" [handle: https://lrc.mcor.dev/modules/LrPhoto.html
-- setRawMetadata, gps]. Automaat never writes nil. Both are [unverified] in our Lightroom until Jim's
-- check. Altitude (gpsAltitude) is neither read nor written.
function Library.setGps(payload)
    local clear = payload.clear == true
    if not clear and not (coordinate(payload.latitude, 90) and coordinate(payload.longitude, 180)) then
        return fail("bad_request", "latitude must be a number from -90 to 90 and longitude from -180 to 180, or clear must be true")
    end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = gpsOf(catalog, photo)
    if before == nil then return fail("read_failed", "gps: " .. err, true) end
    local want = (not clear) and { latitude = payload.latitude, longitude = payload.longitude } or nil
    local held = (want == nil and before == false)
        or (want ~= nil and before ~= false and before.latitude == want.latitude and before.longitude == want.longitude)
    local writeErr
    if not held then
        writeErr = written(function()
            catalog:withWriteAccessDo("AVG set GPS", function() photo:setRawMetadata("gps", want) end)
        end)
    end
    local after, afterErr = gpsOf(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, before = before, after = after, write_error = writeErr, after_error = afterErr }
end

return Library
