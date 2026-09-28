-- AVG-S8 question 5: is a module's table the same for the init script's loop, a menu item and the
-- Plug-in Manager section? Each of them requires this module and writes or reads a mark in it, and
-- the same mark on _G. In Phase 0 a menu item once did not see _G state set by another script in the
-- same Lightroom session; the cause is [unverified] [handle: LR_SDK_NOTES "Also recorded in Phase 0",
-- the _G entry]. The answer decides how the HUD's menu items reach the bridge task (PHASE5_PLAN
-- row 2): directly, or through a request file as S8 does.

local State = {}

return State
