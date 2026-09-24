-- AVG-S1: preview freshness + latency after applyDevelopSettings.
--
-- On the target (active) photo:
--   n = 0      baseline thumbnail, no develop change
--   n = 1..5   applyDevelopSettings { Exposure2012 = current +/- 1.0 } (history "AVG S1"),
--              then request the thumbnail until Lightroom returns JPEG data
--   export     one LrExportSession JPEG rendition at 1600 px long edge, timed
--   restore    Exposure2012 back to the original value (history "AVG S1 restore")
--
-- Run 1 (2026-09-23, docs\reports\phase0\S1.md) showed that a thumbnail requested right
-- after applyDevelopSettings is answered within ~1 ms with no data and the error
-- "error loading thumb". So each step now re-requests every RETRY_INTERVAL_S until data
-- arrives or READY_TIMEOUT_MS passes, and records:
--   attempts    requests made before data arrived
--   first_error the error text of the first failed request
--   ready_ms    ms from applyDevelopSettings returning to the first usable thumbnail
--   request_ms  ms from the successful request to its callback
-- Output in <temp>\LrC-AVG\: s1_results.csv, s1_<n>.jpg (s1_<n>_cb<k>.jpg for extra data
-- callbacks), s1_export.jpg. spikes\S1\measure.ts turns these into the report numbers.

local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local STEPS = 5
local THUMB_WIDTH = 1600
local READY_TIMEOUT_MS = 30000     -- give up on a step after this long
local REQUEST_TIMEOUT_MS = 10000   -- longest wait for one request's callback
local RETRY_INTERVAL_S = 0.05      -- pause between a failed request and the next
-- After data arrives, keep listening this long in case Lightroom calls back again with a
-- newer render. [unverified whether that ever happens; run 1 saw one callback per request]
local EXTRA_CALLBACK_GRACE_MS = 1000
local EXPORT_LONG_EDGE = 1600

-- LrDate.currentTime() is seconds as a float; its resolution on Windows is [unverified].
local function nowMs()
    return LrDate.currentTime() * 1000
end

local function outDir()
    local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
    LrFileUtils.createAllDirectories(dir)
    return dir
end

local function writeBinary(path, data)
    local fh, err = io.open(path, "wb")
    if not fh then error("cannot write " .. path .. ": " .. tostring(err)) end
    fh:write(data)
    fh:close()
end

local function csvCell(v)
    if v == nil then return "" end
    local s = tostring(v)
    return (s:gsub("[,\r\n]", " "))
end

local function fmtMs(ms)
    if ms == nil then return "" end
    return string.format("%.1f", ms)
end

local function readExposure(catalog, photo)
    local value
    catalog:withReadAccessDo(function()
        value = photo:getDevelopSettings().Exposure2012
    end)
    return value
end

local function removeStaleOutputs(dir)
    local stale = {}
    for path in LrFileUtils.files(dir) do
        local leaf = LrPathUtils.leafName(path)
        if leaf:match("^s1_.*%.jpg$") or leaf == "s1_results.csv" then
            table.insert(stale, path)
        end
    end
    for _, path in ipairs(stale) do
        LrFileUtils.delete(path)
    end
end

-- Request objects whose callback had not fired when their wait ended. They are held here
-- for the rest of the run, so a late callback is never lost by releasing the object early
-- (LR_SDK_NOTES, LrPhoto requestJpegThumbnail: hold the request until its callback fires).
-- Each entry: { calls = <that request's callback list> }; late callbacks are counted at the end.
local unanswered = {}

-- One requestJpegThumbnail call. Returns every callback { at, data, err } and the request
-- time. Never throws: an SDK error becomes an error record, so the run always reaches its
-- CSV write and the exposure restore.
local function requestOnce(photo, size, timeoutMs)
    local calls = {}
    local function onThumb(data, err)
        table.insert(calls, { at = nowMs(), data = data, err = err })
    end
    local requestedAt = nowMs()
    local ok, requestOrErr = LrTasks.pcall(function()
        return photo:requestJpegThumbnail(THUMB_WIDTH, size.height, onThumb)
    end)
    if not ok and size.height == nil then
        -- Run 1 showed (1600, nil) is accepted; keep the fallback visible in the CSV anyway.
        size.height = THUMB_WIDTH
        size.args = string.format("%dx%d (nil height rejected: %s)", THUMB_WIDTH, THUMB_WIDTH, tostring(requestOrErr))
        requestedAt = nowMs()
        ok, requestOrErr = LrTasks.pcall(function()
            return photo:requestJpegThumbnail(THUMB_WIDTH, THUMB_WIDTH, onThumb)
        end)
    end
    if not ok then
        return { { at = nowMs(), data = nil, err = "requestJpegThumbnail threw: " .. tostring(requestOrErr) } }, requestedAt
    end
    local request = requestOrErr

    while #calls == 0 and (nowMs() - requestedAt) < timeoutMs do
        LrTasks.sleep(0.005)
    end
    local gotData = false
    for _, c in ipairs(calls) do
        if c.data then gotData = true end
    end
    if gotData then
        local graceEnd = nowMs() + EXTRA_CALLBACK_GRACE_MS
        while nowMs() < graceEnd do
            LrTasks.sleep(0.05)
        end
    end
    if #calls == 0 then
        -- No callback yet: keep the request alive for the rest of the run.
        table.insert(unanswered, { request = request, calls = calls })
    end
    request = nil
    return calls, requestedAt
end

-- Re-request until Lightroom returns JPEG data or READY_TIMEOUT_MS passes. Each request's
-- wait is capped by the time left, so a step never runs past READY_TIMEOUT_MS.
local function thumbnailWhenReady(photo, size)
    local start = nowMs()
    local attempts, firstError, lastError = 0, nil, nil
    while true do
        attempts = attempts + 1
        local remaining = READY_TIMEOUT_MS - (nowMs() - start)
        local timeoutMs = math.max(1, math.min(REQUEST_TIMEOUT_MS, remaining))
        local calls, requestedAt = requestOnce(photo, size, timeoutMs)
        local good = {}
        for i, c in ipairs(calls) do
            if c.data then
                table.insert(good, { index = i, at = c.at, data = c.data })
            else
                firstError = firstError or tostring(c.err)
                lastError = tostring(c.err)
            end
        end
        if #calls == 0 then
            local e = string.format("no callback within %.0f ms", timeoutMs)
            firstError = firstError or e
            lastError = e
        end
        if #good > 0 then
            return {
                ok = true, attempts = attempts, firstError = firstError,
                readyMs = good[1].at - start, requestMs = good[1].at - requestedAt,
                good = good, callbackCount = #calls,
            }
        end
        if nowMs() - start >= READY_TIMEOUT_MS then
            return { ok = false, attempts = attempts, firstError = firstError, lastError = lastError,
                elapsedMs = nowMs() - start }
        end
        LrTasks.sleep(RETRY_INTERVAL_S)
    end
end

LrFunctionContext.postAsyncTaskWithContext("AVG S1", function(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    -- Outside any read gate: selection queries yield (Automaat HandlerSelection.lua:30-38).
    local photo = catalog:getTargetPhoto()
    if not photo then
        LrDialogs.message("AVG S1", "Select one photo first (it becomes the target).", "warning")
        return
    end

    local filename
    catalog:withReadAccessDo(function()
        filename = photo:getFormattedMetadata("fileName")
    end)
    local original = readExposure(catalog, photo)
    if type(original) ~= "number" then
        LrDialogs.message("AVG S1", "Target photo has no Exposure2012 value (legacy process version?). Use a fixture in the current process version.", "critical")
        return
    end
    -- Stay inside the -5..+5 slider range: alternate downward if the photo is already bright.
    local sign = (original > 4.0) and -1 or 1

    local dir = outDir()
    removeStaleOutputs(dir)
    local runId = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y%m%d-%H%M%S")
    local lrVersion = LrApplication.versionString()
    local size = { height = nil, args = tostring(THUMB_WIDTH) .. "x(nil)" }
    local rows = {
        "run_id,lr_version,photo,n,kind,delta_ev,exposure_before,exposure_readback,apply_ms,size_args,attempts,first_error,ready_ms,request_ms,callback_index,callback_count,bytes,file,error",
    }
    local summary = {}
    local failures = 0

    local function row(n, kind, delta, before, readback, applyMs, r, fields)
        table.insert(rows, table.concat({
            runId, csvCell(lrVersion), csvCell(filename), n, kind, delta, before, csvCell(readback), fmtMs(applyMs),
            csvCell(size.args), r.attempts or "", csvCell(r.firstError), fmtMs(r.readyMs), fmtMs(r.requestMs),
            fields.index or "", r.callbackCount or "", fields.bytes or "", fields.file or "", csvCell(fields.error),
        }, ","))
    end

    local function record(n, kind, delta, before, readback, applyMs)
        local r = thumbnailWhenReady(photo, size)
        if not r.ok then
            failures = failures + 1
            local err = string.format("no thumbnail after %.0f ms (cap %d ms) and %d attempts; last error: %s",
                r.elapsedMs, READY_TIMEOUT_MS, r.attempts, tostring(r.lastError))
            row(n, kind, delta, before, readback, applyMs, r, { error = err })
            table.insert(summary, string.format("n=%d %s %+.1f EV: FAILED - %s", n, kind, delta, err))
            return
        end
        for k, g in ipairs(r.good) do
            local leaf = (k == 1) and string.format("s1_%d.jpg", n) or string.format("s1_%d_cb%d.jpg", n, g.index)
            writeBinary(LrPathUtils.child(dir, leaf), g.data)
            row(n, kind, delta, before, readback, applyMs, r, { index = g.index, bytes = #g.data, file = leaf })
        end
        local errNote = r.firstError and (", first error: " .. r.firstError) or ""
        table.insert(summary, string.format("n=%d %s %+.1f EV: thumbnail after %.0f ms (%d attempt%s%s)",
            n, kind, delta, r.readyMs, r.attempts, (r.attempts == 1) and "" or "s", errNote))
    end

    -- n = 0: baseline, no develop change.
    record(0, "baseline", 0, original, original, nil)

    local current = original
    for n = 1, STEPS do
        local delta = sign * ((n % 2 == 1) and 1.0 or -1.0)
        local target = current + delta
        local tApply = nowMs()
        catalog:withWriteAccessDo("AVG S1", function()
            photo:applyDevelopSettings({ Exposure2012 = target }, "AVG S1")
        end)
        local applyMs = nowMs() - tApply
        local readback = readExposure(catalog, photo)
        record(n, "step", delta, current, readback, applyMs)
        current = (type(readback) == "number") and readback or target
    end

    -- One LrExportSession JPEG at 1600 px long edge. Settings follow Automaat's working
    -- export (HandlerExport.lua:71-104); LR_jpeg_quality range 0-1 is [unverified]
    -- (Automaat passes 0-100 at HandlerExport.lua:75).
    local exportSettings = {
        LR_export_destinationType = "specificFolder",
        LR_export_destinationPathPrefix = dir,
        LR_export_useSubfolder = false,
        LR_format = "JPEG",
        LR_jpeg_quality = 0.75,
        LR_export_colorSpace = "sRGB",
        LR_size_doConstrain = true,
        LR_size_resizeType = "longEdge",
        LR_size_maxWidth = EXPORT_LONG_EDGE,
        LR_size_maxHeight = EXPORT_LONG_EDGE,
        LR_size_units = "pixels",
        LR_outputSharpeningOn = false,
        LR_collisionHandling = "overwrite",
        LR_reimportExportedPhoto = false,
    }
    local tExport = nowMs()
    -- Protected like the thumbnail requests: an export failure is recorded, and the run still
    -- writes its CSV and restores the exposure.
    local exportOk, exportErr = LrTasks.pcall(function()
        local exportSession = LrExportSession { photosToExport = { photo }, exportSettings = exportSettings }
        exportSession:doExportOnCurrentTask()
    end)
    local exportMs = nowMs() - tExport

    local expected = LrPathUtils.replaceExtension(LrPathUtils.child(dir, filename), "jpg")
    local exportFields = { index = 1 }
    if not exportOk then
        failures = failures + 1
        exportFields.error = "export threw: " .. tostring(exportErr)
        table.insert(summary, "export: FAILED - " .. exportFields.error)
    elseif LrFileUtils.exists(expected) == "file" then
        local final = LrPathUtils.child(dir, "s1_export.jpg")
        LrFileUtils.move(expected, final)
        exportFields.file = "s1_export.jpg"
        exportFields.bytes = LrFileUtils.fileAttributes(final).fileSize
        table.insert(summary, string.format("export: %.0f ms", exportMs))
    else
        failures = failures + 1
        exportFields.error = "export file not found at " .. expected
        table.insert(summary, "export: FAILED - " .. exportFields.error)
    end
    row(STEPS + 1, "export", 0, current, current, nil,
        { attempts = 1, readyMs = exportMs, requestMs = exportMs, callbackCount = 1 }, exportFields)

    catalog:withWriteAccessDo("AVG S1 restore", function()
        photo:applyDevelopSettings({ Exposure2012 = original }, "AVG S1 restore")
    end)

    local csvPath = LrPathUtils.child(dir, "s1_results.csv")
    writeBinary(csvPath, table.concat(rows, "\n") .. "\n")

    local lateCallbacks = 0
    for _, u in ipairs(unanswered) do
        if #u.calls > 0 then lateCallbacks = lateCallbacks + 1 end
    end
    table.insert(summary, string.format("requests with no callback before their wait ended: %d (of which answered later: %d)",
        #unanswered, lateCallbacks))

    local headline = (failures == 0) and "All steps returned a thumbnail." or
        string.format("ERRORS: %d item(s) FAILED - see the lines marked FAILED.", failures)
    LrDialogs.message("AVG S1 done",
        headline .. "\n\n" .. table.concat(summary, "\n") ..
        "\n\nExposure2012 restored to " .. tostring(original) ..
        ".\nResults: " .. csvPath, (failures == 0) and "info" or "warning")
end)
