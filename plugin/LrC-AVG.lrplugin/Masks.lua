-- Bridge commands for the masks capture (GitHub issue #59, PR C step 1, plugin 0.11.0). They exist
-- to learn how Lightroom stores and changes masks before any mask tool is built, so they record what
-- the SDK gives and interpret nothing; no mask field name is written here (rule 03: key names come
-- from a live getDevelopSettings() dump, which the capture takes with get_settings). Each handler runs
-- in its own task (Dispatch.lua) and returns a result table, or nil plus an error table
-- { code, message, recoverable } (PRD NFR-7). An SDK call this Lightroom lacks answers
-- feature_unavailable; nothing here raises on purpose. Capture 2's commands are in MaskCalibrate.lua;
-- the probes' shared parts (target and deadline checks, step records) in MaskProbe.lua.
--
-- update_ai_settings { photo_uuid, expect? }: photo:updateAISettings() on the photo found by uuid
--   (Photos.lua), in its own write gate. The SDK reference: "Updates AI Settings for this photo. Must
--   be called from within a catalog:withWriteAccessDo or catalog:withProlongedWriteAccessDo gate.
--   First supported in version 13.3" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read
--   2026-10-03]. It worked for this plugin, which declares LrSdkVersion 13.0, on LrC 15.6: an AI mask
--   added as a table entry computed after it, and Jim saw it cover the sky [handle: Jim's capture 1
--   run, 2026-10-03, docs\reports\phase6\masks-capture\check.json step 7_sky and answers]. Waiting for the mask to
--   compute is the capture script's job, by reading get_settings, so no field name is needed here.
-- probe_masks_dc { target_uuid }: LrDevelopController on the selected photo (MaskProbe.lua says how
--   it is pinned to the target and bounded). Switches to Develop, opens Masking, creates an AI sky
--   mask and an AI subject mask, sets local exposure right away and again after a wait, selects each
--   mask by id with one argument and with two, and deletes them. The parameter name "local_Exposure"
--   is from the SDK reference [handle: https://lrc.mcor.dev/modules/LrDevelopController.html, read
--   2026-10-03]. selectMask and deleteMask are listed as (id, param) with one description; a
--   third-party plugin passes the id twice [community: issue #59 research], so both are tried.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local MaskProbe = require 'MaskProbe'
local Photos = require 'Photos'

local Masks = {}

local record, dc = MaskProbe.record, MaskProbe.dc
-- How long a new AI mask may take to show in getAllMasks. The research reports ~0.6 s to compute
-- [community: issue #59 research, one non-raw photo]; 10 s is a generous bound [inference].
local MASK_WAIT_SECONDS = 10
local DELETE_WAIT_SECONDS = 3
-- The whole probe's bound: its waits add up to about 37 s at most [inference: the waits above]. The
-- capture script waits 90 s for the answer, so the probe stops before the engine gives up.
local PROBE_SECONDS = 60
local LOCAL_EXPOSURE = "local_Exposure"

function Masks.updateAISettings(payload)
    local tCommand = LrDate.currentTime()
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    if MaskProbe.kind(photo, "updateAISettings") ~= "function" then return MaskProbe.unavailable("photo:updateAISettings (SDK 13.3)") end
    local t0 = LrDate.currentTime()
    local ok, status = LrTasks.pcall(function()
        return catalog:withWriteAccessDo("AVG update AI masks", function() photo:updateAISettings() end)
    end)
    local t1 = LrDate.currentTime()
    if not ok then return nil, { code = "update_failed", message = tostring(status), recoverable = true } end
    return { uuid = found.uuid, call_ms = (t1 - t0) * 1000, command_ms = (t1 - tCommand) * 1000,
        gate = status ~= nil and tostring(status) or nil }
end

-- createNewMask("aiSelection", subtype), a local exposure write before the mask can have computed,
-- the wait for it to show, and its id (the selected mask). Returns the id or nil.
local function createAiMask(ctx, subtype, before)
    record(ctx, "createNewMask_" .. subtype, function() return dc("createNewMask", "aiSelection", subtype) end)
    record(ctx, "setValue_immediate_" .. subtype, function() return dc("setValue", LOCAL_EXPOSURE, 0.5) end)
    record(ctx, "getValue_immediate_" .. subtype, function() return dc("getValue", LOCAL_EXPOSURE) end)
    MaskProbe.recordCount(ctx, "wait_mask_" .. subtype, MASK_WAIT_SECONDS, function(c) return c > before end)
    local ok, id = record(ctx, "getSelectedMask_after_" .. subtype, function() return dc("getSelectedMask") end)
    if ok and id ~= nil then return id end
    return nil
end

-- A second local exposure write after a wait, and the photo's settings then (the capture reads the
-- stored value from them).
local function afterWait(ctx, subtype)
    LrTasks.sleep(MaskProbe.SETTLE_SECONDS)
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
    local okCount, n0 = record(ctx, "mask_count_before_delete", MaskProbe.maskCount)
    if not okCount then n0 = 0 end
    record(ctx, "deleteMask_1arg_sky", function() return dc("deleteMask", skyId) end)
    MaskProbe.recordCount(ctx, "mask_count_after_1arg", DELETE_WAIT_SECONDS, function(c) return c < n0 end)
    record(ctx, "deleteMask_2arg_subject", function() return dc("deleteMask", subjectId, subjectId) end)
    MaskProbe.recordCount(ctx, "mask_count_after_2arg", DELETE_WAIT_SECONDS, function(c) return c < n0 - 1 end)
    record(ctx, "getAllMasks_end", function() return dc("getAllMasks") end)
end

function Masks.probeDc(payload)
    local ctx, err = MaskProbe.begin(payload, PROBE_SECONDS)
    if not ctx then return nil, err end
    MaskProbe.openMasking(ctx)
    local okCount, before = record(ctx, "mask_count_before", MaskProbe.maskCount)
    if not okCount then before = 0 end
    local skyId = createAiMask(ctx, "sky", before)
    afterWait(ctx, "sky")
    local subjectId = createAiMask(ctx, "subject", before + 1)
    selectAndDelete(ctx, skyId, subjectId)
    return MaskProbe.finish(ctx)
end

return Masks
