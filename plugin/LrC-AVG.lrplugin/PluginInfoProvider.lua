-- The settings page: LrC-AVG's section in File > Plug-in Manager (PRD section 6.2, AVG-006,
-- PHASE5_PLAN decision 2 and row 3). The HUD shows these values read-only while the engine sends no
-- session settings of its own (row 4, HudView.props).
--
-- Every field is bound straight to LrPrefs.prefsForPlugin(), with bind_to_object on its group box
-- and on its row: S8's group B, which saved each value as it was edited, let the running bridge
-- task see the change within 2 s and kept it across a restart; a section whose fields had no
-- bind_to_object saved nothing [handle: docs\reports\phase5\S8.md "Consequences";
-- plugin\spikes\S8.lrplugin\S8InfoProvider.lua group(), row()]. No observers and no endDialog copy
-- (S8's groups A and C), as Jim chose [stated: "Accept all (Recommended)", S8 question 6].
-- `precision` makes an edit field numeric and `min`/`max` bound it [handle:
-- https://lrc.mcor.dev/modules/LrView%20edit%20view%20properties.html, read 2026-09-28]; over its
-- maximum the field warns and does not keep the value [stated: Jim's tick boxes in S8].
-- What the fields hold is checked again on every read (Prefs.lua), so a value the page lets through
-- can never reach the engine unchecked.

local LrPrefs = import 'LrPrefs'
local LrView = import 'LrView'

local Prefs = require 'Prefs'

local Provider = {}

local LABEL_CHARS = 30

local function row(f, prefs, label, control, note)
    local items = { bind_to_object = prefs, f:static_text { title = label, width_in_chars = LABEL_CHARS }, control }
    if note then items[#items + 1] = f:static_text { title = note } end
    return f:row(items)
end

local function number(f, key, spec, precision, chars)
    return f:edit_field { value = LrView.bind(key), precision = precision, min = spec.min, max = spec.max, width_in_chars = chars or 6 }
end

local function specOf(key)
    for _, spec in ipairs(Prefs.SPECS) do
        if spec.key == key then return spec end
    end
    error("Prefs.SPECS has no " .. key)
end

local function range(key)
    local spec = specOf(key)
    return "(" .. spec.min .. "-" .. spec.max .. ")"
end

local function box(f, prefs, title, rows)
    local items = { title = title, bind_to_object = prefs, fill_horizontal = 1 }
    for _, r in ipairs(rows) do items[#items + 1] = r end
    return f:group_box(items)
end

local function sessionBox(f, prefs)
    return box(f, prefs, "Sessions", {
        row(f, prefs, "Mode:", f:popup_menu {
            value = LrView.bind("mode"),
            items = {
                { title = "Autonomous", value = "autonomous" },
                { title = "Approve each pass", value = "approve_each_pass" },
            },
        }),
        row(f, prefs, "Max passes per photo " .. range("maxPasses") .. ":", number(f, "maxPasses", specOf("maxPasses"), 0)),
        row(f, prefs, "Variant count " .. range("variantCount") .. ":", number(f, "variantCount", specOf("variantCount"), 0),
            "copies in Variants mode"),
        row(f, prefs, "Step decay per pass:", f:edit_field { value = LrView.bind("decay"), width_in_chars = 20 },
            "1 to " .. Prefs.DECAY_MAX_VALUES .. " numbers above 0 and at most 1, e.g. 1.0, 0.6, 0.4, 0.25"),
    })
end

local function guardrailBox(f, prefs)
    return box(f, prefs, "Guardrails (an intent's own limits come first)", {
        row(f, prefs, "Highlight clipping, % of pixels:", number(f, "clipHighPct", specOf("clipHighPct"), 2), "pixels at 253 or above"),
        row(f, prefs, "Shadow crushing, % of pixels:", number(f, "clipLowPct", specOf("clipLowPct"), 2), "pixels at 2 or below"),
    })
end

local function previewBox(f, prefs)
    return box(f, prefs, "Previews", {
        row(f, prefs, "Long edge, pixels " .. range("previewLongEdge") .. ":", number(f, "previewLongEdge", specOf("previewLongEdge"), 0)),
        row(f, prefs, "JPEG quality " .. range("previewQuality") .. ":", number(f, "previewQuality", specOf("previewQuality"), 0)),
        row(f, prefs, "Temp preview folder:", f:static_text { title = Prefs.tempPreviewDir() }, "(fixed)"),
    })
end

local function folderBox(f, prefs)
    return box(f, prefs, "Folders (blank: the default; the engine's LRC_AVG_* variable wins when set)", {
        row(f, prefs, "Intents folder:", f:edit_field { value = LrView.bind("intentsFolder"), width_in_chars = 45 }),
        f:static_text { title = "Default: %LOCALAPPDATA%\\LrC-AVG\\intents. Variable: LRC_AVG_INTENTS_DIR." },
        row(f, prefs, "Log folder:", f:edit_field { value = LrView.bind("logFolder"), width_in_chars = 45 }),
        f:static_text { title = "Default: %LOCALAPPDATA%\\LrC-AVG\\logs. Variable: LRC_AVG_LOG_DIR (the development Claude Desktop entry sets it)." },
    })
end

local function bridgeBox(f, prefs)
    return box(f, prefs, "Bridge ports (apply at the next Lightroom start)", {
        row(f, prefs, "Receive port " .. range("receivePort") .. ":", number(f, "receivePort", specOf("receivePort"), 0, 7)),
        row(f, prefs, "Send port " .. range("sendPort") .. ":", number(f, "sendPort", specOf("sendPort"), 0, 7)),
        f:static_text { title = "The two must differ, and " .. Prefs.LOCK_PORT .. " is the engine's own." },
    })
end

-- What was not valid when the page opened (Prefs.read), so a value that is not used does not pass
-- silently.
local function invalidLines(f, prefs)
    local _, invalid = Prefs.read(prefs)
    if #invalid == 0 then return f:static_text { title = "All settings were valid when this page opened." } end
    -- One static_text per line: whether a title with line breaks shows several lines is [unverified].
    local lines = { f:static_text { title = "Not valid when this page opened, so the default is used:" } }
    for _, item in ipairs(invalid) do
        lines[#lines + 1] = f:static_text { title = "  " .. item.key .. " = " .. tostring(item.value) .. ": " .. tostring(item.reason) }
    end
    return f:column(lines)
end

function Provider.sectionsForTopOfDialog(f, _propertyTable)
    local prefs = LrPrefs.prefsForPlugin()
    Prefs.fillDefaults(prefs)
    return {
        {
            title = "LrC-AVG settings",
            f:static_text { title = "Saved as you change them. Claude's next session reads them; a session already open keeps its own." },
            sessionBox(f, prefs),
            guardrailBox(f, prefs),
            previewBox(f, prefs),
            folderBox(f, prefs),
            bridgeBox(f, prefs),
            invalidLines(f, prefs),
        },
    }
end

return Provider
