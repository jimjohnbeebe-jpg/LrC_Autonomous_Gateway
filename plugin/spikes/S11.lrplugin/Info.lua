-- AVG-S11 spike: catalog metadata the engine has no tool for yet (issues #111, #112, #139 gaps 2
-- and 4): pick flags, title/caption/headline, GPS altitude, folder search, and stacks. One menu
-- item runs it on the selected photo of the "fixtures" collection and puts the photo back.
-- Throwaway; see spikes\S11\README.md.
-- LrSdkVersion 13.0 as S10 declared it [handle: plugin\spikes\S10.lrplugin\Info.lua].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s11',
    LrPluginName = "LrC-AVG Spike S11 (catalog metadata)",
    LrExportMenuItems = {
        { title = "AVG S11 - Run on the selected photo", file = "S11Run.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 1, build = 0 },
}
