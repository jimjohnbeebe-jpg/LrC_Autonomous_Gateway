// Entry point of the library module: the catalog tools kept from Automaat (PHASE6_PROTOTYPE_PLAN
// row 2; the MCP side is mcp\tools-catalog.ts and mcp\defs-catalog.ts).

export { CATALOG_READ_TIMEOUT_MS, DEFAULT_PAGE, MAX_PAGE, isCalendarDay, listing, searchCriteria, shiftDay } from "./search.js";
export type { SearchFilters } from "./search.js";
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
