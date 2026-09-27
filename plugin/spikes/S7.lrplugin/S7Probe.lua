-- AVG-S7 item 2: is there an undocumented call that removes a photo from the catalog (D-02,
-- PHASE4_PLAN decision 4)? The SDK reference lists none on LrCatalog or LrPhoto [handle:
-- https://lrc.mcor.dev/modules/LrCatalog.html, https://lrc.mcor.dev/modules/LrPhoto.html, read
-- 2026-09-27]. The probe lists the names it can see on the catalog and on a photo, and asks for a
-- set of likely names. It NEVER CALLS what it finds: an undocumented remove call might act on the
-- selection rather than its argument [inference], and decision 4 only needs to know one exists.
-- Controls: names known to exist, one of them undocumented (getPhotoByLocalId, found in S6), show
-- whether the probe can see a function at all.

local LrTasks = import 'LrTasks'

local S7Probe = {}

local CANDIDATES = {
    catalog = { "removePhotos", "removePhoto", "deletePhotos", "deletePhoto", "removeFromCatalog",
        "removePhotosFromCatalog", "removeVirtualCopies", "removeVirtualCopy", "deleteVirtualCopies",
        "deleteVirtualCopy", "trashPhotos" },
    photo = { "remove", "delete", "removeFromCatalog", "deleteFromCatalog", "removePhoto", "deletePhoto",
        "removeVirtualCopy", "deleteVirtualCopy" },
}
local CONTROLS = {
    catalog = { "createVirtualCopies", "getPhotoByLocalId", "findPhotoByUuid", "deleteAllEmptyMasks" },
    photo = { "applyDevelopSettings", "getRawMetadata", "deleteDevelopSnapshot" },
}
-- Removal-like names the SDK reference documents (same pages): not what D-02 is looking for.
local DOCUMENTED = { deleteAllEmptyMasks = true, deleteDevelopSnapshot = true, deleteSmartPreview = true,
    removeKeyword = true }

local function kind(obj, name)
    local ok, t = LrTasks.pcall(function() return type(obj[name]) end)
    if ok then return t end
    return "error: " .. tostring(t)
end

local function addNames(names, seen, t)
    for k, v in pairs(t) do
        if type(k) == "string" and not seen[k] then
            seen[k] = true
            table.insert(names, k .. ":" .. type(v))
        end
    end
end

-- Names on the object itself and, when its metatable's __index is a table, there.
local function enumerate(obj)
    local out = { names = {} }
    local seen = {}
    local ok, err = LrTasks.pcall(function() addNames(out.names, seen, obj) end)
    if not ok then out.pairs_error = tostring(err) end
    local okMeta, errMeta = LrTasks.pcall(function()
        local mt = getmetatable(obj)
        out.metatable = type(mt)
        if type(mt) == "table" and type(mt.__index) == "table" then addNames(out.names, seen, mt.__index) end
    end)
    if not okMeta then out.metatable_error = tostring(errMeta) end
    table.sort(out.names)
    return out
end

local function removalLike(name)
    local lower = name:lower()
    return lower:find("remove", 1, true) or lower:find("delete", 1, true) or lower:find("trash", 1, true)
end

local function probeOne(label, obj)
    local out = { enumerated = enumerate(obj), candidates = {}, controls = {}, undocumented_removal_names = {} }
    for _, name in ipairs(CONTROLS[label]) do out.controls[name] = kind(obj, name) end
    for _, name in ipairs(CANDIDATES[label]) do
        out.candidates[name] = kind(obj, name)
        if out.candidates[name] == "function" then table.insert(out.undocumented_removal_names, name) end
    end
    for _, entry in ipairs(out.enumerated.names) do
        local name = entry:match("^([^:]+)")
        if removalLike(name) and not DOCUMENTED[name] and not out.candidates[name] then
            table.insert(out.undocumented_removal_names, name)
        end
    end
    return out
end

-- Returns { catalog = ..., photo = ..., found = <number of undocumented removal-like names> }.
function S7Probe.run(catalog, photo)
    local out = { catalog = probeOne("catalog", catalog), photo = probeOne("photo", photo), called = "nothing" }
    out.found = #out.catalog.undocumented_removal_names + #out.photo.undocumented_removal_names
    return out
end

return S7Probe
