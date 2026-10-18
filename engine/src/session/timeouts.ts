// The bridge timeouts of a session's writes and copies, moved out of types.ts unchanged in issue #181 (module size, rule 01:
// types.ts stood at 300 lines). A leaf file: it imports nothing; types.ts re-exports both, so no importer changes.

/**
 * A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md "Numbers"].
 * The plugin's write gate waits up to 60 s for the catalog (plugin\LrC-AVG.lrplugin\Gate.lua), so the
 * engine waits 90 s: a write queued behind a Lightroom dialog gets its own answer, not a timeout
 * (that the plugin's gate waits behind a dialog is [unverified] until masks capture 4).
 */
export const WRITE_TIMEOUT_MS = 90000;
/**
 * create_virtual_copies: the plugin waits up to 10 s for its selection lock [handle:
 * plugin\LrC-AVG.lrplugin\Catalog.lua Catalog.LOCK_WAIT_SECONDS], then makes each copy; S6's copies
 * took 212-1017 ms [handle: docs\reports\phase0\S6\s6_*.json calls[*].ms]. 10 s + 4 copies x 5 s
 * [inference: the per-copy allowance, about five times S6's slowest] (PHASE4_PLAN "For row 7, from PR #33").
 */
export const COPIES_TIMEOUT_MS = 30000;
