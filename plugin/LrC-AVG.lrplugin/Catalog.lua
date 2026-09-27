-- Bridge commands for virtual copies and the selection (PRD section 6.6, ARCHITECTURE section 3,
-- PHASE4_PLAN row 6). Each handler runs in its own task (Dispatch.lua) and returns a result table,
-- or nil plus an error table { code, message, recoverable } (PRD NFR-7).
--
-- create_virtual_copies { target_uuid, names }: one virtual copy of the selected photo (the master)
--   per name. createVirtualCopies acts on the selected photos, returns the new copy, names it
--   (copyName) and makes it the active photo [handle: docs\reports\phase0\S6.md "Analysis"], so the
--   master is selected again before each call and the copy is taken from the return value (Phase 0,
--   P-09). Once a copy exists the command answers ok, so the engine always learns which copies were
--   made; `failure` says why it stopped early.
--   No write gate around createVirtualCopies: .claude\rules\03-lightroom.md makes it the one
--   exception, as PRD section 6.6 (P-09) records. It worked outside a gate 10 of 10 times and was
--   never tried inside one [handle: docs\reports\phase0\S6.md "Analysis", 6 of 6;
--   docs\reports\phase4\S7.md "Consequences", 4 of 4].
-- select_photo { uuid, expect }: find a photo by uuid, check it is the photo the engine means
--   (Phase 0, P-18), select it and read the selection back. findPhotoByUuid found S7's copies and
--   its identity check passed [handle: docs\reports\phase4\S7.md "Numbers"]. A uuid is the photo's
--   own id; whether Lightroom reuses a localIdentifier is [unverified] (S6.md "Consequences").
--
-- The catalog queries (getTargetPhoto(s), setSelectedPhotos, findPhotoByUuid) run outside any read
-- gate, as rule 03 asks of yielding queries; whether findPhotoByUuid yields is [unverified], and S7
-- ran it outside a gate too [handle: plugin\spikes\S7.lrplugin\S7Common.lua:122-131]. Metadata
-- reads run inside a read gate with LrTasks.pcall, as in Develop.lua getContext.

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'

local Catalog = {}

-- PRD section 6 settings: "Variant count 3, 2-4".
Catalog.MIN_COPIES = 2
Catalog.MAX_COPIES = 4

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
local function describe(catalog, photo)
    local d = { local_id = photo.localIdentifier }
    catalog:withReadAccessDo(function()
        d.uuid = read(photo, photo.getRawMetadata, "uuid")
        d.is_virtual_copy = read(photo, photo.getRawMetadata, "isVirtualCopy")
        local master = read(photo, photo.getRawMetadata, "masterPhoto")
        if type(master) ~= "string" and master ~= nil then d.master_local_id = master.localIdentifier end
        d.copy_name = read(photo, photo.getFormattedMetadata, "copyName")
    end)
    return d
end

-- Select `photo` alone, then read the selection back: Lightroom may not select a photo, for
-- example one outside the current view [unverified], and reports no error then [inference].
local function selectOnly(catalog, photo)
    local ok, err = LrTasks.pcall(function() catalog:setSelectedPhotos(photo, { photo }) end)
    if not ok then return false, "setSelectedPhotos: " .. tostring(err) end
    local active = catalog:getTargetPhoto()
    local selected = catalog:getTargetPhotos() or {}
    local id = photo.localIdentifier
    if active and active.localIdentifier == id and #selected == 1 and selected[1].localIdentifier == id then
        return true
    end
    return false, string.format("Lightroom did not select photo %s (active photo %s, %d selected)",
        tostring(id), tostring(active and active.localIdentifier), #selected)
end

local function validNames(names)
    if type(names) ~= "table" or #names < Catalog.MIN_COPIES or #names > Catalog.MAX_COPIES then return false end
    local seen = {}
    for _, name in ipairs(names) do
        if type(name) ~= "string" or name:sub(1, 4) ~= "AVG " or seen[name] then return false end
        seen[name] = true
    end
    return true
end

-- One copy of the master named `name`. Returns the copy's description, or nil plus a failure.
local function copyOnce(catalog, master, masterInfo, name)
    local selected, selectErr = selectOnly(catalog, master)
    if not selected then return nil, { code = "select_failed", message = selectErr } end
    local ok, returned = LrTasks.pcall(function() return catalog:createVirtualCopies(name) end)
    if not ok then return nil, { code = "copy_failed", message = "createVirtualCopies: " .. tostring(returned) } end
    if type(returned) ~= "table" or #returned ~= 1 or returned[1] == nil then
        return nil, { code = "copy_failed", message = "createVirtualCopies returned " .. type(returned) ..
            (type(returned) == "table" and (" of " .. #returned) or "") }
    end
    local copy = describe(catalog, returned[1])
    copy.identity_ok = copy.is_virtual_copy == true and copy.master_local_id == masterInfo.local_id
        and copy.copy_name == name and type(copy.uuid) == "string"
    if not copy.identity_ok then
        return copy, { code = "identity_mismatch", message = "the new photo is not a virtual copy of the master named " .. name }
    end
    return copy, nil
end

function Catalog.createVirtualCopies(payload)
    if type(payload.target_uuid) ~= "string" or payload.target_uuid == "" then
        return fail("bad_request", "target_uuid must name the master photo")
    end
    if not validNames(payload.names) then
        return fail("bad_request", string.format("names must be %d-%d different strings, each starting with 'AVG '",
            Catalog.MIN_COPIES, Catalog.MAX_COPIES))
    end
    local catalog, master, masterUuid, err = Develop.target(payload)
    if err then return nil, err end
    local masterInfo = describe(catalog, master)
    if masterInfo.is_virtual_copy ~= false then
        return fail("bad_target", "the selected photo is a virtual copy (or unreadable); select the master photo", true)
    end
    local copies, failure = {}, nil
    for i, name in ipairs(payload.names) do
        if i > 1 then LrTasks.yield() end -- PRD NFR-1: yield between photos
        local copy, why = copyOnce(catalog, master, masterInfo, name)
        if copy then copies[#copies + 1] = copy end
        if why then
            failure = why
            break
        end
    end
    local masterSelected, selectErr = selectOnly(catalog, master)
    return { uuid = masterUuid, local_id = masterInfo.local_id, requested = #payload.names, copies = copies,
        failure = failure, master_selected = masterSelected, master_select_error = selectErr }
end

-- The first way `d` differs from what the engine expects, or nil.
local function mismatch(d, uuid, expect)
    if d.uuid ~= uuid then return "uuid " .. tostring(d.uuid) end
    for _, field in ipairs({ "copy_name", "master_local_id", "is_virtual_copy" }) do
        if expect[field] ~= nil and d[field] ~= expect[field] then
            return field .. " " .. tostring(d[field]) .. ", expected " .. tostring(expect[field])
        end
    end
    return nil
end

function Catalog.selectPhoto(payload)
    local uuid, expect = payload.uuid, payload.expect
    if type(uuid) ~= "string" or uuid == "" then return fail("bad_request", "uuid must be a non-empty string") end
    if expect == nil then expect = {} end
    if type(expect) ~= "table" then return fail("bad_request", "expect must be an object") end
    local catalog = LrApplication.activeCatalog()
    local ok, photo = LrTasks.pcall(function() return catalog:findPhotoByUuid(uuid) end)
    if not ok then return fail("lookup_failed", "findPhotoByUuid: " .. tostring(photo), true) end
    if not photo then return fail("unknown_photo", "no photo in the catalog has uuid " .. uuid) end
    local d = describe(catalog, photo)
    local wrong = mismatch(d, uuid, expect)
    if wrong then return fail("identity_mismatch", "the photo with uuid " .. uuid .. " has " .. wrong) end
    local selected, selectErr = selectOnly(catalog, photo)
    if not selected then return fail("select_failed", selectErr, true) end
    return d
end

return Catalog
