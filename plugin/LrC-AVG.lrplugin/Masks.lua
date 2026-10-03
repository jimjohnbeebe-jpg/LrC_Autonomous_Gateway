-- Bridge commands for the masks capture (GitHub issue #59, PR C step 1, plugin 0.11.0). They exist
-- to learn how Lightroom stores and changes masks before any mask tool is built, so they record what
-- the SDK gives and interpret nothing; no mask field name is written here (rule 03: key names come
-- from a live getDevelopSettings() dump, which the capture takes with get_settings). Each handler runs
-- in its own task (Dispatch.lua) and returns a result table, or nil plus an error table
-- { code, message, recoverable } (PRD NFR-7). An SDK call this Lightroom lacks answers
-- feature_unavailable; nothing here raises on purpose.
--
-- update_ai_settings { photo_uuid, expect? }: photo:updateAISettings() on the photo found by uuid
--   (Photos.lua), in its own write gate. The SDK reference: "Updates AI Settings for this photo. Must
--   be called from within a catalog:withWriteAccessDo or catalog:withProlongedWriteAccessDo gate.
--   First supported in version 13.3" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read
--   2026-10-03]. This plugin declares LrSdkVersion 13.0 (Info.lua); whether Lightroom hides a 13.3
--   call from it is [unverified]. That an AI mask written as a table stays pending until this call,
--   and that it must run in a gate of its own after the write, is [community: third-party plugin
--   notes, issue #59 research] and [unverified] here. Waiting for the mask to compute is the
--   capture script's job, by reading get_settings, so no field name is needed here.
-- probe_masks_dc { target_uuid }: LrDevelopController on the selected photo, which must be the photo
--   with target_uuid (else target_mismatch, as Develop.lua target() refuses). Outside any write gate
--   (a gate around createNewMask reportedly rolls it back [community: issue #59 research]). Switches
--   to Develop, opens Masking, creates an AI sky mask and an AI subject mask, sets local exposure
--   right away and again after a wait, selects each mask by id with one argument and with two,
--   deletes them, and records every step as { step, ok, result | error, ms }. LrDevelopController
--   acts on the current photo, not on a photo object, so before every step the probe checks that the
--   selected photo is still the target, and that its own deadline (PROBE_SECONDS) has not passed; if
--   either fails it records why (`stopped`) and runs no further step. So a probe the engine gave up
--   on stops by itself. The capture puts the photo back with a snapshot afterwards. The function
--   names, their "Must be called while the Develop module is active" rules and the parameter name
--   "local_Exposure" are from the SDK reference [handle:
--   https://lrc.mcor.dev/modules/LrDevelopController.html, read 2026-10-03; LrApplicationView.html
--   for switchToModule and getCurrentModuleName]; how they behave is what this probe asks
--   [unverified]. selectMask and deleteMask are listed as (id, param) with one description; a
--   third-party plugin passes the id twice [community: issue #59 research], so both are tried.
-- A method is looked up with type(obj[name]) inside LrTasks.pcall, as spike S7 did; it saw
-- "function" for methods that exist [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json
-- removal_probe.photo.controls].

local LrApplication = import 'LrApplication'
local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local Photos = require 'Photos'

local Masks = {}

local POLL_SECONDS = 0.25
local MODULE_WAIT_SECONDS = 5
-- How long a new AI mask may take to show in getAllMasks. The research reports ~0.6 s to compute
-- [community: issue #59 research, one non-raw photo]; 10 s is a generous bound [inference].
local MASK_WAIT_SECONDS = 10
local DELETE_WAIT_SECONDS = 3
local SETTLE_SECONDS = 2
-- The whole probe's bound: its waits add up to about 37 s at most [inference: the waits above]. The
-- capture script waits 90 s for the answer, so the probe stops before the engine gives up.
local PROBE_SECONDS = 60
local LOCAL_EXPOSURE = "local_Exposure"
local COPY_DEPTH = 8

local function unavailable(what)
    return nil, { code = "feature_unavailable", recoverable = true,
        message = what .. " is not available in this Lightroom (or not to this plugin)" }
end

-- type(obj[name]), or nil when the lookup raises.
local function kind(obj, name)
    local ok, t = LrTasks.pcall(function() return type(obj[name]) end)
    return ok and t or nil
end

-- obj[name](...), or an error naming the missing call (record() below turns it into ok = false).
local function call(obj, label, name, ...)
    if kind(obj, name) ~= "function" then error(label .. "." .. name .. " is not available", 0) end
    return obj[name](...)
end
local function dc(name, ...) return call(LrDevelopController, "LrDevelopController", name, ...) end
local function view(name, ...) return call(LrApplicationView, "LrApplicationView", name, ...) end

-- A copy Json.lua can encode: functions, userdata and threads become "<type>", tables are copied to
-- `depth` levels, keys that are neither numbers nor strings become strings.
local function jsonSafe(v, depth)
    local t = type(v)
    if t == "table" then
        if depth <= 0 then return "<table nested too deep>" end
        local out = {}
        for k, x in pairs(v) do
            local key = (type(k) == "number" or type(k) == "string") and k or tostring(k)
            out[key] = jsonSafe(x, depth - 1)
        end
        return out
    elseif t == "function" or t == "userdata" or t == "thread" then
        return "<" .. t .. ">"
    end
    return v
end

-- Why the probe must stop now, or nil: its deadline passed, or the selected photo is not the target.
local function stopReason(ctx)
    if LrDate.currentTime() > ctx.deadline then return "the probe's " .. PROBE_SECONDS .. " s deadline passed" end
    local _, _, _, err = Develop.target({ target_uuid = ctx.uuid })
    if err then return tostring(err.code) .. ": " .. tostring(err.message) end
    return nil
end

-- Runs fn and appends { step, ok, result | error, ms } to ctx.steps, unless the probe has stopped or
-- must stop now (then it records why, once). Returns ok and fn's raw value.
local function record(ctx, name, fn)
    if ctx.stopped then return false, nil end
    local checked, why = LrTasks.pcall(stopReason, ctx)
    if not checked then why = "the selection check raised: " .. tostring(why) end
    if why then
        ctx.stopped = why
        ctx.steps[#ctx.steps + 1] = { step = "stopped_before_" .. name, ok = false, ms = 0, error = why }
        return false, nil
    end
    local t0 = LrDate.currentTime()
    local ok, value = LrTasks.pcall(fn)
    local entry = { step = name, ok = ok, ms = (LrDate.currentTime() - t0) * 1000 }
    if ok then
        local copied, copy = LrTasks.pcall(jsonSafe, value, COPY_DEPTH)
        if copied then entry.result = copy else entry.ok, entry.error = false, "copy failed: " .. tostring(copy) end
    else
        entry.error = tostring(value)
    end
    ctx.steps[#ctx.steps + 1] = entry
    return ok, value
end

-- Polls fn every POLL_SECONDS until it returns a truthy value, `seconds` pass or the probe's deadline
-- does: the value or nil, and the ms waited.
local function waitFor(ctx, seconds, fn)
    local t0 = LrDate.currentTime()
    local limit = math.min(seconds, ctx.deadline - t0)
    while true do
        local ok, v = LrTasks.pcall(fn)
        if ok and v then return v, (LrDate.currentTime() - t0) * 1000 end
        if LrDate.currentTime() - t0 >= limit then return nil, (LrDate.currentTime() - t0) * 1000 end
        LrTasks.sleep(POLL_SECONDS)
    end
end

-- How many entries getAllMasks returns (counted with pairs: its shape is what the probe records).
local function maskCount()
    local all = dc("getAllMasks")
    local n = 0
    if type(all) == "table" then for _ in pairs(all) do n = n + 1 end end
    return n
end

-- Records the mask count until it passes `test` or `seconds` pass.
local function recordCount(ctx, name, seconds, test)
    record(ctx, name, function()
        local n, ms = waitFor(ctx, seconds, function() local c = maskCount(); return test(c) and c end)
        return { reached = n ~= nil, count = n or maskCount(), waited_ms = ms }
    end)
end

function Masks.updateAISettings(payload)
    local tCommand = LrDate.currentTime()
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    if kind(photo, "updateAISettings") ~= "function" then return unavailable("photo:updateAISettings (SDK 13.3)") end
    local t0 = LrDate.currentTime()
    local ok, status = LrTasks.pcall(function()
        return catalog:withWriteAccessDo("AVG update AI masks", function() photo:updateAISettings() end)
    end)
    local t1 = LrDate.currentTime()
    if not ok then return nil, { code = "update_failed", message = tostring(status), recoverable = true } end
    return { uuid = found.uuid, call_ms = (t1 - t0) * 1000, command_ms = (t1 - tCommand) * 1000,
        gate = status ~= nil and tostring(status) or nil }
end

-- Develop, then Masking.
local function openMasking(ctx)
    record(ctx, "module_before", function() return view("getCurrentModuleName") end)
    record(ctx, "switchToModule_develop", function() return view("switchToModule", "develop") end)
    record(ctx, "wait_develop", function()
        local inDevelop, ms = waitFor(ctx, MODULE_WAIT_SECONDS, function() return view("getCurrentModuleName") == "develop" end)
        return { in_develop = inDevelop == true, waited_ms = ms }
    end)
    record(ctx, "getAllMasks_before", function() return dc("getAllMasks") end)
    record(ctx, "getSelectedMask_before", function() return dc("getSelectedMask") end)
    record(ctx, "goToMasking", function() return dc("goToMasking") end)
    LrTasks.sleep(SETTLE_SECONDS)
    record(ctx, "getSelectedTool_after_goToMasking", function() return dc("getSelectedTool") end)
end

-- createNewMask("aiSelection", subtype), a local exposure write before the mask can have computed,
-- the wait for it to show, and its id (the selected mask). Returns the id or nil.
local function createAiMask(ctx, subtype, before)
    record(ctx, "createNewMask_" .. subtype, function() return dc("createNewMask", "aiSelection", subtype) end)
    record(ctx, "setValue_immediate_" .. subtype, function() return dc("setValue", LOCAL_EXPOSURE, 0.5) end)
    record(ctx, "getValue_immediate_" .. subtype, function() return dc("getValue", LOCAL_EXPOSURE) end)
    recordCount(ctx, "wait_mask_" .. subtype, MASK_WAIT_SECONDS, function(c) return c > before end)
    local ok, id = record(ctx, "getSelectedMask_after_" .. subtype, function() return dc("getSelectedMask") end)
    if ok and id ~= nil then return id end
    return nil
end

-- A second local exposure write after a wait, and the photo's settings then (the capture reads the
-- stored value from them).
local function afterWait(ctx, subtype)
    LrTasks.sleep(SETTLE_SECONDS)
    record(ctx, "setValue_after_wait_" .. subtype, function() return dc("setValue", LOCAL_EXPOSURE, 0.75) end)
    record(ctx, "getValue_after_wait_" .. subtype, function() return dc("getValue", LOCAL_EXPOSURE) end)
    record(ctx, "getAllMasks_after_" .. subtype, function() return dc("getAllMasks") end)
    record(ctx, "getDevelopSettings_after_" .. subtype, function()
        local settings
        ctx.catalog:withReadAccessDo(function() settings = ctx.photo:getDevelopSettings() end)
        return settings
    end)
end

-- selectMask and deleteMask with one argument (sky) and with the id twice (subject).
local function selectAndDelete(ctx, skyId, subjectId)
    if ctx.stopped then return end
    if skyId == nil or subjectId == nil then
        ctx.steps[#ctx.steps + 1] = { step = "select_delete_skipped", ok = false, ms = 0, error = "a created mask has no id" }
        return
    end
    record(ctx, "selectMask_1arg_sky", function() return dc("selectMask", skyId) end)
    record(ctx, "getSelectedMask_after_1arg", function() return dc("getSelectedMask") end)
    record(ctx, "selectMask_2arg_subject", function() return dc("selectMask", subjectId, subjectId) end)
    record(ctx, "getSelectedMask_after_2arg", function() return dc("getSelectedMask") end)
    local okCount, n0 = record(ctx, "mask_count_before_delete", maskCount)
    if not okCount then n0 = 0 end
    record(ctx, "deleteMask_1arg_sky", function() return dc("deleteMask", skyId) end)
    recordCount(ctx, "mask_count_after_1arg", DELETE_WAIT_SECONDS, function(c) return c < n0 end)
    record(ctx, "deleteMask_2arg_subject", function() return dc("deleteMask", subjectId, subjectId) end)
    recordCount(ctx, "mask_count_after_2arg", DELETE_WAIT_SECONDS, function(c) return c < n0 - 1 end)
    record(ctx, "getAllMasks_end", function() return dc("getAllMasks") end)
end

function Masks.probeDc(payload)
    if type(payload.target_uuid) ~= "string" or payload.target_uuid == "" then
        return nil, { code = "bad_request", message = "target_uuid must be a non-empty string", recoverable = false }
    end
    if kind(LrDevelopController, "getAllMasks") ~= "function" then return unavailable("LrDevelopController.getAllMasks") end
    local catalog, photo, uuid, err = Develop.target({ target_uuid = payload.target_uuid })
    if err then return nil, err end
    local ctx = { steps = {}, catalog = catalog, photo = photo, uuid = uuid, deadline = LrDate.currentTime() + PROBE_SECONDS }
    openMasking(ctx)
    local okCount, before = record(ctx, "mask_count_before", maskCount)
    if not okCount then before = 0 end
    local skyId = createAiMask(ctx, "sky", before)
    afterWait(ctx, "sky")
    local subjectId = createAiMask(ctx, "subject", before + 1)
    selectAndDelete(ctx, skyId, subjectId)
    local d = Photos.describe(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, steps = ctx.steps, stopped = ctx.stopped }
end

return Masks
