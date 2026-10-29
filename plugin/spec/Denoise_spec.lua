-- Denoise.apply: its refusals and the branches of steps 3-5 in its header (issue #213). The Develop panel is a fake
-- whose Enhance state and digest change as the spec says; DevelopSession.withPhoto runs the function at once (its
-- switching and put-back are its own), and the catalog is spec_helper's read-gate spy.
local helper = require 'spec_helper'

describe("Denoise.apply", function()
    local Denoise, LDC, lr, calls, snapshotAnswer, found

    -- The photo as Lightroom has it: `compressed` is the Enhance filter's digest (nil: no Denoise), `panel` what the
    -- Develop panel shows; `shows` and `saves` say whether a change reaches the panel and the photo's settings.
    local function lightroom(o)
        lr = { compressed = o.compressed, shows = o.shows ~= false, saves = o.saves ~= false }
        if o.panel ~= false then lr.panel = { denoiseEnabled = o.enabled ~= false, denoiseState = o.state == true, denoiseAmount = o.amount or 0 } end
        lr.photo = { getDevelopSettings = function()
            if not lr.compressed then return { FilterList = { Filters = { { Name = "Dust Removal" } } } } end
            return { FilterList = { Filters = { { Name = "Enhance", CompressedSettings = lr.compressed } } } }
        end }
        lr.active = lr.photo
        lr.catalog = helper.catalog({ getTargetPhoto = function() return lr.active end })
    end

    local function change(kind, amount)
        calls[#calls + 1] = kind .. " " .. amount
        if lr.shows then lr.panel = { denoiseEnabled = true, denoiseState = true, denoiseAmount = amount } end
        if lr.saves then lr.compressed = "after " .. amount end
    end

    local function apply(payload)
        payload = payload or {}
        return Denoise.apply({ photo_uuid = "u1", amount = payload.amount or 50, snapshot_name = payload.snapshot_name or "AVG denoise" })
    end

    before_each(function()
        calls, snapshotAnswer, found = {}, { snapshot_id = "s1" }, false
        LDC = { getEnhancePanelState = function() return lr.panel end,
            setEnhance = function(kind, on, amount) assert.are.same({ "denoise", true }, { kind, on }); change("setEnhance", amount) end,
            changeDenoiseAmount = function(amount) change("changeDenoiseAmount", amount) end }
        helper.sdk.LrDevelopController = LDC
        helper.sdk.LrApplication = { activeCatalog = function() return lr.catalog end, versionString = function() return "15.6" end }
        helper.sdk.LrDate = { currentTime = function() return 0 end }
        local stubs = {
            Log = helper.log(),
            Develop = { createSnapshot = function(p)
                calls[#calls + 1] = "snapshot " .. p.name
                if snapshotAnswer then return snapshotAnswer end
                return nil, { message = "no snapshot" }
            end },
            DevelopSession = {
                waitFor = function(done) for _ = 1, 3 do if done() then return true end end return false end,
                withPhoto = function(_, _, _, fn) return fn(true) end,
            },
            Photos = { find = function(_, uuid) found = true; return lr.photo, { uuid = uuid } end },
        }
        package.loaded.Needs = nil
        Denoise = helper.load('Denoise', stubs)
        lightroom({})
    end)

    it("refuses an amount that is not a whole number from 1 to 100, and a snapshot name without AVG", function()
        for _, amount in ipairs({ 0, 101, 2.5, "50" }) do
            local res, err = Denoise.apply({ photo_uuid = "u1", amount = amount, snapshot_name = "AVG x" })
            assert.is_nil(res)
            assert.are.equal("bad_request", err.code)
        end
        local res, err = apply({ snapshot_name = "denoise" })
        assert.is_nil(res)
        assert.truthy(err.message:find("AVG ", 1, true))
        assert.is_false(found)
        assert.are.same({}, calls)
    end)

    it("answers feature_unavailable, naming the missing call, before it looks the photo up", function()
        LDC.setEnhance = nil
        local res, err = apply()
        assert.is_nil(res)
        assert.are.same({ "feature_unavailable", true }, { err.code, err.recoverable })
        assert.truthy(err.message:find("LrDevelopController.setEnhance", 1, true))
        assert.truthy(err.message:find("14.5", 1, true))
        assert.is_false(found)
    end)

    it("applies Denoise to a photo without it: the snapshot first, done once the panel and the digest show it", function()
        local res = apply()
        assert.are.same({ "snapshot AVG denoise", "setEnhance 50" }, calls)
        assert.are.same({ "applied", "u1", 0 }, { res.status, res.uuid, res.ms })
        assert.are.same({ id = "s1", name = "AVG denoise" }, res.snapshot)
        assert.is_nil(res.previous_amount)
        assert.are.same({}, lr.catalog.insideGate)
        assert.is_true(lr.catalog.reads >= 2)
    end)

    it("changes the amount of a photo that has Denoise, and answers the amount before", function()
        lightroom({ compressed = "before", state = true, amount = 30 })
        local res = apply()
        assert.are.same({ "snapshot AVG denoise", "changeDenoiseAmount 50" }, calls)
        assert.are.same({ "amount_changed", 30 }, { res.status, res.previous_amount })
    end)

    it("writes nothing when Denoise is on at that amount already", function()
        lightroom({ compressed = "before", state = true, amount = 50 })
        assert.are.equal("unchanged", apply().status)
        assert.are.same({}, calls)
    end)

    it("counts a panel that says Denoise is on but a photo with no Enhance filter as no Denoise yet", function()
        lightroom({ state = true, amount = 50 })
        assert.are.equal("applied", apply().status)
        assert.are.same({ "snapshot AVG denoise", "setEnhance 50" }, calls)
    end)

    it("fails without the panel state, and skips a photo the panel says cannot be denoised, writing nothing", function()
        lightroom({ panel = false })
        local res = apply()
        assert.are.equal("failed", res.status)
        assert.truthy(res.reason:find("Enhance state", 1, true))
        lightroom({ enabled = false })
        assert.are.equal("skipped", apply().status)
        assert.are.same({}, calls)
    end)

    it("fails without applying when the snapshot fails or another photo became active", function()
        snapshotAnswer = nil
        local res = apply()
        assert.are.equal("failed", res.status)
        assert.truthy(res.reason:find("no snapshot", 1, true))
        snapshotAnswer = { snapshot_id = "s2" }
        lr.active = { other = true }
        res = apply()
        assert.are.equal("failed", res.status)
        assert.are.equal("s2", res.snapshot.id)
        assert.are.same({ "snapshot AVG denoise", "snapshot AVG denoise" }, calls)
    end)

    it("puts the amount back when Lightroom shows the change but does not save it", function()
        lightroom({ compressed = "before", state = true, amount = 30, saves = false })
        local res = apply()
        assert.are.equal("failed", res.status)
        assert.truthy(res.reason:find("did not save", 1, true))
        assert.are.same({ "snapshot AVG denoise", "changeDenoiseAmount 50", "changeDenoiseAmount 30" }, calls)
    end)

    it("fails when the panel never shows the new amount, with nothing to put back on a photo that had no Denoise", function()
        lightroom({ shows = false, saves = false })
        local res = apply()
        assert.are.equal("failed", res.status)
        assert.truthy(res.reason:find("did not show", 1, true))
        assert.are.same({ "snapshot AVG denoise", "setEnhance 50" }, calls)
    end)

    it("answers the failure of the Enhance call itself", function()
        LDC.setEnhance = function() error("panel busy", 0) end
        local res = apply()
        assert.are.same({ "failed", "panel busy", "s1" }, { res.status, res.reason, res.snapshot.id })
    end)
end)
