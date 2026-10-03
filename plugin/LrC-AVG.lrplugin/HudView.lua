-- The HUD's window (PRD section 6.3, PHASE5_PLAN row 4; laid out again in fix/hud-p1): props(), the
-- text and enabled flags it shows, worked out from the state HudState.lua keeps; and contents(),
-- every line bound to the property table Hud.lua fills from props(), and the buttons. From S8 in
-- Lightroom 15.5.1 [handle: LR_SDK_NOTES "Recorded in Phase 5", Floating dialog]:
--   - a push_button's action cannot yield, so each action only calls Hud.click (`click` here);
--   - `enabled = LrView.bind(key)` greys a button out and back, and a greyed click is not delivered;
--   - a push_button title bound with LrView.bind changes with its property ("Approve pass n").
-- Every container carries bind_to_object. S8's HUD set it on its outer column only, and the bound
-- `enabled` of the buttons in its rows worked [handle: plugin\spikes\S8.lrplugin\S8Hud.lua:95-108;
-- docs\reports\phase5\S8.md Numbers, "Pick A-C greyed"]; S8's first settings section, with no
-- bind_to_object, saved nothing (run 1, cause [inference]). Setting it everywhere costs nothing
-- [inference].
--
-- A title longer than its control runs off the window instead of wrapping [stated: Jim, 2026-10-03],
-- and a title with line breaks shown on several lines is [unverified] (PluginInfoProvider.lua
-- invalidLines). So every text is cut by HudText.wrap into a fixed number of slots, one bound
-- static_text each ("headline1", "headline2", ...), as the deltas grid has one bound cell per text.
-- Window order (fix/hud-p1 plan, "Copy deck"): the headline; Pick A-C and Approve; Accept and Abort,
-- Abort last; the feedback line; Photo; Camera; Step; the selection line; the deltas grid; the
-- guardrail sentence; the settings block; the connection line.

local LrView = import 'LrView'

local HudState = require 'HudState'
local HudText = require 'HudText'
local Prefs = require 'Prefs'

local HudView = {}

local SLOTS, CELL, WIDTH = HudText.SLOTS, HudText.CELL, HudText.WIDTH
local COLUMNS = { "slider", "before", "after", "delta" }

local has, isEnd = HudState.has, HudState.isEnd

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

-- Whose turn it is. The bridge and the end of an edit come first, then the connection, then
-- `unknown` ("checking" or "gone", HudState.unknown), then the stage.
local function headline(s, conn, unknown)
    local T = HudText.HEADLINE
    if not conn.running then return T.not_running end
    if s == nil then return T.none end
    if isEnd(s.stage) then return T[s.stage] end
    if not conn.engine then return T.not_connected end
    if unknown then return T[unknown] end
    if s.stage == "awaiting_pick" then return T.awaiting_pick end
    if s.approve_pass then return string.format(T.approve, s.approve_pass) end
    if s.stage == "converged" or s.stage == "target_changed" then return T[s.stage] end
    return T.working
end

-- The undo line while an open edit cannot reach Claude (not connected, or no longer open in
-- Claude); else the click line; else the update's note (fix/hud-p1 "Feedback rule").
local function feedback(s, conn, hud)
    if s and not isEnd(s.stage) and (not conn.engine or hud.unknown == "gone") then
        return string.format(HudText.UNDO, s.snapshot or HudText.UNDO_NO_SNAPSHOT)
    end
    return hud.click or (s and s.note) or ""
end

local function stepLine(s)
    local pass = s.pass and (s.max_passes and (s.pass .. " of " .. s.max_passes) or tostring(s.pass))
    local label = HudText.STEP[s.stage]
    if s.stage == "applying" then return "Step: " .. label .. (pass and (" " .. pass) or "") end
    local suffix = (pass and s.pass >= 1 and s.stage ~= "pass0") and (" (pass " .. pass .. ")") or ""
    return "Step: " .. label .. suffix
end

local function cameraLine(t)
    local parts = {}
    if t.iso then parts[#parts + 1] = "ISO " .. t.iso end
    for _, key in ipairs({ "shutter", "aperture", "lens" }) do
        if t[key] then parts[#parts + 1] = t[key] end
    end
    if t.lens_profile then parts[#parts + 1] = "lens profile " .. t.lens_profile end
    return #parts > 0 and ("Camera: " .. table.concat(parts, ", ")) or ""
end

-- The engine's sentence as given; green without one says the clipping held.
local function guardrailLine(s)
    local g = s and s.guardrail
    if not g then return "" end
    if g.reason then return g.reason end
    return g.status == "green" and HudText.CLIPPING_OK or ""
end

local function connectionLine(conn)
    local C = HudText.CONNECTION
    if not conn.running then return C.not_running end
    return conn.engine and C.connected or C.not_connected
end

-- `text` into its slots: v.key1 .. v.keyN.
local function put(v, key, text)
    for i, line in ipairs(HudText.wrap(text, SLOTS[key], HudText.budget(WIDTH))) do v[key .. i] = line end
end

-- The settings page's values under their wire names (Prefs.read checks each one), for props().
function HudView.pageSettings()
    local values = Prefs.read()
    local wire = {}
    for _, spec in ipairs(Prefs.SPECS) do wire[spec.wire] = values[spec.key] end
    return wire
end

-- Every property contents() binds, from the state `s` (or nil), the connection { running, engine }
-- (Events.lua), the pending click (or nil), the settings page's values by wire name (decision 4
-- [stated: Jim, 2026-09-29, "Go with recommended"]: the session's settings when the engine sends
-- them, else the page's), and what Hud.lua keeps beside the state, `hud` = { click (the click line or
-- nil), selection (the selection line), unknown (nil, "checking" or "gone") }. Buttons are off while
-- the engine is not connected (decision 2) or the edit is unknown (fix/hud-p1 P1-3).
function HudView.props(s, conn, pending, page, hud)
    local v = {}
    put(v, "headline", headline(s, conn, hud.unknown))
    put(v, "feedback", feedback(s, conn, hud))
    put(v, "photo", s and ("Photo: " .. HudState.targetName(s)) or "")
    put(v, "camera", s and cameraLine(s.target) or "")
    put(v, "step", s and stepLine(s) or "")
    put(v, "selection", hud.selection or "")
    put(v, "guardrail", guardrailLine(s))
    local rows = (s and s.deltas) or {}
    for i = 1, HudState.LIMITS.rows do
        local r = rows[i] or {}
        for _, c in ipairs(COLUMNS) do
            v["d" .. i .. "_" .. c] = HudText.wrap(r[c], 1, HudText.budget(CELL[c]))[1]
        end
    end
    local sessionSettings = s and s.settings and next(s.settings) ~= nil
    put(v, "settingsTitle", sessionSettings and "Session settings:" or "Settings page (the next session reads them):")
    local a, b = settingsLines(sessionSettings and s.settings or page)
    put(v, "settingsA", a)
    put(v, "settingsB", b)
    put(v, "connection", connectionLine(conn))
    -- A plain true or false: a bound `enabled` never gets nil.
    local live = (s ~= nil and not isEnd(s.stage) and conn.engine == true and pending == nil and hud.unknown == nil) and true or false
    v.abortEnabled = live
    -- The engine refuses Accept while a pick is awaited (engine\src\session\hud-actions.ts, "click Pick first").
    v.acceptEnabled = live and s.stage ~= "awaiting_pick"
    for _, letter in ipairs(HudState.VARIANTS) do
        v["pick" .. letter .. "Enabled"] = live and s.stage == "awaiting_pick" and has(s.variants, letter)
    end
    v.approveEnabled = live and s.approve_pass ~= nil
    v.approveTitle = HudState.eventLabel("hud_approve_pass", nil, (s and not isEnd(s.stage)) and s or nil)
    return v
end

function HudView.contents(f, props, click)
    local bind = LrView.bind
    local items = { bind_to_object = props, spacing = f:control_spacing() }
    local function add(x) items[#items + 1] = x end
    -- A text's slots, in a column of their own so they sit together like one paragraph's lines
    -- [inference: spacing is in pixels, the unit f:control_spacing() gives].
    local function text(key)
        local lines = { bind_to_object = props, spacing = 0 }
        for i = 1, SLOTS[key] do lines[i] = f:static_text { title = bind(key .. i), width_in_chars = WIDTH } end
        add(f:column(lines))
    end
    local function row(list)
        list.bind_to_object = props
        return f:row(list)
    end
    local function button(title, name, variant, enabledKey, width)
        return f:push_button { title = title, enabled = bind(enabledKey), width_in_chars = width or 12,
            action = function() click(name, variant) end }
    end
    local function cells(titles)
        local list = {}
        for i, c in ipairs(COLUMNS) do list[i] = f:static_text { title = titles[c], width_in_chars = CELL[c] } end
        return row(list)
    end
    local grid = { bind_to_object = props, cells { slider = "Slider", before = "Before", after = "After", delta = "Change" } }
    for i = 1, HudState.LIMITS.rows do
        local titles = {}
        for _, c in ipairs(COLUMNS) do titles[c] = bind("d" .. i .. "_" .. c) end
        grid[#grid + 1] = cells(titles)
    end
    text("headline")
    add(row {
        button("Pick A", "hud_pick", "A", "pickAEnabled"),
        button("Pick B", "hud_pick", "B", "pickBEnabled"),
        button("Pick C", "hud_pick", "C", "pickCEnabled"),
        button(bind("approveTitle"), "hud_approve_pass", nil, "approveEnabled", 16),
    })
    add(row { button("Accept", "hud_accept", nil, "acceptEnabled"), button("Abort", "hud_abort", nil, "abortEnabled") })
    for _, key in ipairs({ "feedback", "photo", "camera", "step", "selection" }) do text(key) end
    add(f:group_box { title = "Changes in the latest pass", bind_to_object = props, fill_horizontal = 1, f:column(grid) })
    for _, key in ipairs({ "guardrail", "settingsTitle", "settingsA", "settingsB", "connection" }) do text(key) end
    return f:column(items)
end

return HudView
