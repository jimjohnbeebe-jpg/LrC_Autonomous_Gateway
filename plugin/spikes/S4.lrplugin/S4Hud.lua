-- AVG-S4: LrDialogs.presentFloatingDialog with two static_text labels bound to a
-- property table (LrBinding.makePropertyTable returns an LrObservableTable). A separate
-- task writes both labels once per second for 30 s. What Jim observes: is the window
-- non-modal, do the labels update live, and what happens to focus while working in Develop.
--
-- Unknowns this spike resolves [unverified]: whether presentFloatingDialog blocks the
-- calling task (blockTask) or returns immediately; the harness copes with both and
-- logs which one happened to <temp>\LrC-AVG\s4_log.txt.

local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local TICKS = 30

local function clock()
    return LrDate.timeToUserFormat(LrDate.currentTime(), "%H:%M:%S")
end

local function appendLog(lines)
    local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
    LrFileUtils.createAllDirectories(dir)
    local path = LrPathUtils.child(dir, "s4_log.txt")
    local fh = io.open(path, "a")
    if fh then
        fh:write(table.concat(lines, "\n"), "\n\n")
        fh:close()
    end
    return path
end

LrFunctionContext.postAsyncTaskWithContext("AVG S4", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

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
            props.line2 = "Finished " .. clock() .. " (close me)"
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
    table.insert(log, string.format("presentFloatingDialog returned after %.2f s (window open at return: %s)", returnedAfter, tostring(open)))

    -- If the call did not block, keep this task (and so `props`' function context) alive
    -- until the window closes or the updater has long finished.
    local waitStart = LrDate.currentTime()
    while open and (LrDate.currentTime() - waitStart) < (TICKS + 60) do
        LrTasks.sleep(0.5)
    end
    table.insert(log, "window closed or wait ended at " .. clock())
    appendLog(log)
end)
