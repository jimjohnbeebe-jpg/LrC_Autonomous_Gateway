-- Runs when the plugin loads and on Reload Plug-in. Starts the bridge in its own function context,
-- which outlives this script: a plain startAsyncTask here would be torn down when the init script
-- returns [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInit.lua:25-31, MIT,
-- see THIRD_PARTY_NOTICES.md]. Bridge.start() replaces a previous instance (its generation check).
-- This script is not a task and Bridge.start() does not yield (it only posts the bridge task), so a
-- plain pcall guards it; rule 03's LrTasks.pcall is for code running inside tasks.

local Bridge = require 'Bridge'
local Log = require 'Log'

local ok, err = pcall(Bridge.start)
if not ok then
    Log.error("bridge start failed: " .. tostring(err))
end
