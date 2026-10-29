-- Transfer.importPhoto's stack_with (plugin 1.9.0, issue #139): the photo to stack with is found outside the write
-- gate, the file is added below it, and its stack is read back; an unknown uuid imports nothing. The catalog is
-- spec_helper's read-gate spy; Gate, Photos and Metadata are stand-ins.
local helper = require 'spec_helper'

describe("Transfer.importPhoto stack_with", function()
    local Transfer, catalog, added, stackRead
    local STUBS = { "Gate", "KeywordTree", "Metadata", "Photos" }

    before_each(function()
        added, stackRead = {}, { position = 2, count = 2, collapsed = false, top_uuid = "uuid-top" }
        local photos = { ["uuid-top"] = { id = "top" } }
        catalog = helper.catalog({
            findPhotoByUuid = function(_, uuid) return photos[uuid] end,
            addPhoto = function(_, path, stackWith, position)
                added[#added + 1] = { path = path, stack_with = stackWith, position = position }
                return { id = path }
            end,
        })
        helper.sdk.LrApplication = { activeCatalog = function() return catalog end }
        helper.sdk.LrFileUtils = { exists = function() return "file" end }
        Transfer = helper.load('Transfer', {
            Gate = { write = function(_, _, fn) fn(); return "executed" end },
            KeywordTree = { forget = function() end },
            Photos = { describe = function(_, photo) return { uuid = "uuid-" .. photo.id, filename = photo.id } end },
            Metadata = { stackOf = function() return stackRead end },
        })
    end)

    after_each(function()
        for _, m in ipairs(STUBS) do package.loaded[m] = nil end
    end)

    it("adds the file in place, with no stack, without stack_with", function()
        local r = Transfer.importPhoto({ path = "C:\\in\\a.NEF" })
        assert.are.same({ { path = "C:\\in\\a.NEF" } }, added)
        assert.are.equal("imported", r.status)
        assert.is_nil(r.stack)
    end)

    it("adds the file below the photo it names and returns the stack read back", function()
        local r = Transfer.importPhoto({ path = "C:\\in\\b.NEF", stack_with = "uuid-top" })
        assert.are.same({ { path = "C:\\in\\b.NEF", stack_with = { id = "top" }, position = "below" } }, added)
        assert.are.same(stackRead, r.stack)
        assert.are.same({}, catalog.insideGate)
    end)

    it("keeps a stack read back as false (Lightroom put it in none)", function()
        stackRead = false
        assert.are.equal(false, Transfer.importPhoto({ path = "C:\\in\\b.NEF", stack_with = "uuid-top" }).stack)
    end)

    it("imports nothing when no photo has that uuid, or stack_with is empty", function()
        local r, err = Transfer.importPhoto({ path = "C:\\in\\b.NEF", stack_with = "uuid-gone" })
        assert.is_nil(r)
        assert.are.equal("unknown_photo", err.code)
        local _, bad = Transfer.importPhoto({ path = "C:\\in\\b.NEF", stack_with = "" })
        assert.are.equal("bad_request", bad.code)
        assert.are.same({}, added)
    end)
end)
