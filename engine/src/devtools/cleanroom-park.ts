// `npm run cleanroom -- --park | --restore` (vault PHASE9_PLAN.md D9.1): moves Jim's development setup
// aside so a product install can be tested as on a fresh account, and puts it back exactly. Data safety
// first: every item is recorded in park.json (with a byte copy) before it is changed, park.json is saved
// after every step, so a stopped run is undone by --restore, and park.json is deleted only when
// everything is back. Order: client entries first (a product uninstaller removes "lrc-avg" from Claude
// Desktop [inference: PR 1's uninstall hook runs setup-cli --installer --remove], so the dev entry is saved
// before any uninstaller runs), then the Decks, then the data.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { clientSpecs, configItemSchema, findEntry, recordConfig, removeConfig, restoreConfig } from "./cleanroom-entries.js";
import { installsPresent, productPresent } from "./cleanroom-scan.js";
import { blockers, pathsOf, type Sys } from "./cleanroom-sys.js";
import { deckInstaller } from "./clients-deck.js";

const PARK_SCHEMA = "lrc-avg/cleanroom-park/v1";
const folderItem = z.object({ kind: z.literal("folder"), from: z.string(), to: z.string(), state: z.enum(["moving", "moved", "restored"]) });
const deckItem = z.object({ kind: z.literal("deck"), name: z.string(), version: z.string().nullable(), install_dir: z.string(), uninstaller: z.string(), state: z.enum(["recorded", "uninstalled", "reinstalled", "manual"]) });
// `complete`: true only after the last item is parked; `npm run setup:install` (tools\setup\install.ts) requires it.
const parkSchema = z.object({ schema: z.literal(PARK_SCHEMA), parked_at: z.string(), dir: z.string(), complete: z.boolean().default(false), items:z.array(z.discriminatedUnion("kind", [configItemSchema, folderItem, deckItem])) });
type Park = z.infer<typeof parkSchema>;
type DeckItem = z.infer<typeof deckItem>;
type FolderItem = z.infer<typeof folderItem>;

export type Outcome = { ok: boolean; refused: boolean; actions: string[]; messages: string[] };
const refused = (...messages: string[]): Outcome => ({ ok: false, refused: true, actions: [], messages });

/** How long an NSIS uninstaller may take after it hands over to its copy in %TEMP% [inference: NSIS uninstallers re-run from a temp copy, so the first process exits early]. */
const UNINSTALL_WAIT_MS = 90_000;

function save(file: string, park: Park): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(park, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

export function readPark(file: string): Park {
  return parkSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Rename; across volumes, copy then remove (the copy is complete before anything is removed). */
function moveFolder(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw new Error(`could not move ${from} (${(err as Error).message}); is a program still using it?`);
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    rmSync(from, { recursive: true });
  }
}

/** Every installed Deck (or Deck-only dev build): its uninstall key, or a known uninstaller on disk. */
function decksFound(sys: Sys): DeckItem[] {
  const p = pathsOf(sys);
  const decks: DeckItem[] = [];
  const add = (name: string, installDir: string, uninstaller: string, exeName: string | null) => {
    if (decks.some((d) => d.uninstaller.toLowerCase() === uninstaller.toLowerCase()) || !existsSync(uninstaller)) return;
    const exe = exeName ?? readdirSync(installDir).find((n) => n.toLowerCase().endsWith(".exe") && n.toLowerCase() !== "uninstall.exe") ?? null;
    decks.push({ kind: "deck", name, version: exe ? sys.exeVersion(path.join(installDir, exe)) : null, install_dir: installDir, uninstaller, state: "recorded" });
  };
  for (const k of sys.uninstallKeys().filter((k) => k.displayName.startsWith("LrC-AVG") && k.uninstallString)) {
    const uninstaller = k.uninstallString as string;
    add(k.displayName, k.installLocation ?? path.dirname(uninstaller), uninstaller, k.mainBinary);
  }
  for (const dir of [p.oldDeck, p.install]) add(path.basename(dir), dir, path.join(dir, "uninstall.exe"), null);
  return decks;
}

async function uninstallDeck(d: DeckItem, sys: Sys): Promise<void> {
  const code = sys.run(d.uninstaller, ["/S"]);
  if (code !== 0) throw new Error(`${d.uninstaller} /S exited with ${String(code)}`);
  const gone = () => !existsSync(d.uninstaller) && !sys.uninstallKeys().some((k) => (k.uninstallString ?? "").toLowerCase() === d.uninstaller.toLowerCase());
  for (let waited = 0; !gone(); waited += 1000) {
    if (waited >= UNINSTALL_WAIT_MS) throw new Error(`${d.name} was still installed ${UNINSTALL_WAIT_MS / 1000} s after ${d.uninstaller} /S`);
    await sys.sleep(1000);
  }
}

/** Why a park cannot start, or null. */
function parkRefusal(sys: Sys): Outcome | null {
  const p = pathsOf(sys);
  if (existsSync(p.parkFile)) return refused(`Already parked: ${p.parkFile} exists. Run "npm run cleanroom -- --restore" first.`);
  const block = blockers(sys);
  if (block.length > 0) return refused(`Quit these first: ${block.join("; ")}.`);
  const product = productPresent(sys);
  if (product.length > 0) return refused(`A product install is present (${product.join("; ")}): uninstall it first (Settings > Apps > Installed apps > LrC-AVG > Uninstall).`);
  return null;
}

export async function park(sys: Sys, dryRun: boolean): Promise<Outcome> {
  const p = pathsOf(sys);
  const refusal = parkRefusal(sys);
  if (refusal) return refusal;
  const entries = clientSpecs(sys).map((spec) => ({ spec, found: findEntry(spec) }));
  const problems = entries.flatMap((e) => (e.found.problem ? [e.found.problem] : []));
  if (problems.length > 0) return refused(...problems.map((m) => `Nothing was parked: ${m}.`));
  const present = entries.filter((e) => e.found.present);
  const decks = decksFound(sys);
  const folders = p.dataFolders.filter((f) => existsSync(f));
  const dir = path.join(p.parkDir, sys.now().toISOString().replace(/[:.]/g, "-"));
  const plan = [
    ...present.map((e) => `take "lrc-avg" out of ${e.spec.client}'s ${e.spec.file} (copy first, into ${dir})`),
    ...decks.map((d) => `uninstall ${d.name} ${d.version ?? "(version unknown)"} with "${d.uninstaller}" /S`),
    ...folders.map((f) => `move ${f} into ${dir}`),
  ];
  if (dryRun) return { ok: true, refused: false, actions: plan.map((a) => `would ${a}`), messages: plan.length === 0 ? ["Nothing to park."] : [] };
  mkdirSync(dir, { recursive: true });
  const state: Park = { schema: PARK_SCHEMA, parked_at: sys.now().toISOString(), dir, complete: false, items: [] };
  save(p.parkFile, state);
  const actions: string[] = [];
  try {
    for (const [n, e] of present.entries()) {
      const item = recordConfig(e.spec, e.found, path.join(dir, "configs"), n);
      state.items.push(item);
      save(p.parkFile, state);
      removeConfig(item, sys);
      save(p.parkFile, state);
      actions.push(`took "lrc-avg" out of ${item.file} (copy: ${item.copy})`);
    }
    for (const d of decks) {
      state.items.push(d);
      save(p.parkFile, state);
      await uninstallDeck(d, sys);
      d.state = "uninstalled";
      save(p.parkFile, state);
      actions.push(`uninstalled ${d.name} ${d.version ?? ""}`.trim());
    }
    for (const [n, from] of folders.entries()) {
      const item: FolderItem = { kind: "folder", from, to: path.join(dir, "folders", `${n}-${path.basename(from)}`), state: "moving" };
      state.items.push(item);
      save(p.parkFile, state);
      moveFolder(from, item.to);
      item.state = "moved";
      save(p.parkFile, state);
      actions.push(`moved ${from} to ${item.to}`);
    }
  } catch (err) {
    return { ok: false, refused: false, actions, messages: [`Stopped: ${(err as Error).message}`, `What was parked so far is recorded in ${p.parkFile}; "npm run cleanroom -- --restore" puts it back.`] };
  }
  state.complete = true;
  save(p.parkFile, state);
  return { ok: true, refused: false, actions, messages: [] };
}

/** Puts a parked folder back. A folder the test left in its place is renamed aside, never deleted. */
function restoreFolder(item: FolderItem, dir: string, stamp: string, messages: string[]): void {
  if (!existsSync(item.to)) {
    if (item.state === "moving" && existsSync(item.from)) return void (item.state = "restored");
    throw new Error(`the parked folder ${item.to} is missing`);
  }
  // %TEMP%\LrC-AVG holding only the clean room's own results: those are merged into the restored folder.
  let results: string | null = null;
  if (existsSync(item.from)) {
    if (readdirSync(item.from).every((n) => n === "cleanroom")) {
      results = path.join(dir, `results-${stamp}`);
      renameSync(item.from, results);
    } else {
      const aside = `${item.from}-cleanroom-residue-${stamp}`;
      renameSync(item.from, aside);
      messages.push(`The test left ${item.from}; it was renamed to ${aside} (nothing deleted).`);
    }
  }
  moveFolder(item.to, item.from);
  item.state = "restored";
  const stash = results === null ? null : path.join(results, "cleanroom");
  if (stash === null || !existsSync(stash)) return;
  const into = path.join(item.from, "cleanroom");
  mkdirSync(into, { recursive: true });
  for (const n of readdirSync(stash)) if (!existsSync(path.join(into, n))) renameSync(path.join(stash, n), path.join(into, n));
}

const REINSTALL = 'npm run deck:build, then run the installer under hud\\src-tauri\\target\\release\\bundle\\nsis\\ with /S';

function restoreDeck(d: DeckItem, sys: Sys): string {
  let installer: string | null = null;
  try {
    installer = deckInstaller(sys.repo);
  } catch {
    installer = null;
  }
  if (installer === null) {
    // Still owed: the restore fails, park.json stays and the next --restore tries again. Not by hand:
    // restore would then refuse the Deck as an install still present (restoreRefusal).
    d.state = "manual";
    throw new Error(`a dev Deck (${d.name} ${d.version ?? ""}) was uninstalled at park and no built installer was found. To put it back: npm run deck:build, then npm run cleanroom -- --restore again (it runs the installer under hud\\src-tauri\\target\\release\\bundle\\nsis\\ with /S)`);
  }
  const code = sys.run(installer, ["/S"]);
  if (code !== 0) throw new Error(`the Deck installer ${installer} /S exited with ${String(code)}; to reinstall by hand: ${REINSTALL}`);
  d.state = "reinstalled";
  return `reinstalled the dev Deck with ${installer} /S (it was ${d.name} ${d.version ?? ""} at park)`;
}

function restoreRefusal(sys: Sys): Outcome | null {
  const p = pathsOf(sys);
  if (!existsSync(p.parkFile)) return refused(`Nothing is parked (${p.parkFile} does not exist).`);
  const block = blockers(sys);
  if (block.length > 0) return refused(`Quit these first: ${block.join("; ")}.`);
  const installs = installsPresent(sys);
  if (installs.length > 0) return refused(`An install is still present (${installs.join("; ")}): uninstall it first (Settings > Apps > Installed apps > LrC-AVG > Uninstall).`);
  return null;
}

export async function restore(sys: Sys, dryRun: boolean): Promise<Outcome> {
  const p = pathsOf(sys);
  const refusal = restoreRefusal(sys);
  if (refusal) return refusal;
  const state = readPark(p.parkFile);
  // A Deck still "recorded" (its uninstall timed out) is gone by now: restoreRefusal saw no install.
  // A "manual" Deck (no installer last time) is tried again; what is back already is not redone.
  const todo = state.items.filter((i) => i.state !== "restored" && i.state !== "reinstalled");
  // Folders first, so the data is back before an entry or the Deck uses it.
  const ordered = [...todo.filter((i) => i.kind === "folder"), ...todo.filter((i) => i.kind === "config"), ...todo.filter((i) => i.kind === "deck")];
  if (dryRun) {
    const actions = ordered.map((i) => (i.kind === "folder" ? `would move ${i.to} back to ${i.from}` : i.kind === "config" ? `would put "lrc-avg" back into ${i.file}` : `would reinstall the dev Deck (${REINSTALL}; run only if the installer is built)`));
    return { ok: true, refused: false, actions: [...actions, `would delete ${p.parkFile}`], messages: [] };
  }
  const stamp = sys.now().toISOString().replace(/[:.]/g, "-");
  const actions: string[] = [];
  const messages: string[] = [];
  let failed = 0;
  for (const item of ordered) {
    try {
      if (item.kind === "folder") {
        restoreFolder(item, state.dir, stamp, messages);
        actions.push(`moved ${item.to} back to ${item.from}`);
      } else if (item.kind === "config") {
        actions.push(restoreConfig(item, sys));
        item.state = "restored";
      } else {
        actions.push(restoreDeck(item, sys));
      }
    } catch (err) {
      failed++;
      messages.push(`Not restored: ${(err as Error).message}`);
    }
    save(p.parkFile, state);
  }
  if (failed > 0) return { ok: false, refused: false, actions, messages: [...messages, `${p.parkFile} is kept; fix the above and run "npm run cleanroom -- --restore" again.`] };
  rmSync(p.parkFile);
  // The byte copies of the parked configs hold other servers' env values too [inference]: gone once all is back.
  const copies = path.join(state.dir, "configs");
  if (existsSync(copies)) {
    rmSync(copies, { recursive: true });
    actions.push(`deleted the config copies in ${copies}`);
  }
  return { ok: true, refused: false, actions, messages };
}
