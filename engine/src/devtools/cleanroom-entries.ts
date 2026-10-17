// The "lrc-avg" entry in each AI client's config (vault PHASE9_PLAN.md D9.1): find it, park it
// (copy the file byte for byte, then take the entry out), and put it back. Restore copies the parked
// bytes back only when the file is still exactly as the park left it; a file that changed since gets
// the entry merged into its current content instead, so nothing newer is overwritten.
//   Claude Desktop (every config discovery finds) and Antigravity: JSON, through apply-config.ts.
//   OpenCode opencode.jsonc and Hermes config.yaml: text spans (cleanroom-text.ts).
//   Claude Code user scope: `claude mcp remove|add-json -s user`, never by editing ~/.claude.json,
//   which a running Claude Code rewrites [inference: it holds per-session state; this session's own].

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { applyDesktopConfig } from "../setup/apply-config.js";
import { desktopConfigSchema, findDesktopConfigs, SERVER_NAME, type ServerEntry } from "../setup/desktop-config.js";
import { cut, jsoncSpan, reinsert, yamlSpan, type Span } from "./cleanroom-text.js";
import { pathsOf, type Sys } from "./cleanroom-sys.js";

export type Format = "json" | "jsonc" | "yaml" | "claude-cli";
export type ClientSpec = { client: string; file: string; format: Format };

/** Hermes's key has no dash [handle: clients-config.ts hermesBlock; Jim's %LOCALAPPDATA%\hermes\config.yaml, read 2026-10-17]. */
const HERMES_KEY = "lrc_avg";

export function clientSpecs(sys: Sys): ClientSpec[] {
  const p = pathsOf(sys);
  return [
    ...findDesktopConfigs(sys.env).map((file): ClientSpec => ({ client: "claude-desktop", file, format: "json" })),
    { client: "claude-code", file: p.claudeJson, format: "claude-cli" },
    { client: "opencode", file: p.opencode, format: "jsonc" },
    { client: "hermes", file: p.hermes, format: "yaml" },
    { client: "antigravity", file: p.antigravity, format: "json" },
  ];
}

export const configItemSchema = z.object({
  kind: z.literal("config"),
  client: z.string(),
  format: z.enum(["json", "jsonc", "yaml", "claude-cli"]),
  file: z.string(),
  /** Byte copy of the file before the park changed it. */
  copy: z.string(),
  before_sha: z.string(),
  /** The file's sha256 right after the park; null until then. */
  after_sha: z.string().nullable(),
  /** json and claude-cli: the entry's value. */
  entry: z.unknown(),
  /** jsonc and yaml: the text cut out, and its surroundings. */
  removed: z.string().nullable(),
  anchor: z.object({ prefix: z.string(), suffix: z.string() }).nullable(),
  state: z.enum(["copied", "removed", "restored"]),
});
export type ConfigItem = z.infer<typeof configItemSchema>;

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

const userScope = z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() });

/** The file as text, refused when it is not UTF-8 (a decode/encode round trip would change its bytes). */
function text(file: string): string {
  const bytes = readFileSync(file);
  const t = bytes.toString("utf8");
  if (!Buffer.from(t, "utf8").equals(bytes)) throw new Error(`${file} is not UTF-8 text; left as it is`);
  return t;
}

function span(spec: ClientSpec, t: string): Span | null {
  return spec.format === "jsonc" ? jsoncSpan(t, SERVER_NAME) : yamlSpan(t, HERMES_KEY);
}

export type Found = { present: boolean; entry?: unknown; problem?: string };

/** Whether the file has the entry. `problem`: it does (or may), but the clean room cannot take it out safely. */
export function findEntry(spec: ClientSpec): Found {
  if (!existsSync(spec.file)) return { present: false };
  try {
    if (spec.format === "json" || spec.format === "claude-cli") {
      const schema = spec.format === "json" ? desktopConfigSchema : userScope;
      const parsed = schema.safeParse(JSON.parse(readFileSync(spec.file, "utf8")) as unknown);
      if (!parsed.success) return { present: false, problem: `${spec.file} has an unexpected shape` };
      const entry = parsed.data.mcpServers?.[SERVER_NAME];
      return entry === undefined ? { present: false } : { present: true, entry };
    }
    const t = text(spec.file);
    const loose = spec.format === "jsonc" ? new RegExp(`"${SERVER_NAME}"\\s*:`) : new RegExp(`\\b${HERMES_KEY}\\s*:`);
    if (span(spec, t) !== null) return { present: true };
    return loose.test(t) ? { present: true, problem: `${spec.file} mentions ${spec.format === "jsonc" ? SERVER_NAME : HERMES_KEY} in a form the clean room does not edit; take it out by hand` } : { present: false };
  } catch (err) {
    return { present: false, problem: `${spec.file}: ${(err as Error).message}` };
  }
}

/** The record a park writes before it changes anything: the copy is made here. */
export function recordConfig(spec: ClientSpec, found: Found, dir: string, n: number): ConfigItem {
  mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, `${n}-${spec.client}-${path.basename(spec.file)}`);
  copyFileSync(spec.file, copy);
  const bytes = readFileSync(copy);
  if (!bytes.equals(readFileSync(spec.file))) throw new Error(`the copy of ${spec.file} differs from it; nothing was changed`);
  return { kind: "config", client: spec.client, format: spec.format, file: spec.file, copy, before_sha: sha256(bytes), after_sha: null, entry: found.entry ?? null, removed: null, anchor: null, state: "copied" };
}

/** Takes the entry out (the copy already exists); sets after_sha and, for text files, what was cut. */
export function removeConfig(item: ConfigItem, sys: Sys): void {
  if (item.format === "claude-cli") {
    const r = sys.claude(["mcp", "remove", SERVER_NAME, "-s", "user"]);
    if (r.status !== 0) throw new Error(`claude mcp remove ${SERVER_NAME} -s user failed (${r.output})`);
  } else if (item.format === "json") {
    const result = applyDesktopConfig({ entry: null, configPath: item.file });
    // The park's own copy is the backup; apply-config's copy next to the file is not needed (as clients-config.ts).
    if (result.backup) rmSync(path.join(path.dirname(item.file), result.backup), { force: true });
  } else {
    const t = text(item.file);
    const s = span({ client: item.client, file: item.file, format: item.format }, t);
    if (s === null) throw new Error(`the entry in ${item.file} was not found again`);
    const c = cut(t, s);
    writeFileSync(item.file, c.text);
    if (readFileSync(item.file, "utf8") !== c.text) throw new Error(`${item.file} did not read back as written`);
    item.removed = c.removed;
    item.anchor = c.anchor;
  }
  if (findEntry({ client: item.client, file: item.file, format: item.format }).present) throw new Error(`${item.file} still has the entry after the removal`);
  item.after_sha = sha256(readFileSync(item.file));
  item.state = "removed";
}

const entrySchema = z.looseObject({ command: z.string(), args: z.array(z.string()) });

/** Puts the entry back; returns what it did. Throws when it cannot, leaving the file as it found it. */
export function restoreConfig(item: ConfigItem, sys: Sys): string {
  const spec: ClientSpec = { client: item.client, file: item.file, format: item.format };
  if (item.format === "claude-cli") {
    if (findEntry(spec).present) return `${item.client}: "${SERVER_NAME}" is already there; left as it is`;
    const r = sys.claude(["mcp", "add-json", SERVER_NAME, JSON.stringify(item.entry), "-s", "user"]);
    if (r.status !== 0 || !findEntry(spec).present) throw new Error(`claude mcp add-json ${SERVER_NAME} -s user failed (${r.output})`);
    return `${item.client}: added "${SERVER_NAME}" again with claude mcp add-json`;
  }
  const original = readFileSync(item.copy);
  const now = existsSync(item.file) ? sha256(readFileSync(item.file)) : null;
  if (now === item.before_sha) return `${item.client}: ${item.file} is already as before the park`;
  if (now === null || now === item.after_sha) {
    mkdirSync(path.dirname(item.file), { recursive: true });
    writeFileSync(item.file, original);
    if (sha256(readFileSync(item.file)) !== item.before_sha) throw new Error(`${item.file} did not read back as the parked copy ${item.copy}`);
    return `${item.client}: ${item.file} put back byte for byte`;
  }
  if (findEntry(spec).present) return `${item.client}: ${item.file} changed since the park and has an entry again; left as it is`;
  if (item.format === "json") {
    const entry = entrySchema.parse(item.entry) as ServerEntry;
    const r = applyDesktopConfig({ entry, configPath: item.file });
    return `${item.client}: ${item.file} changed since the park; "${SERVER_NAME}" merged in (backup of the newer file: ${r.backup ?? "none"})`;
  }
  if (item.removed === null || item.anchor === null) throw new Error(`${item.file} changed since the park and the park did not record the removed text; the parked copy is ${item.copy}`);
  const current = text(item.file);
  const merged = reinsert(current, item.removed, item.anchor);
  if (merged === null) throw new Error(`${item.file} changed since the park around the entry, so it was left as it is. Put the entry back by hand from the parked copy ${item.copy}`);
  writeFileSync(item.file, merged);
  if (!findEntry(spec).present) {
    writeFileSync(item.file, current);
    throw new Error(`${item.file}: the merged entry was not found again, so the file was put back as it was`);
  }
  return `${item.client}: ${item.file} changed since the park; the entry was merged back in at its old place`;
}
