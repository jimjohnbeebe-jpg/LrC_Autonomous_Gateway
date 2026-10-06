-- File > Plug-in Extras > "LrC-AVG - Pick A" (fix/hud-p1 P1-4): the HUD's Pick A, sent as hud_pick
-- with variant A and source "menu". Unless a Deck is live and the event went out (HudClick.menuEvent, plugin 0.18.0), the HUD opens if it is closed, and its feedback line says
-- whether the event was sent. Hud.menuEvent may wait for the engine and sends, so it runs in a task.

local LrTasks = import 'LrTasks'

local Hud = require 'Hud'

LrTasks.startAsyncTask(function() Hud.menuEvent("hud_pick", "A") end)
