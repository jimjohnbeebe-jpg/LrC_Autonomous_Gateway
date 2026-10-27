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
-- while the engine says a Deck is connected (HudClick.menuEvent, Hud.showFromMenu). From 0.20.0 (GitHub
-- issue #124) clear_pending_ai drops Pending.lua's guard on a photo when the engine abandons its session.
-- From 0.21.0 (GitHub issues #131, #139) Pending.lua waits on every AI part of a mask, listings and the
-- context carry gps and path (Photos.describe opts.where), and imports return capture_time. From 0.22.0
-- (GitHub issues #111, #112, #139) Metadata.lua sets flags and title/caption/headline and reads a photo's
-- metadata and stack; search_photos takes a folder path. From 0.23.0 (GitHub issue #155) the HUD names
-- the AI client and its model (hud_update ai_name, ai_model; HudText.ai), or says "the AI". From 1.0.0
-- (Phase 9) the plugin, the engine and the Deck share one version, and "LrC-AVG - Status" (MenuStatus.lua)
-- shows both and writes status.txt.
-- LrSdkVersion 15.2 is the newest SDK confirmed [handle: D:\Developer\LightRoom Classic Dev Kit\Readme.txt:1,
-- "Adobe Lightroom Classic 15.2 Software Development Kit"; a newer one is [unverified]]; the guide says to set it
-- "to latest version" and LrSdkMinimumVersion to the oldest Lightroom the plug-in works with [handle:
-- Manual\Lightroom Classic SDK Guide.pdf pp. 22-23 (pdftotext), "set this value to 8.0 and LrSdkVersion to 11.0"].
-- LrSdkMinimumVersion stays 13.0, which the Phase 0 spike plugins declared and ran on LrC 15.5.1 [handle:
-- docs\reports\phase0\PHASE0.md "Draft for LR_SDK_NOTES", SDK version] (Jim, issue #209: refuse at runtime). A
-- feature from a later release checks its call first and answers feature_unavailable ("needs Lightroom Classic
-- N or later") through Needs.lua. The guide documents no hiding of calls or develop keys by the declared
-- version; whether 15.2 changes the keys getDevelopSettings() returns is answered by `npm run sdkver:check`
-- (docs\reports\phase11\SDKVER.md) and is [unverified] until Jim runs it.
-- This repo copy is the development plugin, with its own ID and name; the setup build ships it as
-- com.lrcavg.gateway, "LrC-AVG (Autonomous Vision Gateway)" (tools\setup\plugin-id.ts says why).
return {
    LrSdkVersion = 15.2,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.gateway.dev',
    LrPluginName = "LrC-AVG (dev)",
    LrInitPlugin = 'PluginInit.lua',
    -- The settings section in File > Plug-in Manager (PRD section 6.2, AVG-006).
    LrPluginInfoProvider = 'PluginInfoProvider.lua',
    -- Load at Lightroom start, not on first use. Automaat notes this needs at least one menu item
    -- [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\Info.lua:14-17].
    LrForceInitPlugin = true,
    -- The plugin's private metadata fields (plugin 1.5.0, issue #218 row 9; MetadataDefinition.lua says why).
    LrMetadataProvider = 'MetadataDefinition.lua',
    -- Enable and Disable in Plug-in Manager start and stop the bridge (issue #174).
    LrEnablePlugin = 'PluginEnable.lua',
    LrDisablePlugin = 'PluginDisable.lua',
    -- File > Plug-in Extras (PRD FR-1.1; PHASE5_PLAN decision 7 for the HUD's first three; Approve
    -- Pass and Pick A-C from fix/hud-p1 P1-4, so every HUD button has a menu item; Abort last, as on
    -- the HUD).
    LrExportMenuItems = {
        { title = "LrC-AVG - Status", file = "MenuStatus.lua" },
        { title = "LrC-AVG - Show Vision Gateway HUD", file = "MenuHud.lua" },
        { title = "LrC-AVG - Pick A", file = "MenuPickA.lua" },
        { title = "LrC-AVG - Pick B", file = "MenuPickB.lua" },
        { title = "LrC-AVG - Pick C", file = "MenuPickC.lua" },
        { title = "LrC-AVG - Approve Pass", file = "MenuApprove.lua" },
        { title = "LrC-AVG - Accept Edit", file = "MenuAccept.lua" },
        { title = "LrC-AVG - Abort Edit", file = "MenuAbort.lua" },
    },
    VERSION = { major = 1, minor = 4, revision = 0, build = 0 },
}
