-- AVG-S1 spike: preview freshness + latency. Throwaway; see spikes\S1\README.md.
-- LrSdkVersion 13.0 [unverified: highest SDK level LrC 15.5.1 accepts; see LR_SDK_NOTES "To record in Phase 0"].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s1',
    LrPluginName = "LrC-AVG Spike S1 (preview freshness)",
    -- LrExportMenuItems appear under File > Plug-in Extras, reachable from Develop [unverified on 15.5.1].
    LrExportMenuItems = {
        { title = "AVG S1 - Run preview freshness + latency", file = "S1Run.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
