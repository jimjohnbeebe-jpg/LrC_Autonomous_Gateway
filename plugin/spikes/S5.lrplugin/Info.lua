-- AVG-S5 spike: getDevelopSettings() key dump, camera-profile capture, write/readback tests.
-- Throwaway; see spikes\S5\README.md.
-- LrSdkVersion 13.0 [unverified: highest SDK level LrC 15.5.1 accepts]. If Lightroom gates
-- newer develop keys on the plugin's declared SDK version [unverified], a dump taken at 13.0
-- could miss keys added in SDK 14/15; the dump's meta records the declared version.
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s5',
    LrPluginName = "LrC-AVG Spike S5 (develop key dump)",
    LrExportMenuItems = {
        { title = "AVG S5 - 1. Start profile recorder", file = "S5RecordStart.lua" },
        { title = "AVG S5 - 2. Stop profile recorder", file = "S5RecordStop.lua" },
        { title = "AVG S5 - 3. Run write tests (automatic)", file = "S5WriteTests.lua" },
        { title = "AVG S5 - Dump develop settings of target photo (part 1)", file = "S5Dump.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 2, build = 0 },
}
