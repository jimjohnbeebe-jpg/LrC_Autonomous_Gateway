-- Bridge command apply_denoise { photo_uuid, amount, snapshot_name } (issue #190, the port of Automaat PR #288):
-- Lightroom's AI Denoise on one photo. Denoise is not a develop key applyDevelopSettings can write: Lightroom
-- keeps it as an "Enhance" filter in FilterList, with data computed for that one image, and LrC 15 drives it
-- through the Develop panel's own calls, LrDevelopController.setEnhance("denoise", true, amount) and
-- changeDenoiseAmount, which act on the photo active in Develop [upstream claim: Automaat PR #288,
-- HandlerDevelop.lua]. So this command, under the selection lock (Catalog.exclusive):
--   1. checks the Enhance calls exist, through Needs.lua (feature_unavailable otherwise; nothing changed);
--   2. notes the module, the sources and the selection, switches to Develop and selects the photo alone
--      (through All Photographs when it is outside the current source);
--   3. waits for the Enhance panel; reads the photo's own Enhance digest, since right after a switch the
--      panel may still describe the photo before [upstream claim: same PR];
--   4. answers unchanged (Denoise on at that amount) or skipped (the panel says Denoise is not available)
--      with nothing written; else takes the snapshot `snapshot_name` and applies;
--   5. counts the change as done only once the panel shows the amount and the digest changed: Lightroom can
--      show a change and never save it [upstream claim: same PR]; else puts the amount back and answers failed;
--   6. puts back the module, the sources and the selection, whatever happened.
-- FilterList is seen live in a getDevelopSettings dump (a "Dust Removal" filter) [handle:
-- docs\reports\phase8\S10\census\s10_PICT0019.DNG.json "FilterList"]; the "Enhance" name, getEnhancePanelState
-- and its fields, getActiveSources and setActiveSources are [upstream claim] and [unverified] here until Jim's
-- `npm run denoise:check`. The History step is Lightroom's own: these calls take no History name.
-- Steps 2 and 6 are DevelopSession.withPhoto (issue #214), moved out of this file with no change in behaviour.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local DevelopSession = require 'DevelopSession'
local Log = require 'Log'
local Needs = require 'Needs'
local Photos = require 'Photos'

local Denoise = {}

-- Upstream's waits [upstream claim: Automaat PR #288, HandlerDevelop.lua DENOISE_*_SECONDS]; selecting the photo
-- (10 s, polled every 0.1 s) is DevelopSession.lua's.
local SETTLE_SECONDS, PANEL_SECONDS, CONFIRM_SECONDS, SAVE_SECONDS = 0.5, 8, 1.5, 5
local waitFor = DevelopSession.waitFor

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- The Enhance filter's CompressedSettings, or nil when the photo has none (no Denoise).
local function digest(catalog, photo)
    local found
    catalog:withReadAccessDo(function()
        local list = (photo:getDevelopSettings() or {}).FilterList
        for _, f in ipairs(type(list) == "table" and type(list.Filters) == "table" and list.Filters or {}) do
            if type(f) == "table" and f.Name == "Enhance" then found = tostring(f.CompressedSettings or "") end
        end
    end)
    return found
end

local function panelState()
    local ok, state = LrTasks.pcall(LrDevelopController.getEnhancePanelState)
    return ok and state or nil
end

-- Steps 3-5 on the selected photo in Develop; a result table.
local function denoiseSelected(catalog, photo, amount, snapshotName, uuid)
    LrTasks.sleep(SETTLE_SECONDS)
    local panel
    waitFor(function() panel = panelState(); return panel ~= nil and panel.denoiseEnabled end, PANEL_SECONDS)
    local before = digest(catalog, photo)
    if not panel then return { status = "failed", reason = "the Develop panel's Enhance state was not available" } end
    if not panel.denoiseEnabled then return { status = "skipped", reason = "Lightroom says Denoise is not available for this photo" } end
    local has = before ~= nil and panel.denoiseState == true
    if has and panel.denoiseAmount == amount then return { status = "unchanged" } end
    local snap, snapErr = Develop.createSnapshot({ photo_uuid = uuid, name = snapshotName })
    if not snap then return { status = "failed", reason = "the snapshot before Denoise failed: " .. tostring(snapErr and snapErr.message) } end
    local snapshot = { id = snap.snapshot_id, name = snapshotName }
    if catalog:getTargetPhoto() ~= photo then return { status = "failed", reason = "another photo became active before Denoise was applied", snapshot = snapshot } end
    local ok, err = LrTasks.pcall(function()
        if has then LrDevelopController.changeDenoiseAmount(amount) else LrDevelopController.setEnhance("denoise", true, amount) end
    end)
    if not ok then return { status = "failed", reason = tostring(err), snapshot = snapshot } end
    local shown = waitFor(function()
        local now = panelState()
        return catalog:getTargetPhoto() == photo and now ~= nil and now.denoiseState == true and now.denoiseAmount == amount
    end, CONFIRM_SECONDS)
    local saved = shown and waitFor(function() local d = digest(catalog, photo); return d ~= nil and d ~= before end, SAVE_SECONDS)
    if not saved then
        -- Only on this photo: a click in Lightroom may have made another one active meanwhile (Greptile, PR #191).
        if has and catalog:getTargetPhoto() == photo then LrTasks.pcall(LrDevelopController.changeDenoiseAmount, panel.denoiseAmount) end
        return { status = "failed", snapshot = snapshot, reason = shown and "Lightroom did not save the change (it can drop a change made while it still computes Denoise for this photo; try again once the Activity Center is idle)" or "the Develop panel did not show the new amount" }
    end
    return { status = has and "amount_changed" or "applied", previous_amount = has and panel.denoiseAmount or nil, snapshot = snapshot }
end

function Denoise.apply(payload)
    local amount = payload.amount
    if type(amount) ~= "number" or amount ~= math.floor(amount) or amount < 1 or amount > 100 then return fail("bad_request", "amount must be a whole number from 1 to 100") end
    local name = payload.snapshot_name
    if type(name) ~= "string" or name:sub(1, 4) ~= "AVG " then return fail("bad_request", "snapshot_name must start with 'AVG '") end
    -- 14.5: getEnhancePanelState and changeDenoiseAmount are "First supported in version 14.5" [handle: API Reference\modules\
    -- LrDevelopController.html:1131, 730, SDK 15.2]. setEnhance is not in that reference, so its release is [unverified]; this
    -- replaces "needs Lightroom Classic 15", an [upstream claim: Automaat PR #288] the reference does not bear out for the other two.
    local present, unavailable = Needs.check("AI Denoise", "14.5", "LrDevelopController.", LrDevelopController, { "getEnhancePanelState", "setEnhance", "changeDenoiseAmount" })
    if not present then return nil, unavailable end
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    local t0 = LrDate.currentTime()
    local result, busy = DevelopSession.withPhoto("apply_denoise", catalog, photo, function()
        return denoiseSelected(catalog, photo, amount, name, found.uuid)
    end)
    if not result then return nil, busy end
    result.uuid, result.ms = found.uuid, math.floor((LrDate.currentTime() - t0) * 1000)
    Log.info(string.format("denoise: %s %s at %d (%s)", found.uuid, result.status, amount, tostring(result.reason or "")))
    return result
end

return Denoise
