// Keyword paths (engine 0.15.0 with plugin 0.10.0, GitHub issue #60 [stated: Jim, 2026-10-03,
// "Keyword hierarchy"]; the plugin side is plugin\LrC-AVG.lrplugin\KeywordTree.lua). A keyword is
// named parent first with "|" between the levels, "Places|Europe|Paris": Automaat's separator, which
// it takes to be Lightroom's own and impossible inside a keyword name [upstream claim: Automaat
// plugin/LightroomMCP.lrplugin/KeywordTree.lua:3-6 at commit 11c0b93]. A name without "|" is a
// top-level keyword. Levels are trimmed; an empty level is refused.
//
// How a name that fits several keywords is settled (the same rules as KeywordTree.lua changes()):
//   - an added plain name is the top-level keyword of that name, created there if missing, even when
//     deeper keywords share the name (plugin 0.8.0 created every added name at the top level);
//   - a removed plain name takes off every keyword of exactly that name, at any level (plugin 0.8.0
//     matched removals by name);
//   - a path means the one keyword at that place; its levels match case aside, as Lightroom matches
//     keyword names [upstream claim: Automaat KeywordTree.lua:13-15 at 11c0b93].

export const KEYWORD_SEPARATOR = "|";

/** The levels of a keyword path, each trimmed; null when a level is empty ("A||B", "|A", "A|", ""). */
export function keywordLevels(path: string): string[] | null {
  const levels = path.split(KEYWORD_SEPARATOR).map((level) => level.trim());
  return levels.some((level) => level === "") ? null : levels;
}

/** A keyword with its levels trimmed ("A | B" -> "A|B"); unchanged when a level is empty. */
export function normalizeKeyword(path: string): string {
  return keywordLevels(path)?.join(KEYWORD_SEPARATOR) ?? path;
}

export const isKeywordPath = (keyword: string): boolean => keyword.includes(KEYWORD_SEPARATOR);

/**
 * Case aside. JavaScript's lower-casing and the plugin's LrStringUtils.lower ("the operating system's
 * localized case conversion" [handle: https://lrc.mcor.dev/modules/LrStringUtils.html lower]) may
 * differ on a few letters [inference].
 */
const fold = (s: string): string => s.toLowerCase();
const leaf = (path: string): string => path.slice(path.lastIndexOf(KEYWORD_SEPARATOR) + 1);

/**
 * What a read-back shows Lightroom did not take, or null. `after` holds the photo's keyword paths
 * (normalized `add` and `remove`, as sent). An added keyword must be there, case aside (a plain name
 * as a top-level keyword); a removed plain name must be gone at every level, by exact name; a
 * removed path must be gone, case aside.
 */
export function keywordsNotTaken(after: readonly string[], add: readonly string[], remove: readonly string[]): string | null {
  const held = new Set(after.map(fold));
  const missing = add.filter((k) => !held.has(fold(k)));
  const left = remove.filter((k) => (isKeywordPath(k) ? held.has(fold(k)) : after.some((p) => leaf(p) === k)));
  if (missing.length === 0 && left.length === 0) return null;
  return `Lightroom read back keywords without ${JSON.stringify(missing)} and still with ${JSON.stringify(left)}.`;
}
