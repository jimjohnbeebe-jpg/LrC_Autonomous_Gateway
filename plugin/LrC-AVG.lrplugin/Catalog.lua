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
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local Log = require 'Log'

local Catalog = {}

-- PRD section 6 settings: "Variant count 3, 2-4".
Catalog.MIN_COPIES = 2
Catalog.MAX_COPIES = 4
-- How long a command waits for another selection command to finish. Below the engine's default
-- 15 s request timeout (engine\src\bridge\client.ts DEFAULTS), so a command the engine has given up
-- on does not run later [inference: the figure].
Catalog.LOCK_WAIT_SECONDS = 10

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- One selection command at a time (Greptile, PR #33). Every bridge line runs in its own task
-- (Sockets.lua onMessage), and the selection queries yield [upstream claim: rule 03,
-- HandlerSelection.lua:30-38], so without this a select_photo could change the selection between
-- create_virtual_copies' check of the master and its createVirtualCopies call. Against a fake
-- Lightroom whose queries yield, the code before this lock made a copy of the other photo at 4 of 13
-- start times, and with it none [handle: docs\reports\phase4\variants-plugin-smoke\smoke.txt "== Two
-- commands at once"]. A click in Lightroom's own window is not held back by this; a copy of another
-- photo then comes back with identity_ok false [inference].
--
-- A holder that never finishes must not block every later command until Lightroom restarts
-- (Greptile, PR #33): a task stopped by a Reload Plug-in, or a call that never returns. So a lock
-- taken under another bridge generation (Bridge.lua bumps _G.LrCAVG_BridgeGeneration on each start)
-- or held longer than LOCK_MAX_HOLD_SECONDS counts as abandoned, and a holder releases only its own
-- lock [handle: docs\reports\phase4\variants-plugin-smoke\smoke.txt "== A lock whose holder never
-- finishes": against the fake, both takeovers, and a mutant releasing any lock caught]. The task of
-- an abandoned lock may in fact still be running, so a command checks that it still holds the lock
-- (`owns`) right before each selection change and each createVirtualCopies call, and stops with
-- lock_lost when it does not (Greptile, PR #33 round 3). No other task runs between that check and
-- the call, since tasks are coroutines that switch only where one yields [handle: LR_SDK_NOTES
-- "LrTasks"]. A call already inside createVirtualCopies when its lock is taken over is the window
-- no lock here can close: against the fake it copied whatever was selected when it read the
-- selection, and the other command then reported select_failed; otherwise no copy of another photo
-- was made [handle: docs\reports\phase4\variants-plugin-smoke\smoke.txt "taken over while running"].
-- Whether Lightroom's own call yields inside is [unverified].
-- S6's copies took 212-1017 ms each [handle: docs\reports\phase0\S6\s6_*.json calls[*].ms], so a
-- 4-copy batch should take seconds; 60 s is a generous bound [inference: the figure].
Catalog.LOCK_MAX_HOLD_SECONDS = 60
local holder = nil -- { name, generation, since }

local function abandoned(h)
    if h.generation ~= _G.LrCAVG_BridgeGeneration then return "taken before the bridge restarted" end
    if LrDate.currentTime() - h.since > Catalog.LOCK_MAX_HOLD_SECONDS then
        return "held longer than " .. Catalog.LOCK_MAX_HOLD_SECONDS .. " s"
    end
    return nil
end

local function exclusive(name, fn)
    local t0 = LrDate.currentTime()
    while holder do
        local why = abandoned(holder)
        if why then
            Log.warn("catalog: " .. name .. " takes over the selection lock from " .. holder.name .. " (" .. why .. ")")
            holder = nil
        elseif LrDate.currentTime() - t0 >= Catalog.LOCK_WAIT_SECONDS then
            return fail("busy", string.format("%s waited %d s for %s to finish", name, Catalog.LOCK_WAIT_SECONDS, holder.name), true)
        else
            LrTasks.sleep(0.05)
        end
    end
    local mine = { name = name, generation = _G.LrCAVG_BridgeGeneration, since = LrDate.currentTime() }
    holder = mine
    local ok, result, err = LrTasks.pcall(fn, function() return holder == mine end)
    if holder == mine then holder = nil end
    if not ok then error(result, 0) end
    return result, err
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

local LOCK_LOST = "another command took over the selection lock (the bridge restarted, or this one ran over " ..
    Catalog.LOCK_MAX_HOLD_SECONDS .. " s)"

-- One copy of the master named `name`. Returns the copy's description, or nil plus a failure.
-- `owns()` tells whether this command still holds the selection lock.
local function copyOnce(catalog, master, masterInfo, name, owns)
    if not owns() then return nil, { code = "lock_lost", message = LOCK_LOST .. "; stopped before selecting the master" } end
    local selected, selectErr = selectOnly(catalog, master)
    if not selected then return nil, { code = "select_failed", message = selectErr } end
    if not owns() then return nil, { code = "lock_lost", message = LOCK_LOST .. "; stopped before copying" } end
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

local function createCopies(payload, owns)
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
        local copy, why = copyOnce(catalog, master, masterInfo, name, owns)
        if copy then copies[#copies + 1] = copy end
        if why then
            failure = why
            break
        end
    end
    -- Put the master back, unless another command now holds the selection.
    local masterSelected, selectErr = false, LOCK_LOST .. "; the selection was left to it"
    if owns() then masterSelected, selectErr = selectOnly(catalog, master) end
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

local function selectPhoto(payload, owns)
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
    if not owns() then return fail("lock_lost", LOCK_LOST .. "; nothing was selected", true) end
    local selected, selectErr = selectOnly(catalog, photo)
    if not selected then return fail("select_failed", selectErr, true) end
    return d
end

function Catalog.createVirtualCopies(payload)
    return exclusive("create_virtual_copies", function(owns) return createCopies(payload, owns) end)
end

function Catalog.selectPhoto(payload)
    return exclusive("select_photo", function(owns) return selectPhoto(payload, owns) end)
end

return Catalog
