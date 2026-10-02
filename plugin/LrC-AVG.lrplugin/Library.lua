-- Catalog commands kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2, decision 3 [stated: Jim,
-- 2026-10-01, "Go with A"]; plugin 0.8.0): search_photos, list_collections, set_rating and
-- set_keywords. lr_get_selected_photos uses Catalog.lua's get_selection. Each handler runs in its own
-- task (Dispatch.lua) and returns a result table, or nil plus an error table
-- { code, message, recoverable } (PRD NFR-7).
--
-- search_photos { criteria, collection_id, offset, limit }: the engine builds the search descriptor's
--   entries (engine\src\library\search.ts); this side runs them, intersected, through findPhotos.
--   With no criteria and no collection, every photo (getAllPhotos), as Automaat does [upstream claim:
--   vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSearch.lua:110-114]. `count` is how many
--   matched; `photos` describes those from offset + 1, at most `limit`.
-- list_collections {}: every collection, top level and inside collection sets, with the set path.
-- set_rating { photo_uuid, rating } and set_keywords { photo_uuid, add, remove }: one photo per
--   command, written in a named write gate and read back; the engine loops over the photos
--   (engine\src\library\write.ts). A photo that already holds what was asked is not written.
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
    if before ~= rating then
        catalog:withWriteAccessDo("AVG set rating", function()
            -- nil clears it: the SDK's rating is "either nil or number of stars" [handle: LrPhoto page,
            -- setRawMetadata], and Automaat writes nil for 0 [upstream claim: HandlerOrganization.lua:116-118].
            photo:setRawMetadata("rating", rating > 0 and rating or nil)
        end)
    end
    local after, afterErr = ratingOf(catalog, photo)
    if not after then return fail("read_failed", "rating after the write: " .. afterErr, true) end
    return { uuid = d.uuid, filename = d.filename, before = before, after = after }
end

-- A photo's keywords: { names, objects } in the same order, or nil plus the error. getRawMetadata
-- ("keywords") is "the list of keyword objects for the photo" [handle: LrPhoto page].
local function keywordsOf(catalog, photo)
    local names, objects, err = {}, {}, nil
    catalog:withReadAccessDo(function()
        local ok, list = LrTasks.pcall(photo.getRawMetadata, photo, "keywords")
        if not ok then err = tostring(list) return end
        for _, keyword in ipairs(list or {}) do
            local okName, name = LrTasks.pcall(keyword.getName, keyword)
            if not okName then err = tostring(name) return end
            names[#names + 1] = name
            objects[#objects + 1] = keyword
        end
    end)
    if err then return nil, err end
    return { names = names, objects = objects }
end

local function nameList(v)
    if v == nil then return {} end
    if type(v) ~= "table" then return nil end
    for _, name in ipairs(v) do
        if type(name) ~= "string" or name == "" then return nil end
    end
    return v
end

-- Keywords are matched by name. An added name is a top-level keyword: createKeyword with
-- returnExisting true returns "an LrKeyword instance ... when a keyword with the specified name and
-- parent already exists" [handle: https://lrc.mcor.dev/modules/LrCatalog.html createKeyword], else
-- creates it. Removing takes a keyword off the photo only; the catalog keeps it.
function Library.setKeywords(payload)
    local add, remove = nameList(payload.add), nameList(payload.remove)
    if not add or not remove or #add + #remove == 0 then
        return fail("bad_request", "add and remove must be lists of keyword names, with at least one name between them")
    end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = keywordsOf(catalog, photo)
    if not before then return fail("read_failed", "keywords: " .. err, true) end
    local has, removing = {}, {}
    for _, name in ipairs(before.names) do has[name] = true end
    for _, name in ipairs(remove) do removing[name] = true end
    local toAdd, toRemove = {}, {}
    for _, name in ipairs(add) do
        if not has[name] then toAdd[#toAdd + 1] = name end
    end
    for i, name in ipairs(before.names) do
        if removing[name] then toRemove[#toRemove + 1] = before.objects[i] end
    end
    if #toAdd + #toRemove > 0 then
        catalog:withWriteAccessDo("AVG set keywords", function()
            for _, name in ipairs(toAdd) do
                -- createKeyword(name, synonyms, includeOnExport, parent, returnExisting) [handle: LrCatalog page].
                local keyword = catalog:createKeyword(name, {}, true, nil, true)
                if keyword then photo:addKeyword(keyword) end -- a nil shows in the read-back
            end
            for _, keyword in ipairs(toRemove) do photo:removeKeyword(keyword) end
        end)
    end
    local after, afterErr = keywordsOf(catalog, photo)
    if not after then return fail("read_failed", "keywords after the write: " .. afterErr, true) end
    return { uuid = d.uuid, filename = d.filename, before = before.names, after = after.names }
end

return Library
