-- AVG-S7 spike (Phase 4): presets, a removal-method probe, a crop on a virtual copy, and a write and
-- export on a photo that is not selected. Throwaway; see spikes\S7\README.md. Items 4-6 re-run the
-- preset file alone, after run 1 wrote none (fix/s7-xmp).
-- LrSdkVersion 13.0: what spikes S1-S6 declared and ran with on LrC 15.5.1
-- [handle: LR_SDK_NOTES "To record in Phase 0", SDK version].
return {
    LrSdkVersion = 13.0,
    LrSdkMinimumVersion = 13.0,
    LrToolkitIdentifier = 'com.lrcavg.spike.s7',
    LrPluginName = "LrC-AVG Spike S7 (presets, crop, unselected photo)",
    LrExportMenuItems = {
        { title = "AVG S7 - 1. Run the checks (select 20260907-_OZ80093.NEF first)", file = "S7Step1.lua" },
        { title = "AVG S7 - 2. What the Presets panel shows (BEFORE restart)", file = "S7Step2.lua" },
        { title = "AVG S7 - 3. What the Presets panel shows (AFTER restart)", file = "S7Step3.lua" },
        { title = "AVG S7 - 4. Re-run: write the preset file only", file = "S7Step4.lua" },
        { title = "AVG S7 - 5. Re-run: what the Presets panel shows (BEFORE restart)", file = "S7Step5.lua" },
        { title = "AVG S7 - 6. Re-run: what the Presets panel shows (AFTER restart)", file = "S7Step6.lua" },
    },
    VERSION = { major = 0, minor = 0, revision = 2, build = 0 },
}
