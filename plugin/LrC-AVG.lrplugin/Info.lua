-- LrC-AVG plugin. Read LR_SDK_NOTES.md before changing anything here.
-- The bridge (Bridge.lua) starts when the plugin loads (PluginInit.lua) and serves the engine's
-- Develop commands (Develop.lua, Phase 1), preview exports (Preview.lua, Phase 2), virtual copies
-- and selection (Catalog.lua, Phase 4), photos named by uuid (Photos.lua, Phase 4), the settings
-- (Prefs.lua, get_prefs, Phase 5) and the HUD (Hud.lua, hud_update, Phase 5); Dispatch.lua routes
-- them. The settings page in Plug-in Manager is PluginInfoProvider.lua (PHASE5_PLAN row 3); the HUD,
-- its events (Events.lua) and the menu items below are row 4. Masks.lua (plugin 0.11.0 to 0.14.0) holds the
-- AI-mask commands of the mask tools (GitHub issue #59); Pending.lua (0.16.0) guards every write to a photo
-- while Lightroom still computes an AI mask on it. Transfer.lua (0.17.0, GitHub issue #55) holds collections,
-- exports and imports. From 0.18.0 (Phase 7 row 5, hud_deck) the menu items leave the classic HUD closed
-- while the engine says a Deck is connected (HudClick.menuEvent, Hud.showFromMenu).
-- LrSdkVersion 13.0: the five Phase 0 spike plugins declared it and ran on LrC 15.5.1
-- [handle: docs\reports\phase0\PHASE0.md "Draft for LR_SDK_NOTES", SDK version]; whether it hides
-- newer develop keys is [unverified].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.gateway',
    LrPluginName = "LrC-AVG (Autonomous Vision Gateway)",
    LrInitPlugin = 'PluginInit.lua',
    -- The settings section in File > Plug-in Manager (PRD section 6.2, AVG-006).
    LrPluginInfoProvider = 'PluginInfoProvider.lua',
    -- Load at Lightroom start, not on first use. Automaat notes this needs at least one menu item
    -- [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\Info.lua:14-17].
    LrForceInitPlugin = true,
    -- File > Plug-in Extras (PRD FR-1.1; PHASE5_PLAN decision 7 for the HUD's first three; Approve
    -- Pass and Pick A-C from fix/hud-p1 P1-4, so every HUD button has a menu item; Abort last, as on
    -- the HUD).
    LrExportMenuItems = {
        { title = "LrC-AVG - Bridge status", file = "MenuStatus.lua" },
        { title = "LrC-AVG - Show Vision Gateway HUD", file = "MenuHud.lua" },
        { title = "LrC-AVG - Pick A", file = "MenuPickA.lua" },
        { title = "LrC-AVG - Pick B", file = "MenuPickB.lua" },
        { title = "LrC-AVG - Pick C", file = "MenuPickC.lua" },
        { title = "LrC-AVG - Approve Pass", file = "MenuApprove.lua" },
        { title = "LrC-AVG - Accept Edit", file = "MenuAccept.lua" },
        { title = "LrC-AVG - Abort Edit", file = "MenuAbort.lua" },
    },
    VERSION = { major = 0, minor = 18, revision = 1, build = 0 },
}
