-- File > Plug-in Extras > "LrC-AVG - Show Vision Gateway HUD" (PRD FR-1.1, PHASE5_PLAN decision 7).
-- Plugin 0.18.0 (Phase 7 row 5): with a Deck live and an edit open, the Deck shows itself and the
-- classic window stays closed; otherwise the classic HUD opens with the last session state the engine
-- sent, if it is not open already (Hud.showFromMenu). Menu item scripts share module state and _G with
-- the bridge task [handle: LR_SDK_NOTES "Recorded in Phase 5", Shared state]. The send may wait for its
-- socket (Events.send), so this runs in a task.

local LrTasks = import 'LrTasks'

local Hud = require 'Hud'

LrTasks.startAsyncTask(function() Hud.showFromMenu() end)
