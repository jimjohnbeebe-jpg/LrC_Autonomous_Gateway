-- Bridge command export_preview (ARCHITECTURE sections 1, 3 and 6): an LrExportSession JPEG of the
-- target photo, written to <temp>\LrC-AVG\previews\<new uuid>\, and its path returned. The engine
-- reads the file and deletes it (engine\src\preview\service.ts); it reads only inside that folder.
--
-- The export is the only post-change preview (Phase 0, P-01): after a write, requestJpegThumbnail
-- returned no image within 30 s, while the export was fresh at ~2.6 s for 1600 px
-- [handle: docs\reports\phase0\S1.md]. The preview crosses as a path, not base64 (D-01).
--
-- The export settings are the ones spike S1 ran with on LrC 15.5.1
-- [handle: plugin\spikes\S1.lrplugin\S1Run.lua:264-279], themselves taken from Automaat's export
-- handler [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerExport.lua:71-104].
-- LR_jpeg_quality gets quality / 100: S1's 0.75 produced a JPEG, but that the scale is 0-1 is
-- [unverified]; npm run phase2:check exports at two qualities and records whether the size follows.
-- No write gate: an export does not write to the catalog, and S1 ran it from a task without one.
-- The request's own folder is new and empty, so the one JPEG in it after the export is the preview
-- (LrFileUtils.files yields full paths [handle: plugin\spikes\S1.lrplugin\S1Run.lua:77-87]).

local LrDate = import 'LrDate'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrUUID = import 'LrUUID'

local Develop = require 'Develop'

local Preview = {}

Preview.MIN_LONG_EDGE = 200
Preview.MAX_LONG_EDGE = 4096

function Preview.directory()
    return LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "previews")
end

local function fail(code, message, recoverable)
    return nil, { code = code, message = message, recoverable = recoverable == true }
end

local function isWhole(n, lo, hi)
    return type(n) == "number" and n == math.floor(n) and n >= lo and n <= hi
end

function Preview.exportPreview(payload)
    local longEdge, quality = payload.long_edge, payload.quality
    if not isWhole(longEdge, Preview.MIN_LONG_EDGE, Preview.MAX_LONG_EDGE) then
        return fail("bad_request", string.format("long_edge must be a whole number from %d to %d", Preview.MIN_LONG_EDGE, Preview.MAX_LONG_EDGE))
    end
    if not isWhole(quality, 1, 100) then
        return fail("bad_request", "quality must be a whole number from 1 to 100")
    end
    local _, photo, uuid, err = Develop.target(payload)
    if err then return nil, err end

    local dir = LrPathUtils.child(Preview.directory(), LrUUID.generateUUID())
    LrFileUtils.createAllDirectories(dir)
    local t0 = LrDate.currentTime()
    local session = LrExportSession {
        photosToExport = { photo },
        exportSettings = {
            LR_export_destinationType = "specificFolder",
            LR_export_destinationPathPrefix = dir,
            LR_export_useSubfolder = false,
            LR_format = "JPEG",
            LR_jpeg_quality = quality / 100,
            LR_export_colorSpace = "sRGB",
            LR_size_doConstrain = true,
            LR_size_resizeType = "longEdge",
            LR_size_maxWidth = longEdge,
            LR_size_maxHeight = longEdge,
            LR_size_units = "pixels",
            LR_outputSharpeningOn = false,
            LR_collisionHandling = "overwrite",
            LR_reimportExportedPhoto = false,
        },
    }
    session:doExportOnCurrentTask()
    local exportMs = (LrDate.currentTime() - t0) * 1000

    for file in LrFileUtils.files(dir) do
        if file:lower():match("%.jpe?g$") then
            return { uuid = uuid, path = file, export_ms = exportMs }
        end
    end
    return fail("export_failed", "the export wrote no JPEG into " .. dir, true)
end

return Preview
