// Taking one MCP entry out of a config file that is not plain JSON, and putting it back, without
// touching a byte around it: OpenCode's opencode.jsonc (comments allowed) and Hermes's config.yaml.
// A removal is one contiguous span of the original text, so a park can store it with its
// surroundings (the anchor) and a restore can put it back into a file that changed elsewhere since.
// Pure functions; cleanroom-entries.ts does the file work.

export type Span = { start: number; end: number };

/** Index after the string that opens at `i` (a `"`), backslash escapes honoured. */
function endOfString(t: string, i: number): number {
  let j = i + 1;
  while (j < t.length && t[j] !== '"') j += t[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Index after the comment at `i`, or `i` when none starts there. */
function endOfComment(t: string, i: number): number {
  if (t.startsWith("//", i)) {
    const nl = t.indexOf("\n", i);
    return nl < 0 ? t.length : nl;
  }
  if (t.startsWith("/*", i)) {
    const close = t.indexOf("*/", i + 2);
    return close < 0 ? t.length : close + 2;
  }
  return i;
}

/** First index at or after `i` that is not whitespace or a comment. */
function skip(t: string, i: number): number {
  for (;;) {
    while (i < t.length && /\s/.test(t[i] as string)) i++;
    const j = endOfComment(t, i);
    if (j === i) return i;
    i = j;
  }
}

/** Index after the object or array that opens at `i`. */
function endOfValue(t: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < t.length) {
    const c = t[j] as string;
    if (c === '"') {
      j = endOfString(t, j);
      continue;
    }
    const k = endOfComment(t, j);
    if (k !== j) {
      j = k;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") depth--;
    j++;
    if (depth === 0) return j;
  }
  return j;
}

/** Last index before `i` that is not whitespace (comments before a comma are not expected [inference]). */
function prevSolid(t: string, i: number): number {
  let j = i - 1;
  while (j >= 0 && /\s/.test(t[j] as string)) j--;
  return j;
}

/** Every member `"<key>": { … }` (an object value), at any depth, as [keyStart, valueEnd]. */
function jsoncMembers(t: string, key: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let i = 0;
  while (i < t.length) {
    const k = endOfComment(t, i);
    if (k !== i) {
      i = k;
      continue;
    }
    if (t[i] !== '"') {
      i++;
      continue;
    }
    const j = endOfString(t, i);
    if (t.slice(i + 1, j - 1) === key) {
      const colon = skip(t, j);
      const value = t[colon] === ":" ? skip(t, colon + 1) : -1;
      if (value >= 0 && t[value] === "{") found.push([i, endOfValue(t, value)]);
    }
    i = j;
  }
  return found;
}

/** Widens [start, end) to whole lines when only whitespace is around it on them. */
function wholeLines(t: string, start: number, end: number): Span {
  const lineStart = t.lastIndexOf("\n", start - 1) + 1;
  const s = /^[ \t]*$/.test(t.slice(lineStart, start)) ? lineStart : start;
  const m = /^[ \t]*\r?\n/.exec(t.slice(end));
  return { start: s, end: m ? end + m[0].length : end };
}

/**
 * The span to cut so that member `"<key>": {…}` and one comma go: its own trailing comma, or else the
 * comma before it (it was the last member). null when there is no such member; throws on two.
 */
export function jsoncSpan(t: string, key: string): Span | null {
  const members = jsoncMembers(t, key);
  if (members.length === 0) return null;
  if (members.length > 1) throw new Error(`"${key}" appears ${members.length} times`);
  const [start, end] = members[0] as [number, number];
  const after = skip(t, end);
  if (t[after] === ",") return wholeLines(t, start, after + 1);
  const before = prevSolid(t, start);
  if (before >= 0 && t[before] === ",") return { start: before, end };
  return wholeLines(t, start, end);
}

const indentOf = (line: string): number => (/^[ ]*/.exec(line) as RegExpExecArray)[0].length;
const blank = (line: string): boolean => /^\s*(#.*)?$/.test(line);

/**
 * The span of `<key>:` under the top-level `mcp_servers:` of a block-style YAML file, with the lines
 * indented below it. When it is the only server, `mcp_servers:` goes too (a key with no value is null in
 * YAML [inference], and clients-config.ts hermesRefused skips a Hermes file that already has the key). null when not found.
 */
export function yamlSpan(t: string, key: string): Span | null {
  const lines = t.split(/(?<=\n)/);
  const offsets: number[] = [];
  lines.reduce((at, l) => (offsets.push(at), at + l.length), 0);
  const parent = lines.findIndex((l) => /^mcp_servers\s*:\s*(#.*)?\r?\n?$/.test(l));
  if (parent < 0) return null;
  let last = parent + 1;
  while (last < lines.length && (blank(lines[last] as string) || indentOf(lines[last] as string) > 0)) last++;
  const keyRe = new RegExp(`^ +${key}\\s*:`);
  const at = lines.findIndex((l, i) => i > parent && i < last && keyRe.test(l));
  if (at < 0) return null;
  const indent = indentOf(lines[at] as string);
  let end = at + 1;
  while (end < last && (blank(lines[end] as string) || indentOf(lines[end] as string) > indent)) end++;
  while (end > at + 1 && blank(lines[end - 1] as string)) end--;
  const others = lines.slice(parent + 1, last).some((l, i) => !blank(l) && (parent + 1 + i < at || parent + 1 + i >= end));
  const endOffset = end < lines.length ? (offsets[end] as number) : t.length;
  return { start: offsets[others ? at : parent] as number, end: endOffset };
}

/** Context kept around a removal, to find the spot again in a file that changed elsewhere. */
export type Anchor = { prefix: string; suffix: string };
const ANCHOR = 80;

export function cut(t: string, span: Span): { text: string; removed: string; anchor: Anchor } {
  const text = t.slice(0, span.start) + t.slice(span.end);
  const anchor = { prefix: text.slice(Math.max(0, span.start - ANCHOR), span.start), suffix: text.slice(span.start, span.start + ANCHOR) };
  return { text, removed: t.slice(span.start, span.end), anchor };
}

/** `removed` put back where `anchor` is; null when the anchor is not found exactly once. */
export function reinsert(t: string, removed: string, anchor: Anchor): string | null {
  const joint = anchor.prefix + anchor.suffix;
  const at = t.indexOf(joint);
  if (at < 0 || t.indexOf(joint, at + 1) >= 0 || (joint === "" && t !== "")) return null;
  const pos = at + anchor.prefix.length;
  return t.slice(0, pos) + removed + t.slice(pos);
}
