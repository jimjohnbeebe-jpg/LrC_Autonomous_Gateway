-- AVG-S8: asks Jim what only he can see, as tick boxes in one Lightroom dialog (rule 04's default,
-- the S4 pattern: plugin\spikes\S4.lrplugin\S4Hud.lua:136-155). Each statement is saved with its
-- answer; Cancel saves every answer as not given.

local LrBinding = import 'LrBinding'
local LrDialogs = import 'LrDialogs'
local LrView = import 'LrView'

local Ask = {}

-- questions: { { key = "...", text = "..." }, ... }. Returns answered (bool), and
-- { [key] = { statement, answer } }, answer true only when ticked and saved.
function Ask.ticks(context, title, questions)
    local f = LrView.osFactory()
    local answers = LrBinding.makePropertyTable(context)
    local rows = {
        bind_to_object = answers,
        spacing = f:control_spacing(),
        f:static_text { title = "Tick every statement that is true. Leave the others unticked." },
    }
    for _, q in ipairs(questions) do
        answers[q.key] = false
        table.insert(rows, f:checkbox { title = q.text, value = LrView.bind(q.key) })
    end
    local choice = LrDialogs.presentModalDialog {
        title = title,
        actionVerb = "Save",
        contents = f:column(rows),
    }
    local saved = {}
    for _, q in ipairs(questions) do
        saved[q.key] = { statement = q.text, answer = (choice == "ok") and (answers[q.key] == true) }
    end
    return choice == "ok", saved
end

return Ask
