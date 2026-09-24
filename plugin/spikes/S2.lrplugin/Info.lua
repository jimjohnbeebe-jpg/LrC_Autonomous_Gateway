-- AVG-S2 spike: LrSocket dual socket echo. Throwaway; see spikes\S2\README.md.
-- LrSdkVersion 13.0 [unverified: highest SDK level LrC 15.5.1 accepts]. LrSocket is SDK 6.0+ (LR_SDK_NOTES).
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s2',
    LrPluginName = "LrC-AVG Spike S2 (LrSocket echo)",
    LrExportMenuItems = {
        { title = "AVG S2 - Start echo server (8765 receive / 8766 send)", file = "S2Start.lua" },
        { title = "AVG S2 - Stop echo server", file = "S2Stop.lua" },
        { title = "AVG S2 - Show status", file = "S2Status.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
