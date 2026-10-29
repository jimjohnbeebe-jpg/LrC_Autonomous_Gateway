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

-- The catalog calls rule 03 (.claude\rules\03-lightroom.md) keeps outside withReadAccessDo: the yielding queries,
-- which deadlock inside it on Windows [upstream claim: HandlerSelection.lua:30-38], and the batch reads issue #212
-- put outside it. The same list as OUTSIDE in engine\tests\lua-read-gate.test.ts, the static check of this rule.
M.OUTSIDE_GATE = { "findPhotos", "findPhotoByUuid", "findPhotoByPath", "getTargetPhoto", "getTargetPhotos",
    "setSelectedPhotos", "getAllPhotos", "getFolderByPath", "getCollectionByLocalIdentifier", "batchGetRawMetadata",
    "batchGetFormattedMetadata" }

-- A catalog that spies on its read gate: `insideGate` lists each OUTSIDE_GATE call made while a withReadAccessDo
-- runs, `reads` counts the gates. `methods` (name -> function(self, ...)) gives the answers; an OUTSIDE_GATE call
-- with none answers nil. Unlike the static check, this sees a call reached through another function. Upstream's
-- spec_helper keeps the same spy [upstream claim: vendor\automaat\plugin\spec\spec_helper.lua:139, 219,
-- getQueriedInsideReadAccess]; written here, not copied.
function M.catalog(methods)
    methods = methods or {}
    local cat, depth = { insideGate = {}, reads = 0 }, 0
    for name, fn in pairs(methods) do cat[name] = fn end
    for _, name in ipairs(M.OUTSIDE_GATE) do
        cat[name] = function(self, ...)
            if depth > 0 then cat.insideGate[#cat.insideGate + 1] = name end
            if methods[name] then return methods[name](self, ...) end
        end
    end
    function cat.withReadAccessDo(_, fn)
        depth, cat.reads = depth + 1, cat.reads + 1
        local ok, err = pcall(fn)
        depth = depth - 1
        if not ok then error(err, 0) end
    end
    return cat
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
