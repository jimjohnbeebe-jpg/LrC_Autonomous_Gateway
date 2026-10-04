-- The HUD's words and line slots (fix/hud-p1, repo logs\fix-hud-p1-plan.md, gitignored, "Copy deck"
-- and "Long lines"). Pure Lua with no SDK import, so it loads without Lightroom: every fixed string
-- the HUD shows is in the tables below, and wrap() is the only way a text reaches a line.
--
-- A static_text title longer than its control does not wrap: it runs off the window [stated: Jim,
-- 2026-10-03, "long lines do not wrap, the move off of the canvas"]. A title with line breaks shown
-- on several lines is [unverified] (HudView.lua header). So each text gets a fixed number of slots,
-- one static_text each, and wrap() fills them: break at spaces, split a word longer than a line only
-- between UTF-8 characters (Lua 5.1 has no utf8 library), and end the last slot with "..." when the
-- text still does not fit.
--
-- A slot's budget is MARGIN of its width_in_chars, because characters differ in width and a line of
-- capitals or digits is wider than the same count of average characters [inference]. At 85 % nothing
-- ran off the window in Lightroom 15.6, but lines left a lot of empty space at the right [handle:
-- docs\reports\phase6\hud-p1-check\check.txt, run 1, step 2]; Jim chose 95 % [stated: Jim,
-- 2026-10-03, "Raise to 95 % now"]. At 95 % nothing ran off either, but the note and the clipping
-- sentence ended in "..." (run 2; Lightroom's own cut is [inference]); kept for a later change
-- [stated: Jim, 2026-10-03, "Continue as-is, we can address in a later change request."].

local HudText = {}

HudText.MARGIN = 0.95 -- see above

-- width_in_chars of every line, and of the deltas grid's cells. The slider cell fits the longest
-- Lightroom label, "Lens Corrections (panel on/off)" (31); before and after fit the profile names
-- "Camera Monochrome" (17) and "Adobe Landscape"; the lines are as wide as the grid's row, so the
-- grid does not make the window wider than they are [inference: 37 + 20 + 20 + 8 = 85].
HudText.WIDTH = 84
HudText.CELL = { slider = 37, before = 20, after = 20, delta = 8 }

-- How many static_texts each text has (HudView.contents builds them, HudView.props fills them).
HudText.SLOTS = {
    headline = 2, feedback = 2, photo = 2, camera = 2, step = 1, selection = 2, guardrail = 2,
    settingsTitle = 1, settingsA = 1, settingsB = 1, connection = 1,
}

-- Fixed copy. "%d" and "%s" are filled with string.format; the longest values are pass 99 and the
-- label "Approve pass 99".
HudText.HEADLINE = {
    none = "No edit running. In Claude Desktop, ask Claude to edit a photo.",
    not_running = "LrC-AVG is not running: reload it in File > Plug-in Manager.",
    not_connected = "Claude is not connected. Your edit so far stays.",
    checking = "Checking this edit with Claude...",
    gone = "This edit is no longer open in Claude. Your edit so far stays.",
    stopped = "Claude stopped during the edit. Your edit so far stays.",
    putting_back = "Putting the photo back...",
    working = "Claude is working. Nothing needed from you.",
    awaiting_pick = "Your turn: pick a copy, or tell Claude which one.",
    approve = "Your turn: approve pass %d so Claude can go on.",
    converged = "Your turn: Claude thinks the edit is done.",
    target_changed = "Your turn: select the edit's photo again.",
    accepted = "Done: the edit is kept.",
    aborted = "Done: the photo is back as it was.",
    ended = "The edit has ended.",
}

-- "Step: <label>"; " (pass n of N)" follows for pass 1 and up, except on applying (whose label
-- takes "n of N" itself) and pass0.
HudText.STEP = {
    begin = "Starting", pass0 = "Setting profile, lens corrections and baseline", applying = "Applying pass",
    acquiring_preview = "Rendering a preview", metrics = "Measuring the preview",
    awaiting_claude = "Claude is looking at the result", awaiting_pick = "Waiting for your pick",
    awaiting_approval = "Waiting for your approval", converged = "Claude thinks the edit is done",
    target_changed = "Another photo is selected", accepted = "Accepted", aborted = "Aborted", ended = "Ended",
}

HudText.CONNECTION = {
    connected = "Connected to Claude.",
    not_connected = "Not connected to Claude.",
    not_running = "LrC-AVG is not running in Lightroom.",
}

-- The feedback line while Claude is not connected or the edit is no longer open in Claude.
HudText.UNDO = "To undo it: Develop > Snapshots > %s"
HudText.UNDO_NO_SNAPSHOT = "the newest AVG pre-session snapshot"

-- The feedback line around Put back (plugin 0.13.0, HudClick.lua): the offer, the wait (the write
-- gate waits behind a Lightroom message, so the user is told to answer it), the outcome. `failed` is
-- filled with a REASON below and the snapshot's name. The headline after a done put-back is
-- HEADLINE.aborted's.
HudText.PUT_BACK = {
    offer = "Put back returns the photo to how it was before the edit.",
    running = "Putting the photo back. If Lightroom shows a message, click OK there.",
    done = "Put back: done.",
    failed = "Put back: not possible — %s; in Develop > Snapshots click '%s'.",
}
HudText.PUT_BACK_REASON = {
    no_photo = "the photo is not in the catalog",
    no_snapshot = "the photo no longer has that snapshot",
    busy = "Lightroom stayed busy for %d s",
    error = "Lightroom could not apply it",
    read_back = "Lightroom could not read the photo back",
    newer = "a newer edit began",
}

HudText.CLIPPING_OK = "Clipping: within limits."

-- Click lines: "<Label> sent; waiting for Claude.", "<Label> not sent: <reason>.", and the line
-- when Claude does not answer a click. A menu item that waited adds WAITED to its reason.
HudText.CLICK = {
    sent = "%s sent; waiting for Claude.",
    not_sent = "%s not sent: %s.",
    no_answer = "%s: no answer from Claude within %d s; the buttons are on again.",
    waited = " (waited %d s)",
}
HudText.REASON = {
    not_connected = "Claude is not connected",
    not_running = "LrC-AVG is not running",
    no_edit = "no edit is open",
    ended = "the edit has ended",
    no_pick = "no pick is waiting",
    no_approval = "no pass is waiting for approval",
    pending = "the %s is still waiting for Claude",
    changed = "the edit changed before it could be sent",
    gone = "this edit is no longer open in Claude",
    encode = "LrC-AVG could not encode it",
}

function HudText.notSent(label, reason)
    return string.format(HudText.CLICK.not_sent, label, reason)
end

-- The characters a slot of `width` chars holds.
function HudText.budget(width)
    return math.floor(width * HudText.MARGIN)
end

-- UTF-8 characters in s: every byte that is not a continuation byte (0x80-0xBF).
local function chars(s)
    local n = 0
    for i = 1, #s do
        local b = s:byte(i)
        if b < 128 or b >= 192 then n = n + 1 end
    end
    return n
end
HudText.chars = chars

-- The byte where the first n characters of s end, so s:sub(1, cut) never ends inside a character.
local function cutAt(s, n)
    local count = 0
    for i = 1, #s do
        local b = s:byte(i)
        if b < 128 or b >= 192 then
            if count == n then return i - 1 end
            count = count + 1
        end
    end
    return #s
end

local function trimEnd(s)
    return (s:gsub("%s+$", ""))
end

-- Every line of text at `budget` characters, however many.
local function allLines(text, budget)
    local out, line = {}, ""
    for word in text:gmatch("%S+") do
        local sep = (line == "") and "" or " "
        if chars(line) + #sep + chars(word) <= budget then
            line = line .. sep .. word
        elseif chars(word) <= budget then
            out[#out + 1] = line
            line = word
        else
            -- Longer than a line: fill this line with its first characters, then whole lines.
            local rest = line .. sep .. word
            while chars(rest) > budget do
                local cut = cutAt(rest, budget)
                out[#out + 1] = trimEnd(rest:sub(1, cut))
                rest = (rest:sub(cut + 1):gsub("^%s+", ""))
            end
            line = rest
        end
    end
    if line ~= "" then out[#out + 1] = line end
    return out
end

-- `text` (nil counts as "") in exactly `slots` lines of at most `budget` characters (at least 4),
-- "" for each unused slot; when it does not fit, the last line ends with "...".
function HudText.wrap(text, slots, budget)
    local all = allLines(tostring(text or ""), budget)
    local out = {}
    for i = 1, slots do out[i] = all[i] or "" end
    if #all > slots then
        local last = out[slots]
        if chars(last) > budget - 3 then last = trimEnd(last:sub(1, cutAt(last, budget - 3))) end
        out[slots] = last .. "..."
    end
    return out
end

return HudText
