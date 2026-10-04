-- Every catalog write gate of the plugin (GitHub issue #59, PR C step 2b). Each passes timeoutParams,
-- so a write that finds the gate held waits for it instead of raising at once: without them
-- withWriteAccessDo raises "It was blocked by another write access call, and no timeout parameters
-- were provided" [stated: Jim's step-2 check, 2026-10-03: Lightroom's "Update AI Settings Errors"
-- dialog held the gate, and every later write, the put-backs included, raised that]. The SDK: with a
-- 'timeout' it "returns within 'timeout' seconds with either "executed" or "aborted""; with
-- 'asynchronous' true it "returns immediately with either "executed" or "queued"", and a queued
-- 'func' runs within 'timeout' seconds or 'callback' runs instead [community: third-party-hosted copy
-- of Adobe's SDK 15.1 reference, LrCatalog withWriteAccessDo]. "aborted" is never a success here: the
-- caller gets the error gate_busy (recoverable). Gate.lua itself never yields inside a gate.

local Gate = {}

-- How long a write waits for the gate: a put-back queued behind a dialog runs once the user clicks
-- OK within this time [inference: the SDK reference above].
Gate.WAIT_SECONDS = 60

local function busy(name, seconds)
    return { code = "gate_busy", recoverable = true,
        message = "Lightroom's catalog stayed busy for " .. tostring(seconds) .. " s, so '" .. name ..
            "' was not written (a Lightroom dialog may be open: close it, then try again)" }
end

-- withWriteAccessDo(name, fn) waiting up to `seconds` (default WAIT_SECONDS). Returns Lightroom's
-- status ("executed"), or nil plus the error table gate_busy. An error raised by `fn` is raised on.
-- "executed" means `fn` ran: 'When "executed" is returned, 'func' will have been executed' [community:
-- third-party-hosted copy of Adobe's SDK 15.1 reference, LrCatalog withWriteAccessDo]; every put-back of
-- capture 4 went through here and read back equal to the start [handle:
-- docs\reports\phase6\masks-capture\capture4-check.json steps `row*_put_back`, `final_*`].
function Gate.write(catalog, name, fn, seconds)
    seconds = seconds or Gate.WAIT_SECONDS
    local status = catalog:withWriteAccessDo(name, fn, { timeout = seconds })
    if status == "aborted" then return nil, busy(name, seconds) end
    return status or "executed"
end

-- As Gate.write, for callers that catch errors themselves (Library.lua, KeywordTree.lua): a busy gate raises.
function Gate.run(catalog, name, fn, seconds)
    local status, err = Gate.write(catalog, name, fn, seconds)
    if not status then error(err.message, 0) end
    return status
end

-- No asynchronous gate: with the catalog free, one (plugin 0.13.0) ran `fn` before it returned, 11 s
-- for an AI update [handle: docs\reports\phase6\masks-capture\capture4-check.json step
-- `row2_vegetation` `update`]. Masks.lua runs that update in its own task instead.

return Gate
