-- AVG-S6 spike: catalog:createVirtualCopies from Loupe and from Grid. Throwaway; see spikes\S6\README.md.
-- LrSdkVersion 13.0 [unverified: highest SDK level LrC 15.5.1 accepts].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s6',
    LrPluginName = "LrC-AVG Spike S6 (virtual copies)",
    LrExportMenuItems = {
        { title = "AVG S6 - Create 3 virtual copies (I am in LOUPE view)", file = "S6FromLoupe.lua" },
        { title = "AVG S6 - Create 3 virtual copies (I am in GRID view)", file = "S6FromGrid.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
