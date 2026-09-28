-- AVG-S8: runs when the plugin loads (LrInitPlugin, with LrForceInitPlugin as in
-- plugin\LrC-AVG.lrplugin\Info.lua). Starts the S8 loop in its own function context, which outlives
-- this script [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInit.lua:25-31], as
-- plugin\LrC-AVG.lrplugin\PluginInit.lua starts the bridge. It also sets question 5's init mark on
-- _G and in S8State. A generation number on _G lets a Reload Plug-in stop the old loop, as in
-- Bridge.lua:58-62: a reload runs the init script again in the same Lua state [upstream claim:
-- vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInit.lua:8-15]. The README's steps use no reload.

local LrFunctionContext = import 'LrFunctionContext'
local LrUUID = import 'LrUUID'

local S8Loop = require 'S8Loop'
local State = require 'S8State'

_G.S8_generation = (_G.S8_generation or 0) + 1
local generation = _G.S8_generation
local mark = "init-" .. LrUUID.generateUUID()
State.initMark = mark
_G.S8_initMark = mark

LrFunctionContext.postAsyncTaskWithContext("AVG S8 loop", function()
    S8Loop.run(generation, mark)
end)
