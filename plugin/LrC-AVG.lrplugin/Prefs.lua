-- The plugin's settings (PRD section 6.2, AVG-006; PHASE5_PLAN decision 2 and row 3): their keys in
-- LrPrefs.prefsForPlugin(), defaults and ranges, the check every read goes through, and the bridge
-- command get_prefs that hands them to the engine at session start.
--
-- The settings page (PluginInfoProvider.lua) binds its fields straight to the prefs table, S8's
-- group B: those fields saved as they were edited, the running bridge task saw a change within 2 s,
-- and the values survived a restart [handle: docs\reports\phase5\S8.md "Consequences";
-- LR_SDK_NOTES "Recorded in Phase 5", Plug-in Manager section]. A numeric field refuses a value over
-- its maximum with a warning [stated: Jim's tick boxes in S8], but what the field holds afterwards is
-- [unverified], and a stored value can be anything an earlier plugin wrote. So every read is checked
-- here: a value that fails keeps its key out of use, the default goes to the engine instead, and the
-- key is listed in `invalid` with the reason.
--
-- engine\tests\lua-plugin.test.ts checks SPECS against the engine's PAGE_SPECS
-- (engine\src\settings\page.ts): the same keys, defaults and ranges on both sides. Keep one spec
-- per line.

local LrPathUtils = import 'LrPathUtils'
local LrPrefs = import 'LrPrefs'

local Prefs = {}

-- The engine's instance lock listens on 127.0.0.1:8767 (engine\src\mcp\instance-lock.ts
-- lockPortFor, the default event port + 1), so neither bridge port may take it (PHASE5_PLAN row 3,
-- decision 3 [stated: Jim, 2026-09-28, "Go with recommendations"]).
Prefs.LOCK_PORT = 8767

-- key: the LrPrefs key (receivePort/sendPort are the names Bridge.lua has read since Phase 1);
-- wire: the get_prefs field. Ranges and defaults: PRD 6.2, with the variant count 2-3
-- (PHASE5_PLAN decision 2a). The clip limits' 0-100 is the range lr_begin_session accepts
-- (engine\src\mcp\defs-session.ts beginArgs.guardrails); the ports' lower bound 1024 keeps to the
-- ports Windows does not reserve for system services [inference].
Prefs.SPECS = {
    { key = "mode", wire = "mode", kind = "choice", default = "autonomous", choices = { "autonomous", "approve_each_pass" } },
    { key = "maxPasses", wire = "max_passes", kind = "int", default = 4, min = 1, max = 8 },
    { key = "variantCount", wire = "variant_count", kind = "int", default = 3, min = 2, max = 3 },
    { key = "previewLongEdge", wire = "long_edge", kind = "int", default = 1600, min = 800, max = 1920 },
    { key = "previewQuality", wire = "quality", kind = "int", default = 75, min = 60, max = 90 },
    { key = "clipHighPct", wire = "clip_high_pct", kind = "number", default = 0.5, min = 0, max = 100 },
    { key = "clipLowPct", wire = "clip_low_pct", kind = "number", default = 1.0, min = 0, max = 100 },
    { key = "decay", wire = "decay", kind = "decay", default = "1.0, 0.6, 0.4, 0.25" },
    { key = "intentsFolder", wire = "intents_dir", kind = "folder", default = "" },
    { key = "logFolder", wire = "log_dir", kind = "folder", default = "" },
    { key = "receivePort", wire = "receive_port", kind = "port", default = 8765, min = 1024, max = 65535 },
    { key = "sendPort", wire = "send_port", kind = "port", default = 8766, min = 1024, max = 65535 },
}

-- The decay schedule: 1 to 8 multipliers, each above 0 and at most 1, as the engine applies them
-- (engine\src\session\rules.ts decayFor).
Prefs.DECAY_MAX_VALUES = 8

local function trim(s)
    return (s:match("^%s*(.-)%s*$"))
end

-- Every entry between commas counts: an empty one ("0.5," or "0.5,,0.3") is refused, not skipped,
-- so a schedule is never silently shortened (Greptile, PR #44).
function Prefs.parseDecay(v)
    if type(v) ~= "string" then return nil, "not text" end
    if trim(v) == "" then return nil, "give 1 to " .. Prefs.DECAY_MAX_VALUES .. " values, separated by commas" end
    local out = {}
    for part in (v .. ","):gmatch("([^,]*),") do
        local s = trim(part)
        if s == "" then return nil, "an empty entry between commas" end
        local n = tonumber(s)
        if n == nil or n ~= n or n <= 0 or n > 1 then
            return nil, "each value must be a number above 0 and at most 1, not \"" .. s .. "\""
        end
        out[#out + 1] = n
    end
    if #out < 1 or #out > Prefs.DECAY_MAX_VALUES then
        return nil, "give 1 to " .. Prefs.DECAY_MAX_VALUES .. " values, separated by commas"
    end
    return out
end

local function checkNumber(spec, v)
    local n = (type(v) == "number" or type(v) == "string") and tonumber(v) or nil
    if n == nil or n ~= n then return nil, "not a number" end
    if (spec.kind == "int" or spec.kind == "port") and n ~= math.floor(n) then return nil, "not a whole number" end
    if n < spec.min or n > spec.max then return nil, "outside " .. spec.min .. "-" .. spec.max end
    if spec.kind == "port" and n == Prefs.LOCK_PORT then return nil, Prefs.LOCK_PORT .. " is the engine's own port" end
    return n
end

-- A folder is blank (the engine's default) or a full path: a drive letter or a network share.
local function checkFolder(v)
    if type(v) ~= "string" then return nil, "not text" end
    local s = trim(v)
    if s == "" then return "" end
    if not (s:match("^%a:[\\/]") or s:match("^[\\/][\\/][^\\/]")) then
        return nil, "not a full path (for example D:\\Photos\\LrC-AVG\\intents)"
    end
    return s
end

-- One value checked against its spec: the value to use, or nil and why not. A missing value (nil)
-- is the default, and not listed as invalid.
function Prefs.check(spec, v)
    if v == nil then
        if spec.kind == "decay" then return Prefs.parseDecay(spec.default) end
        return spec.default
    end
    if spec.kind == "choice" then
        for _, c in ipairs(spec.choices) do
            if v == c then return v end
        end
        return nil, "not one of " .. table.concat(spec.choices, ", ")
    elseif spec.kind == "decay" then
        return Prefs.parseDecay(v)
    elseif spec.kind == "folder" then
        return checkFolder(v)
    end
    return checkNumber(spec, v)
end

local function shown(v)
    local s = tostring(v)
    return #s > 80 and (s:sub(1, 80) .. "...") or s
end

-- The checked settings, by LrPrefs key, and the keys that failed with their reasons. `prefs` is
-- LrPrefs.prefsForPlugin() unless given (the smoke test passes a table).
function Prefs.read(prefs)
    prefs = prefs or LrPrefs.prefsForPlugin()
    local values, invalid = {}, {}
    local function default(spec)
        if spec.kind == "decay" then return (Prefs.parseDecay(spec.default)) end
        return spec.default
    end
    for _, spec in ipairs(Prefs.SPECS) do
        local raw = prefs[spec.key]
        local v, why = Prefs.check(spec, raw)
        if v == nil then
            invalid[#invalid + 1] = { key = spec.key, value = shown(raw), reason = why }
            v = default(spec)
        end
        values[spec.key] = v
    end
    if values.receivePort == values.sendPort then
        invalid[#invalid + 1] = { key = "sendPort", value = shown(values.sendPort), reason = "the same as the receive port" }
        values.receivePort, values.sendPort = 8765, 8766
    end
    return values, invalid
end

-- The ports the bridge binds (Bridge.lua), checked like every other setting.
function Prefs.ports(prefs)
    local values = Prefs.read(prefs)
    return values.receivePort, values.sendPort
end

-- Where the engine reads previews: fixed, shown on the page only (PHASE5_PLAN decision 2c). The
-- same folder as Preview.directory(), built here so the page need not load the export code; the
-- engine's folder is %TEMP%\LrC-AVG\previews (engine\src\preview\service.ts), and "temp" here is
-- %TEMP% [handle: LR_SDK_NOTES "Recorded in Phase 1", Standard paths].
function Prefs.tempPreviewDir()
    return LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "previews")
end

-- Stored defaults for keys that have no value yet, so the page's fields start filled in [inference: a
-- field bound to a nil key would show empty; S8's page stored its defaults the same way,
-- plugin\spikes\S8.lrplugin\S8InfoProvider.lua ensureDefaults].
function Prefs.fillDefaults(prefs)
    for _, spec in ipairs(Prefs.SPECS) do
        if prefs[spec.key] == nil then prefs[spec.key] = spec.default end
    end
end

-- Bridge command get_prefs (engine\src\bridge\protocol.ts COMMANDS.get_prefs): every setting under
-- its wire name, checked; `invalid` lists what was replaced by its default.
function Prefs.getPrefs(_payload)
    local values, invalid = Prefs.read()
    local out = { temp_preview_dir = Prefs.tempPreviewDir(), invalid = invalid }
    for _, spec in ipairs(Prefs.SPECS) do out[spec.wire] = values[spec.key] end
    return out
end

return Prefs
