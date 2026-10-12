-- AVG-S11 menu item: the spike on the selected photo, which must be in the "fixtures" collection.
-- Order: put back what an earlier run left (S11Common pending); the metadata writes and their
-- put-back (S11Metadata); the stack state of the photo; the folder lookups; the stack at import
-- (S11Stack). One results file under %TEMP%\LrC-AVG\S11\, one dialog with the headline.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local Common = require 'S11Common'
local Metadata = require 'S11Metadata'
local Stack = require 'S11Stack'

local COLLECTION = "fixtures"
local yn = function(b) return b and "YES" or "NO" end

local function inFixtures(catalog, photo)
    local ok, collections = Common.call(function() return photo:getContainedCollections() end)
    if not ok then
        ok, collections = Common.call(function()
            local r
            catalog:withReadAccessDo(function() r = photo:getContainedCollections() end)
            return r
        end)
    end
    for _, c in ipairs(ok and collections or {}) do
        if c:getName() == COLLECTION then return true end
    end
    return false
end

-- An earlier run's values written back to its photo; true when there was nothing to do or it
-- worked, else false and what Jim should do. The record names its catalog (catalog:getPath(), SDK
-- 3.0 [handle: modules\LrCatalog.html]), so another open catalog keeps it (Greptile, PR #145).
local function earlierPutBack(catalog, results)
    local p = Common.pending()
    if not p then return true end
    if p.catalog ~= catalog:getPath() then
        results.earlier_put_back = { uuid = p.uuid, catalog = p.catalog, other_catalog = true }
        return false, "An earlier run's photo is in the catalog " .. tostring(p.catalog) .. ". Open that catalog (File > Open Catalog), then choose this menu item again."
    end
    local photo = catalog:findPhotoByUuid(p.uuid)
    local ok, steps = false, nil
    if photo then ok, steps = Metadata.putBack(catalog, photo, p.prior) end
    results.earlier_put_back = { uuid = p.uuid, found = photo ~= nil, ok = ok, steps = steps }
    -- A photo no longer in its catalog cannot be put back: the record is dropped, not kept for ever.
    if ok or not photo then Common.setPending(nil) end
    return ok or not photo, "An earlier run's photo could not be put back. Tell Claude Code."
end

local function count(list, field)
    local n = 0
    for _, r in ipairs(list or {}) do if r[field] then n = n + 1 end end
    return n
end

local function summary(r)
    local w = r.metadata and r.metadata.writes or {}
    local flags, texts = {}, {}
    for _, s in ipairs(w) do table.insert(s.key == "pickStatus" and flags or texts, s) end
    local f = r.folders or {}
    local imp = r.import_stack or {}
    return table.concat({
        "Pick flag writes taken: " .. count(flags, "taken") .. " of " .. #flags,
        "Title, caption, headline taken: " .. count(texts, "taken") .. " of " .. #texts,
        "Folder by path holds the photo: " .. yn(f.get_photos and f.get_photos.contains_photo),
        "Folder searches that found the photo: " .. count(f.find_photos, "contains_photo") .. " of " .. #(f.find_photos or {}),
        "Stack made at import: " .. (imp.skipped or imp.copy_error or yn(imp.stacked)),
        "Put back: " .. yn(r.put_back and r.put_back.ok),
    }, "\n")
end

local function run()
    local catalog = LrApplication.activeCatalog()
    local results = { spike = "S11", started_at = Common.now(), lr_version = LrApplication.versionString() }
    local file = LrPathUtils.child(Common.resultsDir(), "s11_" .. Common.now():gsub(":", "-") .. ".json")
    local earlierOk, why = earlierPutBack(catalog, results)
    if not earlierOk then
        Common.writeJson(file, results)
        LrDialogs.message("AVG S11: FAILED - put back: NO", why, "critical")
        return
    end
    local targets = catalog:getTargetPhotos() or {}
    if #targets ~= 1 or not inFixtures(catalog, targets[1]) then
        local earlier = results.earlier_put_back ~= nil
        if earlier then Common.writeJson(file, results) end
        LrDialogs.message("AVG S11: NOT STARTED", "Select exactly one photo of the \"fixtures\" collection, then choose this menu item again." ..
            (earlier and " An earlier run's photo was put back first (saved)." or " Nothing was written."), "warning")
        return
    end
    local photo = targets[1]
    catalog:withReadAccessDo(function()
        results.photo = { uuid = photo:getRawMetadata("uuid"), filename = photo:getFormattedMetadata("fileName"), path = photo:getRawMetadata("path") }
    end)
    local prior = Metadata.prior(catalog, photo)
    Common.setPending({ uuid = results.photo.uuid, catalog = catalog:getPath(), prior = prior })
    results.prior = prior
    local okW, metadata = LrTasks.pcall(Metadata.writes, catalog, photo)
    results.metadata = okW and metadata or { error = tostring(metadata) }
    local okP, steps = Metadata.putBack(catalog, photo, prior)
    results.put_back = { ok = okP, steps = steps }
    if okP then Common.setPending(nil) end
    local ok, err = LrTasks.pcall(function()
        results.stack_of_photo = Stack.stackState(catalog, photo)
        results.folders = Stack.folders(catalog, photo, results.photo.path)
        results.import_stack = Stack.importStack(catalog, results.photo.path)
    end)
    if not ok then results.error = tostring(err) end
    results.finished_at = Common.now()
    Common.writeJson(file, results)
    -- A copy or import that did not run, or an addPhoto that threw, is FAILED too (Greptile, PR #145; rule 04 headlines).
    local imp = results.import_stack or {}
    local stackRan = imp.add_photo_a ~= nil and imp.add_photo_a.ok and imp.add_photo_b ~= nil and imp.add_photo_b.ok
    local worked = okW and ok and okP and stackRan
    local imported = imp.a ~= nil
    LrDialogs.message("AVG S11: " .. (worked and "WORKED" or "FAILED") .. " - put back: " .. yn(okP),
        summary(results) .. (results.error and ("\nStopped: " .. results.error) or "") ..
        "\n\nResults saved automatically. " .. (imported and "Now remove the two S11-stack copies (spikes\\S11\\README.md, step 5), then tell" or "Tell") ..
        " Claude Code \"S11 done\".",
        worked and "info" or "critical")
end

-- One run at a time: a second click while a run waits for the catalog would read the first run's
-- pending record as a stopped run (Greptile, PR #145). The flag lives on _G (rule 03, plugin hygiene)
-- and is cleared however the run ends; no yielding call sits between the check and the set, so two tasks cannot both pass it [inference].
LrTasks.startAsyncTask(function()
    if _G.AVG_S11_RUNNING then
        LrDialogs.message("AVG S11: NOT STARTED - a run is still going", "Wait for its dialog. Nothing was written by this click.", "warning")
        return
    end
    _G.AVG_S11_RUNNING = true
    local ok, err = LrTasks.pcall(run)
    _G.AVG_S11_RUNNING = nil
    if not ok then LrDialogs.message("AVG S11: FAILED", tostring(err) .. "\nTell Claude Code.", "critical") end
end)
