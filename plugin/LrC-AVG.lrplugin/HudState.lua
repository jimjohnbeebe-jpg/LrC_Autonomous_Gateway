-- The HUD's state (PRD section 6.3, PHASE5_PLAN row 4): the hud_update command's payload checked field
-- by field, which updates to take, and the events and messages that follow from it. No Lightroom call
-- is made here; Hud.lua runs the window and HudView.lua lays it out and fills it.
--
-- The engine side of the contract is engine\src\bridge\hud-protocol.ts (hudUpdatePayloadSchema, the
-- event schemas). engine\tests\lua-plugin.test.ts keeps STAGES, END_STAGES, GUARDRAIL, EVENTS,
-- VARIANTS and LIMITS below equal to its lists, and the smoke transcript runs payloads that schema
-- accepts and refuses through check() [handle: docs\reports\phase5\hud-plugin-smoke\smoke.txt
-- "Contract"]. A field that is not in the spec, or of the wrong type, refuses the whole update
-- (bad_request, naming the field): the engine is the only sender, so a wrong field is a bug to show,
-- not to guess around. Text longer than LIMITS.text is shortened for display, not refused.
-- fix/hud-p1: the optional `snapshot` (the pre-session snapshot's name, for the undo line), and the
-- HUD's words (HudText.lua). Plugin 0.13.0 (PR C step 2b): the optional `put_back` (the session's
-- pre-session snapshot and its photo, for the Put back button; canPutBack below, HudClick.lua).

local HudText = require 'HudText'

local HudState = {}

HudState.STAGES = { "begin", "pass0", "applying", "acquiring_preview", "metrics", "awaiting_claude", "awaiting_pick", "awaiting_approval", "converged", "target_changed", "accepted", "aborted", "ended" }
HudState.END_STAGES = { "accepted", "aborted", "ended" }
HudState.GUARDRAIL = { "green", "clamped", "refused", "corrected", "unmet", "undone" }
HudState.EVENTS = { "hud_abort", "hud_accept", "hud_pick", "hud_approve_pass", "hud_put_back" }
HudState.VARIANTS = { "A", "B", "C" }
HudState.LIMITS = { text = 120, id = 64, rows = 12, photos = 16, pass = 99, decay = 8 }

-- After a click the buttons stay off until the engine answers that click, or this long. (The ended
-- HUD stays open until closed or the next session starts [stated: Jim, 2026-10-03, D2 "Stay open
-- (Recommended)"]; that replaced decision 1's close after 5 s.)
HudState.PENDING_SECONDS = 10
-- After an engine connection the HUD's open session is unknown until an update for it arrives, at
-- most this long; then it is taken as no longer open in the engine (fix/hud-p1 P1-3). The engine
-- sends the session's state again as soon as it is connected (engine\src\hud\publisher.ts
-- onStateChange), so 10 s is ample [inference].
HudState.UNKNOWN_SECONDS = 10
-- Put back is offered once the engine has been away from an open edit this long, as the HUD's
-- ticker sees it: a menu or Plug-in Manager pauses the plugin and the engine drops on its heartbeat,
-- then reconnects within seconds and the edit goes on (LR_SDK_NOTES "The bridge task's pauses"), and
-- a button offered during such a drop would put the photo back under a live edit. 10 s, as for
-- UNKNOWN_SECONDS, is [inference].
HudState.AWAY_SECONDS = 10

local LIMITS = HudState.LIMITS

function HudState.has(list, v)
    for _, x in ipairs(list or {}) do
        if x == v then return true end
    end
    return false
end
local has = HudState.has

function HudState.isEnd(stage)
    return has(HudState.END_STAGES, stage)
end

-- Cut on a character boundary, so a UTF-8 file name is never split inside a character.
local function shorten(s)
    if #s <= LIMITS.text then return s end
    local cut = LIMITS.text - 3
    while cut > 0 and s:byte(cut + 1) >= 128 and s:byte(cut + 1) < 192 do cut = cut - 1 end
    return s:sub(1, cut) .. "..."
end

-- A decoded JSON array: only the keys 1..n. An empty table counts (Json.lua writes [] and {} alike).
local function isArray(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" then return false end
        n = n + 1
    end
    return n == #t
end

local TEXT = { kind = "text" }
local INT = { kind = "int", min = 0 }
local NUMBER = { kind = "number" }

local TARGET = { uuid = { kind = "id", required = true }, filename = TEXT, copy_name = TEXT, iso = TEXT, shutter = TEXT,
    aperture = TEXT, lens = TEXT, lens_profile = TEXT }
local DELTA = { slider = { kind = "text", required = true }, before = TEXT, after = TEXT, delta = TEXT }
local GUARD = { status = { kind = "enum", list = HudState.GUARDRAIL, required = true }, reason = TEXT }
local SETTINGS = { mode = { kind = "enum", list = { "autonomous", "approve_each_pass" } }, max_passes = INT,
    variant_count = INT, long_edge = INT, quality = INT, clip_high_pct = NUMBER, clip_low_pct = NUMBER,
    decay = { kind = "array", of = NUMBER, max = LIMITS.decay } }
local PUT_BACK = { photo_uuid = { kind = "id", required = true }, snapshot_id = { kind = "id", required = true }, snapshot_name = { kind = "text", required = true } }

local FIELDS = {
    session_id = { kind = "id", required = true },
    seq = { kind = "int", min = 1, required = true },
    open = { kind = "boolean" },
    stage = { kind = "enum", list = HudState.STAGES, required = true },
    mode = { kind = "enum", list = { "converge", "variants" } },
    pass = { kind = "int", min = 0, max = LIMITS.pass },
    max_passes = { kind = "int", min = 1, max = LIMITS.pass },
    target = { kind = "object", fields = TARGET, required = true },
    session_photos = { kind = "array", of = { kind = "id" }, max = LIMITS.photos },
    variants = { kind = "array", of = { kind = "enum", list = HudState.VARIANTS }, max = #HudState.VARIANTS },
    approve_pass = { kind = "int", min = 1, max = LIMITS.pass },
    answered_click_id = { kind = "id" },
    deltas = { kind = "array", of = { kind = "object", fields = DELTA }, max = LIMITS.rows },
    guardrail = { kind = "object", fields = GUARD },
    note = TEXT,
    settings = { kind = "object", fields = SETTINGS },
    snapshot = TEXT,
    put_back = { kind = "object", fields = PUT_BACK },
}

local checkObject

local function checkValue(spec, v, name)
    local kind = spec.kind
    if kind == "text" then
        if type(v) == "number" then v = tostring(v) end
        if type(v) ~= "string" then return nil, name .. " must be text" end
        return shorten(v)
    elseif kind == "id" then
        if type(v) ~= "string" or v == "" or #v > LIMITS.id then
            return nil, name .. " must be a non-empty string of at most " .. LIMITS.id .. " bytes"
        end
        return v
    elseif kind == "boolean" then
        if type(v) ~= "boolean" then return nil, name .. " must be true or false" end
        return v
    elseif kind == "int" or kind == "number" then
        if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then return nil, name .. " must be a number" end
        if kind == "int" and v ~= math.floor(v) then return nil, name .. " must be a whole number" end
        if (spec.min and v < spec.min) or (spec.max and v > spec.max) then return nil, name .. " is out of range" end
        return v
    elseif kind == "enum" then
        if has(spec.list, v) then return v end
        return nil, name .. " must be one of " .. table.concat(spec.list, ", ")
    elseif kind == "array" then
        if type(v) ~= "table" or not isArray(v) then return nil, name .. " must be a list" end
        if #v > spec.max then return nil, name .. " has more than " .. spec.max .. " entries" end
        local out = {}
        for i, item in ipairs(v) do
            local x, why = checkValue(spec.of, item, name .. "[" .. i .. "]")
            if x == nil then return nil, why end
            out[i] = x
        end
        return out
    end
    return checkObject(spec.fields, v, name)
end

checkObject = function(fields, t, name)
    if type(t) ~= "table" then return nil, name .. " must be an object" end
    for key in pairs(t) do
        if type(key) ~= "string" or fields[key] == nil then return nil, name .. "." .. tostring(key) .. " is not a known field" end
    end
    local out = {}
    for key, spec in pairs(fields) do
        local v = t[key]
        if v == nil then
            if spec.required then return nil, name .. "." .. key .. " is required" end
        else
            local x, why = checkValue(spec, v, name .. "." .. key)
            if x == nil then return nil, why end
            out[key] = x
        end
    end
    return out
end

-- The update as the HUD keeps it, or nil and a bad_request error naming the field.
function HudState.check(payload)
    local s, why = checkObject(FIELDS, payload, "hud_update")
    if not s then return nil, { code = "bad_request", message = why, recoverable = false } end
    return s
end

-- Why an update that passed check() is not taken, or nil. Within a session only a newer seq is
-- taken: each bridge line runs in its own task (Sockets.lua onMessage), so two updates are not
-- guaranteed to arrive in order [inference]. A session id seen before that is not the current one
-- belongs to a session a newer one replaced. `seen` holds every session id taken so far.
function HudState.staleReason(current, seen, s)
    if current and current.session_id == s.session_id then
        if s.seq <= current.seq then return "update " .. s.seq .. " is not newer than " .. current.seq end
        return nil
    end
    if seen[s.session_id] then return "session " .. s.session_id .. " was replaced by a newer one" end
    return nil
end

-- The session marked unknown at `unknownAt` (an engine connection; nil when an update has arrived
-- since): nil, "checking" for UNKNOWN_SECONDS, then "gone".
function HudState.unknown(unknownAt, now)
    if unknownAt == nil then return nil end
    return (now - unknownAt >= HudState.UNKNOWN_SECONDS) and "gone" or "checking"
end

-- Whether the HUD offers Put back (a plain true or false): the open edit carries `put_back`, no
-- put-back is running or done (`hud.putBack`, HudClick.lua; one that failed may be tried again), and
-- Claude cannot reach the edit: the engine away AWAY_SECONDS (`hud.away`), or the edit no longer open
-- in Claude (`hud.unknown` "gone"). `conn` and `hud` are HudView.props's.
function HudState.canPutBack(s, conn, hud)
    if s == nil or HudState.isEnd(s.stage) or s.put_back == nil then return false end
    if hud.putBack and hud.putBack.state ~= "failed" then return false end
    return ((not conn.engine and hud.away == true) or hud.unknown == "gone") and true or false
end

-- "Pick B", "Approve pass 3", "Abort", "Accept": what the HUD and the menu items call an event.
function HudState.eventLabel(name, variant, s)
    if name == "hud_pick" then return "Pick " .. tostring(variant) end
    if name == "hud_approve_pass" then return "Approve pass" .. ((s and s.approve_pass) and (" " .. s.approve_pass) or "") end
    if name == "hud_accept" then return "Accept" end
    if name == "hud_put_back" then return "Put back" end
    return "Abort"
end

-- Why this event cannot be sent for the session the HUD shows, or nil. The buttons' `enabled`
-- bindings say the same; this check also covers the menu items and an update arriving between a
-- button's greying and its click. Accept at awaiting_pick is greyed (HudView.props) but not refused
-- here: from a menu item it goes to the engine, whose answer says to pick first.
function HudState.refusal(s, name, variant)
    local R = HudText.REASON
    if not has(HudState.EVENTS, name) then return "unknown event " .. tostring(name) end
    if s == nil then return R.no_edit end
    if HudState.isEnd(s.stage) then return R.ended end
    if name == "hud_pick" and not (s.stage == "awaiting_pick" and has(s.variants, variant)) then return R.no_pick end
    if name == "hud_approve_pass" and s.approve_pass == nil then return R.no_approval end
    return nil
end

-- The event's payload (engine\src\bridge\hud-protocol.ts hudEventSchemas). Hud.lua adds click_id.
function HudState.eventPayload(s, name, variant, source)
    local p = { session_id = s.session_id, seq_seen = s.seq, source = source }
    if name == "hud_pick" then p.variant = variant end
    if name == "hud_approve_pass" then p.pass = s.approve_pass end
    return p
end

-- The session's photo as the HUD names it: its file, and a copy's name after it.
function HudState.targetName(s)
    local t = s.target
    local name = t.filename or t.uuid
    if t.copy_name then name = name .. " (" .. t.copy_name .. ")" end
    return name
end

-- The selection line for the photo selected now (uuid and name, both nil when nothing is selected):
-- "Target changed: ..." when it is not one of the session's photos, else a line saying it is, so the
-- line is never blank during a session (after the row 4 probe, HudSelection.lua). The session's
-- photos are session_photos (Variants: the master and its copies, which the engine selects itself)
-- or else the target alone. The advice matches the engine's own TARGET_CHANGED message
-- (engine\src\session\io.ts bridge()). fix/hud-p1: "session" became "edit".
HudState.SELECTION_OK = "Selection: the edit's photo."

function HudState.targetChangedLine(s, uuid, name)
    if s == nil or HudState.isEnd(s.stage) then return "" end
    local photos = s.session_photos or { s.target.uuid }
    if uuid ~= nil and (uuid == s.target.uuid or has(photos, uuid)) then return HudState.SELECTION_OK end
    local selected = uuid == nil and "No photo is selected" or ((name or uuid) .. " is selected")
    local again = s.mode == "variants" and "Claude's next call selects the edit's photo again"
        or ("Select " .. HudState.targetName(s) .. " again")
    return "Target changed: " .. selected .. ". " .. again .. "; the edit is still open."
end

return HudState
