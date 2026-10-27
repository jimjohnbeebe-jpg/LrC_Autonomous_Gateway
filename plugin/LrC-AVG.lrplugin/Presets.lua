-- Bridge commands for Develop presets (GitHub issue #215; the port of Automaat's preset handlers, HandlerDevelop.lua
-- at upstream 1040453 [upstream claim]). The plugin lists, reads and writes; the engine chooses which preset a call
-- means and what goes into a checkpoint (engine\src\presets\lightroom.ts, checkpoint.ts; CLAUDE.md standing rule b).
-- The SDK calls are LrApplication.developPresetFolders, getDevelopPresetsForPlugin and addDevelopPresetForPlugin,
-- folder:getName and getDevelopPresets, preset:getName, getUuid, getFile and getSetting, and photo:applyDevelopPreset,
-- all "First supported in version 3.0" [handle: API Reference\modules\LrApplication.html, LrDevelopPresetFolder.html,
-- LrDevelopPreset.html, LrPhoto.html, SDK 15.2], below LrSdkMinimumVersion 13.0, so none has a Needs.lua gate.
--
-- list_presets {}: every preset of every folder (scope "lightroom"), then this plugin's own (scope "plugin", folder
--   "Plugin Develop Presets", the folder the SDK reference names). A preset without a uuid is left out: nothing could
--   name it again. getUuid() is not the crs:UUID in the preset's file [handle: vault LR_SDK_NOTES "Recorded in Phase 4"].
-- get_preset { uuid, scope }: the preset's getSetting() copied into a plain table (strings, numbers, booleans and
--   tables of them, at most MAX_DEPTH levels and MAX_KEYS keys a table) [upstream claim: cloneSerializable].
-- apply_preset { photo_uuid, expect?, preset_uuid, scope, history_name }: photo:applyDevelopPreset(preset), with
--   _PLUGIN for a checkpoint, inside Gate.write named history_name ("AVG ..."). The call takes no History name; whether
--   Lightroom's History shows the gate's name or the preset's is [unverified]. Its 4th argument, updateAISettings, is
--   never passed: it reportedly brings back the modal "calculating AI settings" lockup [upstream claim: Automaat commit
--   efce08f, citing Adobe community bug 14459471]. The engine asks for the AI update itself (update_ai_settings,
--   Masks.lua, its own write gate). Refused as apply_settings is (Develop.lua): while Lightroom computes an AI mask on
--   the photo (Pending.lua) and when its original is missing. The selection and the module are not touched.
--   S7 applied both kinds this way inside a write gate [handle: vault LR_SDK_NOTES "Recorded in Phase 4"].
-- create_checkpoint { name, settings }: LrApplication.addDevelopPresetForPlugin(_PLUGIN, name, settings), outside a
--   write gate, as S7 ran it [handle: vault LR_SDK_NOTES "Recorded in Phase 4": it wrote %APPDATA%\Adobe\Lightroom\
--   Plugin Develop Presets\<toolkit id>\<name>.lrtemplate]. Refused when a checkpoint of that name exists: whether the
--   call would replace its file is [unverified], so it is never made over one.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrTasks = import 'LrTasks'

local Develop = require 'Develop'
local Gate = require 'Gate'
local Log = require 'Log'
local Photos = require 'Photos'

local Presets = {}

local PLUGIN_FOLDER = "Plugin Develop Presets"
local MAX_DEPTH, MAX_KEYS = 8, 5000

local function fail(code, message)
    return nil, { code = code, message = message, recoverable = false }
end

-- obj:method(), or nil when it is missing or raises.
local function call(obj, method)
    local ok, value = LrTasks.pcall(function() return obj[method](obj) end)
    if ok then return value end
    return nil
end

local function entry(preset, folder, scope)
    return { preset = preset, name = call(preset, "getName") or "", folder = folder, scope = scope,
        uuid = call(preset, "getUuid"), file = call(preset, "getFile") }
end

local function all()
    local out = {}
    for _, folder in ipairs(LrApplication.developPresetFolders() or {}) do
        local name = call(folder, "getName") or ""
        for _, p in ipairs(call(folder, "getDevelopPresets") or {}) do out[#out + 1] = entry(p, name, "lightroom") end
    end
    local ok, own = LrTasks.pcall(LrApplication.getDevelopPresetsForPlugin, _PLUGIN)
    for _, p in ipairs(ok and type(own) == "table" and own or {}) do out[#out + 1] = entry(p, PLUGIN_FOLDER, "plugin") end
    return out
end

local function find(uuid, scope)
    for _, e in ipairs(all()) do
        if e.uuid == uuid and e.scope == scope then return e end
    end
    return nil
end

local function summary(e)
    return { name = e.name, folder = e.folder, scope = e.scope, uuid = e.uuid, file = type(e.file) == "string" and e.file or nil }
end

-- A plain copy of `v`, or nil plus why not.
local function plain(v, depth)
    local t = type(v)
    if t == "string" or t == "number" or t == "boolean" then return v end
    if t ~= "table" then return nil, "a " .. t .. " value" end
    if depth >= MAX_DEPTH then return nil, "more than " .. MAX_DEPTH .. " levels" end
    local out, count = {}, 0
    for k, item in pairs(v) do
        count = count + 1
        if count > MAX_KEYS then return nil, "a table of more than " .. MAX_KEYS .. " keys" end
        if type(k) ~= "string" and type(k) ~= "number" then return nil, "a key of type " .. type(k) end
        local copy, why = plain(item, depth + 1)
        if copy == nil then return nil, why end
        out[k] = copy
    end
    return out
end

local function checkScope(scope)
    return scope == "lightroom" or scope == "plugin"
end

function Presets.list()
    local out = {}
    for _, e in ipairs(all()) do
        if type(e.uuid) == "string" and e.uuid ~= "" then out[#out + 1] = summary(e) end
    end
    return { presets = out }
end

function Presets.get(payload)
    if type(payload.uuid) ~= "string" or not checkScope(payload.scope) then return fail("bad_request", "uuid and scope (lightroom or plugin) are required") end
    local e = find(payload.uuid, payload.scope)
    if not e then return fail("unknown_preset", "no " .. payload.scope .. " preset has the uuid " .. payload.uuid) end
    local settings, why = plain(call(e.preset, "getSetting"), 0)
    if type(settings) ~= "table" or next(settings) == nil then
        return fail("preset_unreadable", "Lightroom gave no settings for this preset" .. (why and (": " .. why) or ""))
    end
    local out = summary(e)
    out.settings = settings
    return out
end

function Presets.apply(payload)
    local history = payload.history_name
    if type(history) ~= "string" or history:sub(1, 4) ~= "AVG " then return fail("bad_request", "history_name must start with 'AVG ' (PRD FR-4.4)") end
    if type(payload.preset_uuid) ~= "string" or not checkScope(payload.scope) then return fail("bad_request", "preset_uuid and scope (lightroom or plugin) are required") end
    local e = find(payload.preset_uuid, payload.scope)
    if not e then return fail("unknown_preset", "no " .. payload.scope .. " preset has the uuid " .. payload.preset_uuid) end
    local catalog, photo, uuid, err = Develop.writeTarget({ photo_uuid = payload.photo_uuid, expect = payload.expect })
    if err then return nil, err end
    local missing = Photos.missing(catalog, photo)
    if missing then return nil, missing end
    local t0 = LrDate.currentTime()
    local gated, busy = Gate.write(catalog, history, function()
        if e.scope == "plugin" then photo:applyDevelopPreset(e.preset, _PLUGIN) else photo:applyDevelopPreset(e.preset) end
    end)
    if not gated then return nil, busy end
    local t1 = LrDate.currentTime()
    Log.info(string.format("presets: applied %s (%s) to %s", tostring(e.name), e.scope, tostring(uuid)))
    return { uuid = uuid, apply_ms = (t1 - t0) * 1000, read_back = Develop.readSettings(catalog, photo) }
end

function Presets.createCheckpoint(payload)
    local name = payload.name
    if type(name) ~= "string" or name == "" then return fail("bad_request", "name must be a non-empty string") end
    if type(payload.settings) ~= "table" or next(payload.settings) == nil then return fail("bad_request", "settings must be a non-empty object") end
    for _, e in ipairs(all()) do
        if e.scope == "plugin" and e.name == name then return fail("preset_exists", "a checkpoint named " .. name .. " exists") end
    end
    local ok, preset = LrTasks.pcall(LrApplication.addDevelopPresetForPlugin, _PLUGIN, name, payload.settings)
    if not ok or not preset then return fail("checkpoint_failed", "Lightroom did not create the checkpoint: " .. tostring(preset)) end
    Log.info("presets: created checkpoint " .. name)
    return summary(entry(preset, PLUGIN_FOLDER, "plugin"))
end

return Presets
