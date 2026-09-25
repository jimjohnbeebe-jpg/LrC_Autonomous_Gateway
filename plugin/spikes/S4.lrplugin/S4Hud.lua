-- AVG-S4: LrDialogs.presentFloatingDialog with two static_text labels bound to a
-- property table (LrBinding.makePropertyTable returns an LrObservableTable). A separate
-- task writes both labels once per second for 30 s. While it runs, Jim tries the actions
-- in spikes\S4\README.md. When the HUD closes, the harness:
--   1. puts the target photo's Exposure2012 back to its value at the start (Jim drags the
--      Exposure slider during the test), and reads it back;
--   2. asks Jim the five observations in one dialog with checkboxes;
--   3. saves answers, timing and the exposure restore to <temp>\LrC-AVG\S4\s4_result_<time>.json.
-- Claude Code collects that file; Jim copies nothing.
--
-- Unknowns this spike resolves [unverified]: whether presentFloatingDialog blocks the
-- calling task (blockTask) or returns immediately; the harness copes with both and
-- records which one happened. Exposure2012 is a key in the live dump
-- (engine\src\params\sdk-keys.lrc15.json).

local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local SpikeJson = require 'SpikeJson'

local TICKS = 30

local QUESTIONS = {
    { key = "slider_draggable", text = "I could drag the Exposure slider while the HUD was open" },
    { key = "ticks_while_dragging", text = "The Tick counter kept counting while I dragged the slider" },
    { key = "backslash_toggled", text = "Pressing \\ (backslash) switched Before/After while the HUD was open" },
    { key = "hud_stayed_in_front", text = "The HUD stayed in front when I clicked the main Lightroom window" },
    { key = "hud_survived_module_switch", text = "The HUD was still there after G then D (Library and back to Develop)" },
}

local function clock()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S")
end

local function outDir()
    local dir = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "S4")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

local function readExposure(catalog, photo)
    local value
    catalog:withReadAccessDo(function()
        value = photo:getDevelopSettings().Exposure2012
    end)
    return value
end

LrFunctionContext.postAsyncTaskWithContext("AVG S4", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto() -- outside any gate (yields; Automaat HandlerSelection.lua:30-38)
    local filename, startExposure
    if photo then
        catalog:withReadAccessDo(function() filename = photo:getFormattedMetadata("fileName") end)
        startExposure = readExposure(catalog, photo)
    end

    local props = LrBinding.makePropertyTable(context)
    props.line1 = "Tick 0 / " .. TICKS
    props.line2 = "Started " .. clock()

    local f = LrView.osFactory()
    local contents = f:column {
        bind_to_object = props,
        spacing = f:control_spacing(),
        f:static_text { title = LrView.bind("line1"), width_in_chars = 36 },
        f:static_text { title = LrView.bind("line2"), width_in_chars = 36 },
    }

    local open = true
    local log = { "AVG S4 run at " .. clock() }

    LrTasks.startAsyncTask(function()
        for i = 1, TICKS do
            if not open then break end
            props.line1 = string.format("Tick %d / %d", i, TICKS)
            props.line2 = "Clock " .. clock()
            LrTasks.sleep(1)
        end
        if open then
            props.line1 = "Done: " .. TICKS .. " ticks"
            props.line2 = "Finished " .. clock() .. " - close this window"
        end
        table.insert(log, "updater finished at " .. clock())
    end)

    local t0 = LrDate.currentTime()
    LrDialogs.presentFloatingDialog(_PLUGIN, {
        title = "AVG S4 HUD",
        contents = contents,
        blockTask = true,
        windowWillClose = function()
            open = false
        end,
    })
    local returnedAfter = LrDate.currentTime() - t0
    local openAtReturn = open
    table.insert(log, string.format("presentFloatingDialog returned after %.2f s (window open at return: %s)", returnedAfter, tostring(openAtReturn)))

    -- If the call did not block, keep this task (and so `props`' function context) alive
    -- until the window closes or the updater has long finished.
    local waitStart = LrDate.currentTime()
    while open and (LrDate.currentTime() - waitStart) < (TICKS + 60) do
        LrTasks.sleep(0.5)
    end
    table.insert(log, "window closed or wait ended at " .. clock())

    -- 1. Put Exposure2012 back (Jim dragged the slider during the test).
    local exposure = { start = startExposure }
    if photo and type(startExposure) == "number" then
        exposure.before_restore = readExposure(catalog, photo)
        if exposure.before_restore ~= startExposure then
            local ok, err = LrTasks.pcall(function()
                catalog:withWriteAccessDo("AVG S4 restore", function()
                    photo:applyDevelopSettings({ Exposure2012 = startExposure }, "AVG S4 restore exposure")
                end)
            end)
            exposure.write_error = (not ok) and tostring(err) or nil
        end
        exposure.after_restore = readExposure(catalog, photo)
        exposure.restored = (exposure.after_restore == startExposure)
    else
        exposure.restored = false
        exposure.note = "no target photo or no Exposure2012 at start; nothing to restore"
    end

    -- 2. Ask the observations.
    local answers = LrBinding.makePropertyTable(context)
    local rows = {
        bind_to_object = answers,
        spacing = f:control_spacing(),
        f:static_text { title = "Tick every statement that is true. Leave the others unticked." },
    }
    for _, q in ipairs(QUESTIONS) do
        answers[q.key] = false
        table.insert(rows, f:checkbox { title = q.text, value = LrView.bind(q.key) })
    end
    local choice = LrDialogs.presentModalDialog {
        title = "AVG S4 - what did you see?",
        actionVerb = "Save",
        contents = f:column(rows),
    }
    local saved = {}
    for _, q in ipairs(QUESTIONS) do
        saved[q.key] = { statement = q.text, answer = (choice == "ok") and (answers[q.key] == true) }
    end

    -- 3. Save everything.
    local now = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H-%M-%S")
    local path = LrPathUtils.child(outDir(), "s4_result_" .. now .. ".json")
    local ok, err = SpikeJson.writeFile(path, {
        spike = "S4",
        run_at = now .. " (local time)",
        photo = filename,
        present_floating_dialog_returned_after_s = returnedAfter,
        window_open_when_call_returned = openAtReturn,
        blocked_until_closed = not openAtReturn,
        answered = (choice == "ok"),
        observations = saved,
        exposure_restore = exposure,
        log = log,
    })

    local exposureLine = exposure.restored and "Exposure put back to how it was: YES"
        or ("Exposure put back: NO (" .. tostring(exposure.note or exposure.write_error or "value differs") .. ") - use History to undo your drag")
    if ok then
        LrDialogs.message("AVG S4 done", exposureLine .. "\n\nSaved automatically - nothing to copy.\nTell Claude Code: \"S4 done.\"",
            exposure.restored and "info" or "warning")
    else
        LrDialogs.message("AVG S4 - SAVE FAILED", exposureLine .. "\n\nThe results could not be saved: " .. tostring(err) .. "\nTell Claude Code.", "critical")
    end
end)
