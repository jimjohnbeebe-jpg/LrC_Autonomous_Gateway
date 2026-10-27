-- The runtime gate for SDK calls from a Lightroom Classic newer than LrSdkMinimumVersion (Info.lua; GitHub
-- issue #209). Declaring an older minimum than the SDK version is the pattern the guide gives for a plug-in with
-- newer features [handle: Manual\Lightroom Classic SDK Guide.pdf p. 23, LrSdkMinimumVersion]; the plug-in then
-- loads on the old Lightroom, so each feature that needs a later release checks the call it makes before making it.
-- Needs.check probes the call with type(obj[name]) == "function", as the upstream plugin does [handle:
-- vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerDevelop.lua:336], and a Lightroom that lacks one answers
-- feature_unavailable, naming the release the SDK reference gives ("First supported in version N of the
-- Lightroom Classic SDK") and the call. The caller returns that answer before it changes anything. The engine passes
-- the code and the message on as the tool's FEATURE_UNAVAILABLE error (engine\src\mcp\errors.ts fromBridge).
--
-- Where each gate sits (engine\tests\sdk-version-gate.test.ts checks that no call bypasses it):
--   photo:updateAISettings           13.3  Masks.updateAISettings [handle: API Reference\modules\LrPhoto.html:1308, SDK 15.2]
--   getEnhancePanelState,
--   changeDenoiseAmount              14.5  Denoise.apply [handle: API Reference\modules\LrDevelopController.html:730, 1131]
--   setEnhance                       none documented: not in the 15.2 reference at all [handle: grep -ri setEnhance
--                                    "API Reference" finds nothing]; it worked on LrC 15.6 [handle: LR_SDK_NOTES
--                                    "Recorded in Phase 9"], so its first release is [unverified] and the 14.5 above
--                                    is that of the two documented calls beside it.
-- The mask calls (getAllMasks, createNewMask, ...) are from 11.0 [handle: LrDevelopController.html, "First supported
-- in version 11.0"], below LrSdkMinimumVersion 13.0, so they have no gate of their own; MaskProbe.lua still probes
-- them, to name a build that lacks one.

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Needs = {}

-- type(obj[name]), or nil when the lookup raises: inside LrTasks.pcall, as spike S7 did; it saw "function" for
-- methods that exist [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json removal_probe.photo.controls].
function Needs.kind(obj, name)
    local ok, t = LrTasks.pcall(function() return type(obj[name]) end)
    return ok and t or nil
end

-- true when `obj` has every function in `names`; else nil plus the feature_unavailable error
-- { code, message, recoverable } (PRD NFR-7). `feature` is what the caller offers ("AI Denoise"), `version` the
-- Lightroom Classic release that has the calls, `prefix` how the SDK writes them ("LrDevelopController.",
-- "photo:"). Recoverable: the same call works once Lightroom is updated.
function Needs.check(feature, version, prefix, obj, names)
    local missing = {}
    for _, name in ipairs(names) do
        if Needs.kind(obj, name) ~= "function" then missing[#missing + 1] = prefix .. name end
    end
    if #missing == 0 then return true end
    return nil, { code = "feature_unavailable", recoverable = true,
        message = feature .. " needs Lightroom Classic " .. version .. " or later: " .. table.concat(missing, ", ") ..
            " not found in this Lightroom Classic " .. tostring(LrApplication.versionString()) }
end

-- true when this Lightroom Classic is `major`.`minor` or later; else nil plus feature_unavailable, as check. For a
-- feature that is a metadata key, not a call, so there is no function to probe (plugin 1.5.0: the accessibility
-- texts, "first supported in version 13.2" [handle: API Reference\modules\LrPhoto.html, getFormattedMetadata and
-- setRawMetadata, SDK 15.2]). LrApplication.versionTable() gives major and minor [handle: modules\LrApplication.html
-- versionTable]; a Lightroom whose version cannot be read is refused.
function Needs.release(feature, major, minor)
    local ok, v = LrTasks.pcall(LrApplication.versionTable)
    if ok and type(v) == "table" and type(v.major) == "number" then
        if v.major > major or (v.major == major and (tonumber(v.minor) or 0) >= minor) then return true end
    end
    return nil, { code = "feature_unavailable", recoverable = true,
        message = feature .. " needs Lightroom Classic " .. major .. "." .. minor .. " or later; this is Lightroom Classic " ..
            tostring(LrApplication.versionString()) }
end

return Needs
