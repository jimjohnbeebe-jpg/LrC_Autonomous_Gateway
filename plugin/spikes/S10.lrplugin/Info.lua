-- AVG-S10 spike: the profile recorder for the rendered pipeline (PHASE8_PLAN row 1). It is the
-- S5 part-2 recorder (plugin\spikes\S5.lrplugin\S5Recorder.lua) writing to its own folder, so Jim's
-- clicks on a JPEG's profiles (Color, Monochrome) are recorded as (CameraProfile, Look) pairs for
-- `npm run s10:check` to write back. Throwaway; see spikes\S10\README.md.
-- LrSdkVersion 13.0 as S5 declared it [handle: plugin\spikes\S5.lrplugin\Info.lua].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s10',
    LrPluginName = "LrC-AVG Spike S10 (rendered profiles)",
    LrExportMenuItems = {
        { title = "AVG S10 - 1. Start profile recorder", file = "S10RecordStart.lua" },
        { title = "AVG S10 - 2. Stop profile recorder", file = "S10RecordStop.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
