-- Copy of plugin\spikes\S5.lrplugin\SpikeJson.lua (each .lrplugin can only require its own
-- files). Keep in step with the S5 original, which was checked under fengari
-- (docs\reports\phase0\S5.md "Pre-run findings").
-- Minimal JSON encoder (encode only, pretty-printed, keys sorted).
-- Lua cannot tell an empty array from an empty object: empty tables are written as [].
-- Non-finite numbers are written as the strings "NaN", "Infinity", "-Infinity".
-- Values JSON cannot hold (functions, userdata) are written as "<type: tostring>".

local SpikeJson = {}

local ESCAPES = {
    ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
    ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function encodeString(s)
    local escaped = s:gsub('[%c"\\]', function(c)
        return ESCAPES[c] or string.format("\\u%04x", c:byte())
    end)
    return '"' .. escaped .. '"'
end

local function encodeNumber(n)
    if n ~= n then return '"NaN"' end
    if n == math.huge then return '"Infinity"' end
    if n == -math.huge then return '"-Infinity"' end
    -- "%.0f", not "%d": %d goes through a C integer that may be 32-bit and would wrap
    -- large integral values; "%.0f" is exact for any integral double below 1e15.
    if n == math.floor(n) and math.abs(n) < 1e15 then return string.format("%.0f", n) end
    return string.format("%.14g", n)
end

local function isArray(t)
    local count = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then return false end
        count = count + 1
    end
    for i = 1, count do
        if t[i] == nil then return false end
    end
    return true
end

local encodeValue

local function encodeTable(t, indent, depth)
    if depth > 32 then return '"<max depth>"' end
    local pad = string.rep("  ", depth + 1)
    local closePad = string.rep("  ", depth)
    local parts = {}
    if isArray(t) then
        if #t == 0 then return "[]" end
        for i = 1, #t do
            parts[i] = pad .. encodeValue(t[i], indent, depth + 1)
        end
        return "[\n" .. table.concat(parts, ",\n") .. "\n" .. closePad .. "]"
    end
    local keys = {}
    for k in pairs(t) do table.insert(keys, tostring(k)) end
    table.sort(keys)
    local lookup = {}
    for k, v in pairs(t) do lookup[tostring(k)] = v end
    for i, k in ipairs(keys) do
        parts[i] = pad .. encodeString(k) .. ": " .. encodeValue(lookup[k], indent, depth + 1)
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n" .. closePad .. "}"
end

encodeValue = function(v, indent, depth)
    local tv = type(v)
    if v == nil then return "null" end
    if tv == "boolean" then return v and "true" or "false" end
    if tv == "number" then return encodeNumber(v) end
    if tv == "string" then return encodeString(v) end
    if tv == "table" then return encodeTable(v, indent, depth) end
    return encodeString("<" .. tv .. ": " .. tostring(v) .. ">")
end

function SpikeJson.encode(value)
    return encodeValue(value, true, 0)
end

-- Write `value` as JSON to `path`; returns true or false, error.
function SpikeJson.writeFile(path, value)
    local fh, err = io.open(path, "wb")
    if not fh then return false, err end
    fh:write(SpikeJson.encode(value), "\n")
    fh:close()
    return true
end

return SpikeJson
