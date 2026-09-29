-- The HUD's selection line (PRD section 6.13; PHASE5_PLAN row 4, fix/hud-menu-and-target): which
-- photo is selected, read in a task, against the session's photos (HudState.targetChangedLine).
--
-- In the row 4 probe the "Target changed" line never appeared when Jim selected another photo
-- [stated: Jim, 2026-09-29], and the plugin logged nothing that could say why [handle: repo
-- logs\probe-hud-2026-09-29\bridge-log-excerpt.txt (gitignored), no HUD line between 05:55:32 and
-- 05:56:09]. So now:
--   - every selectionChangeObserver call is logged, and so is each change of the line;
--   - a check runs at once and again RECHECK_SECONDS later, in case the observer runs before
--     getTargetPhoto returns the new photo [inference];
--   - the HUD's ticker checks every PERIOD_SECONDS while a session is open, in case the observer is
--     not called [inference; S8 saw it called once per change: docs\reports\phase5\S8.md Numbers].
-- The query runs outside any gate, the metadata reads inside the read gate with LrTasks.pcall
-- (rule 03; Photos.lua describe).

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local HudState = require 'HudState'
local Log = require 'Log'

local HudSelection = {}

HudSelection.RECHECK_SECONDS = 0.5
HudSelection.PERIOD_SECONDS = 2

local checks = 0
local lastLine = nil

-- The selected photo's uuid and name, "file (copy name)" for a virtual copy, which shares its
-- master's file [inference: a virtual copy has no file of its own]; nil, nil when none.
local function selectedPhoto()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then return nil, nil end
    local uuid, name
    catalog:withReadAccessDo(function()
        local okUuid, u = LrTasks.pcall(photo.getRawMetadata, photo, "uuid")
        local okName, n = LrTasks.pcall(photo.getFormattedMetadata, photo, "fileName")
        local okCopy, c = LrTasks.pcall(photo.getFormattedMetadata, photo, "copyName")
        uuid = okUuid and u or nil
        name = okName and n or nil
        if name and okCopy and type(c) == "string" and c ~= "" then name = name .. " (" .. c .. ")" end
    end)
    return uuid, name
end

-- Runs in a task. `state()` gives the HUD's state when the line is worked out, `show(line)` writes
-- it. The catalog calls may yield and a newer check may start meanwhile: only the newest one writes.
function HudSelection.check(state, show)
    checks = checks + 1
    local mine = checks
    local ok, uuid, name = LrTasks.pcall(selectedPhoto)
    if mine ~= checks then return end
    if not ok then
        Log.warn("hud: could not read the selected photo: " .. tostring(uuid))
        return
    end
    local line = HudState.targetChangedLine(state(), uuid, name)
    if line ~= lastLine then
        Log.info("hud: selection " .. tostring(uuid) .. ": " .. (line == "" and "(no line)" or line))
        lastLine = line
    end
    show(line)
end

-- selectionChangeObserver's call (it cannot be assumed to yield): a check now, and one
-- RECHECK_SECONDS later.
function HudSelection.onChange(state, show)
    Log.info("hud: selectionChangeObserver called")
    LrTasks.startAsyncTask(function() HudSelection.check(state, show) end)
    LrTasks.startAsyncTask(function()
        LrTasks.sleep(HudSelection.RECHECK_SECONDS)
        HudSelection.check(state, show)
    end)
end

return HudSelection
