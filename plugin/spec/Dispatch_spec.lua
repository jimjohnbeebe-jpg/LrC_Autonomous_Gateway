-- Dispatch.handleLine: the command envelope and its token checked before any handler runs (C-8; issue #213).
local helper = require 'spec_helper'
local Json = require 'Json'

-- The handler modules Dispatch.lua requires; handleLine calls none of them, so each is an empty table here.
local HANDLER_MODULES = { "Catalog", "CollectionEdit", "Copies", "Denoise", "Develop", "DevelopTools", "Folders", "Hud",
    "KeywordEdit", "Library", "MaskClean", "Masks", "Metadata", "Pending", "PluginMetadata", "Prefs", "Presets", "Preview",
    "Snapshots", "Transfer" }

describe("Dispatch.handleLine", function()
    local Dispatch, S, sent, calls
    local handlers = {
        ping = function(p) calls = calls + 1; return { pong = true, nonce = p.nonce } end,
        boom = function() error("it broke") end,
        refuse = function() return nil, { code = "bad_request", message = "no", recoverable = false } end,
        echo = function(p) return { got = p } end,
    }
    local function respond(id, name, ok, body) sent[#sent + 1] = { id = id, name = name, ok = ok, body = body } end
    local function run(line) Dispatch.handleLine(S, handlers, respond, line) end
    local function cmd(name, token, payload)
        return Json.encode({ type = "cmd", id = "c1", name = name, token = token, payload = payload })
    end

    before_each(function()
        local stubs = { Log = helper.log(), Json = Json }
        for _, m in ipairs(HANDLER_MODULES) do stubs[m] = {} end
        Dispatch = helper.load('Dispatch', stubs)
        S = { token = "t0k", tokenFile = "token-file", handled = 0, failed = 0, malformed = 0, unauthorized = 0 }
        sent, calls = {}, 0
    end)

    it("runs the handler of a command with the right token and answers ok", function()
        run(cmd("ping", "t0k", { nonce = "n1" }))
        assert.are.same({ { id = "c1", name = "ping", ok = true, body = { pong = true, nonce = "n1" } } }, sent)
        assert.are.equal(1, S.handled)
    end)

    it("refuses a wrong or missing token, and a bridge without one, before the handler runs", function()
        run(cmd("ping", "wrong", {}))
        run(cmd("ping", nil, {}))
        S.token = nil
        run(cmd("ping", "t0k", {}))
        assert.are.equal(0, calls)
        assert.are.equal(3, S.unauthorized)
        for _, r in ipairs(sent) do
            assert.is_false(r.ok)
            assert.are.equal("unauthorized", r.body.code)
            assert.truthy(r.body.message:find("token-file", 1, true))
        end
    end)

    it("answers a line that is not a command envelope only when it carries an id", function()
        run('{"id":"x7", not json')
        run(Json.encode({ type = "evt", id = "x8", name = "ping" }))
        run(Json.encode({ type = "cmd", name = "ping" }))
        assert.are.equal(3, S.malformed)
        assert.are.equal(2, #sent)
        assert.are.same({ "x7", "?", false, "bad_request" }, { sent[1].id, sent[1].name, sent[1].ok, sent[1].body.code })
        assert.are.equal("x8", sent[2].id)
    end)

    it("answers unknown_command, plugin_error for a raise, and the handler's own error for nil", function()
        run(cmd("nope", "t0k", {}))
        run(cmd("boom", "t0k", {}))
        run(cmd("refuse", "t0k", {}))
        assert.are.equal("unknown_command", sent[1].body.code)
        assert.are.equal("plugin_error", sent[2].body.code)
        assert.truthy(sent[2].body.message:find("it broke", 1, true))
        assert.are.equal("bad_request", sent[3].body.code)
        assert.are.equal(3, S.failed)
    end)

    it("gives the handler an empty table when the payload is not one", function()
        run(Json.encode({ type = "cmd", id = "c1", name = "echo", token = "t0k", payload = "text" }))
        assert.are.same({}, sent[1].body.got)
    end)
end)
