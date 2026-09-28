-- AVG-S8: the test HUD, presented by the S8 loop (S8Loop.lua) from a task of its own, as the Phase 5
-- HUD will be presented by the bridge task. It answers the S4 leftovers Phase 5 rests on
-- [handle: docs\reports\phase0\S4.md "Consequences", "Still [unverified] after S4"]:
--   - push buttons in a floating dialog: each click is recorded with its time, whether the action
--     runs in a task (LrTasks.canYield, https://lrc.mcor.dev/modules/LrTasks.html), and whether a
--     task started from the action can read the selected photo's develop settings (the HUD's buttons
--     will start a task that sends an event to the engine);
--   - `enabled` bound to a property (Pick A-C greyed until Approve), and a push_button title bound
--     to a property (Approve -> "Approve pass 2"). Lightroom ignores a binding on a push_button title
--     [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua:760-765];
--   - focus at the moment the HUD opens (asked of Jim);
--   - closing from code (the loop's "close");
--   - selectionChangeObserver (a presentFloatingDialog argument on the SDK page,
--     https://lrc.mcor.dev/modules/LrDialogs.html): does it fire when Jim changes the selection?
-- A ticker task rewrites the Stage and Deltas lines once per second, as bridge messages will.
-- Nothing here writes to a photo. When the HUD closes, S8Ask asks Jim and the result is saved.

local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Ask = require 'S8Ask'
local Common = require 'S8Common'

local Hud = {}

local MAX_TICKS = 900 -- the ticker stops after 15 min
local WATCH_S = 10 -- README step 19: Jim watches the HUD this long before he uses the X

local QUESTIONS = {
    { key = "hud_appeared", text = "The HUD appeared by itself a few seconds after menu item 1" },
    { key = "focus_backslash", text = "Right after the HUD appeared, pressing \\ (without clicking anywhere first) switched Before/After in the main window" },
    { key = "last_click_shown", text = "The 'Last click' line named each button right after I clicked it" },
    { key = "picks_greyed", text = "Pick A, Pick B and Pick C looked greyed out until I clicked Approve" },
    { key = "picks_enabled_after_approve", text = "After I clicked Approve, Pick B looked normal and I could click it" },
    { key = "approve_label_changed", text = "After I clicked Approve, its button read 'Approve pass 2'" },
    { key = "approve_label_blank", text = "The Approve button had no text on it (only the 'Approve:' label next to it)" },
    { key = "stage_updated", text = "The Stage and Deltas lines changed every second, also while I clicked" },
    { key = "closed_by_itself", text = "The HUD closed by itself when I chose menu item 2" },
}

-- The selected photo's Exposure2012, read in a task: the query outside any gate, the settings inside
-- the read gate (rule 03). Returns the value, or nil and why.
local function readSelected()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then return nil, "no selected photo" end
    local exposure
    catalog:withReadAccessDo(function() exposure = photo:getDevelopSettings().Exposure2012 end)
    return exposure
end

local function selectedName()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo then return nil end
    local name
    catalog:withReadAccessDo(function()
        local ok, value = LrTasks.pcall(photo.getFormattedMetadata, photo, "fileName")
        name = ok and value or ("error: " .. tostring(value))
    end)
    return name
end

local function onClick(run, props, name)
    local t0 = LrDate.currentTime()
    local click = { button = name, at = Common.clock(), epoch = t0, can_yield_in_action = LrTasks.canYield(),
        picks_enabled_at_click = props.picksEnabled == true }
    table.insert(run.clicks, click)
    props.lastClick = "Last click: " .. name .. " at " .. click.at
    if name == "Approve" then
        props.picksEnabled = true
        props.approveTitle = "Approve pass 2"
    end
    LrTasks.startAsyncTask(function()
        click.task_started_ms = (LrDate.currentTime() - t0) * 1000
        local ok, exposure, why = LrTasks.pcall(readSelected)
        click.task_read_ok = ok and exposure ~= nil
        click.task_exposure = exposure
        click.task_error = (not ok) and tostring(exposure) or why
        click.task_done_ms = (LrDate.currentTime() - t0) * 1000
    end)
end

local function contents(run, props)
    local f = LrView.osFactory()
    local function button(name, extra)
        local spec = { title = name, action = function() onClick(run, props, name) end }
        for k, v in pairs(extra or {}) do spec[k] = v end
        return f:push_button(spec)
    end
    local picks = { enabled = LrView.bind("picksEnabled") }
    return f:column {
        bind_to_object = props,
        spacing = f:control_spacing(),
        f:static_text { title = LrView.bind("stage"), width_in_chars = 46 },
        f:static_text { title = "Deltas:" },
        f:static_text { title = LrView.bind("deltas"), width_in_chars = 46, height_in_lines = 3 },
        f:static_text { title = LrView.bind("lastClick"), width_in_chars = 46 },
        f:row { button("Abort"), button("Accept") },
        f:row { button("Pick A", picks), button("Pick B", picks), button("Pick C", picks) },
        f:row {
            f:static_text { title = "Approve:" },
            f:push_button { title = LrView.bind("approveTitle"), width_in_chars = 16, action = function() onClick(run, props, "Approve") end },
        },
    }
end

local function startTicker(run, props)
    LrTasks.startAsyncTask(function()
        local i = 0
        while run.open ~= false and i < MAX_TICKS do
            i = i + 1
            props.stage = string.format("Stage: Applying pass %d of 4   (tick %d)", (math.floor(i / 5) % 4) + 1, i)
            props.deltas = string.format("Exposure    +0.30 -> %+.2f\nHighlights  -20 -> %d\nUpdated %s", 0.30 + i * 0.01, -20 - (i % 40), Common.clock())
            run.ticks = i
            LrTasks.sleep(1)
        end
    end)
end

local function present(run, props)
    local t0 = LrDate.currentTime()
    run.open = true
    local ok, err = LrTasks.pcall(LrDialogs.presentFloatingDialog, _PLUGIN, {
        title = "AVG S8 HUD",
        contents = contents(run, props),
        blockTask = true,
        onShow = function() run.shown_epoch = LrDate.currentTime(); run.shown_at = Common.clock() end,
        windowWillClose = function() run.open = false; run.closed_epoch = LrDate.currentTime(); run.closed_at = Common.clock() end,
        selectionChangeObserver = function() table.insert(run.selection_change_times, Common.clock()) end,
    })
    run.present_error = (not ok) and tostring(err) or nil
    run.present_returned_after_s = LrDate.currentTime() - t0
    run.open_when_present_returned = run.open
    -- If the call did not block (S4: it did, with blockTask [handle: docs\reports\phase0\S4.md
    -- "Analysis"]), keep this task and so `props`' context alive until the window closes (P-19).
    while ok and run.open ~= false and (LrDate.currentTime() - t0) < MAX_TICKS + 60 do LrTasks.sleep(0.5) end
    if run.open ~= false then run.open = false end
end

-- Closed from code: "yes" when the window closed inside the call (S8Loop.tryClose). When it closed
-- only after the call returned, the window's time cannot tell the call from Jim's X (Greptile,
-- PR #40). The README has Jim watch for WATCH_S before he uses the X, so:
--   - closed within WATCH_S of the call: Jim's tick "closed by itself" decides ("unclear" without an
--     answer), since only the call can have closed it unless Jim used the X early;
--   - closed later: "no", unless Jim ticked "closed by itself", then "unclear" (a very late close
--     from code and Jim's X cannot be told apart).
local function closedByCode(run, answered, observations)
    local close = run.close
    if not close then return "not tried", "menu item 2 was not used" end
    if close.closed_during_call then return "yes", "the window closed inside the call" end
    if not close.exists then return "no", "closeFloatingDialogsForPlugin does not exist" end
    local called = false
    for _, try in ipairs(close.tries or {}) do called = called or try.ok end
    if not called then return "no", "every call of closeFloatingDialogsForPlugin raised an error" end
    if not run.closed_epoch or run.closed_epoch < close.epoch - 0.01 then return "no", "the window did not close after the call" end
    local jim = answered and observations.closed_by_itself and observations.closed_by_itself.answer
    local after = string.format("closed %.1f s after the call returned", run.closed_epoch - close.epoch)
    if run.closed_epoch - close.epoch <= WATCH_S then
        if not answered then return "unclear", after .. "; no answer from Jim" end
        return jim and "yes" or "no", after .. "; Jim's answer decides"
    end
    if jim then return "unclear", after .. ", later than the " .. WATCH_S .. " s watch; Jim says it closed by itself" end
    return "no", after .. ", later than the " .. WATCH_S .. " s watch"
end

local function findings(run, answered, observations)
    local out = { clicks = #run.clicks, clicks_on_greyed_picks = 0, buttons = {} }
    for _, c in ipairs(run.clicks) do
        table.insert(out.buttons, c.button)
        if c.button:find("^Pick") and not c.picks_enabled_at_click then out.clicks_on_greyed_picks = out.clicks_on_greyed_picks + 1 end
    end
    if run.shown_epoch then out.appeared_after_request_s = run.shown_epoch - run.requested_epoch end
    out.closed_by_code, out.closed_by_code_because = closedByCode(run, answered, observations)
    out.selection_changes_seen = #run.selection_change_times
    return out
end

function Hud.run(context, run)
    run.run_at = Common.localTime()
    run.photo = select(2, LrTasks.pcall(selectedName))
    local props = LrBinding.makePropertyTable(context)
    props.stage = "Stage: starting"
    props.deltas = "(none yet)"
    props.lastClick = "Last click: (none yet)"
    props.picksEnabled = false
    props.approveTitle = "Approve"
    startTicker(run, props)
    present(run, props)
    LrTasks.sleep(1) -- let the last click's task finish
    local answered, observations = Ask.ticks(context, "AVG S8 - what did you see in the HUD?", QUESTIONS)
    local found = findings(run, answered, observations)
    local ok, err = Common.save("s8_hud", {
        spike = "S8", step = "hud", run_at = run.run_at, lr_version = LrApplication.versionString(),
        run = run, findings = found, answered = answered, observations = observations,
    })
    local lines = {
        string.format("Buttons: %d clicks recorded (%s).", found.clicks, table.concat(found.buttons, ", ")),
        string.format("Clicks on a greyed-out Pick button that still counted: %d.", found.clicks_on_greyed_picks),
        "Closed from code: " .. string.upper(found.closed_by_code) .. " (" .. found.closed_by_code_because .. ").",
        "",
        Common.saveLine(ok, err),
        "Next: README step 11.",
    }
    LrDialogs.message(ok and "AVG S8 HUD test: SAVED" or "AVG S8 HUD test: SAVE FAILED", table.concat(lines, "\n"), ok and "info" or "critical")
end

return Hud
