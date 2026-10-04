-- AI masks Lightroom is still computing, and the guard every write to their photo passes (GitHub issue #59,
-- PR C step 2d, plugin 0.16.0). Jim's D16 [stated: Jim, 2026-10-04, "Yes: revert after restart
-- (Recommended)"]: nothing writes to a photo while an AI mask this Lightroom was asked to compute
-- (update_ai_settings, Masks.lua) has neither its digest nor an ErrorReason other than 0. The update's own
-- record says "done" before that: digests appeared 0.3-0.5 s after updateAISettings returned [handle:
-- docs\reports\phase6\masks-capture\capture3-check.json steps `4_*`], so the guard reads the photo's table.
-- In capture 5's row E a put-back went through after Lightroom's gate was free again, the catalog read back
-- equal, yet Lightroom's screen kept the edit until a restart [stated: Jim, 2026-10-04]; that writing under
-- the running computation caused it is [inference].
--   - Pending.start (Masks.lua, at update_ai_settings): the photo's record { request_id, watch, since }.
--     `watch` comes from the engine (engine\src\params\mask-ops.ts aiWatch): the entries' CorrectionIDs and
--     the field names to read, so no SDK key is written here (rule 03). Without one, nothing is guarded.
--   - Pending.refusal (Develop.lua apply_settings, apply_snapshot, create_snapshot; Masks.lua
--     create_ai_mask_dc; HudClick.lua Put back): in the command's own task, before its write gate, the table
--     read; while an entry listed has neither result the write is refused with ai_compute_pending; once the
--     read shows every result (or the entry is gone), the record is cleared and the write goes ahead.
--   - Pending.clear: an update Lightroom reported failed, or dropped (abandoned), computes nothing.
-- The records live on _G (rule 03: they survive a Reload Plug-in running this module again). A Lightroom
-- restart starts a new Lua state, so they are gone and writes go ahead [inference: _G is per Lua state;
-- whether disabling and enabling the plugin also starts one is [unverified]]. Bridge.lua's hello carries
-- that state's start time (process_started_at), by which the engine tells a restart.

local Pending = {}

_G.LrCAVG_PendingAi = _G.LrCAVG_PendingAi or {}
local records = _G.LrCAVG_PendingAi

Pending.REFUSED = { code = "ai_compute_pending", recoverable = false,
    message = "Lightroom is still computing an AI mask on this photo: wait, or restart Lightroom" }

local FIELDS = { "table", "id", "masks", "digest", "error" }

-- `w` as the engine sends it, or nil when it is not one.
local function checked(w)
    if type(w) ~= "table" or type(w.ids) ~= "table" or #w.ids == 0 then return nil end
    for _, id in ipairs(w.ids) do
        if type(id) ~= "string" then return nil end
    end
    for _, f in ipairs(FIELDS) do
        if type(w[f]) ~= "string" or w[f] == "" then return nil end
    end
    return w
end

-- Records the update of photo `uuid`; the ids of a record still there are kept with the new ones. Returns
-- the record, or nil when `watch` is missing or malformed (then nothing is guarded).
function Pending.start(uuid, requestId, watch)
    local w = checked(watch)
    if not w then return nil end
    local old = records[uuid]
    if old then
        for _, id in ipairs(old.watch.ids) do w.ids[#w.ids + 1] = id end
    end
    local rec = { request_id = requestId, watch = w, since = os.date("!%Y-%m-%dT%H:%M:%SZ") }
    records[uuid] = rec
    return rec
end

-- Forget the record `rec` of photo `uuid`, unless a newer update replaced it.
function Pending.clear(uuid, rec)
    if rec ~= nil and records[uuid] == rec then records[uuid] = nil end
end

-- A component that shows Lightroom's answer: its digest, or an ErrorReason other than 0 (as the engine's
-- params\mask-table.ts computed and aiError read them).
local function answered(c, w)
    local d = c[w.digest]
    if type(d) == "string" and d ~= "" then return true end
    local e = tonumber(c[w.error] or 0)
    return e ~= nil and e ~= 0
end

-- True while an entry the record lists still waits: its first component (the AI one, as the engine reads
-- it, params\mask-ops.ts firstComponent) without an answer. An entry no longer in the table waits for nothing.
local function computing(settings, w)
    local wanted = {}
    for _, id in ipairs(w.ids) do wanted[id] = true end
    local entries = type(settings) == "table" and settings[w.table]
    if type(entries) ~= "table" then return false end
    for _, e in ipairs(entries) do
        local parts = type(e) == "table" and wanted[e[w.id]] and e[w.masks]
        local c = type(parts) == "table" and parts[1]
        if type(c) == "table" and not answered(c, w) then return true end
    end
    return false
end

-- Runs in the write's task, before its gate. nil when the write may go ahead, else the error table.
function Pending.refusal(catalog, photo, uuid)
    local rec = records[uuid]
    if not rec then return nil end
    local settings
    catalog:withReadAccessDo(function() settings = photo:getDevelopSettings() end)
    if computing(settings, rec.watch) then return Pending.REFUSED end
    Pending.clear(uuid, rec)
    return nil
end

return Pending
