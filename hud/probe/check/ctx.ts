// What every step of the Phase 7 check shares (row 6): the saved state (%TEMP%\LrC-AVG\P7\p7_state.json,
// written to a temporary name and renamed, read through summary.ts's zod schema), the real engine
// against Jim's Lightroom (menu-kit.ts startEngine, as `npm run deck:menu` ran it), giving the bridge to
// Claude Desktop for the chats and taking it back (Desktop's engine lets it go 60 s after its last call
// with no edit open [handle: engine\src\mcp\main.ts IDLE_RELEASE_MS; Phase 5's check took it back after
// every chat, docs\reports\phase5\PHASE5.md "Observed"]), the photo's put-back with the check's own
// snapshot, and Jim's answers.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pluginVersionAtLeast } from "../../../engine/dist/bridge/index.js";
import { acquireInstanceLock, devOverrides } from "../../../engine/dist/mcp/index.js";
import { enter, yes } from "../kit.ts";
import { PluginLog, differing, startEngine, until, type Engine } from "../menu-kit.ts";
import { deckEvents, sessionLogs, type PidEvent } from "./budgets.ts";
import { CHECKS, stateSchema, type State } from "./summary.ts";

/** LRC_AVG_P7_OUT: a dev override for dry runs against the simulator, as phase5-check-cli.ts has LRC_AVG_P5_OUT. */
export const OUT = process.env["LRC_AVG_P7_OUT"] || path.join(tmpdir(), "LrC-AVG", "P7");
export const STATE_FILE = path.join(OUT, "p7_state.json");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Lock = { release: () => Promise<void> };
type Json = Record<string, unknown>;
export const PLUGIN_MANAGER = "In Lightroom: File > Plug-in Manager. In the list on the left, click LrC-AVG. In the Sessions box, set Mode to";

export function loadState(): State | null {
  if (!existsSync(STATE_FILE)) return null;
  return stateSchema.parse(JSON.parse(readFileSync(STATE_FILE, "utf8")));
}

export function saveState(state: State): void {
  mkdirSync(OUT, { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, STATE_FILE);
}

export class Ctx {
  readonly state: State;
  dir: string;
  readonly plog = new PluginLog();
  private engineNow: Engine | null = null;
  private lock: Lock | null = null;

  constructor(state: State) {
    this.state = state;
    this.dir = path.join(OUT, state.run);
    mkdirSync(this.dir, { recursive: true });
  }

  /** `--new`, once the last run's photo is back: this run's state replaces it, in place, and is saved. */
  reset(next: State): void {
    Object.assign(this.state, next);
    this.dir = path.join(OUT, next.run);
    mkdirSync(this.dir, { recursive: true });
    this.save();
  }

  say(text: string): void {
    console.log(`\n${text}`);
  }

  save(): void {
    saveState(this.state);
  }

  /** A check's outcome (summary.ts CHECKS names every id), printed and saved at once. */
  record(id: string, ok: boolean | null, detail?: unknown): boolean {
    if (!CHECKS.some((x) => x.id === id)) throw new Error(`unknown check ${id}`);
    this.state.answers[id] = { ok, at: new Date().toISOString(), ...(detail === undefined ? {} : { detail }) };
    this.save();
    console.log(`  ${ok === null ? "NOT RUN" : ok ? "YES" : "NO "}  ${id}`);
    return ok === true;
  }

  skip(id: string, why: string): void {
    this.state.answers[id] = { ok: null, at: new Date().toISOString(), skipped: why };
    this.save();
    console.log(`  n/a  ${id} (${why})`);
  }

  /** Jim's y/n, phrased so that y is the good answer. */
  async jim(id: string, question: string): Promise<boolean> {
    return this.record(id, await yes(question));
  }

  // --- The engine and the bridge ---------------------------------------------------------------------
  engine(): Engine {
    if (!this.engineNow) throw new Error("the check's engine is not running");
    return this.engineNow;
  }

  hasEngine(): boolean {
    return this.engineNow !== null;
  }

  /** Takes the bridge (waiting up to `waitMs` for another engine to let it go) and starts the engine. */
  async start(waitMs = 0): Promise<boolean> {
    if (this.engineNow) return true;
    const end = Date.now() + waitMs;
    for (;;) {
      const got = await acquireInstanceLock(devOverrides().lockPort);
      if (got.ok) {
        this.lock = got.lock;
        break;
      }
      if (Date.now() >= end) return false;
      await sleep(2000);
    }
    const e = await startEngine(this.dir, () => true, () => {}, "phase7-check");
    this.engineNow = e;
    const v = e.client.hello()?.plugin_version;
    if (!pluginVersionAtLeast(v, "0.18.0")) throw new Error(`Lightroom runs plugin ${v ?? "unknown"}, not 0.18.0 or later: File > Plug-in Manager > LrC-AVG > Reload Plug-in, then run this again.`);
    return true;
  }

  /** Gives the bridge up (for Claude Desktop's engine, or at the end). */
  async release(): Promise<void> {
    this.engineNow?.tools.deck()?.close();
    this.engineNow?.client.stop();
    this.engineNow = null;
    await this.lock?.release();
    this.lock = null;
  }

  // --- The photo --------------------------------------------------------------------------------------
  photo(): NonNullable<State["photo"]> {
    if (!this.state.photo) throw new Error("no photo recorded yet");
    return this.state.photo;
  }

  async settings(uuid: string): Promise<Json> {
    const e = this.engine();
    return e.map.fromSdk((await e.client.request("get_settings", { photo_uuid: uuid })).settings).settings;
  }

  /** Selects the check's photo in Lightroom (the check does it, not Jim). */
  async selectPhoto(): Promise<void> {
    await this.engine().client.request("select_photo", { uuid: this.photo().uuid });
  }

  /**
   * Ends an open edit with revert, then puts the photo back with the check's snapshot if any setting
   * differs from its start, and records back.<step> (null: the start of a run, nothing recorded). True
   * when nothing differs.
   */
  async putBack(step: string | null): Promise<boolean> {
    const e = this.engine();
    const p = this.photo();
    const open = e.tools.sessionManager()?.current();
    if (open) await e.tools.endSession({ session_id: open.id, outcome: "revert" }).catch(() => undefined);
    let diff = differing(await this.settings(p.uuid), p.start);
    if (diff.length > 0) {
      await e.client.request("apply_snapshot", { photo_uuid: p.uuid, snapshot_id: p.snapshot_id }, { timeoutMs: 30_000 });
      diff = differing(await this.settings(p.uuid), p.start);
    }
    if (step === null) return diff.length === 0;
    return this.record(`back.${step}`, diff.length === 0, diff.length ? { differing: diff } : undefined);
  }

  // --- Stopping (Ctrl+C, input ended) -------------------------------------------------------------------
  /** Set when the check stops: no new begin or step starts (Greptile, PR #91: a step loop racing the cleanup). */
  stopping = false;
  private busy: Promise<unknown> = Promise.resolve();

  /** Runs one engine call unless the check is stopping, and remembers it so the cleanup can wait for it. */
  private guarded<T>(call: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error("the check is stopping"));
    const p = call();
    this.busy = p.catch(() => undefined);
    return p;
  }

  /** Waits up to `ms` for the engine call in flight (the cleanup runs after it). */
  async settle(ms: number): Promise<void> {
    await Promise.race([this.busy, sleep(ms)]);
  }

  // --- The settings page's Mode ---------------------------------------------------------------------------
  /**
   * Waits until the settings page's Mode is `want`, asking Jim to set it (get_prefs, plugin 0.5.0,
   * engine\src\bridge\protocol.ts; wire key `mode`, engine\src\settings\page.ts). Read before an edit
   * begins, so a wrong mode never gets as far as Variants' copies (Greptile, PR #91).
   */
  async ensureMode(want: "autonomous" | "approve_each_pass"): Promise<void> {
    const label = want === "autonomous" ? "Autonomous" : "Approve each pass";
    // Three asks, each read back, the last one too (Greptile, PR #91 review 2).
    for (let round = 0; round <= 3; round++) {
      const prefs = (await this.engine().client.request("get_prefs", {}, { timeoutMs: 30_000 })) as Json;
      if (prefs["mode"] === want) {
        if (want === "autonomous" && this.state.mode_changed) {
          this.state.mode_changed = false;
          this.save();
        }
        return;
      }
      if (round < 3) await enter(`${PLUGIN_MANAGER} "${label}", then click Done.`);
    }
    throw new Error(`the settings page's Mode is still not "${label}". Set it (${PLUGIN_MANAGER} "${label}"), then run \`npm run phase7:check\` again.`);
  }

  // --- Edits --------------------------------------------------------------------------------------------
  /** Starts an edit on the check's photo in mode `mode` (checked first); `t0` is just before the call. */
  async begin(args: Json, mode: "autonomous" | "approve_each_pass" = "autonomous"): Promise<{ sid: string; t0: number; snapshot: string; json: Json }> {
    await this.ensureMode(mode);
    await this.selectPhoto();
    const t0 = Date.now();
    const json = (await this.guarded(() => this.engine().tools.beginSession({ intent_id: "neutral_technical_correction", max_passes: 6, return_image: "none", ...args }))).json;
    if (Ctx.approval(json) !== mode) throw new Error(`the edit began in mode ${String(Ctx.approval(json))}, not ${mode}`);
    const snapshot = String((json["snapshot"] as { name?: string } | undefined)?.name ?? "");
    return { sid: String(json["session_id"]), t0, snapshot, json };
  }

  async step(sid: string, settings: Json, extra: Json = {}): Promise<Json> {
    return (await this.guarded(() => this.engine().tools.step({ session_id: sid, settings, rationale: "Phase 7 check", return_image: "none", ...extra }))).json;
  }

  /** Waits up to `ms` for the open edit to end. */
  ended(ms: number): Promise<boolean> {
    return until(() => this.engine().tools.sessionManager()?.current() == null, ms);
  }

  /** The approval mode the settings page gave the edit (begin's session_settings). */
  static approval(json: Json): unknown {
    return (json["session_settings"] as { approval?: unknown } | undefined)?.approval;
  }

  // --- The Deck's log -----------------------------------------------------------------------------------
  /** The first Deck log line at or after `after` that `match` accepts, waiting up to `ms`. */
  async deck(after: number, match: (e: PidEvent) => boolean, ms: number): Promise<PidEvent | null> {
    const end = Date.now() + ms;
    for (;;) {
      const found = deckEvents(this.state.started).find((e) => e.t >= after && match(e));
      if (found || Date.now() >= end) return found ?? null;
      await sleep(150);
    }
  }

  /** The Deck log lines from `from` to `to`. */
  deckBetween(from: number, to: number): PidEvent[] {
    return deckEvents(this.state.started).filter((e) => e.t >= from && e.t <= to);
  }

  /** The engine's session log of edit `sid` (sessions under the run folder). */
  sessionLog(sid: string): ReturnType<typeof sessionLogs>[number] | null {
    return sessionLogs(path.join(this.dir, "sessions")).find((l) => l.session_id === sid) ?? null;
  }
}
