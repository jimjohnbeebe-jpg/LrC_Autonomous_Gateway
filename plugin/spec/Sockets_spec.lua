-- Sockets.lua: the bridge's two listeners set flags in their callbacks and the monitor loop acts on them (P-13, the
-- generation counters, issue #176's rebind-or-re-arm; issue #213). LrSocket.bind is stubbed: each bind is kept with
-- its callbacks, so a spec fires them as Lightroom would.
local helper = require 'spec_helper'

describe("Sockets", function()
    local Sockets, B, binds, tasks, rebinds, log, now

    local function last(mode)
        for i = #binds, 1, -1 do if binds[i].mode == mode then return binds[i] end end
    end

    before_each(function()
        binds, tasks, rebinds, now = {}, {}, {}, 1000
        helper.sdk.LrDate = { currentTime = function() return now end }
        helper.sdk.LrSocket = { bind = function(params)
            local socket = { mode = params.mode, port = params.port, cb = params, closed = false }
            function socket.close(self) self.closed = true end
            binds[#binds + 1] = socket
            return socket
        end }
        helper.sdk.LrTasks.startAsyncTask = function(fn) tasks[#tasks + 1] = fn end
        log = helper.log()
        local Stall = { rebind = function(side, why, gen) rebinds[#rebinds + 1] = { side, why, gen } end }
        Sockets = helper.load('Sockets', { Log = log, Stall = Stall })
        B = { context = {}, generation = 4, S = { receiveGen = 0, sendGen = 0 }, receivePort = 8765, sendPort = 8766,
            current = function() return true end, lines = {} }
        B.onLine = function(line) B.lines[#B.lines + 1] = line end
        B.onSendConnected = function() B.sendHello = true end
        Sockets.rebindReceive(B)
        Sockets.rebindSend(B)
    end)

    it("binds receive on the receive port and send on the send port, with the flags cleared", function()
        assert.are.same({ "receive", 8765, "send", 8766 }, { binds[1].mode, binds[1].port, binds[2].mode, binds[2].port })
        assert.are.same({ 1, 1, 1000 }, { B.S.receiveGen, B.S.sendGen, B.S.boundAt })
        assert.is_false(B.S.receiveNeedsRebind)
        assert.is_false(B.S.sendNeedsReconnect)
    end)

    it("closes the old socket on a rebind, and the old socket's callbacks no longer count", function()
        local old = last("receive")
        B.S.receiveNeedsRebind = true
        Sockets.rebindReceive(B)
        assert.is_true(old.closed)
        assert.are.equal(2, B.S.receiveGen)
        assert.is_false(B.S.receiveNeedsRebind)
        old.cb.onConnected()
        old.cb.onMessage(nil, "stale")
        assert.is_false(B.S.receiveConnected)
        assert.are.equal(0, #tasks)
    end)

    it("ignores every callback once the bridge is no longer the current one", function()
        B.current = function() return false end
        last("receive").cb.onConnected()
        last("send").cb.onClosed()
        assert.is_false(B.S.receiveConnected)
        assert.is_false(B.S.sendNeedsRebind)
    end)

    it("on an engine connection drops a queued rebind and rebinds a send socket that still looks connected", function()
        B.S.sendConnected, B.S.receiveNeedsRebind = true, true
        last("receive").cb.onConnected()
        assert.is_true(B.S.receiveConnected)
        assert.is_false(B.S.receiveNeedsRebind)
        assert.is_false(B.S.sendConnected)
        assert.is_true(B.S.sendNeedsRebind)
    end)

    it("hands each line to a new task instead of running it in the callback", function()
        now = 1005
        last("receive").cb.onMessage(nil, "line 1")
        assert.are.same({}, B.lines)
        assert.are.equal(1005, B.S.lastInbound)
        tasks[1]()
        assert.are.same({ "line 1" }, B.lines)
    end)

    it("rebinds receive on a close, at most once a minute, and re-arms in between", function()
        local receive = last("receive")
        receive.cb.onClosed()
        assert.is_true(B.S.receiveNeedsRebind)
        assert.are.same({ { "receive", "closed", 4 } }, rebinds)
        Sockets.rebindReceive(B)
        now = 1059
        last("receive").cb.onClosed()
        assert.is_false(B.S.receiveNeedsRebind)
        assert.is_true(B.S.receiveNeedsReconnect)
        assert.are.equal(1, #rebinds)
        now = 1060
        last("receive").cb.onClosed()
        assert.is_true(B.S.receiveNeedsRebind)
        assert.are.equal(2, #rebinds)
    end)

    it("re-arms on a timeout with no engine, and rebinds on failed to open, logging that once in ten seconds", function()
        local receive = last("receive")
        receive.cb.onError(nil, "timeout")
        assert.is_true(B.S.receiveNeedsReconnect)
        assert.are.equal(0, #rebinds)
        receive.cb.onError(nil, "failed to open")
        receive.cb.onError(nil, "failed to open")
        assert.is_true(B.S.receiveNeedsRebind)
        assert.are.same({ "receive", "failed to open", 4 }, rebinds[1])
        assert.are.equal(1, #log.lines)
        assert.truthy(log.lines[1]:find("receive port 8765 failed to open", 1, true))
        now = 1010
        receive.cb.onError(nil, "failed to open")
        assert.are.equal(2, #log.lines)
    end)

    it("leaves a connected receive socket alone on a timeout, and drops it on any other error", function()
        local receive = last("receive")
        receive.cb.onConnected()
        receive.cb.onError(nil, "timeout")
        assert.is_true(B.S.receiveConnected)
        assert.is_false(B.S.receiveNeedsReconnect)
        receive.cb.onError(nil, "reset by peer")
        assert.is_false(B.S.receiveConnected)
        assert.is_true(B.S.receiveNeedsReconnect)
        assert.truthy(log.lines[#log.lines]:find("receive: error reset by peer", 1, true))
    end)

    it("send: says hello in a task on connect, and asks for a rebind on a close or an error", function()
        local send = last("send")
        send.cb.onConnected()
        assert.is_true(B.S.sendConnected)
        assert.is_nil(B.sendHello)
        tasks[1]()
        assert.is_true(B.sendHello)
        send.cb.onClosed()
        assert.is_false(B.S.sendConnected)
        assert.is_true(B.S.sendNeedsRebind)
        Sockets.rebindSend(B)
        send = last("send")
        send.cb.onConnected()
        send.cb.onError(nil, "broken pipe")
        assert.is_false(B.S.sendConnected)
        assert.is_true(B.S.sendNeedsRebind)
        assert.are.equal(0, #rebinds)
    end)

    it("send: re-arms on a timeout with no engine, and rebinds on failed to open", function()
        local send = last("send")
        send.cb.onError(nil, "timeout")
        assert.is_true(B.S.sendNeedsReconnect)
        send.cb.onError(nil, "failed to open")
        assert.is_true(B.S.sendNeedsRebind)
        assert.are.same({ { "send", "failed to open", 4 } }, rebinds)
    end)
end)
