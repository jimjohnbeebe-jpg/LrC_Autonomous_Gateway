-- Bridge commands for masks capture 2 (GitHub issue #59, PR C step 1, plugin 0.11.0): the scale of
-- every local slider, and the table entries Lightroom makes for AI masks the engine cannot write by
-- hand yet. Like Masks.lua they record what the SDK gives and interpret nothing; the capture script
-- writes the values and does the arithmetic. Both are probes: pinned to target_uuid, re-checked
-- before every step, bounded by their own deadline, outside any write gate (MaskProbe.lua).
--
-- probe_masks_calibrate { target_uuid, mask_id, mask_name?, names }: selects the mask with mask_id in
--   Masking and reads LrDevelopController getValue and getRange for each name in `names` (local
--   parameter names such as "local_Contrast", which the script takes from the SDK reference and
--   tries in variants [handle: https://lrc.mcor.dev/modules/LrDevelopController.html, read
--   2026-10-03, a third-party mirror of Adobe's reference]; which of them answer is what this asks
--   [unverified]). The DC mask id is the table's CorrectionID, and getAllMasks entries carry Name and
--   ID (MaskProbe.lua header has the handle). If selecting by id does not take, the mask is looked up
--   by Name. If no mask ends up selected, no value is read: another mask's values would mislead. After
--   the selection it waits a second before reading, so the panel can follow [inference].
-- probe_masks_create { target_uuid, subtypes, wait_seconds? }: createNewMask("aiSelection", subtype)
--   for each subtype, waiting up to wait_seconds (default 10) for a mask to show in getAllMasks, and
--   records the ids that are new since just before that create (`new_masks_<subtype>`), so a subtype
--   that made no mask is never credited with another's. The masks stay: the script reads the table,
--   then puts the photo back with a snapshot. The subtypes the SDK reference lists are "color",
--   "luminance", "depth", "subject", "sky", "background", "objects", "people", "landscape" [handle:
--   https://lrc.mcor.dev/modules/LrDevelopController.html createNewMask, read 2026-10-03, a
--   third-party mirror of Adobe's reference].

local LrTasks = import 'LrTasks'

local MaskProbe = require 'MaskProbe'

local MaskCalibrate = {}

local record, dc = MaskProbe.record, MaskProbe.dc
local LIST_WAIT_SECONDS = 5
local SELECT_WAIT_SECONDS = 3
local MAX_NAMES = 80
local MAX_SUBTYPES = 8

local function badRequest(message)
    return nil, { code = "bad_request", message = message, recoverable = false }
end

-- A list of 1..max non-empty strings, or nil.
local function strings(list, max)
    if type(list) ~= "table" or #list < 1 or #list > max then return nil end
    for _, s in ipairs(list) do
        if type(s) ~= "string" or s == "" then return nil end
    end
    return list
end

-- The entry of getAllMasks whose `field` equals value, or nil.
local function listed(field, value)
    local all = dc("getAllMasks")
    if type(all) ~= "table" then return nil end
    for _, m in pairs(all) do
        if type(m) == "table" and m[field] == value then return m end
    end
    return nil
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

-- Selects `id`, else the mask called `name`; returns the id now selected, or nil.
local function selectTarget(ctx, id, name)
    record(ctx, "wait_mask_listed", function()
        local m, ms = MaskProbe.waitFor(ctx, LIST_WAIT_SECONDS, function() return listed("ID", id) end)
        return { listed = m ~= nil, waited_ms = ms }
    end)
    local tries = { { "by_id", function() return id end } }
    if name then tries[2] = { "by_name", function() local m = listed("Name", name); return m and m.ID end } end
    for _, try in ipairs(tries) do
        local okId, target = record(ctx, "find_" .. try[1], try[2])
        if okId and target ~= nil then
            record(ctx, "selectMask_" .. try[1], function() return dc("selectMask", target) end)
            local okSel, sel = record(ctx, "getSelectedMask_" .. try[1], function()
                return MaskProbe.waitFor(ctx, SELECT_WAIT_SECONDS, function() return dc("getSelectedMask") == target and target end)
            end)
            if okSel and sel == target then return target end
        end
    end
    return nil
end

function MaskCalibrate.calibrate(payload)
    local names = strings(payload.names, MAX_NAMES)
    if not names then return badRequest("names must be 1-" .. MAX_NAMES .. " non-empty strings") end
    if type(payload.mask_id) ~= "string" or payload.mask_id == "" then return badRequest("mask_id must be a non-empty string") end
    if payload.mask_name ~= nil and type(payload.mask_name) ~= "string" then return badRequest("mask_name must be a string") end
    -- Its waits add up to about 19 s at most (Develop 5, settle 2, listed 5, two selections 3 each,
    -- the pause 1), plus two quick calls per name [inference]; the script waits 75 s.
    local ctx, err = MaskProbe.begin(payload, 45)
    if not ctx then return nil, err end
    MaskProbe.openMasking(ctx)
    local selected = selectTarget(ctx, payload.mask_id, payload.mask_name)
    if selected == nil then
        if not ctx.stopped then ctx.steps[#ctx.steps + 1] = { step = "values_skipped", ok = false, ms = 0, error = "the mask could not be selected" } end
        return MaskProbe.finish(ctx)
    end
    LrTasks.sleep(1)
    for _, name in ipairs(names) do
        record(ctx, "getValue_" .. name, function() return dc("getValue", name) end)
        record(ctx, "getRange_" .. name, function() return { dc("getRange", name) } end)
    end
    return MaskProbe.finish(ctx, { selected = selected })
end

function MaskCalibrate.create(payload)
    local subtypes = strings(payload.subtypes, MAX_SUBTYPES)
    if not subtypes then return badRequest("subtypes must be 1-" .. MAX_SUBTYPES .. " non-empty strings") end
    local wait = payload.wait_seconds or 10
    if type(wait) ~= "number" or wait < 1 or wait > 15 then return badRequest("wait_seconds must be 1-15") end
    -- Opening Masking (up to ~7 s) plus each mask's wait and a few quick calls [inference]; the script
    -- waits this plus 30 s.
    local ctx, err = MaskProbe.begin(payload, 10 + #subtypes * (wait + 2))
    if not ctx then return nil, err end
    MaskProbe.openMasking(ctx)
    for _, subtype in ipairs(subtypes) do
        local okCount, before = record(ctx, "mask_count_before_" .. subtype, MaskProbe.maskCount)
        if not okCount then before = 0 end
        local okIds, old = record(ctx, "mask_ids_before_" .. subtype, ids)
        record(ctx, "createNewMask_" .. subtype, function() return dc("createNewMask", "aiSelection", subtype) end)
        MaskProbe.recordCount(ctx, "wait_mask_" .. subtype, wait, function(c) return c > before end)
        record(ctx, "new_masks_" .. subtype, function()
            local fresh = {}
            for id in pairs(ids()) do
                if not (okIds and old[id]) then fresh[#fresh + 1] = id end
            end
            return fresh
        end)
        record(ctx, "getSelectedMask_after_" .. subtype, function() return dc("getSelectedMask") end)
        record(ctx, "getSelectedTool_after_" .. subtype, function() return dc("getSelectedTool") end)
    end
    record(ctx, "getAllMasks_end", function() return dc("getAllMasks") end)
    return MaskProbe.finish(ctx)
end

return MaskCalibrate
