-- Bridge command copy_photo { photo_uuid, copy_name? } (issue #214, lr_create_virtual_copies; upstream's
-- create_virtual_copies [upstream claim: Automaat/lightroom-mcp 1040453, HandlerVirtualCopies.lua, PR #412], rewritten):
-- one virtual copy of the photo named by uuid, through Catalog.copyOnce, the step Variants mode uses. The photo is
-- selected alone (through All Photographs when it is outside the current source) and the sources and the selection
-- are put back afterwards (DevelopSession.withPhoto, without the switch to Develop: createVirtualCopies worked from
-- Loupe and Grid [handle: LR_SDK_NOTES "Also recorded in Phase 0", docs\reports\phase0\S6.md "Analysis"]).
-- No write gate around createVirtualCopies: the one exception of .claude\rules\03-lightroom.md (Catalog.lua header).
-- A copy of a virtual copy is checked against that copy's master, since Lightroom copies the master photo
-- [inference: masterPhoto names the original, Photos.describe]; what Lightroom does then is [unverified].

local LrApplication = import 'LrApplication'

local Catalog = require 'Catalog'
local DevelopSession = require 'DevelopSession'
local Log = require 'Log'
local Photos = require 'Photos'

local Copies = {}

function Copies.copyPhoto(payload)
    local name = payload.copy_name
    if name ~= nil and (type(name) ~= "string" or not name:find("%S")) then
        return nil, { code = "bad_request", message = "copy_name must be a non-empty string", recoverable = false }
    end
    local catalog = LrApplication.activeCatalog()
    local photo, found = Photos.find(catalog, payload.photo_uuid, payload.expect)
    if not photo then return nil, found end
    local master = found.is_virtual_copy and { local_id = found.master_local_id } or found
    local result, busy = DevelopSession.withPhoto("copy_photo", catalog, photo, function(owns)
        local copy, why = Catalog.copyOnce(catalog, photo, master, name, owns)
        if why then return { status = "failed", copy = copy, code = why.code, reason = why.message } end
        return { status = "copied", copy = copy }
    end, false)
    if not result then return nil, busy end
    result.uuid = found.uuid
    Log.info(string.format("copy_photo: %s %s (%s)", found.uuid, result.status, tostring(result.reason or "")))
    return result
end

return Copies
