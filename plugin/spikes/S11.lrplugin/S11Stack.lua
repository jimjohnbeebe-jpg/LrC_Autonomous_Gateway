-- Spike S11, folders and stacks.
-- Folders (#139 gap 2): the photo's folder found two ways, catalog:getFolderByPath + folder:getPhotos
-- and catalog:findPhotos with the "folder" criterion, "Name of folder -- including all parent folders
-- shown in the Folders panel" [handle: SDK 15.2 API Reference, modules\LrCatalog.html findPhotos,
-- getFolderByPath; modules\LrFolder.html getPhotos]. Each is timed and checked for the photo.
-- Stacks (#111, #139 gap 4): the SDK reads stack state (isInStackInFolder, stackPositionInFolder, ...)
-- but writes a stack only at import, catalog:addPhoto(path, stackWithPhoto, position); no other call
-- names a stack [handle: SDK 15.2 API Reference, modules\LrPhoto.html getRawMetadata and the method
-- list, modules\LrCatalog.html addPhoto, modules\LrSelection.html]. So two copies of the photo's file
-- are imported into <repo>\fixtures\S11 as a stack (Jim's decision D3 B, 2026-10-12 [stated: "Go with
-- recommendations"]) and their stack state read back. Jim removes the two copies by hand
-- (spikes\S11\README.md): the one SDK call that removes photos, LrSelection.removeFromCatalog() (SDK
-- 14.3) [handle: modules\LrSelection.html], acts on whatever is selected, and is not used here.

local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'

local Common = require 'S11Common'

local St = {}

local STACK_KEYS = { "isInStackInFolder", "stackPositionInFolder", "countStackInFolderMembers", "stackInFolderIsCollapsed" }
-- findPhotos operations for a string criterion [handle: modules\LrCatalog.html findPhotos].
local FOLDER_OPS = { "any", "==", "beginsWith" }

local function contains(photos, photo)
    for _, p in ipairs(photos or {}) do
        if p.localIdentifier == photo.localIdentifier then return true end
    end
    return false
end

local function uuidOf(catalog, p)
    if p == nil then return nil end
    local r
    catalog:withReadAccessDo(function() r = p:getRawMetadata("uuid") end)
    return r
end

-- The stack keys of one photo; top of stack and members as uuids.
function St.stackState(catalog, photo)
    local out = {}
    for _, key in ipairs(STACK_KEYS) do out[key] = Common.readKey(catalog, photo, key) end
    local top = Common.readKey(catalog, photo, "topOfStackInFolderContainingPhoto")
    out.top_uuid = top.error and { error = top.error } or uuidOf(catalog, top.value)
    local members = Common.readKey(catalog, photo, "stackInFolderMembers")
    if members.error then
        out.member_uuids = { error = members.error }
    else
        out.member_uuids = {}
        for _, p in ipairs(members.value or {}) do table.insert(out.member_uuids, uuidOf(catalog, p)) end
    end
    return out
end

-- Yielding catalog queries stay outside any read gate (rule 03).
function St.folders(catalog, photo, path)
    local dir = LrPathUtils.parent(path)
    local out = { dir = dir }
    local ok, folder, rec = Common.call(function() return catalog:getFolderByPath(dir) end)
    out.get_folder_by_path = rec
    if not ok or folder == nil then
        rec.found = false
        return out
    end
    rec.found = true
    out.folder_name, out.folder_path = folder:getName(), folder:getPath()
    local okP, photos, recP = Common.call(function() return folder:getPhotos(false) end)
    if okP then recP.count, recP.contains_photo = #photos, contains(photos, photo) end
    out.get_photos = recP
    out.find_photos = {}
    for _, value in ipairs({ out.folder_name, out.folder_path }) do
        for _, op in ipairs(FOLDER_OPS) do
            local okF, found, recF = Common.call(function()
                return catalog:findPhotos { searchDesc = { criteria = "folder", operation = op, value = value } }
            end)
            recF.operation, recF.value = op, value
            if okF then recF.count, recF.contains_photo = #found, contains(found, photo) end
            table.insert(out.find_photos, recF)
        end
    end
    return out
end

local function repoFixtures()
    -- _PLUGIN.path is <repo>\plugin\spikes\S11.lrplugin
    local repo = LrPathUtils.parent(LrPathUtils.parent(LrPathUtils.parent(_PLUGIN.path)))
    return LrPathUtils.child(LrPathUtils.child(repo, "fixtures"), "S11")
end

-- Two copies of the photo's file imported in place, the second stacked with the first.
function St.importStack(catalog, path)
    local dir = repoFixtures()
    LrFileUtils.createAllDirectories(dir)
    local ext = LrPathUtils.extension(path)
    local files = { LrPathUtils.child(dir, "S11-stack-a." .. ext), LrPathUtils.child(dir, "S11-stack-b." .. ext) }
    local out = { files = files }
    for _, f in ipairs(files) do
        if catalog:findPhotoByPath(f) then
            out.skipped = "S11-stack-a/b are still in the catalog from an earlier run: remove them (spikes\\S11\\README.md), then run again"
            return out
        end
    end
    for _, f in ipairs(files) do
        if LrFileUtils.exists(f) then LrFileUtils.delete(f) end -- copy fails onto an existing file [handle: modules\LrFileUtils.html copy]
        local ok, err = LrFileUtils.copy(path, f)
        if not ok then
            out.copy_error = tostring(err)
            return out
        end
    end
    -- Two gates: a change made in a gate takes effect only when the gate completes [handle:
    -- modules\LrCatalog.html withWriteAccessDo], and stackWithPhoto names an "existing photo" (addPhoto).
    local a, b
    local okA, _, recA = Common.call(function()
        catalog:withWriteAccessDo("AVG S11 import a", function() a = catalog:addPhoto(files[1]) end, Common.WRITE_TIMEOUT)
    end)
    out.add_photo_a = recA
    if not okA or a == nil then return out end
    out.a = { uuid = uuidOf(catalog, a) }
    local okB, _, recB = Common.call(function()
        catalog:withWriteAccessDo("AVG S11 import b stacked", function() b = catalog:addPhoto(files[2], a, "below") end, Common.WRITE_TIMEOUT)
    end)
    out.add_photo_b = recB
    out.a.stack = St.stackState(catalog, a)
    if not okB or b == nil then return out end
    out.b = { uuid = uuidOf(catalog, b), stack = St.stackState(catalog, b) }
    local count = out.b.stack.countStackInFolderMembers.value
    -- Which copy is on top is recorded (top_uuid), not required.
    out.stacked = out.b.stack.isInStackInFolder.value == true and count == 2
    return out
end

return St
