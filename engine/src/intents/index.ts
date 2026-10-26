// Entry point of the intents module (ARCHITECTURE section 7).

export { INTENT_ID_PATTERN, INTENT_SCHEMA_VERSION, REGION_KINDS, SUPPORTED_INTENT_SCHEMA_VERSIONS, intentJsonSchema, intentSchema, priorsFor, setFor } from "./schema.js";
export type { Intent, PriorSet } from "./schema.js";
export { IntentError, IntentLibrary, bundledIntentsDir, isColourParam } from "./loader.js";
export { defaultUserIntentsDir, detectVirtualization, documentsFolder, downloadsFolder, expandEnv, locateFolder, parseRegValue } from "./folder.js";
export type { FolderLocation, Virtualization } from "./folder.js";
export { MIGRATION_MARKER, migrateIntents, migrateOnce, oldIntentFolders, takeMigrationNotes } from "./migrate.js";
export type { Copied, OldFolder } from "./migrate.js";
export type { IntentErrorCode, IntentSource, IntentSummary, IntentWarning, LoadedIntent } from "./loader.js";
