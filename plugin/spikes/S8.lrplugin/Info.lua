-- AVG-S8 spike (Phase 5, PHASE5_PLAN row 1): push buttons in a floating HUD, focus when it opens,
-- closing it from code, module state shared between scripts, and a Plug-in Manager settings section
-- saved in LrPrefs across a restart. Throwaway; see spikes\S8\README.md.
-- The plugin is laid out like plugin\LrC-AVG.lrplugin: an init script starts a long-running task
-- (here S8Loop.lua, there the bridge), and menu items reach it through a file.
-- LrSdkVersion 13.0: what spikes S1-S7 and the LrC-AVG plugin declare and ran with on LrC 15.5.1
-- [handle: LR_SDK_NOTES "To record in Phase 0", SDK version].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s8',
    LrPluginName = "LrC-AVG Spike S8 (HUD buttons, focus, settings page)",
    LrPluginInfoProvider = 'S8InfoProvider.lua',
    LrInitPlugin = 'S8Init.lua',
    LrForceInitPlugin = true,
    LrExportMenuItems = {
        { title = "AVG S8 - 1. HUD test (the HUD opens by itself after 5 s)", file = "S8Step1.lua" },
        { title = "AVG S8 - 2. Close the HUD from code", file = "S8Step2.lua" },
        { title = "AVG S8 - 3. Save the settings (BEFORE restart)", file = "S8Step3.lua" },
        { title = "AVG S8 - 4. Save the settings (AFTER restart)", file = "S8Step4.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
