-- File > Plug-in Extras > "LrC-AVG - Abort Session" (PRD FR-1.1, PHASE5_PLAN decision 7): the HUD's
-- Abort, sent as hud_abort with source "menu". The engine reverts the session (PHASE5_PLAN row 5); a
-- message says whether the event was sent. Hud.menuEvent sends, so it runs in a task.

local LrTasks = import 'LrTasks'

local Hud = require 'Hud'

LrTasks.startAsyncTask(function() Hud.menuEvent("hud_abort") end)
