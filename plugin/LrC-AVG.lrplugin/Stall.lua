-- Issue #174 diagnosis. With the plugin enabled and no engine connected, Lightroom stuttered and froze
-- for seconds, sometimes up to 30 s [stated: Jim, issue #174]; bridge.log then held a "receive: closed" /
-- "send: closed" pair about every 10 s, the idle rebind in Bridge.lua's monitor loop [handle:
-- %TEMP%\LrC-AVG\bridge.log 2026-10-17 17:57:42-18:32:55]. What this logs, for `npm run stall:check`:
--   stall  the monitor loop sleeps LOOP_SECONDS; a wake-up more than STALL_SECONDS late means no plugin task
--          ran for that long [inference: plugin tasks run on Lightroom's main thread], logged with what the
--          previous tick did ("tend" when it bound or re-armed a socket, "idle" otherwise)
--   tend   a tick whose socket work took over TEND_LOG_SECONDS (the two rebinds sleep 0.1 s each)
--   rebind  each rebind an event asked for (Sockets.lua rebindOr), or an overlapping start's (Bridge.lua)

local LrDate = import 'LrDate'

local Log = require 'Log'

local Stall = {}

local STALL_SECONDS = 1
local TEND_LOG_SECONDS = 0.3

local function ms(seconds) return math.floor(seconds * 1000 + 0.5) end

function Stall.new(loopSeconds)
    Log.info("stall-diag: on")
    return { loop = loopSeconds, lastTick = nil, lastWhat = "start" }
end

-- At the top of every monitor tick.
function Stall.tick(D)
    local now = LrDate.currentTime()
    if D.lastTick then
        local late = now - D.lastTick - D.loop
        if late > STALL_SECONDS then Log.warn(string.format("stall-diag: stall %d ms after %s", ms(late), D.lastWhat)) end
    end
    D.lastTick, D.lastWhat = now, "idle"
end

-- Runs fn (the monitor's socket work), logs it when slow, and marks the tick as "tend" when it did any work.
function Stall.timed(D, fn)
    local t0 = LrDate.currentTime()
    fn()
    local took = LrDate.currentTime() - t0
    if took > 0.05 then D.lastWhat = "tend" end
    if took > TEND_LOG_SECONDS then Log.info(string.format("stall-diag: tend %d ms", ms(took))) end
    -- The tick's own work is not a stall: count the next wake-up from here.
    D.lastTick = LrDate.currentTime()
end

function Stall.rebind(side, why, generation)
    Log.info(string.format("stall-diag: rebind %s (%s, generation %s)", tostring(side), tostring(why), tostring(generation)))
end

return Stall
