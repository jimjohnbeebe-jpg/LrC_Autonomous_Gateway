-- AVG-S2 "Stop echo server": stops the server, asks Jim the one observation Lightroom
-- cannot measure itself (did Lightroom freeze during the test?), and saves the answer with
-- the server's counters and log to <temp>\LrC-AVG\S2\s2_stop_<time>.json. Claude Code
-- collects that file; Jim copies nothing.

local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrView = import 'LrView'

local S2Server = require 'S2Server'
local SpikeJson = require 'SpikeJson'

LrFunctionContext.postAsyncTaskWithContext("AVG S2 stop", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    S2Server.stop()
    local status = S2Server.status()

    local props = LrBinding.makePropertyTable(context)
    props.froze = false
    local f = LrView.osFactory()
    local choice = LrDialogs.presentModalDialog {
        title = "AVG S2 - one question",
        actionVerb = "Save",
        contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),
            f:static_text { title = "While the PowerShell test was running:" },
            f:checkbox { title = "Lightroom froze or stopped responding during the test", value = LrView.bind("froze") },
            f:static_text { title = "Leave it unticked if Lightroom kept responding normally." },
        },
    }

    local now = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H-%M-%S")
    local path = LrPathUtils.child(S2Server.outDir(), "s2_stop_" .. now .. ".json")
    local answered = (choice == "ok")
    local froze = "not answered"
    if answered then froze = (props.froze == true) end
    local ok, err = SpikeJson.writeFile(path, {
        spike = "S2",
        stopped_at = now .. " (local time)",
        answered = answered,
        lightroom_froze = froze,
        server = status,
    })
    if ok then
        LrDialogs.message("AVG S2 stopped",
            "Echo server stopped. Saved automatically - nothing to copy.\n\n" ..
            "Messages received: " .. tostring(status.messages_received) .. ", echoed: " .. tostring(status.messages_echoed) ..
            "\n\nTell Claude Code: \"S2 done.\"", "info")
    else
        LrDialogs.message("AVG S2 stopped - SAVE FAILED",
            "Echo server stopped, but the results could not be saved: " .. tostring(err) .. "\nTell Claude Code.", "critical")
    end
end)
