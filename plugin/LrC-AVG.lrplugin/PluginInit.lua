-- Runs when the plugin loads and on Reload Plug-in. Starts the bridge in its own function context,
-- which outlives this script: a plain startAsyncTask here would be torn down when the init script
-- returns [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInit.lua:25-31, MIT,
-- see THIRD_PARTY_NOTICES.md]. Bridge.start() replaces a previous instance (its generation check).
-- This script is not a task and Bridge.start() does not yield (it only posts the bridge task), so a
-- plain pcall guards it; rule 03's LrTasks.pcall is for code running inside tasks.

local Bridge = require 'Bridge'
local Log = require 'Log'

-- Lightroom runs this at its start for a disabled plugin too (LrForceInitPlugin), with _PLUGIN.enabled
-- false: the bridge used to bind and rebind there [handle: docs\reports\phase9\stall-174.md "Observed,
-- run 3"]. A disabled plugin starts nothing; Enable starts it (PluginEnable.lua).
if _PLUGIN.enabled == false then
    Log.info("bridge: not started (plugin disabled)")
else
    local ok, err = pcall(Bridge.start) -- plain pcall: not a task, Bridge.start does not yield
    if not ok then
        Log.error("bridge start failed: " .. tostring(err))
    end
end
