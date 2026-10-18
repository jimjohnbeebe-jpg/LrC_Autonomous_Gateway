-- LrEnablePlugin: Enable in File > Plug-in Manager [handle: Lightroom Classic SDK Guide, chapter 2,
-- "Customizing plug-in load behavior"]. After a Lightroom start with the plugin disabled, Enable did not
-- run PluginInit.lua again, so no bridge started [handle: docs\reports\phase9\stall-174.md "Observed,
-- run 3"]. Bridge.start() replaces a bridge that is already running (its generation check).

local Bridge = require 'Bridge'
local Log = require 'Log'

Log.info("plugin: enabled in Plug-in Manager")
local ok, err = pcall(Bridge.start) -- plain pcall: not a task, Bridge.start does not yield
if not ok then
    Log.error("bridge start failed: " .. tostring(err))
end
