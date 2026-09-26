-- LrC-AVG plugin. Read LR_SDK_NOTES.md before changing anything here.
-- The bridge (Bridge.lua) starts when the plugin loads (PluginInit.lua) and serves the engine's
-- Develop commands (Develop.lua, Phase 1) and preview exports (Preview.lua, Phase 2). The HUD and
-- settings page come in later phases (ARCHITECTURE section 1).
-- LrSdkVersion 13.0: the five Phase 0 spike plugins declared it and ran on LrC 15.5.1
-- [handle: docs\reports\phase0\PHASE0.md "Draft for LR_SDK_NOTES", SDK version]; whether it hides
-- newer develop keys is [unverified].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.gateway',
    LrPluginName = "LrC-AVG (Autonomous Vision Gateway)",
    LrInitPlugin = 'PluginInit.lua',
    -- Load at Lightroom start, not on first use. Automaat notes this needs at least one menu item
    -- [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\Info.lua:14-17].
    LrForceInitPlugin = true,
    -- File > Plug-in Extras (PRD FR-1.1).
    LrExportMenuItems = {
        { title = "LrC-AVG - Bridge status", file = "MenuStatus.lua" },
    },
    VERSION = { major = 0, minor = 2, revision = 0, build = 0 },
}
