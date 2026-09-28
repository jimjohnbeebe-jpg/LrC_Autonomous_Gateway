-- AVG-S8 menu item 2: ask the loop to close the HUD from code (closeFloatingDialogsForPlugin). The
-- HUD's own task then asks Jim what he saw.

local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local LrUUID = import 'LrUUID'

local Common = require 'S8Common'

LrTasks.startAsyncTask(function()
    local _, age = Common.loopView()
    if not age or age > Common.LOOP_STALE_SECONDS then
        LrDialogs.message("AVG S8: NOT SENT - the S8 loop is not running",
            "Close the HUD with the X in its corner. Then tell Claude Code.", "warning")
        return
    end
    local ok, err = Common.writeRequest(LrUUID.generateUUID(), "close")
    if not ok then
        LrDialogs.message("AVG S8: NOT SENT - the request could not be written", tostring(err) .. "\nClose the HUD with the X in its corner.", "critical")
    end
end)
