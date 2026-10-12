-- Spike S11, metadata on the selected photo: the pick flag (#111) and title/caption/headline (#112)
-- written and read back, then put back; gps and gpsAltitude read only (#139 gap 3's altitude).
-- setRawMetadata lists title, caption, headline (SDK 3.0), gpsAltitude and pickStatus "1 for flag
-- status 'picked', 0 for 'not set', -1 for 'rejected'" (SDK 4.0) [handle: SDK 15.2 API Reference,
-- modules\LrPhoto.html setRawMetadata]; whether Lightroom takes them is what this run observes.

local Common = require 'S11Common'

local M = {}

-- Written in this order; the last write of each key is followed by the put-back.
M.PUT_BACK_KEYS = { "pickStatus", "title", "caption", "headline" }
local WRITES = {
    { key = "pickStatus", value = 1 },
    { key = "pickStatus", value = -1 },
    { key = "pickStatus", value = 0 },
    { key = "title", value = "AVG S11 title" },
    { key = "caption", value = "AVG S11 caption" },
    { key = "headline", value = "AVG S11 headline" },
}
local READ_ONLY = { "gps", "gpsAltitude" }

-- nil and "" count as the same empty field.
local function same(a, b)
    if a == nil or a == "" then return b == nil or b == "" end
    return a == b
end

-- One setRawMetadata in its own write gate (the gate's name shows in Edit > Undo: LR_SDK_NOTES),
-- then read back.
function M.write(catalog, photo, key, value, label)
    local _, _, rec = Common.call(function()
        catalog:withWriteAccessDo("AVG S11 " .. label, function() photo:setRawMetadata(key, value) end, Common.WRITE_TIMEOUT)
    end)
    local back = Common.readKey(catalog, photo, key)
    rec.key, rec.written, rec.read_back = key, value, back
    rec.taken = rec.ok and back.error == nil and same(value, back.value)
    return rec
end

-- The prior values as the prefs keep them ({ key, value } or { key, is_nil }).
function M.prior(catalog, photo)
    local entries = {}
    for _, key in ipairs(M.PUT_BACK_KEYS) do
        local r = Common.readKey(catalog, photo, key)
        if r.error then error("cannot read " .. key .. " before writing: " .. r.error) end
        if r.value == nil then
            table.insert(entries, { key = key, is_nil = true })
        else
            table.insert(entries, { key = key, value = r.value })
        end
    end
    return entries
end

function M.writes(catalog, photo)
    local steps = {}
    for i, w in ipairs(WRITES) do
        table.insert(steps, M.write(catalog, photo, w.key, w.value, w.key .. " " .. i .. "/" .. #WRITES))
    end
    local reads = {}
    for _, key in ipairs(READ_ONLY) do reads[key] = Common.readKey(catalog, photo, key) end
    return { writes = steps, reads = reads }
end

-- What an empty field is written back as: setRawMetadata documents these keys as a string or a
-- number, and nil only for gps [handle: modules\LrPhoto.html setRawMetadata]; same() counts "" as empty.
local EMPTY = { pickStatus = 0, title = "", caption = "", headline = "" }

-- Every prior value written back and read back. True when each reads back as before.
function M.putBack(catalog, photo, entries)
    local steps, all = {}, true
    for _, e in ipairs(entries) do
        local value = e.value
        if e.is_nil then value = EMPTY[e.key] end
        local rec = M.write(catalog, photo, e.key, value, "put back " .. e.key)
        if not rec.taken then all = false end
        table.insert(steps, rec)
    end
    return all, steps
end

return M
