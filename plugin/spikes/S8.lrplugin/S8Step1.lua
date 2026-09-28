-- AVG-S8 menu item 1: ask the loop to open the HUD in 5 s. On success nothing is shown here: a
-- window would take the keyboard just before the focus question (README step 12) [inference].

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Common = require 'S8Common'

LrTasks.startAsyncTask(function()
    local _, age = Common.loopView()
    if not age or age > Common.LOOP_STALE_SECONDS then
        LrDialogs.message("AVG S8: NOT STARTED - the S8 loop is not running",
            "Restart Lightroom (File > Exit, then open it again), then choose this menu item again.", "warning")
        return
    end
    if not LrApplication.activeCatalog():getTargetPhoto() then
        LrDialogs.message("AVG S8: NOT STARTED - no photo selected", "Click a photo, press D, then choose this menu item again.", "warning")
        return
    end
    local ok, err = Common.writeRequest(LrUUID.generateUUID(), "open")
    if not ok then
        LrDialogs.message("AVG S8: NOT STARTED - the request could not be written", tostring(err) .. "\nTell Claude Code.", "critical")
    end
end)
