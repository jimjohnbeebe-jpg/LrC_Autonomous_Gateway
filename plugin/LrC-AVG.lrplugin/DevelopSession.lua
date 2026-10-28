-- One photo at a time in Develop, then Lightroom's view put back (issue #214). LrDevelopController acts on the
-- photo active in Develop only ("Must be called while the Develop module is active" [handle: API Reference\modules\
-- LrDevelopController.html, every function used here, SDK 15.2]), one call at a time. Extracted from Denoise.lua
-- (issue #190), whose shape upstream's DevelopSession.withPhoto/run also has [upstream claim: Automaat/lightroom-mcp
-- 1040453, plugin\LightroomMCP.lrplugin\DevelopSession.lua]. withPhoto, under the selection lock (Catalog.exclusive):
--   1. notes the module, the sources and the selection;
--   2. switches to Develop (Develop.toDevelop; not when `develop` is false) and selects the photo alone, through
--      All Photographs when it is outside the current source;
--   3. runs `fn(owns)` and returns its result table;
--   4. puts back the module, the sources and the selection, whatever happened.
-- A switch or a selection that fails answers { status = "failed" | "skipped", reason } without running `fn`.
-- getActiveSources and setActiveSources are [upstream claim] and [unverified] here until Jim's `npm run denoise:check`
-- (Denoise.lua header); the module switch is LR_SDK_NOTES "Recorded in Phase 9" (Denoise ran through it).

local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrSelection = import 'LrSelection'
local LrTasks = import 'LrTasks'

local Catalog = require 'Catalog'
local Develop = require 'Develop'

local DevelopSession = {}

-- Upstream's waits [upstream claim: DevelopSession.lua SELECT_TIMEOUT_SECONDS, POLL_SECONDS].
local SELECT_SECONDS, POLL_SECONDS = 10, 0.1

function DevelopSession.waitFor(done, seconds)
    local t0 = LrDate.currentTime()
    while LrDate.currentTime() - t0 < seconds do
        if done() then return true end
        LrTasks.sleep(POLL_SECONDS)
    end
    return done()
end

-- The module, the sources and the selection, and their put-back (Remove.lua puts back only the surviving photos).
function DevelopSession.captureView(catalog)
    local active = catalog:getTargetPhoto()
    local okSources, sources = LrTasks.pcall(function() return catalog:getActiveSources() end)
    return { module = LrApplicationView.getCurrentModuleName(), sources = okSources and sources or nil, active = active, selection = active and catalog:getTargetPhotos() or nil }
end

function DevelopSession.restoreView(catalog, view, switchedSource)
    if switchedSource and view.sources then LrTasks.pcall(function() catalog:setActiveSources(view.sources) end) end
    if view.active then
        LrTasks.pcall(function() catalog:setSelectedPhotos(view.active, view.selection or { view.active }) end)
    else
        LrTasks.pcall(LrSelection.selectNone)
    end
    if view.module and view.module ~= LrApplicationView.getCurrentModuleName() then
        LrTasks.pcall(LrApplicationView.switchToModule, view.module)
    end
end

-- Select `photo` alone, again each second until it sticks (Lightroom drops a selection made while it is
-- still switching [upstream claim: Automaat PR #288]); once more through All Photographs. Returns ok, switchedSource.
local function selectAlone(catalog, photo)
    local function tryFor(seconds)
        return DevelopSession.waitFor(function() return Catalog.selectOnly(catalog, photo) end, seconds)
    end
    if tryFor(SELECT_SECONDS) then return true, false end
    local ok = LrTasks.pcall(function() catalog:setActiveSources({ catalog.kAllPhotos }) end)
    return ok and tryFor(SELECT_SECONDS), true
end

-- Steps 1-4 above. `name` names the lock holder; `develop` false keeps the module (a virtual copy needs no Develop).
-- Returns fn's result table, or nil plus the lock's busy error.
function DevelopSession.withPhoto(name, catalog, photo, fn, develop)
    return Catalog.exclusive(name, function(owns)
        local view = DevelopSession.captureView(catalog)
        local switched = false
        local ok, result = LrTasks.pcall(function()
            if develop ~= false then
                local notDevelop = Develop.toDevelop()
                if notDevelop then return { status = "failed", reason = notDevelop.message } end
            end
            local selected
            selected, switched = selectAlone(catalog, photo)
            if not selected then return { status = "skipped", reason = "Lightroom did not select the photo" .. (develop ~= false and " in Develop" or "") } end
            return fn(owns)
        end)
        DevelopSession.restoreView(catalog, view, switched)
        if not ok then error(result, 0) end
        return result
    end)
end

-- Ends Develop's tracking state, so a change made through LrDevelopController becomes one History step now
-- ("Causes Develop module to exit its tracking state immediately, creating a single history state" [handle:
-- API Reference\modules\LrDevelopController.html stopTracking, SDK 6.0]); upstream calls it after Auto and Reset
-- [upstream claim: DevelopSession.flushPendingEdits, which passes isLocalParam true]. Auto and Reset call it with
-- isLocalParam nil, as they change global settings [inference]; MaskControl.lua with true, after a mask's curves or swatches.
function DevelopSession.flush(isLocalParam)
    LrTasks.pcall(LrDevelopController.stopTracking, isLocalParam)
end

return DevelopSession
