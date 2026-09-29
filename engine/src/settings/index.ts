// Entry point of the settings module (PHASE5_PLAN row 3): the Plug-in Manager page's values as the
// engine reads them (get_prefs), the folders they choose, and a session's values in order of
// precedence.

export { EngineFolders, isFullPath } from "./folders.js";
export type { FolderChoice, FolderFrom } from "./folders.js";
export { DECAY_MAX_VALUES, LOCK_PORT, PAGE_SPECS, parsePage } from "./page.js";
export type { PageValues, WireKey } from "./page.js";
export { PREFS_PLUGIN, readPage } from "./read.js";
export type { PageRead } from "./read.js";
export { resolveSessionSettings } from "./session.js";
export type { Approval, IntentOverrides, SessionSettings, SessionSettingsArgs, SettingFrom } from "./session.js";
export { PageSettings } from "./store.js";
export { KnownLogFolders, MAX_LOG_FOLDERS, defaultLogFoldersPath, searchOrder } from "./log-folders.js";
