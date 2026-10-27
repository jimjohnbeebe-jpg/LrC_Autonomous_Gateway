-- The plugin's private metadata on a photo (plugin 1.5.0, GitHub issue #218 row 9; the fields are declared in
-- MetadataDefinition.lua). One photo per command, as Metadata.lua's writes; the engine loops
-- (engine\src\mcp\tools-ai-metadata.ts) and stamps accepted sessions (engine\src\session\avg-stamp.ts).
--
-- set_plugin_metadata { photo_uuid, fields }: each field of FIELDS given as a string; "" clears it. Written in a
--   named write gate and read back; `before` and `after` hold every field, "" for none. Once `before` is read the
--   command answers ok (`write_error`, `after_error`), as Library.lua's writes do.
-- get_plugin_metadata { photo_uuid }: every field, "" for none.
--
-- SDK: photo:setPropertyForPlugin(plugin, fieldId, value) "Must be called from within one of the
-- catalog:withWriteAccessDo gates"; photo:getPropertyForPlugin "no longer needs to be called from within one of the
-- catalog:with___AccessDo gates, but must be called from within an asynchronous task" [handle: D:\Developer\LightRoom
-- Classic Dev Kit\API Reference\modules\LrPhoto.html, setPropertyForPlugin, getPropertyForPlugin]. Writing nil to clear
-- a field is what upstream does [upstream claim: Automaat/lightroom-mcp@1040453 HandlerAiMetadata.lua:47-56].

local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'
local Photos = require 'Photos'

local PluginMetadata = {}

PluginMetadata.FIELDS = { "aiScore", "aiReason", "avgSession", "avgLook", "avgDate" }

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- Every field as a string ("" for none), or nil plus the error text.
local function valuesOf(photo)
    local ok, out = LrTasks.pcall(function()
        local v = {}
        for _, id in ipairs(PluginMetadata.FIELDS) do v[id] = photo:getPropertyForPlugin(_PLUGIN, id) or "" end
        return v
    end)
    if not ok then return nil, tostring(out) end
    return out
end

function PluginMetadata.get(payload)
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local fields, err = valuesOf(photo)
    if not fields then return fail("read_failed", "plug-in metadata: " .. err, true) end
    return { uuid = d.uuid, filename = d.filename, fields = fields }
end

function PluginMetadata.set(payload)
    local want, any = {}, false
    if type(payload.fields) ~= "table" then return fail("bad_request", "fields must be an object") end
    for _, id in ipairs(PluginMetadata.FIELDS) do
        local v = payload.fields[id]
        if v ~= nil and type(v) ~= "string" then return fail("bad_request", id .. " must be a string") end
        if v ~= nil then want[id], any = v, true end
    end
    if not any then return fail("bad_request", "give at least one of " .. table.concat(PluginMetadata.FIELDS, ", ")) end
    local catalog = LrApplication.activeCatalog()
    local photo, d = Photos.find(catalog, payload.photo_uuid)
    if not photo then return nil, d end
    local before, err = valuesOf(photo)
    if not before then return fail("read_failed", "plug-in metadata: " .. err, true) end
    local changes = {}
    for id, v in pairs(want) do
        if before[id] ~= v then changes[id] = v end
    end
    local writeErr
    if next(changes) then
        local ok, raised = LrTasks.pcall(Gate.run, catalog, "AVG set plug-in metadata", function()
            for id, v in pairs(changes) do photo:setPropertyForPlugin(_PLUGIN, id, v ~= "" and v or nil) end
        end)
        if not ok then writeErr = tostring(raised) end
    end
    local after, afterErr = valuesOf(photo)
    return { uuid = d.uuid, filename = d.filename, before = before, after = after, write_error = writeErr, after_error = afterErr }
end

return PluginMetadata
