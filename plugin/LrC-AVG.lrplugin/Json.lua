-- JSON encoder/decoder for the bridge (Lua 5.1, no utf8 library).
--
-- Derived from Automaat's JSON.lua (vendor\automaat\plugin\LightroomMCP.lrplugin\JSON.lua, MIT,
-- see THIRD_PARTY_NOTICES.md). Changes from upstream:
--   * String escaping touches only '"', '\' and the ASCII control bytes (0-31, 127). Upstream
--     escaped every '%c' match; '%c' follows the C library's locale, and a locale that counts
--     bytes 0x80-0x9F as control characters would break UTF-8 [inference]. Bytes >= 128 pass
--     through unchanged, so UTF-8 text crosses as UTF-8.
--   * Numbers are written with "%.14g" (Lua 5.1's own tostring precision); NaN and infinities
--     become null, since JSON cannot hold them.
--   * Functions and userdata are an encode error instead of being written as strings.
-- Kept from upstream: an empty table encodes as [] (Lua cannot tell [] from {}); the engine
-- treats [] and {} alike for empty tables (engine\src\params\camera-profiles.ts isEmptyLook).

local Json = {}

local SHORT_ESCAPES = {
    ['"'] = '\\"', ['\\'] = '\\\\',
    ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f',
}

local function escapeString(s)
    return (s:gsub('[%c"\\]', function(c)
        local b = c:byte()
        if b >= 128 then return c end -- a UTF-8 byte some locales classify as control: keep it
        return SHORT_ESCAPES[c] or string.format('\\u%04x', b)
    end))
end

local function encodeNumber(n)
    if n ~= n or n == math.huge or n == -math.huge then return "null" end
    return string.format("%.14g", n)
end

local function isArray(t)
    if next(t) == nil then return true end
    local n = #t
    if n == 0 then return false end
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    return count == n
end

local function encodeValue(v, depth)
    if depth > 64 then error("Json.encode: nesting deeper than 64") end
    local t = type(v)
    if t == "string" then
        return '"' .. escapeString(v) .. '"'
    elseif t == "number" then
        return encodeNumber(v)
    elseif t == "boolean" then
        return tostring(v)
    elseif t == "nil" then
        return "null"
    elseif t == "table" then
        local parts = {}
        if isArray(v) then
            for i = 1, #v do parts[i] = encodeValue(v[i], depth + 1) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        for k, val in pairs(v) do
            parts[#parts + 1] = '"' .. escapeString(tostring(k)) .. '":' .. encodeValue(val, depth + 1)
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    error("Json.encode: cannot encode a " .. t)
end

function Json.encode(v)
    return encodeValue(v, 0)
end

-- UTF-8 bytes for a code point (Lua 5.1 has no utf8 library).
local function codepointToUtf8(cp)
    if cp < 0x80 then
        return string.char(cp)
    elseif cp < 0x800 then
        return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + (cp % 0x40))
    elseif cp < 0x10000 then
        return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + (math.floor(cp / 0x40) % 0x40), 0x80 + (cp % 0x40))
    end
    return string.char(0xF0 + math.floor(cp / 0x40000), 0x80 + (math.floor(cp / 0x1000) % 0x40),
        0x80 + (math.floor(cp / 0x40) % 0x40), 0x80 + (cp % 0x40))
end

-- One \uXXXX escape at `pos` (the backslash), pairing surrogates; a lone surrogate becomes U+FFFD.
local function decodeUnicodeEscape(str, pos)
    local hex = str:sub(pos + 2, pos + 5)
    if not hex:match('^%x%x%x%x$') then error('Json.decode: invalid unicode escape \\u' .. hex) end
    local cp = tonumber(hex, 16)
    local nextPos = pos + 6
    if cp >= 0xD800 and cp <= 0xDBFF then
        local low = nil
        if str:sub(nextPos, nextPos + 1) == '\\u' then
            local lowHex = str:sub(nextPos + 2, nextPos + 5)
            low = lowHex:match('^%x%x%x%x$') and tonumber(lowHex, 16)
        end
        if low and low >= 0xDC00 and low <= 0xDFFF then
            cp = 0x10000 + (cp - 0xD800) * 0x400 + (low - 0xDC00)
            nextPos = nextPos + 6
        else
            cp = 0xFFFD
        end
    elseif cp >= 0xDC00 and cp <= 0xDFFF then
        cp = 0xFFFD
    end
    return codepointToUtf8(cp), nextPos
end

local ESCAPE_CHARS = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', n = '\n', r = '\r', t = '\t', b = '\b', f = '\f' }

function Json.decode(str)
    local pos = 1

    local function skipWhitespace()
        pos = str:find('[^ \t\r\n]', pos) or (#str + 1)
    end

    local decodeValue

    local function decodeString()
        pos = pos + 1
        local chars = {}
        while pos <= #str do
            local c = str:sub(pos, pos)
            if c == '"' then
                pos = pos + 1
                return table.concat(chars)
            elseif c == '\\' then
                local e = str:sub(pos + 1, pos + 1)
                if e == 'u' then
                    local text, nextPos = decodeUnicodeEscape(str, pos)
                    chars[#chars + 1] = text
                    pos = nextPos
                elseif ESCAPE_CHARS[e] then
                    chars[#chars + 1] = ESCAPE_CHARS[e]
                    pos = pos + 2
                else
                    error("Json.decode: invalid escape \\" .. e)
                end
            else
                -- Copy a run of plain characters at once.
                local stop = str:find('["\\]', pos) or (#str + 1)
                chars[#chars + 1] = str:sub(pos, stop - 1)
                pos = stop
            end
        end
        error("Json.decode: unterminated string")
    end

    local function decodeNumber()
        local numberText = str:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
        local value = numberText and tonumber(numberText)
        if value == nil then error("Json.decode: invalid number at " .. pos) end
        pos = pos + #numberText
        return value
    end

    decodeValue = function()
        skipWhitespace()
        local c = str:sub(pos, pos)
        if c == '"' then
            return decodeString()
        elseif c == '{' then
            pos = pos + 1
            local obj = {}
            skipWhitespace()
            if str:sub(pos, pos) == '}' then pos = pos + 1; return obj end
            while true do
                skipWhitespace()
                if str:sub(pos, pos) ~= '"' then error("Json.decode: expected a key at " .. pos) end
                local key = decodeString()
                skipWhitespace()
                if str:sub(pos, pos) ~= ':' then error("Json.decode: expected ':' at " .. pos) end
                pos = pos + 1
                obj[key] = decodeValue()
                skipWhitespace()
                c = str:sub(pos, pos)
                pos = pos + 1
                if c == '}' then return obj end
                if c ~= ',' then error("Json.decode: expected ',' or '}' at " .. (pos - 1)) end
            end
        elseif c == '[' then
            pos = pos + 1
            local arr = {}
            skipWhitespace()
            if str:sub(pos, pos) == ']' then pos = pos + 1; return arr end
            local n = 0
            while true do
                n = n + 1
                arr[n] = decodeValue()
                skipWhitespace()
                c = str:sub(pos, pos)
                pos = pos + 1
                if c == ']' then return arr end
                if c ~= ',' then error("Json.decode: expected ',' or ']' at " .. (pos - 1)) end
            end
        elseif str:sub(pos, pos + 3) == 'true' then
            pos = pos + 4
            return true
        elseif str:sub(pos, pos + 4) == 'false' then
            pos = pos + 5
            return false
        elseif str:sub(pos, pos + 3) == 'null' then
            pos = pos + 4
            return nil
        elseif c:match('[%-%d]') then
            return decodeNumber()
        end
        error("Json.decode: unexpected '" .. c .. "' at " .. pos)
    end

    local value = decodeValue()
    skipWhitespace()
    if pos <= #str then error("Json.decode: trailing characters at " .. pos) end
    return value
end

return Json
