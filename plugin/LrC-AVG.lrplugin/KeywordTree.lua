-- Keywords addressed by their place in the keyword hierarchy (plugin 0.10.0, GitHub issue #60;
-- rewritten from Automaat's KeywordTree.lua and HandlerOrganization.lua at upstream commit 11c0b93,
-- MIT, see THIRD_PARTY_NOTICES.md). Library.lua's set_keywords and list_keywords use it.
--
-- A path names a keyword parent first, with "|" between the levels: "Places|Europe|Paris". Automaat
-- chose "|" as Lightroom's own hierarchy separator, which a keyword name cannot hold [upstream claim:
-- plugin/LightroomMCP.lrplugin/KeywordTree.lua:3-6 at 11c0b93]. A name without "|" is a path of one
-- level: a top-level keyword. Each level is trimmed; an empty level is refused. Names compare case
-- aside, folded with LrStringUtils.lower, which "properly converts characters outside the 7-bit ASCII
-- space" [handle: https://lrc.mcor.dev/modules/LrStringUtils.html lower], because Lightroom matches
-- keyword names so, createKeyword's returnExisting included [upstream claim: KeywordTree.lua:13-15 at
-- 11c0b93].
--
-- Reading the tree: catalog:getKeywords(), keyword:getChildren(), getName() and getParent() "must be
-- called from within an asynchronous task", and their pages name no gate [handle:
-- https://lrc.mcor.dev/modules/LrCatalog.html getKeywords; https://lrc.mcor.dev/modules/LrKeyword.html].
-- Automaat walks the tree inside a read gate [upstream claim: HandlerKeywords.lua:56 at 11c0b93]; here
-- the walk runs outside any gate, as rule 03 asks of catalog queries that may yield, since whether
-- these yield is [unverified]. Automaat found LrKeyword getters yielding [upstream claim: commit 11c0b93
-- message, "Yielding is not allowed within a C or metamethod call" from a sort comparator], so names
-- are read before sorting, never in a table.sort comparator. The walk yields every YIELD_EVERY
-- keywords (PRD NFR-1). A photo's own keywords get their paths outside the gate too (Library.lua
-- keywordsOf); plugin 0.8.0 read their names inside a read gate in Lightroom [handle: vault
-- LR_SDK_NOTES "Recorded in Phase 6", catalog search and metadata].
--
-- Creating levels: a keyword made by createKeyword "is not available for access until that function
-- returns" [handle: LrCatalog page, createKeyword], so a new level cannot be the parent of another new
-- level in the same write gate (Automaat saw "bad argument #2 to 'format'" [upstream claim:
-- HandlerOrganization.lua:77-80 at 11c0b93]). resolve() opens one gate per depth that has a missing
-- parent; each such gate is one more "AVG set keywords" in Edit > Undo [inference: every named gate is
-- an Undo item, vault LR_SDK_NOTES "Recorded in Phase 6"]. It also finds an existing last level case
-- aside, so createKeyword never meets a case variant of a keyword that already exists.

local LrStringUtils = import 'LrStringUtils'
local LrTasks = import 'LrTasks'

local Gate = require 'Gate'

local KeywordTree = {}

KeywordTree.SEPARATOR = "|"

-- Keywords walked between yields [inference: the figure].
local YIELD_EVERY = 50

function KeywordTree.fold(s)
    return LrStringUtils.lower(s)
end

function KeywordTree.join(parts)
    return table.concat(parts, KeywordTree.SEPARATOR)
end

-- "A | B|C" -> { "A", "B", "C" }; or nil plus the reason ("A||B", "|A", "A|" and "" have an empty level).
function KeywordTree.split(path)
    if type(path) ~= "string" then return nil, "a keyword must be a string" end
    local parts = {}
    for segment in (path .. KeywordTree.SEPARATOR):gmatch("([^|]*)|") do
        local name = segment:match("^%s*(.-)%s*$")
        if name == "" then return nil, "keyword \"" .. path .. "\" has an empty level" end
        parts[#parts + 1] = name
    end
    return parts
end

-- The path of a keyword object, parent first.
function KeywordTree.pathOf(keyword)
    local names, current = {}, keyword
    while current do
        table.insert(names, 1, current:getName())
        current = current:getParent()
    end
    return KeywordTree.join(names)
end

-- The keywords in `v` (a list of names and paths, or nil), each split into its levels; or nil plus
-- the reason.
function KeywordTree.parseList(v)
    if v == nil then return {} end
    if type(v) ~= "table" then return nil, "must be lists of keywords" end
    local out = {}
    for _, s in ipairs(v) do
        local parts, why = KeywordTree.split(s)
        if not parts then return nil, why end
        out[#out + 1] = parts
    end
    return out
end

-- What set_keywords writes, from the photo's keyword paths before the call. Every keyword is a path,
-- matched case aside; a one-level name is the top-level keyword of that name, for adding and removing
-- alike, never a deeper keyword of the same name. So removing what was added puts the photo back.
--   toAdd: each path to add that the photo does not hold, once;
--   removeAt: the positions in `paths` of the keywords to take off.
function KeywordTree.changes(paths, add, remove)
    local held, toAdd = {}, {}
    for _, path in ipairs(paths) do held[KeywordTree.fold(path)] = true end
    for _, parts in ipairs(add) do
        local k = KeywordTree.fold(KeywordTree.join(parts))
        if not held[k] then
            held[k] = true
            toAdd[#toAdd + 1] = parts
        end
    end
    local removing, removeAt = {}, {}
    for _, parts in ipairs(remove) do removing[KeywordTree.fold(KeywordTree.join(parts))] = true end
    for i, path in ipairs(paths) do
        if removing[KeywordTree.fold(path)] then removeAt[#removeAt + 1] = i end
    end
    return toAdd, removeAt
end

local function children(catalog, parent)
    if parent then return parent:getChildren() or {} end
    return catalog:getKeywords() or {}
end

local function findChild(catalog, parent, name)
    local folded = KeywordTree.fold(name)
    for _, child in ipairs(children(catalog, parent)) do
        if KeywordTree.fold(child:getName()) == folded then return child end
    end
    return nil
end

-- Every keyword under `parent` (nil: the whole tree) appended to `out` as its path, depth first, a
-- parent before its children, siblings in folded-name order, so that pages follow on stably.
function KeywordTree.walk(catalog, parent, prefix, out)
    local kids = {}
    for _, child in ipairs(children(catalog, parent)) do
        local name = child:getName()
        kids[#kids + 1] = { keyword = child, name = name, folded = KeywordTree.fold(name) }
    end
    table.sort(kids, function(a, b)
        if a.folded ~= b.folded then return a.folded < b.folded end
        return a.name < b.name
    end)
    for _, kid in ipairs(kids) do
        local path = prefix .. kid.name
        out[#out + 1] = path
        if #out % YIELD_EVERY == 0 then LrTasks.yield() end -- PRD NFR-1
        KeywordTree.walk(catalog, kid.keyword, path .. KeywordTree.SEPARATOR, out)
    end
    return out
end

local function prefixKey(parts, depth)
    return KeywordTree.fold(KeywordTree.join({ unpack(parts, 1, depth) }))
end

-- For each path in `paths` (lists of levels): `parents[i]`, the keyword its last level goes under (nil
-- for a top-level name; else found case aside, or created), and `leaves[i]`, that last level when it
-- exists already (found case aside), else nil for the caller to create. Missing parents are created
-- depth by depth, one write gate per depth, each level once even when several paths share it. Raises
-- when Lightroom creates no keyword. A list of one-level names opens no gate here.
function KeywordTree.resolve(catalog, paths)
    local known, deepest = {}, 0
    for _, parts in ipairs(paths) do deepest = math.max(deepest, #parts - 1) end
    for depth = 1, deepest do
        local missing = {}
        for _, parts in ipairs(paths) do
            local k = prefixKey(parts, depth)
            if #parts > depth and not known[k] and not missing[k] then
                local parent = known[prefixKey(parts, depth - 1)] -- nil at depth 1: the top level
                known[k] = findChild(catalog, parent, parts[depth])
                if not known[k] then missing[k] = { parent = parent, name = parts[depth] } end
            end
        end
        if next(missing) then
            Gate.run(catalog, "AVG set keywords", function()
                for k, level in pairs(missing) do
                    -- createKeyword(name, synonyms, includeOnExport, parent, returnExisting) [handle: LrCatalog page].
                    known[k] = catalog:createKeyword(level.name, {}, true, level.parent, true)
                end
            end)
            for k, level in pairs(missing) do
                if not known[k] then error("Lightroom created no keyword \"" .. level.name .. "\"") end
            end
        end
    end
    local parents, leaves = {}, {}
    for i, parts in ipairs(paths) do
        parents[i] = known[prefixKey(parts, #parts - 1)]
        leaves[i] = findChild(catalog, parents[i], parts[#parts])
    end
    return parents, leaves
end

return KeywordTree
