-- Pending.lua: a write to a photo waits while an AI mask still computes on it (plugin 0.16.0, D16; issue #213).
local helper = require 'spec_helper'

-- A watch as the engine sends it; the field names are the engine's choice, so any strings do here.
local function watch(ids, ai)
    local w = { ids = ids, table = "Groups", id = "Id", masks = "Parts", digest = "Digest", error = "Err" }
    if ai then w.what, w.image = "What", "image" end
    return w
end

-- A catalog that counts its reads and a photo whose develop settings hold `groups`.
local function lightroom(groups)
    local lr = { reads = 0, groups = groups }
    lr.catalog = { withReadAccessDo = function(_, fn) lr.reads = lr.reads + 1; fn() end }
    lr.photo = { getDevelopSettings = function() return { Groups = lr.groups } end }
    return lr
end

describe("Pending", function()
    local Pending
    before_each(function()
        _G.LrCAVG_PendingAi = nil
        Pending = helper.load('Pending')
    end)

    it("guards nothing for a missing or malformed watch, and reads nothing for an unguarded photo", function()
        assert.is_nil(Pending.start("u1", "r1", nil))
        assert.is_nil(Pending.start("u1", "r1", watch({})))
        assert.is_nil(Pending.start("u1", "r1", { ids = { "m1" } }))
        local lr = lightroom({})
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u1"))
        assert.are.equal(0, lr.reads)
    end)

    it("refuses while the watched part has no answer, then lets the write go and forgets the photo", function()
        local lr = lightroom({ { Id = "m1", Parts = { { Digest = "" } } } })
        Pending.start("u1", "r1", watch({ "m1" }))
        assert.are.equal(Pending.REFUSED, Pending.refusal(lr.catalog, lr.photo, "u1"))
        lr.groups[1].Parts[1].Digest = "abc"
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u1"))
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u1"))
        assert.are.equal(2, lr.reads)
    end)

    it("counts an ErrorReason other than 0 as an answer, and an entry gone from the table as none to wait for", function()
        local lr = lightroom({ { Id = "m1", Parts = { { Err = 3 } } } })
        Pending.start("u1", "r1", watch({ "m1" }))
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u1"))
        Pending.start("u2", "r2", watch({ "gone" }))
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u2"))
    end)

    it("waits only for AI parts when the watch says how to tell them", function()
        local lr = lightroom({ { Id = "m1", Parts = { { What = "brush" }, { What = "image" } } } })
        Pending.start("u1", "r1", watch({ "m1" }, true))
        assert.are.equal(Pending.REFUSED, Pending.refusal(lr.catalog, lr.photo, "u1"))
        lr.groups[1].Parts[2].Digest = "abc"
        assert.is_nil(Pending.refusal(lr.catalog, lr.photo, "u1"))
    end)

    it("keeps the ids of a record still there, and clear leaves a newer record alone", function()
        local first = Pending.start("u1", "r1", watch({ "a" }))
        local second = Pending.start("u1", "r2", watch({ "b" }))
        assert.are.same({ "b", "a" }, second.watch.ids)
        Pending.clear("u1", first)
        local lr = lightroom({ { Id = "a", Parts = { {} } } })
        assert.are.equal(Pending.REFUSED, Pending.refusal(lr.catalog, lr.photo, "u1"))
    end)

    it("clear_pending_ai drops the record and says whether there was one", function()
        local res, err = Pending.clearPhoto({})
        assert.is_nil(res)
        assert.are.equal("bad_request", err.code)
        Pending.start("u1", "r1", watch({ "a" }))
        assert.are.same({ photo_uuid = "u1", cleared = true }, Pending.clearPhoto({ photo_uuid = "u1" }))
        assert.are.same({ photo_uuid = "u1", cleared = false }, Pending.clearPhoto({ photo_uuid = "u1" }))
    end)
end)
