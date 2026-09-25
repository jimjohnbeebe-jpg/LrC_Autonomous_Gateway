-- AVG-S5 part 2: profile recorder. While it runs, it reads the target photo's develop
-- settings every POLL_S seconds and records every new combination of photo +
-- CameraProfile + Look name, including the full Look table (needed to write an Adobe
-- profile back in the write tests). Jim only clicks profiles in Lightroom; a bezel message
-- confirms each recording. Results: <repo>\docs\reports\phase0\S5\run2\s5_profiles_recorded.json
-- (temp folder fallback, see S5Common.resultsDir). Captures are also kept in memory
-- (_G.AVG_S5_REC) for S5WriteTests.lua in the same Lightroom session.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local S5 = require 'S5Common'

local POLL_S = 0.5
local MAX_MINUTES = 20

local M = {}

if not _G.AVG_S5_REC then
    _G.AVG_S5_REC = { running = false, gen = 0, captures = {}, seen = {} }
end
local R = _G.AVG_S5_REC

local function save()
    local dir, where = S5.resultsDir("run2")
    local path = LrPathUtils.child(dir, "s5_profiles_recorded.json")
    S5.writeJson(path, { recorder = "AVG S5 profile recorder", started_at = R.startedAt, captures = R.captures })
    return path, where
end

function M.captures()
    return R.captures
end

function M.start()
    if R.running then
        LrDialogs.showBezel("AVG S5: the profile recorder is already running")
        return
    end
    R.running = true
    R.gen = R.gen + 1
    local gen = R.gen
    R.captures, R.seen, R.startedAt = {}, {}, S5.now()

    LrFunctionContext.postAsyncTaskWithContext("AVG S5 recorder", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local catalog = LrApplication.activeCatalog()
        local started = LrDate.currentTime()
        while R.running and R.gen == gen and (LrDate.currentTime() - started) < MAX_MINUTES * 60 do
            local photo = catalog:getTargetPhoto() -- outside the read gate (yields; Automaat HandlerSelection.lua:30-38)
            if photo then
                local settings, meta = S5.snapshot(catalog, photo)
                local lookName = S5.lookName(settings)
                local key = tostring(meta.filename) .. "|" .. tostring(settings.CameraProfile) .. "|" .. tostring(lookName)
                if not R.seen[key] then
                    R.seen[key] = true
                    local c = {
                        captured_at = meta.captured_at,
                        filename = meta.filename,
                        file_format = meta.file_format,
                        local_identifier = meta.local_identifier,
                        camera_profile = settings.CameraProfile,
                        look_name = lookName,
                        look_uuid = S5.lookUuid(settings),
                        look = settings.Look,
                        process_version = settings.ProcessVersion,
                        key_count = meta.key_count,
                    }
                    table.insert(R.captures, c)
                    save()
                    LrDialogs.showBezel(string.format("Recorded %d: %s", #R.captures, S5.profileLabel(c.camera_profile, c.look_name)), 1.5)
                end
            end
            LrTasks.sleep(POLL_S)
        end
        if R.gen == gen then R.running = false end
    end)
    LrDialogs.showBezel("AVG S5: profile recorder started", 2)
end

function M.stop()
    local wasRunning = R.running
    R.running = false
    if not wasRunning and #R.captures == 0 then
        LrDialogs.message("AVG S5 recorder", "The recorder was not running, and nothing has been recorded in this Lightroom session.", "warning")
        return
    end
    local path, where = save()
    local lines = {}
    for i, c in ipairs(R.captures) do
        lines[i] = string.format("%d. %s: %s", i, tostring(c.filename), S5.profileLabel(c.camera_profile, c.look_name))
    end
    LrDialogs.message("AVG S5 recorder stopped",
        string.format("Recorded %d profile setting(s):\n%s\n\nSaved automatically%s. Nothing to copy.",
            #R.captures, table.concat(lines, "\n"),
            (where == "repo") and " into the project folder" or (" to " .. path)),
        "info")
end

return M
