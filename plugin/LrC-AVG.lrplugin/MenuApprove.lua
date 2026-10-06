-- File > Plug-in Extras > "LrC-AVG - Approve Pass" (fix/hud-p1 P1-4): the HUD's Approve pass n, sent
-- as hud_approve_pass with source "menu" for the pass the HUD shows waiting. Unless a Deck is live and the event went out (HudClick.menuEvent, plugin 0.18.0), the HUD opens if it is
-- closed, and its feedback line says whether the event was sent. Hud.menuEvent may wait for the
-- engine and sends, so it runs in a task.

local LrTasks = import 'LrTasks'

local Hud = require 'Hud'

LrTasks.startAsyncTask(function() Hud.menuEvent("hud_approve_pass") end)
