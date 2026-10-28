-- KeywordTree.lua's pure helpers: keyword paths split, joined, folded and diffed (issue #213).
local helper = require 'spec_helper'
local KeywordTree = helper.load('KeywordTree')

describe("KeywordTree.split and join", function()
    it("splits on | and trims each level", function()
        assert.are.same({ "A", "B", "C" }, KeywordTree.split("A | B|C"))
        assert.are.equal("A|B", KeywordTree.join({ "A", "B" }))
    end)

    it("refuses an empty level and a non-string", function()
        for _, bad in ipairs({ "A||B", "|A", "A|", "", " " }) do
            local parts, why = KeywordTree.split(bad)
            assert.is_nil(parts)
            assert.truthy(why:find("empty level", 1, true))
        end
        local parts, why = KeywordTree.split(5)
        assert.is_nil(parts)
        assert.are.equal("a keyword must be a string", why)
    end)
end)

describe("KeywordTree.fold", function()
    it("lowers ASCII with string.lower and hands any other name to LrStringUtils.lower", function()
        assert.are.equal("abc", KeywordTree.fold("AbC"))
        local seen
        local before = helper.sdk.LrStringUtils.lower
        helper.sdk.LrStringUtils.lower = function(s) seen = s; return "folded" end
        assert.are.equal("folded", KeywordTree.fold("\195\137t\195\169"))
        helper.sdk.LrStringUtils.lower = before
        assert.are.equal("\195\137t\195\169", seen)
    end)
end)

describe("KeywordTree.parseList", function()
    it("splits each keyword, takes nil as none, and refuses a non-list or a bad keyword", function()
        assert.are.same({}, KeywordTree.parseList(nil))
        assert.are.same({ { "A", "B" }, { "C" } }, KeywordTree.parseList({ "A|B", "C" }))
        assert.is_nil(KeywordTree.parseList("A"))
        assert.is_nil(KeywordTree.parseList({ "A||B" }))
    end)
end)

describe("KeywordTree.changes", function()
    it("adds what the photo lacks once and removes by path, case aside", function()
        local toAdd, removeAt = KeywordTree.changes({ "Places|Paris", "Travel" },
            { { "places", "paris" }, { "New" }, { "new" } }, { { "TRAVEL" } })
        assert.are.same({ { "New" } }, toAdd)
        assert.are.same({ 2 }, removeAt)
    end)

    it("takes a one-level name as the top-level keyword only", function()
        local _, removeAt = KeywordTree.changes({ "Places|Paris", "Paris" }, {}, { { "Paris" } })
        assert.are.same({ 2 }, removeAt)
    end)
end)

describe("KeywordTree.pathOf", function()
    it("names a keyword parent first", function()
        local function kw(name, parent)
            return { getName = function() return name end, getParent = function() return parent end }
        end
        assert.are.equal("A|B|C", KeywordTree.pathOf(kw("C", kw("B", kw("A")))))
    end)
end)
