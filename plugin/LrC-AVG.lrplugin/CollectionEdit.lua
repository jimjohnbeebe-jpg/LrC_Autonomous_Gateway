-- Smart collections and deleting a collection (plugin 1.5.0, GitHub issue #218 row 7; upstream's
-- create_smart_collection and delete_collection [upstream claim: Automaat/lightroom-mcp@1040453
-- plugin/LightroomMCP.lrplugin/HandlerCollections.lua:204-210, 467-498], MIT, see THIRD_PARTY_NOTICES.md).
-- Each handler runs in its own task (Dispatch.lua) and returns a result table, or nil plus an error table.
--
-- create_smart_collection { name, set_path, criteria }: a smart collection whose rules are the search
--   descriptor's entries the engine built (engine\src\library\search.ts), intersected, inside the collection
--   sets `set_path` (each made when missing). A collection of that name already there is refused
--   (already_exists): nothing is replaced.
-- delete_collection { collection_id }: deletes the collection; its photos stay in the catalog. `before` is
--   what the engine needs to make it again: name, set path, smart, photo count, and the member uuids of a
--   regular collection or the search description of a smart one.
--
-- SDK: createSmartCollection(name, searchDesc, parent, canReturnPrior) needs write access, and the new
-- collection "is not available for access until that function returns" [handle: D:\Developer\LightRoom
-- Classic Dev Kit\API Reference\modules\LrCatalog.html, createSmartCollection]; collection:delete() "Must be
-- called from within one of the catalog:with___WriteAccessDo gates" and getSearchDescription "must be called
-- from within an asynchronous task" and throws for a collection that is not smart [handle: modules\
-- LrCollection.html, delete, getSearchDescription]. batchGetRawMetadata(photos, keys) "Retrieves unformatted
-- metadata for multiple photos" [handle: LrCatalog.html, batchGetRawMetadata]; it runs outside any gate, as
-- upstream runs it [upstream claim: HandlerExport.lua:283-284 at 1040453].

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'
local Transfer = require 'Transfer'

local CollectionEdit = {}

-- The most member uuids a deleted collection's `before` lists [inference: the figure].
CollectionEdit.MAX_MEMBERS = 5000

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function validCriteria(criteria)
    if type(criteria) ~= "table" or #criteria == 0 then return false end
    for _, c in ipairs(criteria) do
        if type(c) ~= "table" or type(c.criteria) ~= "string" or type(c.operation) ~= "string" then return false end
    end
    return true
end

function CollectionEdit.createSmart(payload)
    local name, setPath, criteria = payload.name, payload.set_path or {}, payload.criteria
    local bad = Transfer.badName(name, setPath)
    if bad then return nil, bad end
    if not validCriteria(criteria) then return fail("bad_request", "criteria must be a non-empty list of { criteria, operation, value }") end
    local catalog = LrApplication.activeCatalog()
    local existing = Transfer.existing(catalog, setPath, name)
    if existing then
        local d = Transfer.describeCollection(catalog, existing)
        return fail("already_exists", "a collection named " .. tostring(d.name) .. " is already there (id " .. tostring(d.local_id) .. "): give another name")
    end
    local desc = { combine = "intersect" }
    for i, c in ipairs(criteria) do desc[i] = c end
    local made
    local status, err = Gate.write(catalog, "AVG create smart collection", function()
        local parent = nil
        for _, level in ipairs(setPath) do parent = catalog:createCollectionSet(level, parent, true) end
        made = catalog:createSmartCollection(name, desc, parent, false)
    end)
    if not status then return nil, err end
    if not made then return fail("create_failed", "Lightroom made no smart collection named " .. name, true) end
    local d = Transfer.describeCollection(catalog, made)
    d.created = true
    return d
end

-- A search description as plain data for the answer (keys as strings; a value Json.lua cannot write as its text).
local function plain(v, depth)
    local t = type(v)
    if t == "string" or t == "number" or t == "boolean" then return v end
    if t ~= "table" or depth > 8 then return tostring(v) end
    local out = {}
    for k, x in pairs(v) do out[tostring(k)] = plain(x, depth + 1) end
    return out
end

-- The uuids of `photos`, at most MAX_MEMBERS; `truncated` when there were more.
local function uuidsOf(catalog, photos)
    local slice = {}
    for i = 1, math.min(#photos, CollectionEdit.MAX_MEMBERS) do slice[i] = photos[i] end
    local raw = catalog:batchGetRawMetadata(slice, { "uuid" }) or {}
    local out = {}
    for _, photo in ipairs(slice) do
        local r = raw[photo]
        if r and type(r.uuid) == "string" then out[#out + 1] = r.uuid end
    end
    return out, #photos > #slice
end

function CollectionEdit.delete(payload)
    local id = payload.collection_id
    if type(id) ~= "number" or id ~= math.floor(id) or id < 0 then return fail("bad_request", "collection_id must be a whole number") end
    local catalog = LrApplication.activeCatalog()
    local collection = catalog:getCollectionByLocalIdentifier(id)
    if not collection then return fail("unknown_collection", "no collection has id " .. tostring(id)) end
    local kind
    catalog:withReadAccessDo(function() kind = collection:type() end)
    if kind ~= "LrCollection" and kind ~= "LrSmartCollection" then
        return fail("unknown_collection", "id " .. tostring(id) .. " is a " .. tostring(kind) .. ", not a collection")
    end
    local before = Transfer.describeCollection(catalog, collection)
    if kind == "LrSmartCollection" then
        local ok, desc = LrTasks.pcall(function() return collection:getSearchDescription() end)
        if ok then before.search_description = plain(desc, 0) else before.search_error = tostring(desc) end
    else
        local ok, uuids, truncated = LrTasks.pcall(uuidsOf, catalog, collection:getPhotos() or {})
        if not ok then return fail("read_failed", "members: " .. tostring(uuids), true) end
        before.member_uuids, before.members_truncated = uuids, truncated
    end
    local status, err = Gate.write(catalog, "AVG delete collection", function() collection:delete() end)
    if not status then return nil, err end
    return { before = before, deleted = catalog:getCollectionByLocalIdentifier(id) == nil }
end

return CollectionEdit
