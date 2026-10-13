-- Catalog metadata commands (plugin 0.22.0; GitHub issues #111, #112, #139 gap 4), one photo per
-- command, as Library.lua's writes; the engine loops (engine\src\mcp\tools-metadata.ts).
--
-- set_flag { photo_uuid, flag }: the pick flag, 1 picked, -1 rejected, 0 none.
-- set_iptc { photo_uuid, title, caption, headline }: each field optional; "" empties it.
--   Both are written in a named write gate and read back, as set_rating; a photo that already holds
--   what was asked is not written. Once `before` is read the command answers ok (`write_error`,
--   `after_error`), as Library.lua's `written` does.
-- get_metadata { photo_uuid }: title, caption, headline, flag, keywords (paths), gps and the stack.
--
-- What S11 observed on Lightroom 15.6 [handle: docs\reports\phase8.5\S11.md "Observed (Jim)", the
-- results file docs\reports\phase8.5\S11\s11_2026-10-12T18-30-29.json]:
--   * setRawMetadata("pickStatus", 1 | -1 | 0) took each value and getRawMetadata read it back;
--   * setRawMetadata took "title", "caption" and "headline", getFormattedMetadata read them back, and
--     writing "" emptied them (its put-back);
--   * the stack keys read on a photo in a stack of 2. A plugin cannot stack photos already in the
--     catalog: no SDK call does [handle: S11.md "Pre-run findings", modules\LrPhoto.html and
--     modules\LrSelection.html of the SDK 15.2 reference], so there is no stack write here.
-- pickStatus read nil is taken as 0, and a text field read nil as "" [inference: S11 read the photo's
-- unset fields as 0 and empty]. What the stack keys read on a photo outside a stack is [unverified]:
-- isInStackInFolder not true gives `stack` false.

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'
local KeywordTree = require 'KeywordTree'
local Photos = require 'Photos'

local Metadata = {}

-- The text fields; the SDK lists them under getFormattedMetadata, not getRawMetadata [handle: SDK
-- 15.2 API Reference, modules\LrPhoto.html, the two key lists; S11.md "Pre-run findings"].
Metadata.TEXT_FIELDS = { "title", "caption", "headline" }

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function written(fn)
    local ok, err = LrTasks.pcall(fn)
    if not ok then return tostring(err) end
    return nil
end

-- Reads `fn(photo)` in a read gate. Returns the value, or nil plus the error text.
local function readIn(catalog, fn)
    local ok, value
    catalog:withReadAccessDo(function() ok, value = LrTasks.pcall(fn) end)
    if not ok then return nil, tostring(value) end
    return value
end

local function flagOf(catalog, photo)
    return readIn(catalog, function() return photo:getRawMetadata("pickStatus") or 0 end)
end

-- { title, caption, headline } as strings ("" for none), or nil plus the error.
local function textOf(catalog, photo)
    return readIn(catalog, function()
        local out = {}
        for _, key in ipairs(Metadata.TEXT_FIELDS) do out[key] = photo:getFormattedMetadata(key) or "" end
        return out
    end)
end

function Metadata.setFlag(payload)
    local flag = payload.flag
    if flag ~= 1 and flag ~= 0 and flag ~= -1 then return fail("bad_request", "flag must be 1 (picked), 0 (none) or -1 (rejected)") end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = flagOf(catalog, photo)
    if before == nil then return fail("read_failed", "pickStatus: " .. err, true) end
    local writeErr
    if before ~= flag then
        writeErr = written(function()
            Gate.run(catalog, "AVG set flag", function() photo:setRawMetadata("pickStatus", flag) end)
        end)
    end
    local after, afterErr = flagOf(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, before = before, after = after, write_error = writeErr, after_error = afterErr }
end

function Metadata.setIptc(payload)
    local want, any = {}, false
    for _, key in ipairs(Metadata.TEXT_FIELDS) do
        local v = payload[key]
        if v ~= nil and type(v) ~= "string" then return fail("bad_request", key .. " must be a string") end
        if v ~= nil then want[key], any = v, true end
    end
    if not any then return fail("bad_request", "give at least one of title, caption, headline") end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = textOf(catalog, photo)
    if not before then return fail("read_failed", "title, caption, headline: " .. err, true) end
    local changes = {}
    for key, v in pairs(want) do
        if before[key] ~= v then changes[key] = v end
    end
    local writeErr
    if next(changes) then
        writeErr = written(function()
            Gate.run(catalog, "AVG set IPTC", function()
                for key, v in pairs(changes) do photo:setRawMetadata(key, v) end
            end)
        end)
    end
    local after, afterErr = textOf(catalog, photo)
    return { uuid = d.uuid, filename = d.filename, before = before, after = after, write_error = writeErr, after_error = afterErr }
end

-- The photo's stack: false outside one, else { position, count, collapsed, top_uuid }. The keys are
-- getRawMetadata's [handle: S11.md "Pre-run findings"; read in S11 on a photo in a stack of 2].
local function stackOf(catalog, photo)
    return readIn(catalog, function()
        if photo:getRawMetadata("isInStackInFolder") ~= true then return false end
        local top = photo:getRawMetadata("topOfStackInFolderContainingPhoto")
        return {
            position = photo:getRawMetadata("stackPositionInFolder"),
            count = photo:getRawMetadata("countStackInFolderMembers"),
            collapsed = photo:getRawMetadata("stackInFolderIsCollapsed") == true,
            top_uuid = top and top:getRawMetadata("uuid") or nil,
        }
    end)
end

-- Each part read on its own: a part that fails is left out and named in `errors`, and the rest is
-- still returned.
function Metadata.getMetadata(payload)
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local out, errors = { uuid = d.uuid, filename = d.filename }, {}
    local text, textErr = textOf(catalog, photo)
    if text then
        for key, v in pairs(text) do out[key] = v end
    else
        errors[#errors + 1] = "title, caption, headline: " .. textErr
    end
    local flag, flagErr = flagOf(catalog, photo)
    if flag ~= nil then out.flag = flag else errors[#errors + 1] = "pickStatus: " .. flagErr end
    local keywords, keywordsErr = KeywordTree.ofPhoto(catalog, photo)
    if keywords then out.keywords = keywords.paths else errors[#errors + 1] = "keywords: " .. keywordsErr end
    local gps, gpsErr = Photos.gpsOf(catalog, photo)
    if gps ~= nil then out.gps = gps else errors[#errors + 1] = "gps: " .. gpsErr end
    local stack, stackErr = stackOf(catalog, photo)
    if stack ~= nil then out.stack = stack else errors[#errors + 1] = "stack: " .. stackErr end
    if #errors > 0 then out.errors = errors end
    return out
end

return Metadata
