// Entry point of the intents module (ARCHITECTURE section 7).

export { INTENT_ID_PATTERN, REGION_KINDS, intentJsonSchema, intentSchema } from "./schema.js";
export type { Intent } from "./schema.js";
export { IntentError, IntentLibrary, bundledIntentsDir, defaultUserIntentsDir } from "./loader.js";
export type { IntentErrorCode, IntentSource, IntentSummary, IntentWarning, LoadedIntent } from "./loader.js";
