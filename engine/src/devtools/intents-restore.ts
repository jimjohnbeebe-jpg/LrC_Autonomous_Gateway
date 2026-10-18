// `npm run intents:check -- --restore` (issue #180) ends by putting Claude Desktop's "lrc-avg" entry back
// as it was before `npm run desktop:install` pointed it at this folder's engine, so Jim does not choose and
// put back his usual entry by hand. "As it was" is the entry in the newest config backup that does not run
// this folder's engine: apply-config.ts writes a backup next to the config before each change, so the one
// desktop:install made holds the old entry (setup\apply-config.ts, the `backup` lines).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { applyDesktopConfig } from "../setup/apply-config.js";
import { CONFIG_FILE, SERVER_NAME, desktopConfigSchema, findDesktopConfigs, type ServerEntry } from "../setup/desktop-config.js";

export type PutBack = { put_back: "YES" | "NO" | "NOT NEEDED"; detail: string };

export type Backup = { name: string; text: string };

const withArgs = z.looseObject({ args: z.array(z.string()) });
const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Whether a config entry runs the engine `mainJs`. */
const runs = (entry: unknown, mainJs: string): boolean => (withArgs.safeParse(entry).data?.args ?? []).some((arg) => same(arg, mainJs));

/** The servers of a config text, or null when it is not a Claude Desktop config. */
function serversOf(text: string): Record<string, unknown> | null {
  try {
    const parsed = desktopConfigSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data.mcpServers ?? {}) : null;
  } catch {
    return null;
  }
}

/** The entry to put back, from the first of `backups` (newest first) whose "lrc-avg" does not run `mainJs`; entry null when that backup had none. undefined when no backup qualifies. */
export function entryBefore(backups: Backup[], mainJs: string): { backup: string; entry: ServerEntry | null } | undefined {
  for (const { name, text } of backups) {
    const servers = serversOf(text);
    const entry = servers?.[SERVER_NAME];
    if (servers && !runs(entry, mainJs)) return { backup: name, entry: (entry ?? null) as ServerEntry | null };
  }
  return undefined;
}

/** Puts Claude Desktop's "lrc-avg" entry back when it runs `mainJs`. Never throws; `env` is for the tests. */
export function putClaudeDesktopBack(mainJs: string, env: NodeJS.ProcessEnv = process.env): PutBack {
  try {
    const files = findDesktopConfigs(env);
    if (files.length !== 1) return { put_back: "NO", detail: `${files.length} Claude Desktop config files were found, so it is not clear which one to put back` };
    const file = files[0] as string;
    if (!runs(serversOf(readFileSync(file, "utf8"))?.[SERVER_NAME], mainJs)) return { put_back: "NOT NEEDED", detail: `the "${SERVER_NAME}" entry in ${file} does not run ${mainJs}` };
    const dir = path.dirname(file);
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(`${CONFIG_FILE}.backup-`))
      .sort()
      .reverse()
      .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
    const before = entryBefore(backups, mainJs);
    if (!before) return { put_back: "NO", detail: `no config backup in ${dir} holds a "${SERVER_NAME}" entry that runs another engine, or none at all` };
    applyDesktopConfig({ entry: before.entry, configPath: file, env });
    return { put_back: "YES", detail: `the "${SERVER_NAME}" entry in ${file} is ${before.entry ? `the one from ${before.backup}` : `removed, because ${before.backup} had none`}` };
  } catch (err) {
    return { put_back: "NO", detail: err instanceof Error ? err.message : String(err) };
  }
}
