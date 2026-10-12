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

-- An earlier run's values written back to its photo; true when there was nothing to do or it worked.
local function earlierPutBack(catalog, results)
    local p = Common.pending()
    if not p then return true end
    local photo = catalog:findPhotoByUuid(p.uuid)
    local ok, steps = false, nil
    if photo then ok, steps = Metadata.putBack(catalog, photo, p.prior) end
    results.earlier_put_back = { uuid = p.uuid, found = photo ~= nil, ok = ok, steps = steps }
    -- A photo no longer in the catalog cannot be put back: the record is dropped, not kept for ever.
    if ok or not photo then Common.setPending(nil) end
    return ok or not photo
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
    if not earlierPutBack(catalog, results) then
        Common.writeJson(file, results)
        LrDialogs.message("AVG S11: FAILED - put back: NO", "An earlier run's photo could not be put back. Tell Claude Code.", "critical")
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
    Common.setPending({ uuid = results.photo.uuid, prior = prior })
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
    local worked = okW and ok and okP
    local imported = results.import_stack and results.import_stack.a ~= nil
    LrDialogs.message("AVG S11: " .. (worked and "WORKED" or "FAILED") .. " - put back: " .. yn(okP),
        summary(results) .. (results.error and ("\nStopped: " .. results.error) or "") ..
        "\n\nResults saved automatically. " .. (imported and "Now remove the two S11-stack copies (spikes\\S11\\README.md, step 5), then tell" or "Tell") ..
        " Claude Code \"S11 done\".",
        worked and "info" or "critical")
end

LrTasks.startAsyncTask(function()
    local ok, err = LrTasks.pcall(run)
    if not ok then LrDialogs.message("AVG S11: FAILED", tostring(err) .. "\nTell Claude Code.", "critical") end
end)
