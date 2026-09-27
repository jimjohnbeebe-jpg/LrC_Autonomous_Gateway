-- AVG-S7 items 3 and 4, each on a virtual copy of the selected photo (the master):
--   3. crop the copy, then read its size metadata three times (before the crop, after it, after an
--      export) and export it, so summarize.ts can compare the metadata with the JPEG's shape. The
--      engine's effective_scale uses getRawMetadata("width"/"height") (engine\src\mcp\tools-context.ts
--      regionPreview); whether those follow a crop is [unverified] (PHASES.md Phase 4, "Inputs from Phase 3").
--   4. select the master again, find the copy with findPhotoByUuid, check it is the copy (P-18),
--      write to it and export it while it is not selected, and record the selection and the
--      master's exposure before and after.

local LrTasks = import 'LrTasks'

local Common = require 'S7Common'

local S7Photos = {}

S7Photos.CROP_COPY = "AVG S7 crop"
S7Photos.UNSELECTED_COPY = "AVG S7 unselected"

-- Fractions of the photo; an uncropped photo reads CropLeft 0, CropTop 0, CropRight 1, CropBottom 1,
-- CropAngle 0 [handle: engine\src\params\sdk-keys.lrc15.json "sample"]. Key names come from that
-- pinned map (rule 03). All five are written, so a crop or angle the copy inherited is replaced.
-- "orientation" is read back: the fixture read "AB" in S5 [handle: same file, "orientation"], and
-- summarize.ts calls the crop comparison inconclusive for any other value (Greptile, PR #29).
local CROP = { CropLeft = 0.1, CropRight = 0.9, CropTop = 0.2, CropBottom = 0.8, CropAngle = 0 }
local CROP_KEYS = { "CropLeft", "CropRight", "CropTop", "CropBottom", "CropAngle", "orientation" }
-- getRawMetadata keys listed on https://lrc.mcor.dev/modules/LrPhoto.html [handle].
local SIZE_KEYS = { "width", "height", "dimensions", "croppedDimensions", "isCropped", "aspectRatio" }

-- Re-select the master before creating a copy (P-09). createVirtualCopies acts on the selection,
-- needs no write gate, returns the copy and makes it the active photo [handle: LR_SDK_NOTES "Also
-- recorded in Phase 0", S6].
-- No write gate here, although rule 03 asks for one around every catalog write: S6 called it outside
-- a gate 6 of 6 times and never tried it inside one [handle: docs\reports\phase0\S6.md "Analysis",
-- "No write gate needed"], so this spike keeps S6's observed call. Which way the plugin does it is for
-- PHASE4_PLAN row 6 (Catalog.lua) to settle with Jim (Greptile, PR #29).
local function createCopy(catalog, master, name, out)
    local okSel, selErr = LrTasks.pcall(function() catalog:setSelectedPhotos(master, { master }) end)
    if not okSel then
        out.error = "re-selecting the master: " .. tostring(selErr)
        return nil
    end
    local ok, copies = LrTasks.pcall(function() return catalog:createVirtualCopies(name) end)
    if not ok then
        out.error = "createVirtualCopies: " .. tostring(copies)
        return nil
    end
    if type(copies) ~= "table" or #copies ~= 1 then
        out.error = "createVirtualCopies returned " .. type(copies) .. (type(copies) == "table" and (" of " .. #copies) or "")
        return nil
    end
    return copies[1]
end

local function cropReadBackMatches(readBack)
    for k, v in pairs(CROP) do
        if not Common.near(readBack[k], v) then return false end
    end
    return true
end

-- Item 3. Returns the result and the copy (nil when no copy was made).
function S7Photos.crop(catalog, master)
    local out = { copy_name = S7Photos.CROP_COPY, crop_written = CROP }
    local copy = createCopy(catalog, master, out.copy_name, out)
    if not copy then return out, nil end
    out.copy = Common.describePhoto(catalog, copy)
    out.master_size = Common.raw(catalog, master, SIZE_KEYS)
    out.size_before_crop = Common.raw(catalog, copy, SIZE_KEYS)
    local ok, err = Common.apply(catalog, copy, CROP, "AVG S7 crop")
    if not ok then
        out.error = "applyDevelopSettings: " .. tostring(err)
        return out, copy
    end
    out.crop_read_back = Common.pick(Common.settings(catalog, copy), CROP_KEYS)
    out.crop_read_back_matches = cropReadBackMatches(out.crop_read_back)
    out.size_after_crop = Common.raw(catalog, copy, SIZE_KEYS)
    out.export = Common.export(copy, "crop")
    out.size_after_export = Common.raw(catalog, copy, SIZE_KEYS)
    out.worked = out.crop_read_back_matches and out.export.path ~= nil
    return out, copy
end

-- P-18: the photo found is the copy just made, a virtual copy of this master, with its name.
local function isTheCopy(found, copy, master, name)
    return found.local_id == copy.local_id and found.uuid == copy.uuid and found.is_virtual_copy == true
        and found.master_local_id == master.localIdentifier and found.copy_name == name
end

local function writeAndExport(catalog, master, photo, out)
    local masterBefore = Common.settings(catalog, master).Exposure2012
    local before = Common.settings(catalog, photo).Exposure2012
    if type(before) ~= "number" then
        out.error = "the copy has no numeric Exposure2012"
        return
    end
    -- +0.5 EV, or -0.5 near the top of the -5..5 range (engine\src\params\canonical.ts "exposure").
    local target = (before <= 4.5) and (before + 0.5) or (before - 0.5)
    local ok, err = Common.apply(catalog, photo, { Exposure2012 = target }, "AVG S7 unselected write")
    local readBack = Common.settings(catalog, photo).Exposure2012
    out.write = { before = before, written = target, read_back = readBack, error = (not ok) and tostring(err) or nil }
    out.write.read_back_matches = ok and Common.near(readBack, target)
    out.selection_after_write = Common.selection(catalog)
    out.export = Common.export(photo, "unselected")
    out.selection_after_export = Common.selection(catalog)
    out.master_exposure = { before = masterBefore, after = Common.settings(catalog, master).Exposure2012 }
    out.selection_unchanged = Common.onlySelected(out.selection_after_write, master)
        and Common.onlySelected(out.selection_after_export, master)
    out.master_unchanged = out.master_exposure.before == out.master_exposure.after
    out.worked = out.write.read_back_matches and out.export.path ~= nil and out.selection_unchanged and out.master_unchanged
end

-- Item 4. Returns the result and the copy (nil when no copy was made).
function S7Photos.unselected(catalog, master)
    local out = { copy_name = S7Photos.UNSELECTED_COPY }
    local copy = createCopy(catalog, master, out.copy_name, out)
    if not copy then return out, nil end
    out.copy = Common.describePhoto(catalog, copy)
    -- The new copy is the active photo now (S6): select the master again, so the copy is not selected.
    LrTasks.pcall(function() catalog:setSelectedPhotos(master, { master }) end)
    out.selection_before = Common.selection(catalog)
    if not Common.onlySelected(out.selection_before, master) then
        out.error = "could not make the master the only selected photo"
        return out, copy
    end
    local found, findErr = Common.findByUuid(catalog, out.copy.uuid)
    if not found then
        out.error = findErr
        return out, copy
    end
    out.found = Common.describePhoto(catalog, found)
    out.identity_ok = isTheCopy(out.found, out.copy, master, out.copy_name)
    if not out.identity_ok then
        out.error = "the photo findPhotoByUuid returned is not the copy"
        return out, copy
    end
    writeAndExport(catalog, master, found, out)
    return out, found
end

return S7Photos
