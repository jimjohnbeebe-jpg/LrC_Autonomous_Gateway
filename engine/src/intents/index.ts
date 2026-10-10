// Entry point of the intents module (ARCHITECTURE section 7).

export { INTENT_ID_PATTERN, INTENT_SCHEMA_VERSION, REGION_KINDS, intentJsonSchema, intentSchema, priorsFor } from "./schema.js";
export type { Intent, PriorSet } from "./schema.js";
export { IntentError, IntentLibrary, bundledIntentsDir, defaultUserIntentsDir, isColourParam } from "./loader.js";
export type { IntentErrorCode, IntentSource, IntentSummary, IntentWarning, LoadedIntent } from "./loader.js";
