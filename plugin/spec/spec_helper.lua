-- busted helpers for the plugin's specs (GitHub issue #213): plugin modules load outside Lightroom with the SDK's
-- `import` stubbed. Modelled on Automaat's plugin/spec/spec_helper.lua (Automaat/lightroom-mcp at 1040453, MIT);
-- written here, not copied. Run from the repo root: `busted` (.busted), or `npm run lua:test`.

local M = {}

-- import 'X' returns M.sdk.X, an empty table unless a spec or this file set it, so a module body that only
-- keeps a namespace in a local loads; a spec sets the functions its module calls on that same table.
M.sdk = {
    -- Outside Lightroom there is no task to yield in, so the plain pcall stands in for LrTasks.pcall.
    LrTasks = { pcall = pcall, yield = function() end, sleep = function() end },
    LrStringUtils = { lower = string.lower },
}

_G.import = function(name)
    M.sdk[name] = M.sdk[name] or {}
    return M.sdk[name]
end

-- Loads plugin module `name` afresh, with `stubs` (module name -> table) in place of the modules it requires.
function M.load(name, stubs)
    for dep, t in pairs(stubs or {}) do package.loaded[dep] = t end
    package.loaded[name] = nil
    return require(name)
end

-- A Log.lua stand-in that keeps its lines instead of writing a file.
function M.log()
    local lines = {}
    local function add(level)
        return function(msg) lines[#lines + 1] = level .. " " .. tostring(msg) end
    end
    return { info = add("INFO"), warn = add("WARN"), error = add("ERROR"), lines = lines }
end

return M
