-- The LrDevelopController parts of Masks.lua's create_ai_mask_dc (GitHub issue #59), first written for
-- the masks captures' probes (their commands stay in git history, PR C step 1).
--
-- A probe works on the selected photo, which must be the photo with target_uuid (else
-- target_mismatch, as Develop.lua target() refuses), and outside any write gate (a gate around
-- createNewMask reportedly rolls it back [community: issue #59 research]). LrDevelopController acts
-- on the current photo, not on a photo object, so before every step the probe checks that the
-- selected photo is still the target, and that its own deadline has not passed; if either fails it
-- records why (`stopped`) and runs no further step. So a probe the engine gave up on stops by itself.
-- Every step is recorded as { step, ok, result | error, ms }, the result copied so Json.lua can
-- encode it. The function names and their "Must be called while the Develop module is active"
-- rules are from the SDK reference [handle: https://lrc.mcor.dev/modules/LrDevelopController.html,
-- read 2026-10-03, a third-party mirror of Adobe's reference; LrApplicationView.html for
-- switchToModule and getCurrentModuleName]. getAllMasks entries carry Name and ID, the ID being the
-- table's CorrectionID, and each entry's Tools carry the MaskID [handle: Jim's capture 1 run,
-- docs\reports\phase6\masks-capture\12_probe_dc.json, getAllMasks_after_sky (8E077BDB…, tool
-- 2DB0B254…) against getDevelopSettings_after_sky]. A method is
-- looked up with type(obj[name]) inside LrTasks.pcall, as spike S7 did; it saw "function" for methods
-- that exist [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json removal_probe.photo.controls].

local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local Photos = require 'Photos'

local MaskProbe = {}

local POLL_SECONDS = 0.25
local MODULE_WAIT_SECONDS = 5
MaskProbe.SETTLE_SECONDS = 2
local COPY_DEPTH = 8

function MaskProbe.unavailable(what)
    return nil, { code = "feature_unavailable", recoverable = true,
        message = what .. " is not available in this Lightroom (or not to this plugin)" }
end

-- type(obj[name]), or nil when the lookup raises.
function MaskProbe.kind(obj, name)
    local ok, t = LrTasks.pcall(function() return type(obj[name]) end)
    return ok and t or nil
end

-- obj[name](...), or an error naming the missing call (record() below turns it into ok = false).
local function call(obj, label, name, ...)
    if MaskProbe.kind(obj, name) ~= "function" then error(label .. "." .. name .. " is not available", 0) end
    return obj[name](...)
end
function MaskProbe.dc(name, ...) return call(LrDevelopController, "LrDevelopController", name, ...) end
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

-- A probe's context, after checking target_uuid and that this Lightroom has LrDevelopController's
-- mask calls; or nil plus an error. `seconds` is the probe's deadline.
function MaskProbe.begin(payload, seconds)
    if type(payload.target_uuid) ~= "string" or payload.target_uuid == "" then
        return nil, { code = "bad_request", message = "target_uuid must be a non-empty string", recoverable = false }
    end
    if MaskProbe.kind(LrDevelopController, "getAllMasks") ~= "function" then
        return MaskProbe.unavailable("LrDevelopController.getAllMasks")
    end
    local catalog, photo, uuid, err = Develop.target({ target_uuid = payload.target_uuid })
    if err then return nil, err end
    return { steps = {}, catalog = catalog, photo = photo, uuid = uuid, seconds = seconds,
        deadline = LrDate.currentTime() + seconds }
end

-- Why the probe must stop now, or nil: its deadline passed, or the selected photo is not the target.
local function stopReason(ctx)
    if LrDate.currentTime() > ctx.deadline then return "the probe's " .. ctx.seconds .. " s deadline passed" end
    local _, _, _, err = Develop.target({ target_uuid = ctx.uuid })
    if err then return tostring(err.code) .. ": " .. tostring(err.message) end
    return nil
end

-- Runs fn and appends { step, ok, result | error, ms } to ctx.steps, unless the probe has stopped or
-- must stop now (then it records why, once). Returns ok and fn's raw value.
function MaskProbe.record(ctx, name, fn)
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
function MaskProbe.waitFor(ctx, seconds, fn)
    local t0 = LrDate.currentTime()
    local limit = math.min(seconds, ctx.deadline - t0)
    while true do
        local ok, v = LrTasks.pcall(fn)
        if ok and v then return v, (LrDate.currentTime() - t0) * 1000 end
        if LrDate.currentTime() - t0 >= limit then return nil, (LrDate.currentTime() - t0) * 1000 end
        LrTasks.sleep(POLL_SECONDS)
    end
end

-- Develop, then Masking.
function MaskProbe.openMasking(ctx)
    local record, dc = MaskProbe.record, MaskProbe.dc
    record(ctx, "module_before", function() return view("getCurrentModuleName") end)
    record(ctx, "switchToModule_develop", function() return view("switchToModule", "develop") end)
    record(ctx, "wait_develop", function()
        local inDevelop, ms = MaskProbe.waitFor(ctx, MODULE_WAIT_SECONDS, function() return view("getCurrentModuleName") == "develop" end)
        return { in_develop = inDevelop == true, waited_ms = ms }
    end)
    record(ctx, "getAllMasks_before", function() return dc("getAllMasks") end)
    record(ctx, "getSelectedMask_before", function() return dc("getSelectedMask") end)
    -- goToMasking only when Masking is not open: capture 1 called it only that way [handle: Jim's
    -- capture 1 run, docs\reports\phase6\masks-capture\12_probe_dc.json, goToMasking then
    -- getSelectedTool "masking"]; what it does with Masking already open is [unverified].
    local okTool, tool = record(ctx, "getSelectedTool_before", function() return dc("getSelectedTool") end)
    if not (okTool and tool == "masking") then
        record(ctx, "goToMasking", function() return dc("goToMasking") end)
        LrTasks.sleep(MaskProbe.SETTLE_SECONDS)
    end
    record(ctx, "getSelectedTool_after_goToMasking", function() return dc("getSelectedTool") end)
end

-- Back to the loupe, so a probe does not leave Lightroom in a mask tool. selectTool takes "one
-- of: 'loupe', 'crop', ... 'masking', ..." [handle: https://lrc.mcor.dev/modules/LrDevelopController.html
-- selectTool, read 2026-10-03; a third-party mirror of Adobe's reference]. It does not close Masking:
-- capture 2 read getSelectedTool_end "masking" after it [handle:
-- docs\reports\phase6\masks-capture\capture2-templates.json]. Skipped once a probe has stopped (the
-- photo may no longer be the target).
local function leaveMasking(ctx)
    MaskProbe.record(ctx, "selectTool_loupe", function() return MaskProbe.dc("selectTool", "loupe") end)
    MaskProbe.record(ctx, "getSelectedTool_end", function() return MaskProbe.dc("getSelectedTool") end)
end

-- The result every probe answers with, after leaving Masking; `extra` fields are added to it.
function MaskProbe.finish(ctx, extra)
    leaveMasking(ctx)
    local d = Photos.describe(ctx.catalog, ctx.photo)
    local out = { uuid = d.uuid, filename = d.filename, steps = ctx.steps, stopped = ctx.stopped }
    for k, v in pairs(extra or {}) do out[k] = v end
    return out
end

return MaskProbe
