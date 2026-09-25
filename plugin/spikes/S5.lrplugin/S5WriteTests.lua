-- AVG-S5 part 2: automatic write tests on the target photo. No typing, no copy/paste.
--
--   0. Take a Develop snapshot "AVG S5 before write tests" (it is the undo for everything below).
--   1. Adobe profile: write a recorded Adobe Look (preferring "Adobe Landscape") together with
--      its base CameraProfile, both taken from the profile recorder in this Lightroom session.
--   2. Nikon profile: write CameraProfile = "Camera Landscape" (or "Camera Neutral" if the photo
--      already has it). Both strings were observed for this NEF in part 1
--      [handle: docs\reports\phase0\S5\part1\s5_profiles.log, lines 21:10:05 and 21:10:23].
--   3. Lens switches: flip EnableLensCorrections, then flip LensProfileEnable (both keys are in
--      the live dump: engine\src\params\sdk-keys.lrc15.json).
--   4. Put the photo back: apply the snapshot, compare every develop setting with the start,
--      then delete the snapshot.
-- Every write is read back. Keys a photo's live settings or the recorder did not show are
-- skipped, never written blind (03-lightroom). Results: <repo>\docs\reports\phase0\S5\run2\
-- s5_writetests_<filename>.json (temp fallback), plus a plain-language dialog.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local S5 = require 'S5Common'
local S5Recorder = require 'S5Recorder'

local SNAPSHOT_NAME = "AVG S5 before write tests"
local NIKON_FIRST, NIKON_SECOND = "Camera Landscape", "Camera Neutral"

local function countKeys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

LrFunctionContext.postAsyncTaskWithContext("AVG S5 write tests", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then
        LrDialogs.message("AVG S5 write tests", "Select the photo first (click 20260907-_OZ80093.NEF).", "warning")
        return
    end

    local start, meta = S5.snapshot(catalog, photo)
    local results = { meta = meta, snapshot = {}, tests = {} }
    local summary = {}

    local function write(label, settings)
        local ok, err = LrTasks.pcall(function()
            catalog:withWriteAccessDo("AVG S5 write test: " .. label, function()
                photo:applyDevelopSettings(settings, "AVG S5 write test: " .. label)
            end)
        end)
        local after = S5.snapshot(catalog, photo)
        return ok, err, after
    end

    -- 0. Snapshot, so the photo can be put back exactly.
    local snapOk, snapErr = LrTasks.pcall(function()
        catalog:withWriteAccessDo("AVG S5 snapshot", function()
            photo:createDevelopSnapshot(SNAPSHOT_NAME, true)
        end)
    end)
    local snapId
    if snapOk then
        catalog:withReadAccessDo(function()
            for _, s in ipairs(photo:getDevelopSnapshots() or {}) do
                if s.name == SNAPSHOT_NAME then snapId = s.snapshotID or s.id end
            end
        end)
    end
    results.snapshot.created = snapOk and snapId ~= nil
    results.snapshot.error = (not snapOk) and tostring(snapErr) or nil

    local current = start

    -- 1. Adobe profile via its Look (from the recorder, same photo, different from now).
    local currentLook = S5.lookName(current)
    local pick
    for _, c in ipairs(S5Recorder.captures()) do
        if c.filename == meta.filename and c.look_name and c.look_name:find("^Adobe") and c.look_name ~= currentLook
            and type(c.look) == "table" then
            if not pick or c.look_name == "Adobe Landscape" then pick = c end
        end
    end
    if not pick then
        table.insert(results.tests, { test = "adobe_look", outcome = "skipped", reason = "no recorded Adobe profile for this photo in this Lightroom session" })
        table.insert(summary, "1. Adobe profile: SKIPPED - no Adobe profile was recorded for this photo (run the recorder steps first)")
    else
        local requested = { CameraProfile = pick.camera_profile, Look = pick.look }
        local ok, err, after = write("Adobe profile " .. pick.look_name, requested)
        local gotLook = S5.lookName(after)
        local worked = ok and gotLook == pick.look_name and after.CameraProfile == pick.camera_profile
        table.insert(results.tests, {
            test = "adobe_look", outcome = worked and "worked" or "failed", error = (not ok) and tostring(err) or nil,
            requested_camera_profile = pick.camera_profile, requested_look_name = pick.look_name, requested_look_uuid = pick.look_uuid,
            before = { camera_profile = current.CameraProfile, look_name = currentLook },
            after = { camera_profile = after.CameraProfile, look_name = gotLook },
            changed_keys = S5.diff(current, after),
        })
        table.insert(summary, string.format("1. Adobe profile -> %s: %s (now: %s)", pick.look_name,
            worked and "WORKED" or "FAILED", S5.profileLabel(after.CameraProfile, gotLook)))
        current = after
    end

    -- 2. Nikon (Camera Matching) profile via CameraProfile alone.
    local target = (current.CameraProfile == NIKON_FIRST) and NIKON_SECOND or NIKON_FIRST
    do
        local lookBefore = S5.lookName(current)
        local ok, err, after = write("Nikon profile " .. target, { CameraProfile = target })
        local worked = ok and after.CameraProfile == target
        table.insert(results.tests, {
            test = "nikon_camera_profile", outcome = worked and "worked" or "failed", error = (not ok) and tostring(err) or nil,
            requested_camera_profile = target,
            before = { camera_profile = current.CameraProfile, look_name = lookBefore },
            after = { camera_profile = after.CameraProfile, look_name = S5.lookName(after) },
            changed_keys = S5.diff(current, after),
        })
        table.insert(summary, string.format("2. Nikon profile -> %s: %s (now: %s)", target,
            worked and "WORKED" or "FAILED", S5.profileLabel(after.CameraProfile, S5.lookName(after))))
        current = after
    end

    -- 3. Lens switches: flip each one.
    local function flipTest(testName, key, flipped, plain)
        if current[key] == nil then
            table.insert(results.tests, { test = testName, outcome = "skipped", reason = key .. " not in live settings" })
            table.insert(summary, string.format("%s: SKIPPED - not in this photo's settings", plain))
            return
        end
        local beforeValue = current[key]
        local ok, err, after = write(plain, { [key] = flipped(beforeValue) })
        local worked = ok and after[key] == flipped(beforeValue)
        table.insert(results.tests, {
            test = testName, outcome = worked and "worked" or "failed", error = (not ok) and tostring(err) or nil,
            key = key, before = beforeValue, requested = flipped(beforeValue), after = after[key],
            changed_keys = S5.diff(current, after),
        })
        table.insert(summary, string.format("%s %s -> %s: %s", plain, tostring(beforeValue), tostring(after[key]),
            worked and "WORKED" or "FAILED"))
        current = after
    end
    flipTest("lens_enable_corrections", "EnableLensCorrections", function(v) return not v end,
        "3. Lens Corrections on/off (EnableLensCorrections)")
    flipTest("lens_profile_enable", "LensProfileEnable", function(v) return (v == 1) and 0 or 1 end,
        "4. Enable Profile Corrections (LensProfileEnable)")

    -- 4. Put the photo back.
    local restoreHow
    if snapId then
        local ok, err = LrTasks.pcall(function()
            catalog:withWriteAccessDo("AVG S5 restore", function() photo:applyDevelopSnapshot(snapId) end)
        end)
        restoreHow = ok and "snapshot" or ("snapshot failed: " .. tostring(err))
        results.snapshot.applied = ok
    end
    if not results.snapshot.applied then
        local back = {}
        for _, key in ipairs({ "CameraProfile", "Look", "EnableLensCorrections", "LensProfileEnable" }) do
            if start[key] ~= nil then back[key] = start[key] end
        end
        write("restore", back)
        restoreHow = (restoreHow and (restoreHow .. "; ") or "") .. "wrote the original values back"
    end
    local final = S5.snapshot(catalog, photo)
    local remaining = S5.diff(start, final)
    local restored = countKeys(remaining) == 0
    results.restore = { how = restoreHow, restored = restored, remaining_differences = remaining }
    if snapId then
        local ok = LrTasks.pcall(function()
            catalog:withWriteAccessDo("AVG S5 delete snapshot", function() photo:deleteDevelopSnapshot(snapId) end)
        end)
        results.snapshot.deleted = ok
    end

    local dir, where = S5.resultsDir("run2")
    local path = LrPathUtils.child(dir, "s5_writetests_" .. S5.safeName(meta.filename) .. ".json")
    S5.writeJson(path, results)

    local restoreLine = restored and ("Photo put back to how it was: YES (" .. restoreHow .. ")")
        or ("Photo put back to how it was: NO - " .. countKeys(remaining) .. " setting(s) still differ. Tell Claude Code before doing anything else.")
    LrDialogs.message("AVG S5 write tests - " .. tostring(meta.filename),
        table.concat(summary, "\n") .. "\n\n" .. restoreLine ..
        "\n\nResults saved automatically" .. ((where == "repo") and " into the project folder" or (" to " .. path)) ..
        ". Nothing to copy.", restored and "info" or "warning")
end)
