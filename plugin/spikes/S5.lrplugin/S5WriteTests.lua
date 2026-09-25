-- AVG-S5 part 2: automatic write tests on the target photo. No typing, no copy/paste.
--
--   0. Take a Develop snapshot "AVG S5 before write tests <time>". It is the undo for everything
--      below. If it cannot be made and found again, stop before changing anything.
--   1. Nikon profile: write CameraProfile = "Camera Landscape" (or "Camera Neutral" if the photo
--      already has it). Both strings were observed for this NEF in part 1
--      [handle: docs\reports\phase0\S5\part1\s5_profiles.log, lines 21:10:05 and 21:10:23].
--      WORKED only if no Look is left applied. If an Adobe Look remains, try once more with an
--      empty Look (Look = {}) [unverified whether that clears it] and report what happened.
--   2. Adobe profile: write a recorded Adobe Look (preferring "Adobe Landscape") together with
--      its base CameraProfile, both from the profile recorder in this Lightroom session.
--   3. Lens switches: flip EnableLensCorrections, then flip LensProfileEnable (both keys are in
--      the live dump: engine\src\params\sdk-keys.lrc15.json).
--   4. Put the photo back by applying the snapshot, and compare every develop setting with the
--      start. The SDK page names the parameter of applyDevelopSnapshot / deleteDevelopSnapshot
--      only "id", while snapshot entries carry both snapshotID and id_global
--      [handle: https://lrc.mcor.dev/modules/LrPhoto.html]. So each call tries snapshotID,
--      verifies the effect, falls back to id_global, and records which id worked.
--      The snapshot is deleted only if the photo is fully restored; otherwise it is kept.
-- Every write is read back. Results: <repo>\docs\reports\phase0\S5\run2\
-- s5_writetests_<filename>.json (temp fallback), plus a plain-language dialog.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local S5 = require 'S5Common'
local S5Recorder = require 'S5Recorder'

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

    -- A unique name per run, so a snapshot left over from an earlier run can never be mistaken
    -- for this run's starting point.
    local SNAPSHOT_NAME = "AVG S5 before write tests " .. S5.now()
    local start, meta = S5.snapshot(catalog, photo)
    local results = { meta = meta, snapshot = { name = SNAPSHOT_NAME }, tests = {} }
    local summary = {}
    local dir, where = S5.resultsDir("run2")
    local path = LrPathUtils.child(dir, "s5_writetests_" .. S5.safeName(meta.filename) .. ".json")
    local savedWhere = (where == "repo") and " into the project folder" or (" to " .. path)

    local function findSnapshot()
        local entry
        catalog:withReadAccessDo(function()
            for _, s in ipairs(photo:getDevelopSnapshots() or {}) do
                if s.name == SNAPSHOT_NAME then entry = s end
            end
        end)
        return entry
    end

    local function write(label, settings)
        local ok, err = LrTasks.pcall(function()
            catalog:withWriteAccessDo("AVG S5 write test: " .. label, function()
                photo:applyDevelopSettings(settings, "AVG S5 write test: " .. label)
            end)
        end)
        local after = S5.snapshot(catalog, photo)
        return ok, err, after
    end

    -- 0. Safety snapshot, required before any write.
    local created, createErr = LrTasks.pcall(function()
        local r
        catalog:withWriteAccessDo("AVG S5 snapshot", function()
            r = photo:createDevelopSnapshot(SNAPSHOT_NAME, true)
        end)
        return r
    end)
    -- createDevelopSnapshot returns true on success (LrPhoto page); anything else counts as failure.
    local createReturned = created and createErr or nil
    results.snapshot.create_ok = created
    results.snapshot.create_returned = createReturned
    results.snapshot.create_error = (not created) and tostring(createErr) or nil
    local snap = (created and createReturned == true) and findSnapshot() or nil
    if not snap then
        results.snapshot.found = false
        S5.writeJson(path, results)
        LrDialogs.message("AVG S5 write tests - STOPPED",
            "Nothing was changed: the safety snapshot could not be created or found" ..
            ((not created) and (" (" .. tostring(createErr) .. ")") or "") ..
            ".\n\nResults saved automatically" .. savedWhere .. ". Tell Claude Code.", "warning")
        return
    end
    results.snapshot.found = true
    results.snapshot.snapshotID = snap.snapshotID
    results.snapshot.id_global = snap.id_global

    local current = start

    -- 1. Nikon (Camera Matching) profile.
    do
        local target = (current.CameraProfile == NIKON_FIRST) and NIKON_SECOND or NIKON_FIRST
        local lookBefore = S5.lookName(current)
        local ok, err, after = write("Nikon profile " .. target, { CameraProfile = target })
        local attempts = { {
            requested = { CameraProfile = target }, ok = ok, error = (not ok) and tostring(err) or nil,
            after = { camera_profile = after.CameraProfile, look_name = S5.lookName(after) },
            changed_keys = S5.diff(current, after),
        } }
        local outcome, note
        if ok and after.CameraProfile == target and S5.lookName(after) == nil then
            outcome, note = "worked", ""
        elseif ok and after.CameraProfile == target then
            -- The profile changed but a Look is still applied: try clearing it.
            local lookLeft = S5.lookName(after)
            local ok2, err2, after2 = write("Nikon profile " .. target .. " + clear Look", { CameraProfile = target, Look = {} })
            table.insert(attempts, {
                requested = { CameraProfile = target, Look = "{} (empty)" }, ok = ok2, error = (not ok2) and tostring(err2) or nil,
                after = { camera_profile = after2.CameraProfile, look_name = S5.lookName(after2) },
                changed_keys = S5.diff(after, after2),
            })
            if ok2 and after2.CameraProfile == target and S5.lookName(after2) == nil then
                outcome, note = "worked", " (the Look '" .. lookLeft .. "' stayed until an empty Look was written)"
            else
                outcome, note = "partial", " - the profile changed, but the Look '" .. tostring(S5.lookName(after2)) .. "' is still applied"
            end
            after = after2
        else
            outcome, note = "failed", ""
        end
        table.insert(results.tests, {
            test = "nikon_camera_profile", outcome = outcome, requested_camera_profile = target,
            before = { camera_profile = current.CameraProfile, look_name = lookBefore }, attempts = attempts,
        })
        table.insert(summary, string.format("1. Nikon profile -> %s: %s%s", target, string.upper(outcome), note))
        current = after
    end

    -- 2. Adobe profile via its recorded Look (same photo, different from now).
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
        table.insert(summary, "2. Adobe profile: SKIPPED - no Adobe profile was recorded for this photo")
    else
        local ok, err, after = write("Adobe profile " .. pick.look_name, { CameraProfile = pick.camera_profile, Look = pick.look })
        local gotLook = S5.lookName(after)
        local worked = ok and gotLook == pick.look_name and after.CameraProfile == pick.camera_profile
        table.insert(results.tests, {
            test = "adobe_look", outcome = worked and "worked" or "failed", error = (not ok) and tostring(err) or nil,
            requested_camera_profile = pick.camera_profile, requested_look_name = pick.look_name, requested_look_uuid = pick.look_uuid,
            before = { camera_profile = current.CameraProfile, look_name = currentLook },
            after = { camera_profile = after.CameraProfile, look_name = gotLook },
            changed_keys = S5.diff(current, after),
        })
        table.insert(summary, string.format("2. Adobe profile -> %s: %s (now: %s)", pick.look_name,
            worked and "WORKED" or "FAILED", S5.profileLabel(after.CameraProfile, gotLook)))
        current = after
    end

    -- 3. Lens switches: flip each one.
    local function flipTest(testName, key, flipped, plain)
        if current[key] == nil then
            table.insert(results.tests, { test = testName, outcome = "skipped", reason = key .. " not in live settings" })
            table.insert(summary, plain .. ": SKIPPED - not in this photo's settings")
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

    -- 4. Put the photo back with the snapshot; find out which id the call takes.
    local remaining
    results.restore = { attempts = {} }
    for _, idField in ipairs({ "snapshotID", "id_global" }) do
        local id = snap[idField]
        if id ~= nil then
            local ok, err = LrTasks.pcall(function()
                catalog:withWriteAccessDo("AVG S5 restore", function() photo:applyDevelopSnapshot(id) end)
            end)
            local final = S5.snapshot(catalog, photo)
            remaining = S5.diff(start, final)
            table.insert(results.restore.attempts, { id_field = idField, ok = ok, error = (not ok) and tostring(err) or nil,
                remaining_differences = countKeys(remaining) })
            if ok and countKeys(remaining) == 0 then
                results.restore.worked_with = idField
                break
            end
        end
    end
    local restored = remaining ~= nil and countKeys(remaining) == 0
    results.restore.restored = restored
    results.restore.remaining_differences = remaining

    -- Delete the snapshot only when the photo is fully restored; find out which id works.
    local deleted = false
    if restored then
        results.snapshot.delete_attempts = {}
        for _, idField in ipairs({ "snapshotID", "id_global" }) do
            local id = snap[idField]
            if id ~= nil and not deleted then
                local ok, err = LrTasks.pcall(function()
                    catalog:withWriteAccessDo("AVG S5 delete snapshot", function() photo:deleteDevelopSnapshot(id) end)
                end)
                deleted = findSnapshot() == nil
                table.insert(results.snapshot.delete_attempts, { id_field = idField, ok = ok,
                    error = (not ok) and tostring(err) or nil, gone_afterwards = deleted })
                if deleted then results.snapshot.deleted_with = idField end
            end
        end
    end
    results.snapshot.deleted = deleted
    results.snapshot.kept_because_restore_incomplete = not restored

    S5.writeJson(path, results)

    local restoreLine
    if restored then
        restoreLine = "Photo put back to how it was: YES" ..
            (deleted and "" or " (the snapshot '" .. SNAPSHOT_NAME .. "' could not be deleted and is still in the Snapshots panel; that is harmless)")
    else
        restoreLine = "Photo put back to how it was: NO - " .. countKeys(remaining or {}) ..
            " setting(s) still differ. The snapshot '" .. SNAPSHOT_NAME .. "' is kept in the Snapshots panel " ..
            "(left side of Develop). Don't change the photo; tell Claude Code."
    end
    LrDialogs.message("AVG S5 write tests - " .. tostring(meta.filename),
        table.concat(summary, "\n") .. "\n\n" .. restoreLine ..
        "\n\nResults saved automatically" .. savedWhere .. ". Nothing to copy.", restored and "info" or "warning")
end)
