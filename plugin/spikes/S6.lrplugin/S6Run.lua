-- AVG-S6: catalog:createVirtualCopies(name) on the selected photo, three times (A, B, C),
-- re-selecting the master before each call. For each call it logs: how the call was made
-- (outside or inside a write gate), what it returned (type, count), each returned copy's
-- localIdentifier / copyName / isVirtualCopy / master id, and what the selection is after.
-- Then it checks each copy is addressable by localIdentifier, via catalog:getPhotoByLocalId
-- if that exists (LR_SDK_NOTES [community]) and via a getAllPhotos scan (Automaat
-- PhotoLookup.lua:37 says there is no find-by-local-id).
-- The view (Loupe / Grid) is what Jim declared by choosing the menu item; the harness also
-- logs the current module name. Output: <temp>\LrC-AVG\s6_log.txt + a summary dialog.
-- Copy names: "AVG S6 A|B|C" (PRD section 6.6 naming style) rather than a bare "AVG S6", so the three
-- copies are distinguishable. Cleanup (deleting the copies) is manual; see the README.

local LrApplication = import 'LrApplication'
local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local S6 = {}

local function logPath()
    local dir = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG")
    LrFileUtils.createAllDirectories(dir)
    return LrPathUtils.child(dir, "s6_log.txt")
end

local function describePhoto(catalog, photo)
    local d = {}
    catalog:withReadAccessDo(function()
        d.local_id = photo.localIdentifier
        d.copy_name = photo:getFormattedMetadata("copyName")
        d.file_name = photo:getFormattedMetadata("fileName")
        d.is_virtual_copy = photo:getRawMetadata("isVirtualCopy")
        local master = photo:getRawMetadata("masterPhoto")
        d.master_local_id = master and master.localIdentifier or nil
    end)
    return string.format("local_id=%s copy_name=%s is_virtual_copy=%s master_local_id=%s file=%s",
        tostring(d.local_id), tostring(d.copy_name), tostring(d.is_virtual_copy),
        tostring(d.master_local_id), tostring(d.file_name)), d
end

local function createCopies(catalog, name, log)
    -- Attempt 1: plain call (the community reports do not say it needs a write gate).
    local ok, result = LrTasks.pcall(function()
        return catalog:createVirtualCopies(name)
    end)
    if ok then
        table.insert(log, "  call: outside write gate -> ok")
        return result
    end
    table.insert(log, "  call: outside write gate -> error: " .. tostring(result))
    -- Attempt 2: inside a write gate.
    local copies
    ok, result = LrTasks.pcall(function()
        catalog:withWriteAccessDo("AVG S6 " .. name, function()
            copies = catalog:createVirtualCopies(name)
        end)
    end)
    if ok then
        table.insert(log, "  call: inside withWriteAccessDo -> ok")
        return copies
    end
    table.insert(log, "  call: inside withWriteAccessDo -> error: " .. tostring(result))
    return nil
end

function S6.run(declaredView)
    LrFunctionContext.postAsyncTaskWithContext("AVG S6", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)

        local catalog = LrApplication.activeCatalog()
        local master = catalog:getTargetPhoto() -- outside any gate (yields; Automaat HandlerSelection.lua:30-38)
        if not master then
            LrDialogs.message("AVG S6", "Select one (master) photo first.", "warning")
            return
        end

        local okModule, moduleName = LrTasks.pcall(function() return LrApplicationView.getCurrentModuleName() end)
        local log = {
            "=== AVG S6 run " .. LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d %H:%M:%S") .. " ===",
            "LR " .. LrApplication.versionString(),
            "declared view (menu item chosen by Jim): " .. declaredView,
            "current module (LrApplicationView.getCurrentModuleName): " .. (okModule and tostring(moduleName) or ("error: " .. tostring(moduleName))),
        }
        local masterText = describePhoto(catalog, master)
        table.insert(log, "master: " .. masterText)

        local created = {}
        for _, letter in ipairs({ "A", "B", "C" }) do
            local name = "AVG S6 " .. letter
            table.insert(log, "-- " .. name)
            -- Re-select the master so each call copies the master, not the previous copy.
            local okSel, selErr = LrTasks.pcall(function()
                catalog:setSelectedPhotos(master, { master })
            end)
            if not okSel then table.insert(log, "  re-select master failed: " .. tostring(selErr)) end
            local targetBefore = catalog:getTargetPhoto()
            table.insert(log, "  target before call: local_id=" .. tostring(targetBefore and targetBefore.localIdentifier))

            local t0 = LrDate.currentTime()
            local result = createCopies(catalog, name, log)
            table.insert(log, string.format("  took %.0f ms; returned type=%s count=%s", (LrDate.currentTime() - t0) * 1000,
                type(result), (type(result) == "table") and tostring(#result) or "n/a"))
            if type(result) == "table" then
                for i, copy in ipairs(result) do
                    local text, d = describePhoto(catalog, copy)
                    table.insert(log, string.format("  copy[%d]: %s", i, text))
                    table.insert(created, d)
                end
            end
            local targetAfter = catalog:getTargetPhoto()
            table.insert(log, "  target after call: " .. (targetAfter and describePhoto(catalog, targetAfter) or "nil"))
        end

        -- Addressability by localIdentifier.
        table.insert(log, "-- addressability")
        local hasGetById = false
        local okProbe = LrTasks.pcall(function()
            hasGetById = type(catalog.getPhotoByLocalId) == "function"
        end)
        table.insert(log, "  catalog.getPhotoByLocalId is a function: " .. tostring(okProbe and hasGetById))
        local all
        catalog:withReadAccessDo(function() all = catalog:getAllPhotos() end)
        for _, d in ipairs(created) do
            local viaApi = "n/a"
            if hasGetById then
                local okGet, found = LrTasks.pcall(function() return catalog:getPhotoByLocalId(d.local_id) end)
                viaApi = okGet and tostring(found ~= nil and found.localIdentifier == d.local_id) or ("error: " .. tostring(found))
            end
            local viaScan = false
            for _, p in ipairs(all) do
                if p.localIdentifier == d.local_id then viaScan = true break end
            end
            table.insert(log, string.format("  local_id=%s found via getPhotoByLocalId=%s via getAllPhotos scan=%s",
                tostring(d.local_id), viaApi, tostring(viaScan)))
        end
        table.insert(log, string.format("total copies returned: %d (expected 3)", #created))

        local path = logPath()
        local fh = io.open(path, "a")
        if fh then
            fh:write(table.concat(log, "\n"), "\n\n")
            fh:close()
        end
        LrDialogs.message("AVG S6 (" .. declaredView .. ")", table.concat(log, "\n") .. "\n\nLog: " .. path, "info")
    end)
end

return S6
