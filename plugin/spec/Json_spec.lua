-- Json.lua, the bridge's codec (issue #213).
require 'spec_helper'
local Json = require 'Json'

describe("Json.encode", function()
    it("writes scalars, NaN and infinities as null", function()
        assert.are.equal("1.5", Json.encode(1.5))
        assert.are.equal("true", Json.encode(true))
        assert.are.equal("null", Json.encode(nil))
        assert.are.equal("null", Json.encode(0 / 0))
        assert.are.equal("null", Json.encode(math.huge))
        assert.are.equal("null", Json.encode(-math.huge))
    end)

    it("escapes quote, backslash and control bytes, and passes UTF-8 through", function()
        assert.are.equal([["a\"b\\c\n"]], Json.encode('a"b\\c\n'))
        assert.are.equal([["\u0001\u007f"]], Json.encode("\1\127"))
        assert.are.equal('"\195\169"', Json.encode("\195\169"))
    end)

    it("writes arrays and objects; an empty table is []", function()
        assert.are.equal("[1,2,3]", Json.encode({ 1, 2, 3 }))
        assert.are.equal("[]", Json.encode({}))
        assert.are.equal('{"a":1}', Json.encode({ a = 1 }))
    end)

    it("refuses functions and nesting deeper than 64", function()
        assert.has_error(function() Json.encode(print) end)
        local deep = {}
        for _ = 1, 70 do deep = { deep } end
        assert.has_error(function() Json.encode(deep) end)
    end)
end)

describe("Json.decode", function()
    it("reads objects, arrays, literals and numbers", function()
        local v = Json.decode('{"a":[1,2,{"b":null}],"s":"x","t":true,"f":false,"n":-1.5e2}')
        assert.are.equal(1, v.a[1])
        assert.are.equal(2, v.a[2])
        assert.is_nil(v.a[3].b)
        assert.are.equal("x", v.s)
        assert.is_true(v.t)
        assert.is_false(v.f)
        assert.are.equal(-150, v.n)
    end)

    it("turns \\u escapes into UTF-8, pairing surrogates; a lone surrogate becomes U+FFFD", function()
        assert.are.equal("x\195\169y", Json.decode([["xéy"]]))
        assert.are.equal("\240\159\152\128", Json.decode([["😀"]]))
        assert.are.equal("\239\191\189x", Json.decode([["\ud800x"]]))
    end)

    it("refuses trailing characters, a bad escape and an unterminated string", function()
        assert.has_error(function() Json.decode("1 2") end)
        assert.has_error(function() Json.decode([["\q"]]) end)
        assert.has_error(function() Json.decode('"abc') end)
    end)

    it("reads back what encode wrote", function()
        local t = { name = "AVG 1/3", list = { 1, "two", { three = 3 } }, ok = false }
        assert.are.same(t, Json.decode(Json.encode(t)))
    end)
end)
