-- The Point Color half of mask_controller (MaskControl.lua, GitHub issue #217): one change to the selected mask's
-- swatches through LrDevelopController's *PointColorSwatch calls with isForMasking true, each confirmed by
-- getValue(param), the param and the swatch fields as the engine sends them (engine\src\params\mask-controller.ts,
-- rule 03). Rewritten from upstream's edit_mask_point_colors [upstream claim: Automaat/lightroom-mcp 581ad7c (#328),
-- HandlerMaskPointColors.lua and MaskPointColors.lua at 1040453]; the calls, their arguments and return values are
-- [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrDevelopController.html, SDK 13.2]. Also the
-- shared copy and holds of MaskControl.lua. `guard` (MaskControl.lua) runs before every swatch call: it puts the
-- photo and mask back in front or raises, so no call lands on a mask the user clicked meanwhile (Greptile on PR #248).

local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'

local DevelopSession = require 'DevelopSession'

local MaskSwatches = {}

-- Upstream's waits and tolerance [upstream claim: HandlerMaskPointColors.lua, MaskPointColors.lua VALUE_TOLERANCE].
local CONFIRM_SECONDS, ATTEMPTS, RESELECT_SECONDS = 3, 2, 1
local SWATCH_TOLERANCE = 0.01
local FOR_MASKING = true
-- An error() text with this prefix is a refusal before anything was written (invalid_arguments), not a write that failed.
MaskSwatches.REFUSED = "refused: "
local REFUSED = MaskSwatches.REFUSED

local function copy(v)
    if type(v) ~= "table" then return v end
    local out = {}
    for k, x in pairs(v) do out[k] = copy(x) end
    return out
end

-- Every number in `wanted` (tables walked by key) within `tol` of `actual`'s; other values equal.
local function holds(actual, wanted, tol)
    if type(wanted) == "number" then return type(actual) == "number" and math.abs(actual - wanted) <= tol end
    if type(wanted) ~= "table" then return actual == wanted end
    if type(actual) ~= "table" then return false end
    for k, x in pairs(wanted) do
        if not holds(actual[k], x, tol) then return false end
    end
    return true
end

-- The same list (or value), both ways, within SWATCH_TOLERANCE.
function MaskSwatches.same(a, b)
    if type(a) == "table" and type(b) == "table" then return #a == #b and holds(a, b, SWATCH_TOLERANCE) and holds(b, a, SWATCH_TOLERANCE) end
    return holds(a, b, SWATCH_TOLERANCE)
end

function MaskSwatches.readList(param)
    local ok, v = LrTasks.pcall(LrDevelopController.getValue, param)
    if not ok then error("Lightroom could not read " .. param .. ": " .. tostring(v), 0) end
    return type(v) == "table" and v or {}
end

-- Polls `param`'s list until test(list) holds or CONFIRM_SECONDS pass: whether it held, and the last list read.
local function waitList(param, test)
    local list
    local held = DevelopSession.waitFor(function() list = MaskSwatches.readList(param); return test(list) end, CONFIRM_SECONDS)
    return held, list
end

-- A swatch call whose first result must be true ("returns true if ... successfully" [handle: LrDevelopController.html]).
local function call(label, name, ...)
    local called, ok, msg = LrTasks.pcall(LrDevelopController[name], ...)
    if not called then error("Lightroom raised on " .. label .. ": " .. tostring(ok), 0) end
    if ok ~= true then error("Lightroom refused " .. label .. ": " .. tostring(msg or "no reason given"), 0) end
end

-- The index of the swatch `after` gained over `before`: the first that does not hold its old entry.
local function newIndex(before, after)
    for i = 1, #after do
        if before[i] == nil or not holds(after[i], before[i], SWATCH_TOLERANCE) then return i end
    end
    return #after
end

local function addSwatch(param, before, swatch, guard)
    guard()
    call("the new Point Color swatch", "addPointColorSwatch", copy(swatch), FOR_MASKING)
    -- "If given color swatch is already present but not selected, then the existing swatch would get selected and no
    -- error message is returned" [handle: LrDevelopController.html addPointColorSwatch].
    local grew, after = waitList(param, function(l) return #l == #before + 1 end)
    if not grew then error("Lightroom added no swatch (a swatch of that source colour may be there already: Lightroom then selects it and adds none)", 0) end
    local at = newIndex(before, after)
    if not holds(after[at], swatch, SWATCH_TOLERANCE) then
        LrTasks.pcall(function() guard(); LrDevelopController.deletePointColorSwatch(false, at, FOR_MASKING) end)
        error("Lightroom did not keep the new swatch's values; the swatch was deleted again", 0)
    end
    return at
end

local function selectSwatch(at)
    local last = -math.huge
    return DevelopSession.waitFor(function()
        local ok, i = LrTasks.pcall(LrDevelopController.getSelectedPointColorSwatchIndex, FOR_MASKING)
        if ok and i == at then return true end
        if LrDate.currentTime() - last >= RESELECT_SECONDS then
            LrTasks.pcall(LrDevelopController.selectPointColorSwatch, at, FOR_MASKING)
            last = LrDate.currentTime()
        end
        return false
    end, CONFIRM_SECONDS)
end

-- updateSelectedPointColorSwatch takes the stored swatch table with fields changed [handle: LrDevelopController.html
-- updateSelectedPointColorSwatch]; `patch` replaces whole fields (a range is one field).
-- The swatch is selected after guard(), which may select the mask again (and with it, maybe, another swatch).
local function updateSwatch(param, before, at, patch, guard)
    local merged = copy(before[at])
    for k, v in pairs(patch) do merged[k] = copy(v) end
    for _ = 1, ATTEMPTS do
        guard()
        if not selectSwatch(at) then error("Lightroom did not select Point Color swatch " .. at, 0) end
        call("the swatch update", "updateSelectedPointColorSwatch", copy(merged), FOR_MASKING)
        if waitList(param, function(l) return #l == #before and holds(l[at], merged, SWATCH_TOLERANCE) end) then return at end
    end
    LrTasks.pcall(function()
        guard()
        if selectSwatch(at) then LrDevelopController.updateSelectedPointColorSwatch(copy(before[at]), FOR_MASKING) end
    end)
    error("Lightroom did not keep the update of swatch " .. at .. "; its values were put back", 0)
end

local function clearSwatches(param, before, guard)
    if #before == 0 then return end
    guard()
    call("clearing the swatches", "deletePointColorSwatch", true, 1, FOR_MASKING)
    if not waitList(param, function(l) return #l == 0 end) then error("Lightroom did not clear the Point Color swatches", 0) end
end

-- One change to the mask's swatches; the index it touched, or nil.
function MaskSwatches.edit(op, before, guard)
    local action, at = op.action, op.index
    if (action == "update" or action == "delete") and (type(at) ~= "number" or before[at] == nil) then
        error(REFUSED .. "this mask has " .. #before .. " Point Color swatches; there is no swatch " .. tostring(at), 0)
    end
    if action == "add" then
        if type(op.max) == "number" and #before >= op.max then error(REFUSED .. "this mask already has " .. #before .. " Point Color swatches, the most a mask holds", 0) end
        return addSwatch(op.param, before, op.swatch, guard)
    elseif action == "update" then
        return updateSwatch(op.param, before, at, op.swatch, guard)
    elseif action == "delete" then
        guard()
        call("the swatch deletion", "deletePointColorSwatch", false, at, FOR_MASKING)
        if not waitList(op.param, function(l) return #l == #before - 1 end) then error("Lightroom did not delete swatch " .. at, 0) end
        return at
    elseif action == "clear" then
        clearSwatches(op.param, before, guard)
    elseif action == "set" then
        clearSwatches(op.param, before, guard)
        local now = {}
        for _, swatch in ipairs(op.list or {}) do
            addSwatch(op.param, now, swatch, guard)
            now = MaskSwatches.readList(op.param)
        end
    else
        error(REFUSED .. "swatches.action must be add, update, delete, clear or set", 0)
    end
    return nil
end

MaskSwatches.copy, MaskSwatches.holds = copy, holds

return MaskSwatches
