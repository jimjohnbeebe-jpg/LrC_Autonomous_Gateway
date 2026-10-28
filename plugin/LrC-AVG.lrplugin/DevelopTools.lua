-- Bridge commands apply_auto, reset_develop and set_process_version (issue #214), and set_develop_settings and
-- undo_last_step (decisions D1 and D2 of epic #207, at the end of this file): ports of upstream's
-- apply_auto_adjustments, reset_develop_adjustments and set_process_version [upstream claim: Automaat/lightroom-mcp
-- 1040453, plugin\LightroomMCP.lrplugin\HandlerDevelop.lua:1055-1325; PRs #407, #410, #411], rewritten. One photo per
-- command, named by photo_uuid; the engine loops over the photos, keeps the time budget, reads the settings before
-- and compares them with `read_back` (engine\src\mcp\tools-develop.ts), so this side names no SDK key (rule 03).
-- Each command:
--   * refuses a photo whose original is missing (Photos.missing) or whose AI mask Lightroom still computes
--     (Develop.writeTarget, Pending.lua), before Lightroom moves;
--   * makes the photo the one active in Develop and puts the view back afterwards (DevelopSession.withPhoto);
--   * takes the snapshot `snapshot_name` ("AVG ...") before it changes anything (AVG-005), once it knows it will;
--   * answers { uuid, status, reason?, snapshot?, read_back, ms }.
-- The History step is Lightroom's own: LrDevelopController calls take no History name [handle: API Reference\modules\
-- LrDevelopController.html, setAutoTone, resetAllDevelopAdjustments, setProcessVersion take none]. Every call here is
-- from SDK 6.0 or 7.4 [handle: same page], below LrSdkMinimumVersion 13.0, so Needs.check only names a build that lacks one.
-- What each call does in Lightroom on Windows is [unverified] until Jim's `npm run develop:check`.

local LrDate = import 'LrDate'
local LrDevelopController = import 'LrDevelopController'
local LrTasks = import 'LrTasks'
local LrUndo = import 'LrUndo'

local Develop = require 'Develop'
local DevelopSession = require 'DevelopSession'
local Gate = require 'Gate'
local Log = require 'Log'
local Needs = require 'Needs'
local Photos = require 'Photos'

local DevelopTools = {}

-- After the photo is selected: Lightroom loads it [upstream claim: DevelopSession.lua PHOTO_SETTLE_SECONDS 0.5].
local SETTLE_SECONDS = 0.5
-- Auto: settled once the settings changed and held still 1 s, at least 2 s after the call, within 8 s; a version
-- change confirmed within 5 s [upstream claim: HandlerDevelop.lua autoOperation, AUTO_SETTLE_TIMEOUT_SECONDS, changeProcessVersion].
local AUTO_MIN_SECONDS, AUTO_STABLE_SECONDS, AUTO_SETTLE_SECONDS, VERSION_SECONDS = 2, 1, 8, 5

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

-- Two getDevelopSettings tables (or values) equal all the way down.
local function same(a, b)
    if type(a) ~= "table" or type(b) ~= "table" then return a == b end
    for k, v in pairs(a) do if not same(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end
-- MaskClean.lua deleteEmptyMasks (issue #217) compares its before and after the same way.
DevelopTools.same = same

-- The snapshot before a change, or nil plus the failed answer.
local function snapshot(uuid, name)
    local snap, err = Develop.createSnapshot({ photo_uuid = uuid, name = name })
    if not snap then return nil, { status = "failed", reason = "the snapshot before the change failed: " .. tostring(err and err.message) } end
    return { id = snap.snapshot_id, name = name }
end

-- Checked right before each controller write: the user can change the selection while a snapshot waits for the write
-- gate, and LrDevelopController acts on whichever photo is active [inference: PR #231 review].
local function moved(catalog, photo)
    return catalog:getTargetPhoto() ~= photo
end

-- The checks, then `body(catalog, photo, uuid, snapshotName)` on the photo active in Develop; the answer with read_back.
local function run(name, payload, body)
    if type(payload.photo_uuid) ~= "string" then return fail("bad_request", "photo_uuid must name the photo") end
    local snapshotName = payload.snapshot_name
    if type(snapshotName) ~= "string" or snapshotName:sub(1, 4) ~= "AVG " then return fail("bad_request", "snapshot_name must start with 'AVG '") end
    local catalog, photo, uuid, err = Develop.writeTarget(payload)
    if err then return nil, err end
    local missing = Photos.missing(catalog, photo)
    if missing then return nil, missing end
    local t0 = LrDate.currentTime()
    local result, busy = DevelopSession.withPhoto(name, catalog, photo, function()
        LrTasks.sleep(SETTLE_SECONDS)
        if catalog:getTargetPhoto() ~= photo then return { status = "failed", reason = "another photo became active in Develop" } end
        return body(catalog, photo, uuid, snapshotName)
    end)
    if not result then return nil, busy end
    result.uuid, result.read_back = uuid, Develop.readSettings(catalog, photo)
    result.ms = math.floor((LrDate.currentTime() - t0) * 1000)
    Log.info(string.format("%s: %s %s (%s)", name, uuid, tostring(result.status), tostring(result.reason or "")))
    return result
end

-- One Auto call, then the settings read until they settle. Returns "applied" | "unchanged" | "failed", reason.
local function autoOnce(catalog, photo, call)
    if moved(catalog, photo) then return "failed", "another photo became active in Develop before Auto ran; nothing was changed" end
    local before = Develop.readSettings(catalog, photo)
    local ok, err = LrTasks.pcall(call)
    if not ok then return "failed", tostring(err) end
    DevelopSession.flush()
    local t0 = LrDate.currentTime()
    local last, stableSince = before, t0
    local settled = DevelopSession.waitFor(function()
        if catalog:getTargetPhoto() ~= photo then return true end
        local now, t = Develop.readSettings(catalog, photo), LrDate.currentTime()
        if not same(now, last) then last, stableSince = now, t end
        return t - t0 >= AUTO_MIN_SECONDS and t - stableSince >= AUTO_STABLE_SECONDS and not same(before, last)
    end, AUTO_SETTLE_SECONDS)
    if catalog:getTargetPhoto() ~= photo then return "failed", "another photo became active while Auto ran" end
    if same(before, last) then return "unchanged" end
    if not settled then return "failed", "the settings did not settle within " .. AUTO_SETTLE_SECONDS .. " s; check this photo before trying again" end
    return "applied"
end

-- apply_auto { photo_uuid, tone, white_balance, snapshot_name }: Auto Tone, then Auto White Balance, as asked.
function DevelopTools.applyAuto(payload)
    local tone, wb = payload.tone == true, payload.white_balance == true
    if not tone and not wb then return fail("bad_request", "tone or white_balance must be true") end
    local present, unavailable = Needs.check("Auto Tone and Auto White Balance", "7.4", "LrDevelopController.", LrDevelopController, { "setAutoTone", "setAutoWhiteBalance", "stopTracking" })
    if not present then return nil, unavailable end
    return run("apply_auto", payload, function(catalog, photo, uuid, snapshotName)
        local snap, failed = snapshot(uuid, snapshotName)
        if not snap then return failed end
        local parts, changed = {}, false
        for _, part in ipairs({ { tone, "tone", LrDevelopController.setAutoTone }, { wb, "white_balance", LrDevelopController.setAutoWhiteBalance } }) do
            if part[1] then
                local status, reason = autoOnce(catalog, photo, part[3])
                parts[part[2]] = status
                if status == "failed" then return { status = "failed", reason = part[2] .. ": " .. reason, snapshot = snap, parts = parts } end
                changed = changed or status == "applied"
            end
        end
        return { status = changed and "applied" or "unchanged", snapshot = snap, parts = parts }
    end)
end

-- reset_develop { photo_uuid, confirm = true, snapshot_name }: Lightroom's Reset, which also clears the crop and the
-- masks [upstream claim: Automaat PR #410, tool-contracts.ts reset_develop_adjustments].
function DevelopTools.reset(payload)
    if payload.confirm ~= true then return fail("bad_request", "confirm must be true: Reset discards every Develop adjustment") end
    local present, unavailable = Needs.check("Reset", "6.0", "LrDevelopController.", LrDevelopController, { "resetAllDevelopAdjustments", "stopTracking" })
    if not present then return nil, unavailable end
    return run("reset_develop", payload, function(catalog, photo, uuid, snapshotName)
        local snap, failed = snapshot(uuid, snapshotName)
        if not snap then return failed end
        if moved(catalog, photo) then return { status = "failed", reason = "another photo became active in Develop before Reset; nothing was changed", snapshot = snap } end
        local ok, err = LrTasks.pcall(LrDevelopController.resetAllDevelopAdjustments)
        if not ok then return { status = "failed", reason = tostring(err), snapshot = snap } end
        DevelopSession.flush()
        LrTasks.sleep(SETTLE_SECONDS) -- before run() reads back [inference: the figure]
        return { status = "reset", snapshot = snap }
    end)
end

-- "Version 1" .. "Version 6", the strings setProcessVersion takes [handle: LrDevelopController.html setProcessVersion].
local function versionNumber(label)
    return type(label) == "string" and tonumber(label:match("^Version (%d)$")) or nil
end

local function currentVersion()
    local ok, v = LrTasks.pcall(LrDevelopController.getProcessVersion)
    return ok and v or nil
end

-- set_process_version { photo_uuid, version = "Version N", masked, confirm = true, snapshot_name }: `masked` is the
-- engine's reading of the photo's mask table; a downgrade on a masked photo is skipped [upstream claim: PR #411].
function DevelopTools.setProcessVersion(payload)
    local want = versionNumber(payload.version)
    if not want or want < 1 or want > 6 then return fail("bad_request", 'version must be "Version 1" to "Version 6"') end
    if payload.confirm ~= true then return fail("bad_request", "confirm must be true: a new process version can change how the photo looks") end
    local present, unavailable = Needs.check("Changing the process version", "6.0", "LrDevelopController.", LrDevelopController, { "getProcessVersion", "setProcessVersion" })
    if not present then return nil, unavailable end
    return run("set_process_version", payload, function(catalog, photo, uuid, snapshotName)
        local previous = currentVersion()
        local had = versionNumber(previous)
        if not had then return { status = "failed", reason = "Lightroom answered an unknown process version: " .. tostring(previous) } end
        if had == want then return { status = "unchanged", previous = previous, actual = previous } end
        if want < had and payload.masked == true then
            return { status = "skipped", previous = previous, actual = previous, reason = "the photo has masks, and a downgrade is refused on a masked photo; keep its process version" }
        end
        local snap, failed = snapshot(uuid, snapshotName)
        if not snap then failed.previous = previous; return failed end
        if moved(catalog, photo) then return { status = "failed", previous = previous, actual = previous, snapshot = snap, reason = "another photo became active in Develop before the change; nothing was changed" } end
        local ok, err = LrTasks.pcall(LrDevelopController.setProcessVersion, payload.version)
        local confirmed = ok and DevelopSession.waitFor(function() return catalog:getTargetPhoto() == photo and currentVersion() == payload.version end, VERSION_SECONDS)
        local actual = catalog:getTargetPhoto() == photo and currentVersion() or nil
        if confirmed then return { status = "changed", previous = previous, actual = actual, snapshot = snap } end
        return { status = "failed", previous = previous, actual = actual, snapshot = snap, reason = ok and "Lightroom did not show the new version" or tostring(err) }
    end)
end

-- set_develop_settings { photo_uuid, settings, history_name, snapshot_name } (decision D1, issue #214; upstream's
-- set_develop_settings [upstream claim: HandlerDevelop.lua setDevelopSettings]): `settings` is an SDK table the
-- engine validated against the pinned dump (engine\src\params\sdk-passthrough.ts), written with applyDevelopSettings
-- as one History step on the photo active in Develop, since Lightroom checks a write only there [handle: LR_SDK_NOTES
-- "Recorded in Phase 8 — 2026-10-09"]. The engine compares read_back and puts the photo back when a key was not taken.
function DevelopTools.setSettings(payload)
    if type(payload.settings) ~= "table" or next(payload.settings) == nil then return fail("bad_request", "settings must be a non-empty object") end
    local historyName = payload.history_name
    if type(historyName) ~= "string" or historyName:sub(1, 4) ~= "AVG " then return fail("bad_request", "history_name must start with 'AVG ' (PRD FR-4.4)") end
    return run("set_develop_settings", payload, function(catalog, photo, uuid, snapshotName)
        local snap, failed = snapshot(uuid, snapshotName)
        if not snap then return failed end
        if moved(catalog, photo) then return { status = "failed", reason = "another photo became active in Develop before the write; nothing was changed", snapshot = snap } end
        local gated, busy = Gate.write(catalog, historyName, function() photo:applyDevelopSettings(payload.settings, historyName) end)
        if not gated then return { status = "failed", reason = tostring(busy and busy.message), snapshot = snap } end
        return { status = "set", snapshot = snap }
    end)
end

-- undo_last_step { confirm = true } (decision D2, issue #214; upstream's undo_last_step [upstream claim:
-- HandlerUndo.lua]): Lightroom's Edit > Undo, once. LrUndo.canUndo and LrUndo.undo are from SDK 6.0 [handle:
-- API Reference\modules\LrUndo.html:363, :393]. The history is Lightroom's own, shared with the user and other
-- plug-ins, so the engine refuses it while a session is open. What it undoes in Lightroom is [unverified] until
-- Jim's `npm run develop-catalog:check`.
function DevelopTools.undoLastStep(payload)
    if payload.confirm ~= true then return fail("bad_request", "confirm must be true: Lightroom's undo history is shared with the user and other plug-ins") end
    local present, unavailable = Needs.check("Undo", "6.0", "LrUndo.", LrUndo, { "canUndo", "undo" })
    if not present then return nil, unavailable end
    local could = LrUndo.canUndo() == true
    if could then
        local ok, err = LrTasks.pcall(LrUndo.undo)
        if not ok then return fail("undo_failed", "LrUndo.undo: " .. tostring(err)) end
    end
    Log.info("undo_last_step: " .. (could and "undone" or "nothing to undo"))
    return { undone = could, can_undo = LrUndo.canUndo() == true }
end

return DevelopTools
