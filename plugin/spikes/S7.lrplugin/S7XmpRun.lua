-- AVG-S7 menu item 4, the preset-file re-run: run 1 wrote no preset file (S7Presets.fileUuid says
-- why), so this writes only "AVG S7 xmp <run date-time>" next to "AVG S7 reference" and lists what
-- Lightroom knows right after. It needs no selected photo, makes no copies and changes no photo.
-- Saves s7_xmp_run_<time>.json and s7_xmp_state.txt, which menu items 5 and 6 read before and after
-- the restart. Run 1's files and s7_state.txt are left as they are.

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'

local Common = require 'S7Common'
local S7Presets = require 'S7Presets'

local S7XmpRun = {}

local function stateOf(result)
    local p = result.presets
    return {
        run_at = result.run_at,
        reference_uuid = tostring(p.reference.uuid),
        reference_group = tostring(p.reference_group),
        xmp_name = p.names.xmp,
        xmp_uuid = p.xmp.uuid or "",
        xmp_path = p.xmp.path or "",
        xmp_bytes = p.xmp.bytes or "",
    }
end

local function message(p)
    local name = "\"" .. p.names.xmp .. "\""
    if not p.xmp.path then
        return "Preset file " .. name .. ": NOT WRITTEN - " .. tostring(p.xmp.error) .. "\n\nStop here and tell Claude Code."
    end
    return "Preset file " .. name .. ": WRITTEN\n" ..
        "Lightroom lists it right now: " .. (p.xmp_listed_as and "YES" or "NO") .. "\n\n" ..
        "Next: press D, and in the Presets panel (left) open the group \"" .. tostring(p.reference_group) ..
        "\" and look for \"" .. S7Presets.REFERENCE .. "\" and " .. name .. ".\n" ..
        "Then run \"AVG S7 - 5\" and tick what you saw."
end

function S7XmpRun.run()
    LrFunctionContext.postAsyncTaskWithContext("AVG S7 step 4", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)
        local _, index = S7Presets.list()
        local ref = index[S7Presets.REFERENCE]
        if not ref then
            LrDialogs.message("AVG S7 - stopped before changing anything",
                "There is no preset named \"" .. S7Presets.REFERENCE .. "\". Create it as spikes\\S7\\README.md says, then run this again.", "warning")
            return
        end
        local names = S7Presets.names(Common.runTag())
        local result = { spike = "S7", step = "4-xmp-run", run_at = Common.localTime(), lr_version = LrApplication.versionString() }
        local p = { names = names, reference = (S7Presets.describe(ref.preset)), reference_group = ref.where, xmp = {} }
        S7Presets.writeXmp(ref.preset, names.xmp, p.xmp)
        local listing, after = S7Presets.list()
        p.listed_after, p.xmp_listed_as = listing, after[names.xmp] and after[names.xmp].where or false
        result.presets = p
        local stateOk, stateErr = Common.saveState(stateOf(result), Common.XMP_STATE_FILE)
        result.state_saved = stateOk or tostring(stateErr)
        local ok, err = Common.save("s7_xmp_run", result)
        LrDialogs.message("AVG S7 - preset file", message(p) .. "\n\n" .. Common.saveLine(ok and stateOk, err or stateErr),
            (p.xmp.path and ok and stateOk) and "info" or "warning")
    end)
end

return S7XmpRun
