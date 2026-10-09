-- AVG-S10: profile recorder, the S5 part-2 recorder (plugin\spikes\S5.lrplugin\S5Recorder.lua)
-- pointed at S10's folder. While it runs, it reads the target photo's develop settings every
-- POLL_S seconds and records every new combination of photo + CameraProfile + Look name, with the
-- full Look table, so `npm run s10:check` can write each pair back to a rendered photo. Jim only
-- clicks profiles in Lightroom; a bezel message confirms each recording. Results:
-- <temp>\LrC-AVG\S10\run1\s10_profiles_recorded_<start time>.json, one file per recorder start.
-- Whether a rendered photo's Color/Monochrome profiles are Looks, plain CameraProfile strings, or
-- something else is what this records [unverified until the run].

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local S10 = require 'S10Common'

local POLL_S = 0.5
local MAX_MINUTES = 20

local M = {}

if not _G.AVG_S10_REC then
    _G.AVG_S10_REC = { running = false, gen = 0, captures = {}, seen = {} }
end
local REC = _G.AVG_S10_REC

local function save()
    local dir = S10.resultsDir("run1")
    local path = LrPathUtils.child(dir, "s10_profiles_recorded_" .. S10.safeName(REC.startedAt) .. ".json")
    S10.writeJson(path, { recorder = "AVG S10 profile recorder", started_at = REC.startedAt, captures = REC.captures })
    return path
end

function M.start()
    if REC.running then
        LrDialogs.showBezel("AVG S10: the profile recorder is already running")
        return
    end
    REC.running = true
    REC.gen = REC.gen + 1
    local gen = REC.gen
    REC.captures, REC.seen, REC.startedAt, REC.lastKey = {}, {}, S10.now(), nil

    LrFunctionContext.postAsyncTaskWithContext("AVG S10 recorder", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local catalog = LrApplication.activeCatalog()
        local started = LrDate.currentTime()
        while REC.running and REC.gen == gen and (LrDate.currentTime() - started) < MAX_MINUTES * 60 do
            local photo = catalog:getTargetPhoto() -- outside the read gate (yields; Automaat HandlerSelection.lua:30-38)
            if photo then
                local settings, meta = S10.snapshot(catalog, photo)
                local lookName = S10.lookName(settings)
                -- ConvertToGrayscale is part of the key: on a rendered photo, Monochrome left
                -- CameraProfile "Embedded" and no Look and set ConvertToGrayscale instead (run 1,
                -- s10_profiles_recorded_2026-10-09T04_54_46.json: 154 keys, recorded as "Embedded" again).
                local key = tostring(meta.filename) .. "|" .. tostring(meta.copy_name) .. "|" .. tostring(settings.CameraProfile) .. "|" .. tostring(lookName) .. "|" .. tostring(settings.ConvertToGrayscale)
                local changed = (key ~= REC.lastKey)
                REC.lastKey = key
                if changed and REC.seen[key] then
                    LrDialogs.showBezel("Already recorded: " .. S10.profileLabel(settings.CameraProfile, lookName, settings.ConvertToGrayscale), 1.5)
                elseif not REC.seen[key] then
                    REC.seen[key] = true
                    local c = {
                        captured_at = meta.captured_at,
                        filename = meta.filename,
                        copy_name = meta.copy_name,
                        file_format = meta.file_format,
                        local_identifier = meta.local_identifier,
                        camera_profile = settings.CameraProfile,
                        look_name = lookName,
                        look_uuid = S10.lookUuid(settings),
                        look = settings.Look,
                        convert_to_grayscale = settings.ConvertToGrayscale,
                        -- The table the engine writes back verbatim (an absent Look is written as {}: S5's "Look = {} clears it").
                        profile_settings = { CameraProfile = settings.CameraProfile, Look = settings.Look or {}, ConvertToGrayscale = settings.ConvertToGrayscale },
                        process_version = settings.ProcessVersion,
                        key_count = meta.key_count,
                    }
                    table.insert(REC.captures, c)
                    save()
                    LrDialogs.showBezel(string.format("Recorded %d: %s", #REC.captures, S10.profileLabel(c.camera_profile, c.look_name, c.convert_to_grayscale)), 1.5)
                end
            end
            LrTasks.sleep(POLL_S)
        end
        if REC.gen == gen then REC.running = false end
    end)
    LrDialogs.showBezel("AVG S10: profile recorder started", 2)
end

function M.stop()
    local wasRunning = REC.running
    REC.running = false
    if not wasRunning and #REC.captures == 0 then
        LrDialogs.message("AVG S10 recorder", "The recorder was not running, and nothing has been recorded in this Lightroom session.", "warning")
        return
    end
    save()
    local lines = {}
    for i, c in ipairs(REC.captures) do
        lines[i] = string.format("%d. %s: %s", i, tostring(c.filename), S10.profileLabel(c.camera_profile, c.look_name, c.convert_to_grayscale))
    end
    LrDialogs.message("AVG S10 recorder stopped",
        string.format("Recorded %d profile setting(s):\n%s\n\nSaved automatically. Nothing to copy.",
            #REC.captures, table.concat(lines, "\n")),
        "info")
end

return M
