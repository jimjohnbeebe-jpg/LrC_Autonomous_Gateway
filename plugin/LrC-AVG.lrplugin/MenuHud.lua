-- File > Plug-in Extras > "LrC-AVG - Show Vision Gateway HUD" (PRD FR-1.1, PHASE5_PLAN decision 7).
-- Opens the HUD with the last session state the engine sent, if it is not open already. Menu item
-- scripts share module state and _G with the bridge task [handle: LR_SDK_NOTES "Recorded in Phase 5",
-- Shared state], so this calls the HUD directly. Hud.show only posts the window's task and never
-- yields, so it needs no task of its own.

local Hud = require 'Hud'

Hud.show()
