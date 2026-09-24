-- AVG-S1: preview freshness + latency after applyDevelopSettings.
--
-- On the target (active) photo:
--   n = 0      baseline requestJpegThumbnail, no develop change
--   n = 1..5   applyDevelopSettings { Exposure2012 = current +/- 1.0 } (history "AVG S1"),
--              then requestJpegThumbnail(1600, nil, cb); every callback is timed and saved
--   export     one LrExportSession JPEG rendition at 1600 px long edge, timed
--   restore    Exposure2012 back to the original value (history "AVG S1 restore")
-- Output in <temp>\LrC-AVG\: s1_results.csv, s1_<n>.jpg (s1_<n>_cb<k>.jpg for any extra
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
local CALLBACK_TIMEOUT_MS = 60000
-- Keep listening this long after the first callback: if Lightroom calls back a second
-- time (e.g. a cached preview first, a fresh one later) we want to see it. [unverified
-- whether that ever happens; this is what the spike checks]
local EXTRA_CALLBACK_GRACE_MS = 2000
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

-- Request a thumbnail and collect every callback. The request object must be held
-- until the callback fires (LR_SDK_NOTES, LrPhoto requestJpegThumbnail).
local function requestThumbnail(photo)
    local calls = {}
    local t0 = nowMs()
    local sizeArgs = tostring(THUMB_WIDTH) .. "x(nil)"
    local function onThumb(data, err)
        table.insert(calls, { ms = nowMs() - t0, data = data, err = err })
    end

    local ok, requestOrErr = LrTasks.pcall(function()
        return photo:requestJpegThumbnail(THUMB_WIDTH, nil, onThumb)
    end)
    if not ok then
        -- The directive specifies (1600, nil). If the SDK rejects a nil height, fall back and
        -- say so in the CSV rather than hiding it.
        sizeArgs = string.format("%dx%d (nil height rejected: %s)", THUMB_WIDTH, THUMB_WIDTH, tostring(requestOrErr))
        t0 = nowMs()
        requestOrErr = photo:requestJpegThumbnail(THUMB_WIDTH, THUMB_WIDTH, onThumb)
    end
    local request = requestOrErr

    while #calls == 0 and (nowMs() - t0) < CALLBACK_TIMEOUT_MS do
        LrTasks.sleep(0.005)
    end
    if #calls > 0 then
        local graceEnd = nowMs() + EXTRA_CALLBACK_GRACE_MS
        while nowMs() < graceEnd do
            LrTasks.sleep(0.05)
        end
    end
    request = nil -- release only after the callbacks have had their chance
    return calls, sizeArgs
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
    local rows = {
        "run_id,lr_version,photo,n,kind,delta_ev,exposure_before,exposure_readback,apply_ms,size_args,callback_index,callback_count,ms,bytes,file,error",
    }
    local summary = {}

    local function record(n, kind, delta, before, readback, applyMs)
        local calls, sizeArgs = requestThumbnail(photo)
        if #calls == 0 then
            table.insert(rows, table.concat({ runId, csvCell(lrVersion), csvCell(filename), n, kind, delta, before, csvCell(readback),
                fmtMs(applyMs), csvCell(sizeArgs), "", 0, "", "", "", "no callback within " .. CALLBACK_TIMEOUT_MS .. " ms" }, ","))
            table.insert(summary, string.format("n=%d %s: NO CALLBACK", n, kind))
            return
        end
        for k, call in ipairs(calls) do
            local leaf = (k == 1) and string.format("s1_%d.jpg", n) or string.format("s1_%d_cb%d.jpg", n, k)
            local bytes = ""
            if call.data then
                writeBinary(LrPathUtils.child(dir, leaf), call.data)
                bytes = #call.data
            else
                leaf = ""
            end
            table.insert(rows, table.concat({ runId, csvCell(lrVersion), csvCell(filename), n, kind, delta, before, csvCell(readback),
                fmtMs(applyMs), csvCell(sizeArgs), k, #calls, fmtMs(call.ms), bytes, leaf, csvCell(call.err) }, ","))
        end
        table.insert(summary, string.format("n=%d %s %+.1f EV: first callback %.0f ms (%d callback%s)",
            n, kind, delta, calls[1].ms, #calls, (#calls == 1) and "" or "s"))
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
    -- (Automaat passes 0-100 at HandlerExport.lua:75) - check the byte size in the report.
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
    local exportSession = LrExportSession { photosToExport = { photo }, exportSettings = exportSettings }
    exportSession:doExportOnCurrentTask()
    local exportMs = nowMs() - tExport

    local expected = LrPathUtils.replaceExtension(LrPathUtils.child(dir, filename), "jpg")
    local exportLeaf, exportBytes, exportErr = "", "", ""
    if LrFileUtils.exists(expected) == "file" then
        local final = LrPathUtils.child(dir, "s1_export.jpg")
        LrFileUtils.move(expected, final)
        exportLeaf = "s1_export.jpg"
        exportBytes = LrFileUtils.fileAttributes(final).fileSize or ""
    else
        exportErr = "export file not found at " .. expected
    end
    table.insert(rows, table.concat({ runId, csvCell(lrVersion), csvCell(filename), STEPS + 1, "export", 0, current, csvCell(current),
        "", csvCell(EXPORT_LONG_EDGE .. " long edge"), 1, 1, fmtMs(exportMs), exportBytes, exportLeaf, csvCell(exportErr) }, ","))
    table.insert(summary, string.format("export: %.0f ms %s", exportMs, exportErr))

    catalog:withWriteAccessDo("AVG S1 restore", function()
        photo:applyDevelopSettings({ Exposure2012 = original }, "AVG S1 restore")
    end)

    local csvPath = LrPathUtils.child(dir, "s1_results.csv")
    writeBinary(csvPath, table.concat(rows, "\n") .. "\n")

    LrDialogs.message("AVG S1 done",
        table.concat(summary, "\n") ..
        "\n\nExposure2012 restored to " .. tostring(original) ..
        ".\nResults: " .. csvPath ..
        "\nNext: node spikes\\S1\\measure.ts \"" .. dir .. "\"", "info")
end)
