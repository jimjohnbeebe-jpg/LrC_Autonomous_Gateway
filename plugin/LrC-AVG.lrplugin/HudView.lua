-- The HUD's window (PRD section 6.3, PHASE5_PLAN row 4): props(), the text and enabled flags it shows,
-- worked out from the state HudState.lua keeps; and contents(), every line bound to the property
-- table Hud.lua fills from props(), and the buttons. From S8 in Lightroom
-- 15.5.1 [handle: LR_SDK_NOTES "Recorded in Phase 5", Floating dialog]:
--   - a push_button's action cannot yield, so each action only calls Hud.click (`click` here);
--   - `enabled = LrView.bind(key)` greys a button out and back, and a greyed click is not delivered;
--   - a push_button title bound with LrView.bind changes with its property ("Approve pass n").
-- Every container carries bind_to_object. S8's HUD set it on its outer column only, and the bound
-- `enabled` of the buttons in its rows worked [handle: plugin\spikes\S8.lrplugin\S8Hud.lua:95-108;
-- docs\reports\phase5\S8.md Numbers, "Pick A-C greyed"]; S8's first settings section, with no
-- bind_to_object, saved nothing (run 1, cause [inference]). Setting it everywhere costs nothing
-- [inference]. The deltas table is a grid of bound cells, one text each, rather than one text with
-- line breaks, whose display on several lines is [unverified] (PluginInfoProvider.lua invalidLines).

local LrView = import 'LrView'

local HudState = require 'HudState'
local Prefs = require 'Prefs'

local HudView = {}

local WIDTH = 72
local CELL = { slider = 20, before = 10, after = 10, delta = 10 }

local has, isEnd = HudState.has, HudState.isEnd

local LABELS = {
    begin = "Starting the session", pass0 = "Pass 0: profile, lens and baseline", applying = "Applying pass",
    acquiring_preview = "Acquiring preview", metrics = "Metrics", awaiting_claude = "Awaiting Claude",
    awaiting_pick = "Awaiting pick", awaiting_approval = "Awaiting approval", converged = "Converged",
    target_changed = "Target changed", accepted = "Accepted", aborted = "Aborted", ended = "Ended",
}

local function num(n)
    if n == math.floor(n) then return string.format("%d", n) end
    return string.format("%g", n)
end

-- Two lines of settings, from wire-named values (get_prefs' names, as the engine sends them).
local function settingsLines(w)
    local a, b = {}, {}
    if w.mode then a[#a + 1] = w.mode == "approve_each_pass" and "approve each pass" or "autonomous" end
    if w.max_passes then a[#a + 1] = "max " .. num(w.max_passes) .. " passes" end
    if w.variant_count then a[#a + 1] = num(w.variant_count) .. " variants" end
    if w.long_edge then a[#a + 1] = "preview " .. num(w.long_edge) .. " px" .. (w.quality and (" q" .. num(w.quality)) or "") end
    if w.clip_high_pct or w.clip_low_pct then
        b[#b + 1] = "clip limits " .. (w.clip_high_pct and num(w.clip_high_pct) or "-") .. " % high, " ..
            (w.clip_low_pct and num(w.clip_low_pct) or "-") .. " % low"
    end
    if w.decay and #w.decay > 0 then
        local d = {}
        for i, x in ipairs(w.decay) do d[i] = num(x) end
        b[#b + 1] = "decay " .. table.concat(d, ", ")
    end
    return table.concat(a, ", "), table.concat(b, ", ")
end

local function hint(s, conn, pending)
    if s == nil then return "No session yet: Claude starts one with lr_begin_session." end
    if isEnd(s.stage) then return "The session has ended." end
    if not conn.running then return "Buttons off: the LrC-AVG bridge is not running." end
    if not conn.engine then return "Buttons off: the engine is not connected." end
    if pending then return "Buttons off until the engine answers the " .. pending.label .. " (at most " .. HudState.PENDING_SECONDS .. " s)." end
    return ""
end

local function stageLine(s)
    local pass = s.pass and (s.max_passes and (s.pass .. " of " .. s.max_passes) or tostring(s.pass))
    if s.stage == "applying" and pass then return "Stage: Applying pass " .. pass end
    return "Stage: " .. LABELS[s.stage] .. (pass and ("  (pass " .. pass .. ")") or "")
end

local function cameraLine(t)
    local parts = {}
    if t.iso then parts[#parts + 1] = "ISO " .. t.iso end
    for _, key in ipairs({ "shutter", "aperture", "lens" }) do
        if t[key] then parts[#parts + 1] = t[key] end
    end
    if t.lens_profile then parts[#parts + 1] = "lens profile " .. t.lens_profile end
    return table.concat(parts, ", ")
end

-- The settings page's values under their wire names (Prefs.read checks each one), for props().
function HudView.pageSettings()
    local values = Prefs.read()
    local wire = {}
    for _, spec in ipairs(Prefs.SPECS) do wire[spec.wire] = values[spec.key] end
    return wire
end

-- Every property contents() binds, from the state `s` (or nil), the connection { running, engine }
-- (Events.lua), the pending click (or nil) and the settings page's values by wire name (decision 4
-- [stated: Jim, 2026-09-29, "Go with recommended"]: the session's settings when the engine sends
-- them, else the page's). Buttons are off while the engine is not connected (decision 2).
function HudView.props(s, conn, pending, page)
    local v = {}
    v.connection = "Connection: " .. ((not conn.engine) and "Disconnected" or ((s and not isEnd(s.stage)) and "Claude session active" or "Engine connected"))
    v.target = s and ("Target: " .. HudState.targetName(s)) or "Target: (none)"
    v.camera = s and cameraLine(s.target) or ""
    v.stage = s and stageLine(s) or "Stage: (no session)"
    v.guardrail = (s and s.guardrail) and ("Guardrails: " .. s.guardrail.status .. (s.guardrail.reason and (": " .. s.guardrail.reason) or "")) or "Guardrails: (nothing measured yet)"
    v.note = (s and s.note) or ""
    local rows = (s and s.deltas) or {}
    for i = 1, HudState.LIMITS.rows do
        local r = rows[i] or {}
        v["d" .. i .. "_slider"], v["d" .. i .. "_before"] = r.slider or "", r.before or ""
        v["d" .. i .. "_after"], v["d" .. i .. "_delta"] = r.after or "", r.delta or ""
    end
    local sessionSettings = s and s.settings and next(s.settings) ~= nil
    v.settingsTitle = sessionSettings and "Session settings:" or "Settings page (the next session reads them):"
    v.settingsA, v.settingsB = settingsLines(sessionSettings and s.settings or page)
    v.hint = hint(s, conn, pending)
    -- A plain true or false: a bound `enabled` never gets nil.
    local live = (s ~= nil and not isEnd(s.stage) and conn.engine == true and pending == nil) and true or false
    v.abortEnabled, v.acceptEnabled = live, live
    for _, letter in ipairs(HudState.VARIANTS) do
        v["pick" .. letter .. "Enabled"] = live and s.stage == "awaiting_pick" and has(s.variants, letter)
    end
    v.approveEnabled = live and s.approve_pass ~= nil
    v.approveTitle = HudState.eventLabel("hud_approve_pass", nil, (s and not isEnd(s.stage)) and s or nil)
    return v
end

function HudView.contents(f, props, click)
    local bind = LrView.bind
    local function line(key)
        return f:static_text { title = bind(key), width_in_chars = WIDTH }
    end
    local function row(items)
        items.bind_to_object = props
        return f:row(items)
    end
    local function cells(slider, before, after, delta)
        return row {
            f:static_text { title = slider, width_in_chars = CELL.slider },
            f:static_text { title = before, width_in_chars = CELL.before },
            f:static_text { title = after, width_in_chars = CELL.after },
            f:static_text { title = delta, width_in_chars = CELL.delta },
        }
    end
    local grid = { bind_to_object = props, cells("Slider", "Before", "After", "Change") }
    for i = 1, HudState.LIMITS.rows do
        local d = "d" .. i .. "_"
        grid[#grid + 1] = cells(bind(d .. "slider"), bind(d .. "before"), bind(d .. "after"), bind(d .. "delta"))
    end
    local function button(title, name, variant, enabledKey)
        return f:push_button { title = title, enabled = bind(enabledKey), width_in_chars = 12,
            action = function() click(name, variant) end }
    end
    return f:column {
        bind_to_object = props,
        spacing = f:control_spacing(),
        line("connection"),
        line("target"),
        line("camera"),
        line("stage"),
        line("targetChanged"),
        f:group_box { title = "Changes in the latest pass", bind_to_object = props, fill_horizontal = 1, f:column(grid) },
        line("guardrail"),
        line("note"),
        row { button("Abort", "hud_abort", nil, "abortEnabled"), button("Accept", "hud_accept", nil, "acceptEnabled") },
        row {
            button("Pick A", "hud_pick", "A", "pickAEnabled"),
            button("Pick B", "hud_pick", "B", "pickBEnabled"),
            button("Pick C", "hud_pick", "C", "pickCEnabled"),
        },
        row {
            f:push_button { title = bind("approveTitle"), enabled = bind("approveEnabled"), width_in_chars = 16,
                action = function() click("hud_approve_pass") end },
        },
        line("hint"),
        line("lastAction"),
        line("settingsTitle"),
        line("settingsA"),
        line("settingsB"),
    }
end

return HudView
