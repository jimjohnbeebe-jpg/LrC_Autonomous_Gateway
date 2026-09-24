-- AVG-S4 spike: floating, non-modal HUD with live-updating labels. Throwaway; see spikes\S4\README.md.
-- LrSdkVersion 13.0 [unverified: highest SDK level LrC 15.5.1 accepts].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s4',
    LrPluginName = "LrC-AVG Spike S4 (floating HUD)",
    LrExportMenuItems = {
        { title = "AVG S4 - Show floating HUD (30 s live update)", file = "S4Hud.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
