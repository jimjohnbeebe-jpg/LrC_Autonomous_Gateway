-- AVG-S5 spike: getDevelopSettings() key dump, CameraProfile capture, write/readback test.
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
        { title = "AVG S5 - Dump develop settings of target photo", file = "S5Dump.lua" },
        { title = "AVG S5 - Write test (CameraProfile + EnableLensCorrections)", file = "S5WriteTest.lua" },
        { title = "AVG S5 - Optional write test B (LensProfileEnable = 1)", file = "S5WriteTestB.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
