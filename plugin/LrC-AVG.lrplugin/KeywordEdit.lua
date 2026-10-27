-- Renaming a keyword and reading a keyword's subtree (plugin 1.5.0, GitHub issue #218 row 5; upstream's
-- rename_keyword and remove_keyword_subtree [upstream claim: Automaat/lightroom-mcp@1040453
-- plugin/LightroomMCP.lrplugin/HandlerKeywords.lua:100-211, HandlerOrganization.lua:283-351], MIT, see
-- THIRD_PARTY_NOTICES.md). Keywords are named by path as in set_keywords (KeywordTree.lua): a plain name is
-- the top-level keyword of that name.
--
-- rename_keyword { path, new_name }: the keyword's name changes in place; its parent, children, synonyms
--   and photos stay. A sibling of that name (case aside) is refused (keyword_exists): a rename never merges
--   keywords. `before` and `after` are its paths, `after` read back once the gate is closed.
-- keyword_subtree { path, photos }: the keyword's path and every path under it (`paths`, the parent first);
--   with photos = true also the uuids of the photos that hold any of them (`uuids`, at most MAX_PHOTOS, and
--   `photo_count`). The engine takes the keywords off the photos with set_keywords, one photo per command,
--   so each photo's keywords are read before and after (engine\src\mcp\tools-keywords.ts). No keyword is
--   deleted: the SDK pages list no call that deletes one [handle: D:\Developer\LightRoom Classic Dev Kit\API
--   Reference\modules\LrKeyword.html, its function list].
--
-- SDK: keyword:setAttributes({ keywordName }) needs write access and returns "True on success, false if there
-- is already a keyword which has the same name and parent"; getPhotos() and getChildren() read [handle:
-- modules\LrKeyword.html, setAttributes, getPhotos, getChildren]. Lightroom ignores a rename that changes only
-- the case, so upstream renames through a temporary name, committed first [upstream claim:
-- HandlerKeywords.lua:166-182]; this does the same. Reads run outside any gate, as KeywordTree.lua says why.

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'
local KeywordTree = require 'KeywordTree'

local KeywordEdit = {}

-- The most photo uuids keyword_subtree returns [inference: the figure]; the engine pages through them.
KeywordEdit.MAX_PHOTOS = 10000

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- The keyword at payload.path, or nil plus the error.
local function keywordAt(catalog, path)
    local parts, why = KeywordTree.split(path)
    if not parts then return fail("bad_request", "path: " .. tostring(why)) end
    local keyword = KeywordTree.find(catalog, parts)
    if not keyword then return fail("unknown_keyword", "no keyword at " .. KeywordTree.join(parts) .. " (lr_list_keywords lists the paths)") end
    return keyword
end

-- Sets the keyword's name in its own write gate; returns the error text, or nil.
local function setName(catalog, keyword, name)
    local ok, err = LrTasks.pcall(Gate.run, catalog, "AVG rename keyword", function()
        if not keyword:setAttributes({ keywordName = name }) then error("Lightroom refused the name " .. name, 0) end
    end)
    if not ok then return tostring(err) end
    return nil
end

-- A sibling name for the case-only rename that no keyword under `parent` holds.
local function tempName(catalog, parent, name)
    local n, temp = 1, name .. " (renaming)"
    while KeywordTree.findChild(catalog, parent, temp) do
        n = n + 1
        temp = name .. " (renaming " .. n .. ")"
    end
    return temp
end

function KeywordEdit.rename(payload)
    local newParts = KeywordTree.split(payload.new_name)
    if not newParts or #newParts ~= 1 then return fail("bad_request", "new_name must be one keyword name, not a path") end
    local newName = newParts[1]
    local catalog = LrApplication.activeCatalog()
    local keyword, err = keywordAt(catalog, payload.path)
    if not keyword then return nil, err end
    local oldName, parent = keyword:getName(), keyword:getParent()
    local before = KeywordTree.pathOf(keyword)
    if oldName == newName then return fail("bad_request", "the keyword is already named " .. newName) end
    local clash = KeywordTree.findChild(catalog, parent, newName)
    if clash and clash ~= keyword then
        return fail("keyword_exists", "a keyword " .. KeywordTree.pathOf(clash) .. " is already there: a rename cannot merge keywords")
    end
    local photoCount = #(keyword:getPhotos() or {})
    local writeErr
    if KeywordTree.fold(oldName) == KeywordTree.fold(newName) then
        writeErr = setName(catalog, keyword, tempName(catalog, parent, newName))
        if not writeErr then writeErr = setName(catalog, keyword, newName) end
    else
        writeErr = setName(catalog, keyword, newName)
    end
    local okAfter, after = LrTasks.pcall(KeywordTree.pathOf, keyword)
    return { before = before, after = okAfter and after or nil, after_error = (not okAfter) and tostring(after) or nil,
        photo_count = photoCount, write_error = writeErr }
end

-- The keyword and every keyword under it, parent first.
local function subtreeOf(keyword, out)
    out[#out + 1] = keyword
    for _, child in ipairs(keyword:getChildren() or {}) do subtreeOf(child, out) end
    return out
end

-- The uuids of the photos holding any of `keywords`, each once, at most MAX_PHOTOS; and how many there are.
local function photosOf(catalog, keywords)
    local seen, photos = {}, {}
    for i, keyword in ipairs(keywords) do
        if i > 1 then LrTasks.yield() end -- PRD NFR-1
        for _, photo in ipairs(keyword:getPhotos() or {}) do
            if not seen[photo.localIdentifier] then
                seen[photo.localIdentifier] = true
                photos[#photos + 1] = photo
            end
        end
    end
    local slice = {}
    for i = 1, math.min(#photos, KeywordEdit.MAX_PHOTOS) do slice[i] = photos[i] end
    local raw = catalog:batchGetRawMetadata(slice, { "uuid" }) or {}
    local uuids = {}
    for _, photo in ipairs(slice) do
        if raw[photo] and type(raw[photo].uuid) == "string" then uuids[#uuids + 1] = raw[photo].uuid end
    end
    return uuids, #photos
end

function KeywordEdit.subtree(payload)
    local catalog = LrApplication.activeCatalog()
    local root, err = keywordAt(catalog, payload.path)
    if not root then return nil, err end
    local ok, keywords = LrTasks.pcall(subtreeOf, root, {})
    if not ok then return fail("read_failed", "keywords: " .. tostring(keywords), true) end
    local paths = {}
    for i, keyword in ipairs(keywords) do
        if i % 50 == 0 then LrTasks.yield() end -- PRD NFR-1
        paths[i] = KeywordTree.pathOf(keyword)
    end
    if payload.photos ~= true then return { paths = paths } end
    local okPhotos, uuids, count = LrTasks.pcall(photosOf, catalog, keywords)
    if not okPhotos then return fail("read_failed", "photos: " .. tostring(uuids), true) end
    return { paths = paths, uuids = uuids, photo_count = count }
end

return KeywordEdit
