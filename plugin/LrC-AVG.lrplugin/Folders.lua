-- The catalog's folder tree (plugin 1.5.0, GitHub issue #218 row 6; upstream's list_folders [upstream claim:
-- Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/HandlerFolders.lua:11-48], MIT, see
-- THIRD_PARTY_NOTICES.md). A folder's photos are lr_search_photos' `folder` (Library.lua folderPhotos).
--
-- list_folders { offset, limit }: every folder as { path, name, depth, photo_count }, a parent before its
-- children, in the order Lightroom lists them; photo_count is the folder's own photos (getPhotos(false)),
-- read only for the folders on the page. `count` is how many folders the catalog has.
--
-- SDK: catalog:getFolders() "Retrieves the folders defined at the root of the hierarchy"; folder:getChildren(),
-- getPath(), getName() and getPhotos(includeChildren) [handle: D:\Developer\LightRoom Classic Dev Kit\API
-- Reference\modules\LrCatalog.html getFolders, modules\LrFolder.html]. The walk runs outside any gate, as
-- upstream walks it and as Library.lua runs getFolderByPath; whether these calls yield is [unverified].

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Folders = {}

-- The largest page (engine\src\library\search.ts MAX_PAGE).
Folders.MAX_PAGE = 500

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function wholeNumber(v, min, max)
    return type(v) == "number" and v == math.floor(v) and v >= min and (max == nil or v <= max)
end

-- Every folder, depth first, as { folder, depth }.
local function walk(catalog)
    local all = {}
    local function visit(folder, depth)
        all[#all + 1] = { folder = folder, depth = depth }
        if #all % 50 == 0 then LrTasks.yield() end -- PRD NFR-1
        for _, child in ipairs(folder:getChildren() or {}) do visit(child, depth + 1) end
    end
    for _, root in ipairs(catalog:getFolders() or {}) do visit(root, 0) end
    return all
end

function Folders.list(payload)
    local offset, limit = payload.offset or 0, payload.limit or 100
    if not wholeNumber(offset, 0) or not wholeNumber(limit, 1, Folders.MAX_PAGE) then
        return fail("bad_request", "offset must be a whole number from 0, limit from 1 to " .. Folders.MAX_PAGE)
    end
    local catalog = LrApplication.activeCatalog()
    local ok, all = LrTasks.pcall(walk, catalog)
    if not ok then return fail("read_failed", "folders: " .. tostring(all), true) end
    local page = {}
    for i = offset + 1, math.min(offset + limit, #all) do
        local e = all[i]
        local okRead, path, name, photos = LrTasks.pcall(function()
            return e.folder:getPath(), e.folder:getName(), e.folder:getPhotos(false)
        end)
        if not okRead then return fail("read_failed", "folder: " .. tostring(path), true) end
        page[#page + 1] = { path = path, name = name, depth = e.depth, photo_count = #(photos or {}) }
    end
    return { count = #all, folders = page }
end

return Folders
