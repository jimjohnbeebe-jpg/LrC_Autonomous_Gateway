-- Bridge command mask_controller (GitHub issue #217 row 3 and Point Color): one mask's local curves and Point Color
-- swatches through LrDevelopController, on the photo open in Develop. Jim's masks:parity run showed neither goes
-- through the mask table: a Point Color swatch written there read back as written but Lightroom did not show it, and
-- a curve dragged by hand changed no curve field in the table [handle: %TEMP%\LrC-AVG\masks-verify\
-- mask_verify_2026-10-28T11-59-26-227Z.json steps point_color (Jim: n) and curve_capture (only CorrectionActive)].
-- Rewritten from upstream's set_mask_curves and edit_mask_point_colors [upstream claim: Automaat/lightroom-mcp 581ad7c
-- (#328), MaskSelection.lua, HandlerMaskCurves.lua, HandlerMaskPointColors.lua at 1040453]. A thin adapter: the
-- parameter names, the swatch fields, the curve points and the limits come from the engine (engine\src\params\
-- mask-controller.ts, rule 03); this file compares whatever it is sent.
--
-- mask_controller { target_uuid, mask_id, curves?, swatches?, read? }:
--   curves   = { { param, points }, ... }: setValue(param, points) for each curve that differs, confirmed by getValue
--              (twice tried), every curve written put back when one fails;
--   swatches = { param, action = "add" | "update" | "delete" | "clear" | "set", index?, swatch?, list?, max? }: one
--              change through the *PointColorSwatch calls with isForMasking true, confirmed by getValue(param); "set"
--              (the engine's undo) clears the swatches and adds `list` back;
--   read     = { param, ... }: values to read too.
--   Answers { uuid, mask_id, before, after (getValue of every param named, before and after), written, index?,
--   settled, ms }. `settled`: the photo's settings changed within SETTLE_SECONDS of the writes (upstream waits for the
--   stored mask to change before it answers [upstream claim: MaskSettle.lua]; whether Lightroom stores a local curve in
--   getDevelopSettings() at all is [unverified]).
-- Refused before anything is written: Lightroom not in Develop (not_in_develop), a selected photo that is not
-- target_uuid's (target_mismatch, Develop.target) or whose AI mask still computes (Pending.lua), no such mask
-- (mask_not_found), a curve whose value before does not read (feature_unavailable: it could not be put back), and a
-- Lightroom without the Point Color calls (Needs.check, SDK 13.2 [handle: D:\Developer\
-- LightRoom Classic Dev Kit\API Reference\modules\LrDevelopController.html, addPointColorSwatch and the four calls
-- beside it, "First supported in version 13.2"]). The mask calls are SDK 11.0 and getValue/setValue 6.0 (same page),
-- below LrSdkMinimumVersion 13.0 (Needs.lua). The reference documents setValue's value as a number; a curve as a flat
-- table of input/output pairs is [upstream claim: MaskCurves.lua], and the local_* names are on the same page
-- ("Localized Adjustments", Version 5 and 6). Selecting a mask and opening Masking are as upstream does them
-- [upstream claim: MaskSelection.lua]; the selected mask and tool are put back after.

local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'

local Catalog = require 'Catalog'
local Develop = require 'Develop'
local DevelopSession = require 'DevelopSession'
local DevelopTools = require 'DevelopTools'
local Log = require 'Log'
local MaskSwatches = require 'MaskSwatches'
local Needs = require 'Needs'

local copy, holds = MaskSwatches.copy, MaskSwatches.holds

local MaskControl = {}

-- Upstream's waits and tolerances [upstream claim: MaskSelection.lua, HandlerMaskCurves.lua, MaskCurves.lua,
-- MaskSettle.lua]; SETTLE_SECONDS is [inference] (upstream: 8).
local LIST_SECONDS, SELECT_SECONDS, RESELECT_SECONDS, SELECTED_SETTLE = 5, 8, 1, 0.3
local CONFIRM_SECONDS, ATTEMPTS, PERSIST_SECONDS, SETTLE_SECONDS = 3, 2, 0.5, 5
local CURVE_TOLERANCE = 1
local REFUSED = MaskSwatches.REFUSED

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function sameCurve(actual, wanted)
    return type(actual) == "table" and #actual == #wanted and holds(actual, wanted, CURVE_TOLERANCE)
end

local function getValue(param)
    local ok, v = LrTasks.pcall(LrDevelopController.getValue, param)
    if ok then return v end
    return nil
end

local function selectedMask()
    local ok, id = LrTasks.pcall(LrDevelopController.getSelectedMask)
    if ok and type(id) == "string" and id ~= "" then return id end
    return nil
end

-- true when getAllMasks lists `id` (each entry's ID is the table's CorrectionID [handle: MaskProbe.lua header]).
local function listed(id)
    local ok, masks = LrTasks.pcall(LrDevelopController.getAllMasks)
    if not ok or type(masks) ~= "table" then return false end
    for _, m in ipairs(masks) do
        if type(m) == "table" and m.ID == id then return true end
    end
    return false
end

-- Opens Masking, selects mask `id` (again each RESELECT_SECONDS until it reads selected), runs body, then puts back
-- the mask and the tool that were selected. Returns body's results.
local function withMask(id, body)
    if not DevelopSession.waitFor(function() return listed(id) end, LIST_SECONDS) then
        return fail("mask_not_found", "Lightroom's Develop module lists no mask with id " .. id .. " on this photo; call lr_list_masks for the current ids")
    end
    local okTool, tool = LrTasks.pcall(LrDevelopController.getSelectedTool)
    if not (okTool and tool == "masking") then LrTasks.pcall(LrDevelopController.goToMasking) end
    local previous = selectedMask()
    local last = -math.huge
    local selected = DevelopSession.waitFor(function()
        if selectedMask() == id then return true end
        if LrDate.currentTime() - last >= RESELECT_SECONDS then
            LrTasks.pcall(LrDevelopController.selectMask, id)
            last = LrDate.currentTime()
        end
        return false
    end, SELECT_SECONDS)
    local ok, result, err
    if selected then
        LrTasks.sleep(SELECTED_SETTLE)
        ok, result, err = LrTasks.pcall(body)
    else
        ok, result, err = true, fail("write_not_taken", "Lightroom did not select mask " .. id .. " in Develop; nothing was written")
    end
    if previous and previous ~= id then LrTasks.pcall(LrDevelopController.selectMask, previous) end
    if okTool and type(tool) == "string" and tool ~= "masking" then LrTasks.pcall(LrDevelopController.selectTool, tool) end
    if not ok then error(result, 0) end
    return result, err
end

local function writeCurve(param, points)
    for _ = 1, ATTEMPTS do
        local ok, err = LrTasks.pcall(LrDevelopController.setValue, param, copy(points))
        if not ok then error("Lightroom refused " .. param .. ": " .. tostring(err), 0) end
        if DevelopSession.waitFor(function() return sameCurve(getValue(param), points) end, CONFIRM_SECONDS) then return true end
    end
    return false
end

-- The parameters the payload names, each a local_* name (no global setting goes through here), or nil plus why not.
local function paramsOf(payload)
    local out, seen = {}, {}
    local function add(p)
        if type(p) ~= "string" or not p:match("^local_%w+$") then return "every param must be a local_* name, got " .. tostring(p) end
        if not seen[p] then seen[p], out[#out + 1] = true, p end
    end
    for _, c in ipairs(type(payload.curves) == "table" and payload.curves or {}) do
        if type(c) ~= "table" or type(c.points) ~= "table" then return nil, "each curve needs param and points" end
        local why = add(c.param)
        if why then return nil, why end
    end
    if payload.swatches ~= nil then
        if type(payload.swatches) ~= "table" then return nil, "swatches must be an object" end
        local why = add(payload.swatches.param)
        if why then return nil, why end
    end
    for _, p in ipairs(type(payload.read) == "table" and payload.read or {}) do
        local why = add(p)
        if why then return nil, why end
    end
    if #out == 0 then return nil, "name at least one curve, swatches or read" end
    return out
end

local function valuesOf(params)
    local out = {}
    for _, p in ipairs(params) do out[p] = getValue(p) end
    return out
end

-- The writes on the selected mask, each confirmed; on a failure every write put back, then the error.
local function apply(payload, params, catalog, photo, uuid)
    local t0 = LrDate.currentTime()
    local mask = payload.mask_id
    local before = valuesOf(params)
    local settingsBefore = Develop.readSettings(catalog, photo)
    local curves = type(payload.curves) == "table" and payload.curves or {}
    local written, swatched, index = {}, false, nil
    -- A curve whose value before does not read could not be put back: refused before anything is written, as upstream
    -- does [upstream claim: HandlerMaskCurves.lua applyToSelectedMask, "cannot be read ... nothing was written"].
    for _, c in ipairs(curves) do
        if type(before[c.param]) ~= "table" then
            return fail("feature_unavailable", "Lightroom gives no " .. c.param .. " for mask " .. mask .. ", so it could not be put back; nothing was written", true)
        end
    end
    local ok, why = LrTasks.pcall(function()
        for _, c in ipairs(curves) do
            if not sameCurve(before[c.param], c.points) then
                written[#written + 1] = c.param -- first, so a half-taken write is put back too
                if not writeCurve(c.param, c.points) then error("Lightroom did not keep the " .. c.param .. " curve", 0) end
            end
        end
        local op = payload.swatches
        if op then
            local list = type(before[op.param]) == "table" and before[op.param] or {}
            index = MaskSwatches.edit(op, list)
            swatched = true
            written[#written + 1] = op.param
        end
        if #written == 0 then return end
        DevelopSession.flush(true)
        LrTasks.sleep(PERSIST_SECONDS)
        for _, c in ipairs(curves) do
            if not sameCurve(getValue(c.param), c.points) then error("Lightroom did not keep the " .. c.param .. " curve", 0) end
        end
        if selectedMask() ~= mask then error("another mask became selected while writing", 0) end
    end)
    if not ok then
        why = tostring(why)
        -- setValue acts on the selected mask: with another one selected, putting back would write onto that mask.
        local onMask = selectedMask() == mask
        for i = onMask and #written or 0, 1, -1 do
            local p = written[i]
            if type(before[p]) == "table" and (not payload.swatches or p ~= payload.swatches.param) then LrTasks.pcall(LrDevelopController.setValue, p, copy(before[p])) end
        end
        if swatched and onMask then
            local param = payload.swatches.param
            local list = type(before[param]) == "table" and before[param] or {}
            LrTasks.pcall(function() MaskSwatches.edit({ param = param, action = "set", list = list }, MaskSwatches.readList(param)) end)
        end
        Log.warn("mask_controller: " .. uuid .. " " .. mask .. ": " .. why)
        local back = #written == 0 and "; nothing was written" or onMask and "; what was written was put back" or "; another mask is selected, so what was written was NOT put back"
        if why:sub(1, #REFUSED) == REFUSED then return fail("invalid_arguments", why:sub(#REFUSED + 1) .. back) end
        return fail("write_not_taken", why .. back)
    end
    local settled = #written > 0 and DevelopSession.waitFor(function()
        return not DevelopTools.same(settingsBefore, Develop.readSettings(catalog, photo))
    end, SETTLE_SECONDS)
    Log.info(string.format("mask_controller: %s %s, %d written", uuid, mask, #written))
    return { uuid = uuid, mask_id = mask, before = before, after = valuesOf(params), written = written, index = index,
        settled = settled == true, ms = math.floor((LrDate.currentTime() - t0) * 1000) }
end

function MaskControl.run(payload)
    if type(payload.target_uuid) ~= "string" or payload.target_uuid == "" then return fail("bad_request", "target_uuid must name the photo open in Develop") end
    if type(payload.mask_id) ~= "string" or payload.mask_id == "" then return fail("bad_request", "mask_id must name the mask") end
    local params, problem = paramsOf(payload)
    if not params then return fail("bad_request", problem) end
    if payload.swatches then
        local present, unavailable = Needs.check("Mask Point Color", "13.2", "LrDevelopController.", LrDevelopController, { "getSelectedPointColorSwatchIndex", "selectPointColorSwatch", "addPointColorSwatch", "updateSelectedPointColorSwatch", "deletePointColorSwatch" })
        if not present then return nil, unavailable end
    end
    local okModule, module = LrTasks.pcall(LrApplicationView.getCurrentModuleName)
    if not (okModule and module == "develop") then
        return fail("not_in_develop", "Mask curves and Point Color work on the photo open in Lightroom's Develop module, and Lightroom shows " .. tostring(module) .. ": press D in Lightroom, then try again", true)
    end
    -- Under the selection lock, so no other command changes the selection between this check and the writes (a virtual
    -- copy starts with its master's masks, ids included [inference: LR_SDK_NOTES "Recorded in Phase 4", each copy
    -- started with the master's develop settings, 0 differing], so getAllMasks alone would not catch the switch).
    return Catalog.exclusive("mask_controller", function()
        local catalog, photo, uuid, err = Develop.writeTarget({ target_uuid = payload.target_uuid })
        if err then return nil, err end
        return withMask(payload.mask_id, function() return apply(payload, params, catalog, photo, uuid) end)
    end)
end

return MaskControl
