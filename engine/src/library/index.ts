// Entry point of the library module: the catalog tools kept from Automaat (PHASE6_PROTOTYPE_PLAN
// row 2; the MCP side is mcp\tools-catalog.ts and mcp\defs-catalog.ts).

export { CATALOG_READ_TIMEOUT_MS, DEFAULT_PAGE, FILE_TYPES, LABEL_VALUES, MAX_PAGE, WHERE_NOTICE, WHERE_PLUGIN, isCalendarDay, listing, searchCriteria, shiftDay } from "./search.js";
export type { FileType, LabelName, SearchFilters } from "./search.js";
export {
  ACCESSIBILITY_FIELDS,
  COLOR_LABELS,
  FLAGS,
  MAX_TEXT,
  METADATA_PLUGIN,
  NO_STACK_WRITE,
  TEXT_FIELDS,
  TEXT_KEYS,
  flagName,
  folderPath,
  textFromWire,
  textNotTaken,
  textToWire,
} from "./metadata.js";
export type { ColorLabel, FlagName, IptcText, TextField } from "./metadata.js";
export { KEYWORD_SEPARATOR, keywordKey, keywordLevels, keywordsNotTaken, normalizeKeyword } from "./keywords.js";
export { GPS_TOLERANCE, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, MAX_KEYWORD_PATH_LENGTH, MAX_PHOTOS, gpsNotTaken, writeEach } from "./write.js";
export type { Failed, Gps, PhotoWrite, WriteResult } from "./write.js";
export {
  CALL_BUDGET_MS,
  EXPORT_PHOTO_TIMEOUT_MS,
  IMPORT_PHOTO_TIMEOUT_MS,
  MAX_COLLECTION_PHOTOS,
  MAX_EXPORT_PHOTOS,
  PHOTO_EXTENSIONS,
  copyForImport,
  defaultExportDir,
  expandHome,
  importFiles,
  isAbsoluteFolder,
  placeExport,
} from "./files.js";
export type { OnExisting, Placed } from "./files.js";
export { TEMPLATE_TOKENS, captureDate, expandTemplate, importDestination, readCaptureDate, templateProblem } from "./capture-date.js";
export type { CaptureDate, ImportTemplates } from "./capture-date.js";
