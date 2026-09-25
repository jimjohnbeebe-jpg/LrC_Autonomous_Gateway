-- AVG-S6: catalog:createVirtualCopies(name) on the selected photo, three times (A, B, C),
-- re-selecting the master before each call. For each call it records: how the call was made
-- (outside or inside a write gate), what it returned (type, count), each returned copy's
-- localIdentifier / copyName / isVirtualCopy / master id, and which photo is active after.
-- Then it checks each copy is addressable by localIdentifier, via catalog:getPhotoByLocalId
-- if that exists (LR_SDK_NOTES [community]) and via a getAllPhotos scan (Automaat
-- PhotoLookup.lua:37 says there is no find-by-local-id).
-- The view (Loupe / Grid) is what Jim declared by choosing the menu item; the harness also
-- records the current module name.
-- Output: <temp>\LrC-AVG\S6\s6_<view>_<time>.json + s6_log.txt (rule 03-lightroom "Plugin
-- hygiene"); Claude Code collects them, Jim copies nothing. At the end the harness selects
-- exactly the copies it created, so cleanup is Photo > Remove Photos... > Remove.
-- Copy names: "AVG S6 A|B|C" (PRD section 6.6 naming style) so the three copies are distinguishable.

local LrApplication = import 'LrApplication'
local LrApplicationView = import 'LrApplicationView'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'

local SpikeJson = require 'SpikeJson'

local S6 = {}

local function outDir()
    local dir = LrPathUtils.child(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "LrC-AVG"), "S6")
    LrFileUtils.createAllDirectories(dir)
    return dir
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
    return d
end

local function describeText(d)
    return string.format("local_id=%s copy_name=%s is_virtual_copy=%s master_local_id=%s file=%s",
        tostring(d.local_id), tostring(d.copy_name), tostring(d.is_virtual_copy),
        tostring(d.master_local_id), tostring(d.file_name))
end

local function createCopies(catalog, name, call)
    -- Attempt 1: plain call (the community reports do not say it needs a write gate).
    local ok, result = LrTasks.pcall(function()
        return catalog:createVirtualCopies(name)
    end)
    if ok then
        call.how = "outside write gate"
        return result
    end
    call.outside_gate_error = tostring(result)
    -- Attempt 2: inside a write gate.
    local copies
    ok, result = LrTasks.pcall(function()
        catalog:withWriteAccessDo("AVG S6 " .. name, function()
            copies = catalog:createVirtualCopies(name)
        end)
    end)
    if ok then
        call.how = "inside withWriteAccessDo"
        return copies
    end
    call.how = "failed both ways"
    call.inside_gate_error = tostring(result)
    return nil
end

function S6.run(declaredView)
    LrFunctionContext.postAsyncTaskWithContext("AVG S6", function(context)
        LrDialogs.attachErrorDialogToFunctionContext(context)

        local catalog = LrApplication.activeCatalog()
        local master = catalog:getTargetPhoto() -- outside any gate (yields; Automaat HandlerSelection.lua:30-38)
        if not master then
            LrDialogs.message("AVG S6", "Select the original photo first (click 20260907-_OZ80093.NEF).", "warning")
            return
        end

        local okModule, moduleName = LrTasks.pcall(function() return LrApplicationView.getCurrentModuleName() end)
        local result = {
            spike = "S6",
            run_at = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d %H:%M:%S") .. " (local time)",
            lr_version = LrApplication.versionString(),
            declared_view = declaredView,
            current_module = okModule and tostring(moduleName) or ("error: " .. tostring(moduleName)),
            master = describePhoto(catalog, master),
            calls = {},
            copies = {},
        }

        local createdPhotos = {}
        for _, letter in ipairs({ "A", "B", "C" }) do
            local name = "AVG S6 " .. letter
            local call = { name = name }
            -- Re-select the master so each call copies the master, not the previous copy.
            local okSel, selErr = LrTasks.pcall(function()
                catalog:setSelectedPhotos(master, { master })
            end)
            if not okSel then call.reselect_master_error = tostring(selErr) end
            local targetBefore = catalog:getTargetPhoto()
            call.target_before_local_id = targetBefore and targetBefore.localIdentifier or nil

            local t0 = LrDate.currentTime()
            local returned = createCopies(catalog, name, call)
            call.ms = (LrDate.currentTime() - t0) * 1000
            call.returned_type = type(returned)
            call.returned_count = (type(returned) == "table") and #returned or nil
            call.returned = {}
            if type(returned) == "table" then
                for _, copy in ipairs(returned) do
                    local d = describePhoto(catalog, copy)
                    table.insert(call.returned, d)
                    table.insert(result.copies, d)
                    table.insert(createdPhotos, copy)
                end
            end
            local targetAfter = catalog:getTargetPhoto()
            call.target_after = targetAfter and describePhoto(catalog, targetAfter) or nil
            table.insert(result.calls, call)
        end

        -- Addressability by localIdentifier.
        local hasGetById = false
        local okProbe = LrTasks.pcall(function()
            hasGetById = type(catalog.getPhotoByLocalId) == "function"
        end)
        result.get_photo_by_local_id_exists = okProbe and hasGetById
        local all
        catalog:withReadAccessDo(function() all = catalog:getAllPhotos() end)
        for _, d in ipairs(result.copies) do
            if hasGetById then
                local okGet, found = LrTasks.pcall(function() return catalog:getPhotoByLocalId(d.local_id) end)
                if okGet then
                    d.found_via_get_photo_by_local_id = (found ~= nil and found.localIdentifier == d.local_id)
                else
                    d.found_via_get_photo_by_local_id = "error: " .. tostring(found)
                end
            end
            d.found_via_get_all_photos_scan = false
            for _, p in ipairs(all) do
                if p.localIdentifier == d.local_id then d.found_via_get_all_photos_scan = true break end
            end
        end
        result.total_copies = #result.copies

        -- Leave exactly the new copies selected, so cleanup is one menu command. Lightroom may
        -- ignore the request without an error (e.g. a copy outside the current view)
        -- [unverified], so read the selection back and only call it selected when it holds
        -- exactly the new copies and nothing else.
        result.copies_selected_for_cleanup = false
        if #createdPhotos > 0 then
            local okSel, selErr = LrTasks.pcall(function()
                catalog:setSelectedPhotos(createdPhotos[1], createdPhotos)
            end)
            result.select_copies_error = (not okSel) and tostring(selErr) or nil
            local selected = catalog:getTargetPhotos() or {} -- outside any gate (yields)
            local wantIds, gotIds = {}, {}
            for _, p in ipairs(createdPhotos) do wantIds[tostring(p.localIdentifier)] = true end
            local exact = (#selected == #createdPhotos)
            for _, p in ipairs(selected) do
                local id = tostring(p.localIdentifier)
                table.insert(gotIds, id)
                if not wantIds[id] then exact = false end
            end
            result.selection_after = gotIds
            result.copies_selected_for_cleanup = okSel and exact
        end

        -- Save: JSON result + a readable log line.
        local stamp = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%dT%H-%M-%S")
        local jsonPath = LrPathUtils.child(outDir(), "s6_" .. declaredView:lower() .. "_" .. stamp .. ".json")
        local saved, saveErr = SpikeJson.writeFile(jsonPath, result)
        local fh = io.open(LrPathUtils.child(outDir(), "s6_log.txt"), "a")
        if fh then
            local lines = { "=== AVG S6 " .. declaredView .. " run " .. result.run_at .. " ===", "master: " .. describeText(result.master) }
            for _, d in ipairs(result.copies) do table.insert(lines, "copy: " .. describeText(d)) end
            fh:write(table.concat(lines, "\n"), "\n\n")
            fh:close()
        end

        local headline = (result.total_copies == 3) and "Created 3 of 3 virtual copies."
            or string.format("PROBLEM: created %d of 3 virtual copies.", result.total_copies)
        local cleanup
        if #createdPhotos == 0 then
            cleanup = "There is nothing to remove."
        elseif result.copies_selected_for_cleanup then
            cleanup = "The new copies (and nothing else) are now selected. To remove them: Photo > Remove Photos... > Remove."
        else
            cleanup = "COULD NOT SELECT the new copies automatically. Do not use Remove Photos yet: " ..
                "select only the new copies yourself (the ones with the folded-corner badge), then Photo > Remove Photos... > Remove."
        end
        local saveLine = saved and "Saved automatically - nothing to copy." or ("SAVE FAILED: " .. tostring(saveErr) .. " - tell Claude Code.")
        LrDialogs.message("AVG S6 (" .. declaredView .. ")", headline .. "\n\n" .. cleanup .. "\n\n" .. saveLine,
            (result.total_copies == 3 and saved) and "info" or "warning")
    end)
end

return S6
