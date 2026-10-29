-- Rule 03 (.claude\rules\03-lightroom.md) at run time (issue #213): the yielding catalog queries and the batch
-- reads stay outside withReadAccessDo, the reads of one photo go inside it. The catalog is spec_helper's spy, which
-- also sees a call reached through another function, as engine\tests\lua-read-gate.test.ts (static) cannot.
local helper = require 'spec_helper'

-- A photo whose getters answer from `raw` and `formatted`; it is its own master, as a photo that is no copy is.
local function photo(uuid, id)
    local raw = { uuid = uuid, isVirtualCopy = false, rating = 3, path = "C:/photos/" .. uuid .. ".dng" }
    local formatted = { fileName = uuid .. ".dng", dateTimeOriginal = "09/15/2005 17:32:50" }
    local p = { localIdentifier = id, raw = raw, formatted = formatted }
    raw.masterPhoto = p
    function p.getRawMetadata(_, key) return raw[key] end
    function p.getFormattedMetadata(_, key) return formatted[key] end
    return p
end

describe("the read-gate spy", function()
    it("notes a query made inside the gate, whichever function makes it, and none made outside", function()
        local cat = helper.catalog()
        local function nested() return cat:getTargetPhoto() end
        cat:getTargetPhotos()
        cat:withReadAccessDo(function() nested() end)
        assert.are.same({ "getTargetPhoto" }, cat.insideGate)
        assert.are.equal(1, cat.reads)
    end)

    it("leaves the gate when its function raises", function()
        local cat = helper.catalog()
        assert.has_error(function() cat:withReadAccessDo(function() error("boom", 0) end) end, "boom")
        cat:findPhotos({})
        assert.are.same({}, cat.insideGate)
    end)
end)

describe("Photos under the read-gate spy", function()
    local Photos
    before_each(function()
        import("LrFileUtils").exists = function() return false end
        Photos = helper.load('Photos', { Log = helper.log() })
    end)

    it("find looks the photo up outside the gate and reads its identity inside one", function()
        local p = photo("u1", 7)
        local cat = helper.catalog({ findPhotoByUuid = function(_, uuid) return uuid == "u1" and p or nil end })
        local found, d = Photos.find(cat, "u1", { is_virtual_copy = false })
        assert.are.equal(p, found)
        assert.are.same({ "u1", 7, "u1.dng" }, { d.uuid, d.master_local_id, d.filename })
        assert.are.same({}, cat.insideGate)
        assert.are.equal(1, cat.reads)
        local none, err = Photos.find(cat, "u2")
        assert.is_nil(none)
        assert.are.equal("unknown_photo", err.code)
    end)

    it("describePage reads a page with the batch calls and no gate", function()
        local a, b = photo("a", 1), photo("b", 2)
        local cat = helper.catalog({
            batchGetRawMetadata = function() return { [a] = a.raw, [b] = b.raw } end,
            batchGetFormattedMetadata = function() return { [a] = a.formatted, [b] = b.formatted } end,
        })
        local out = Photos.describePage(cat, { a, b })
        assert.are.same({ "a", "b" }, { out[1].uuid, out[2].uuid })
        assert.are.same({}, cat.insideGate)
        assert.are.equal(0, cat.reads)
    end)

    it("describePage falls back to one gate per photo when the batch raises, still with nothing yielding inside", function()
        local a, b = photo("a", 1), photo("b", 2)
        local cat = helper.catalog({ batchGetRawMetadata = function() error("batch failed") end })
        local out = Photos.describePage(cat, { a, b }, { where = true })
        assert.are.same({ "a", "b" }, { out[1].uuid, out[2].uuid })
        assert.are.equal("C:/photos/b.dng", out[2].path)
        assert.are.same({}, cat.insideGate)
        assert.are.equal(2, cat.reads)
    end)

    it("missing reads the path and the name inside gates and checks the file outside them", function()
        local p = photo("u1", 7)
        p.checkPhotoAvailability = function() return true end
        local cat = helper.catalog()
        local refusal = Photos.missing(cat, p)
        assert.are.equal("original_missing", refusal.code)
        assert.truthy(refusal.message:find("u1.dng", 1, true))
        assert.are.same({}, cat.insideGate)
        assert.are.equal(2, cat.reads)
    end)
end)

describe("Pending under the read-gate spy", function()
    it("reads the photo's develop settings inside the gate and queries nothing there", function()
        _G.LrCAVG_PendingAi = nil
        local Pending = helper.load('Pending')
        Pending.start("u1", "r1", { ids = { "m1" }, table = "Groups", id = "Id", masks = "Parts", digest = "Digest", error = "Err" })
        local cat = helper.catalog()
        local p = { getDevelopSettings = function() return { Groups = { { Id = "m1", Parts = { { Digest = "" } } } } } end }
        assert.are.equal(Pending.REFUSED, Pending.refusal(cat, p, "u1"))
        assert.are.same({}, cat.insideGate)
        assert.are.equal(1, cat.reads)
    end)
end)
