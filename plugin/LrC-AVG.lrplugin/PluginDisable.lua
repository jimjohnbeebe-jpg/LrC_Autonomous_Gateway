-- LrDisablePlugin: Disable in File > Plug-in Manager [handle: Lightroom Classic SDK Guide, chapter 2,
-- "Customizing plug-in load behavior"; Adobe's remote_control_socket sample stops its socket loop the
-- same way, its stop.lua]. Without it a disabled bridge kept rebinding for 6 min [handle:
-- docs\reports\phase9\stall-174.md "Observed, run 2"].

local Bridge = require 'Bridge'
local Log = require 'Log'

Log.info("plugin: disabled in Plug-in Manager")
local ok, err = pcall(Bridge.stop) -- plain pcall: not a task
if not ok then
    Log.error("bridge stop failed: " .. tostring(err))
end
