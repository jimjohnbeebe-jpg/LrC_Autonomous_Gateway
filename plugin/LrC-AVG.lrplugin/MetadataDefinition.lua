-- The plugin's private metadata fields (plugin 1.5.0, GitHub issue #218 row 9), declared through Info.lua's
-- LrMetadataProvider. aiScore and aiReason are upstream's fields, schema version 1 [upstream claim:
-- Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/AiMetadataDefinition.lua], MIT, see
-- THIRD_PARTY_NOTICES.md; they carry no title, so Lightroom shows them nowhere [inference: the SDK sample's field
-- without a title "will not be available in the metadata browser", D:\Developer\LightRoom Classic Dev Kit\Sample
-- Plugins\custommetadatasample.lrdevplugin\CustomMetadataDefinition.lua]. avgSession, avgLook and avgDate are this
-- project's: the engine writes them when an edit session is accepted (engine\src\session\avg-stamp.ts), and their
-- title, searchable and browsable make AVG edits findable in Lightroom, as the sample declares such a field.
-- A change to these fields needs a new schemaVersion and, for a changed field, updateFromEarlierSchemaVersion
-- (the sample shows one). Adding a metadata provider makes Lightroom update the catalog's plug-in metadata when it
-- loads the plugin [unverified]; this file and its Info.lua line are one commit so they can be dropped together.
-- Values are written with photo:setPropertyForPlugin(_PLUGIN, id, value) in a write gate (PluginMetadata.lua).
-- The development plugin (com.lrcavg.gateway.dev) and the shipped one (com.lrcavg.gateway) keep separate values,
-- since the values belong to the plugin's identifier [inference: setPropertyForPlugin takes the plug-in object].

return {
    schemaVersion = 1,
    metadataFieldsForPhotos = {
        { id = 'aiScore', dataType = 'string', version = 1 },
        { id = 'aiReason', dataType = 'string', version = 1 },
        { id = 'avgSession', title = LOC "$$$/LrCAVG/Fields/Session=AVG session", dataType = 'string', searchable = true, browsable = true, version = 1 },
        { id = 'avgLook', title = LOC "$$$/LrCAVG/Fields/Look=AVG look", dataType = 'string', searchable = true, browsable = true, version = 1 },
        { id = 'avgDate', title = LOC "$$$/LrCAVG/Fields/Date=AVG edit date", dataType = 'string', searchable = true, browsable = true, version = 1 },
    },
}
