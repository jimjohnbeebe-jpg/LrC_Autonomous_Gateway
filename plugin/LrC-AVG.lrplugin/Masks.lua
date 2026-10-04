-- Bridge commands for AI masks (GitHub issue #59, plugin 0.11.0). The engine writes masks as the
-- MaskGroupBasedCorrections table with apply_settings (Develop.lua); an AI mask written that way
-- computes after update_ai_settings, and when it does not, the engine falls back to
-- create_ai_mask_dc. No mask field name is written here (rule 03: key names come from a live
-- getDevelopSettings() dump; the engine's params\mask-table.ts holds them). Each handler runs in its
-- own task (Dispatch.lua) and returns a result table, or nil plus an error table
-- { code, message, recoverable } (PRD NFR-7). An SDK call this Lightroom lacks answers
-- feature_unavailable; nothing here raises on purpose. The masks captures' probe commands
-- (probe_masks_dc, probe_masks_calibrate, probe_masks_create) stay in git history (PR C step 1).
--
-- update_ai_settings { photo_uuid, expect? }: photo:updateAISettings() on the photo found by uuid
--   (Photos.lua), in its own write gate. The SDK reference: "Updates AI Settings for this photo. Must
--   be called from within a catalog:withWriteAccessDo or catalog:withProlongedWriteAccessDo gate.
--   First supported in version 13.3" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read
--   2026-10-03]. It worked for this plugin, which declares LrSdkVersion 13.0, on LrC 15.6: an AI mask
--   added as a table entry computed after it, and Jim saw it cover the sky [handle: Jim's capture 1
--   run, 2026-10-03, docs\reports\phase6\masks-capture\check.json step 7_sky and answers]. Waiting for
--   the mask to compute is the engine's job, by reading get_settings.
-- create_ai_mask_dc { target_uuid, subtype, wait_seconds? }: LrDevelopController on the selected photo
--   (MaskProbe.lua says how it is pinned to the target and bounded): Develop, Masking, then
--   createNewMask("aiSelection", subtype), and the mask ids getAllMasks lists that were not there
--   before it, waited for up to wait_seconds. In capture 1 and 2 a new mask showed after 0.9 s
--   (subject), 2.5 s (sky) and 4.0 s (background), and getAllMasks' ID is the table's CorrectionID
--   [handle: docs\reports\phase6\masks-capture\12_probe_dc.json wait_mask_sky, wait_mask_subject,
--   getAllMasks_after_sky; capture2-templates.json wait_mask_background]. It runs outside any write
--   gate (a gate around createNewMask reportedly rolls it back [community: issue #59 research]), so
--   the History step it makes carries Lightroom's own name [stated: Jim, 2026-10-03, "Accept for
--   fallback (Recommended)"]; what that name is [unverified]. selectTool("loupe") at the end did not
--   leave Masking in capture 2 [handle: capture2-templates.json getSelectedTool_end "masking"].

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local MaskProbe = require 'MaskProbe'
local Photos = require 'Photos'

local Masks = {}

local record, dc = MaskProbe.record, MaskProbe.dc
-- The "aiSelection" subtypes this route made in the captures (people and landscape made no mask in
-- capture 2 [handle: docs\reports\phase6\masks-capture\capture2-transcript.txt]); the names are the SDK
-- reference's [handle: https://lrc.mcor.dev/modules/LrDevelopController.html createNewMask, read 2026-10-03].
local SUBTYPES = { subject = true, sky = true, background = true }
local DEFAULT_WAIT_SECONDS = 12
-- The whole command's bound: opening Masking (up to ~7 s, MaskProbe.lua) shares it with the wait.
-- The engine waits 25 s for the answer (engine\src\session\ai-masks.ts), so this stops first.
local COMMAND_SECONDS = 15

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

-- The ids getAllMasks lists now, as a set.
local function ids()
    local all, set = dc("getAllMasks"), {}
    if type(all) == "table" then
        for _, m in pairs(all) do
            if type(m) == "table" and m.ID ~= nil then set[m.ID] = true end
        end
    end
    return set
end

function Masks.createAiMaskDc(payload)
    local subtype = payload.subtype
    if type(subtype) ~= "string" or not SUBTYPES[subtype] then
        return nil, { code = "bad_request", message = "subtype must be one of subject, sky, background", recoverable = false }
    end
    local wait = payload.wait_seconds or DEFAULT_WAIT_SECONDS
    if type(wait) ~= "number" or wait < 1 or wait > 15 then
        return nil, { code = "bad_request", message = "wait_seconds must be 1-15", recoverable = false }
    end
    local ctx, err = MaskProbe.begin(payload, COMMAND_SECONDS)
    if not ctx then return nil, err end
    MaskProbe.openMasking(ctx)
    local okIds, old = record(ctx, "mask_ids_before", ids)
    if not okIds or type(old) ~= "table" then old = {} end
    record(ctx, "createNewMask_" .. subtype, function() return dc("createNewMask", "aiSelection", subtype) end)
    local fresh, waited = {}, 0
    record(ctx, "wait_new_mask", function()
        local found, ms = MaskProbe.waitFor(ctx, wait, function()
            local now = {}
            for id in pairs(ids()) do
                if not old[id] then now[#now + 1] = id end
            end
            return #now > 0 and now
        end)
        fresh, waited = found or {}, ms
        return { found = found ~= nil, waited_ms = ms }
    end)
    return MaskProbe.finish(ctx, { new_ids = fresh, waited_ms = waited })
end

return Masks
