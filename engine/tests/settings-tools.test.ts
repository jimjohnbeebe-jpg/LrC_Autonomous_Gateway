// The tools with the settings page (PHASE5_PLAN row 3), wired as mcp\main.ts wires them: one
// PageSettings on the client, the intent library and the session log folder following its folders.
// Against the simulated Lightroom (tests/helpers/session-harness.ts). The harness writes the test
// intents to `userDir` only, so an intent found proves the page's intents folder was used. The
// remembered log folders (settings\log-folders.ts) go to a file in the test's temp folder.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { PAGE_WAIT_MS } from "../src/mcp/tools-shared.js";
import { PreviewService } from "../src/preview/index.js";
import { KnownLogFolders, PageSettings } from "../src/settings/index.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";
import { client, clean, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

let pageLogs: string;
let env: NodeJS.ProcessEnv;
let waits: Array<number | undefined>;
let gateCalls = 0;
let known: KnownLogFolders;

/**
 * Tools as main.ts builds them. `bridge` false: Lightroom does not answer (ensureBridge rejects);
 * `folders` null: no remembered log folders.
 */
function makeTools(settings: PageSettings, { bridge = true, folders = known }: { bridge?: boolean; folders?: KnownLogFolders | null } = {}): Tools {
  return new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir: () => settings.folders.intentsDir() }),
    sessionLogDir: () => settings.folders.logDir(),
    settings,
    ...(folders ? { logFolders: folders } : {}),
    engineVersion: "test",
    ensureBridge: (waitMs) => {
      waits.push(waitMs);
      return bridge ? client.waitConnected(2000).then(() => undefined) : Promise.reject(new Error("Lightroom plugin not connected"));
    },
    onCallStart: () => gateCalls++,
    onCallEnd: () => gateCalls++,
  });
}

beforeEach(() => {
  pageLogs = path.join(tmp, "page-logs");
  env = { LOCALAPPDATA: path.join(tmp, "local") };
  waits = [];
  gateCalls = 0;
  known = new KnownLogFolders(path.join(tmp, "known", "log_folders.json"));
  lr.prefs = { ...defaultSimPrefs(), intents_dir: userDir, log_dir: pageLogs };
});

const listed = async (tools: Tools) => {
  const out = (await tools.listIntents()).json as { intents: Array<{ id: string }>; intents_folder: Record<string, unknown> };
  return { ids: out.intents.map((i) => i.id), folder: out.intents_folder };
};

describe("the intent tools and the settings page (decision 2A)", () => {
  it("read the page's intents folder, waiting at most PAGE_WAIT_MS for Lightroom, as bridge calls", async () => {
    const tools = makeTools(new PageSettings(client, env));
    const { ids, folder } = await listed(tools);
    expect(ids).toContain("test_plain");
    expect(folder).toEqual({ path: userDir, from: "page", page: "read now" });
    expect(waits).toEqual([PAGE_WAIT_MS]);
    expect(gateCalls).toBe(2);
    expect((await tools.getIntent({ id: "test_plain" })).json).toMatchObject({ source: "user", intents_folder: { from: "page" } });
  });

  it("keep the folder read before when Lightroom does not answer, and say so", async () => {
    const settings = new PageSettings(client, env);
    await listed(makeTools(settings));
    const { ids, folder } = await listed(makeTools(settings, { bridge: false }));
    expect(ids).toContain("test_plain");
    expect(folder).toMatchObject({ path: userDir, from: "page", page: expect.stringMatching(/^not read \(.*\); the page's folder as read before$/) });
  });

  it("use the default folder before any page read, and say so", async () => {
    const { ids, folder } = await listed(makeTools(new PageSettings(client, env), { bridge: false }));
    expect(ids).not.toContain("test_plain");
    expect(folder).toMatchObject({ path: path.join(tmp, "local", "LrC-AVG", "intents"), from: "default", page: expect.stringContaining("no page read yet") });
  });

  it("let LRC_AVG_INTENTS_DIR win over the page", async () => {
    lr.prefs = { ...defaultSimPrefs(), intents_dir: path.join(tmp, "elsewhere") };
    const { ids, folder } = await listed(makeTools(new PageSettings(client, { ...env, LRC_AVG_INTENTS_DIR: userDir })));
    expect(ids).toContain("test_plain");
    expect(folder).toMatchObject({ path: userDir, from: "environment" });
  });

  it("give up on a silent get_prefs within their wait, and keep the folder read before (Greptile, PR #44)", async () => {
    const settings = new PageSettings(client, env);
    await listed(makeTools(settings));
    plugin.handlers.set("get_prefs", () => "silent");
    const started = performance.now();
    const { ids, folder } = await listed(makeTools(settings));
    expect(performance.now() - started).toBeLessThan(PAGE_WAIT_MS + 500);
    expect(ids).toContain("test_plain");
    expect(folder).toMatchObject({ path: userDir, from: "page", page: expect.stringMatching(/^not read \(get_prefs failed \(timeout: .*\)\); the page's folder as read before$/) });
  });

  it("save into the page's folder", async () => {
    const tools = makeTools(new PageSettings(client, env));
    const saved = await tools.saveIntent({ intent: { id: "page_saved", label: "x", category: "test", brief: "b", priors: {} }, confirmed: true });
    expect(saved.json).toMatchObject({ path: path.join(userDir, "page_saved.json"), intents_folder: { from: "page" } });
  });
});

describe("sessions and the settings page's folders", () => {
  it("lr_begin_session finds its intent and writes its log in the page's folders, and lr_get_session_log of a new engine run reads it there", async () => {
    clean();
    const tools = makeTools(new PageSettings(client, env));
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const id = begun.json["session_id"] as string;
    expect(readdirSync(pageLogs).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(begun.json["session_settings"]).toMatchObject({ page: { read: true } });
    await tools.endSession({ session_id: id, outcome: "revert" });
    const out = await makeTools(new PageSettings(client, env)).getSessionLog({ session_id: id });
    expect(out.json).toMatchObject({ open: false, log: { session_id: id }, log_folder: { path: pageLogs, from: "page", page: "read now" } });
    expect(path.dirname(out.json["log_path"] as string)).toBe(pageLogs);
  });

  it("lr_sync_series looks for the recipe in the page's log folder", async () => {
    clean();
    const first = makeTools(new PageSettings(client, env));
    const begun = await first.beginSession({ intent_id: "test_plain", return_image: "none" });
    const id = begun.json["session_id"] as string;
    const ended = await first.endSession({ session_id: id, outcome: "accept" });
    expect(path.dirname(ended.json["recipe_path"] as string)).toBe(pageLogs);
    lr.copies.set("SIM-COPY-9", { uuid: "SIM-COPY-9", local_id: 109, copy_name: "Burst 9", settings: structuredClone(lr.settings) });
    // A new engine run: its folders are the defaults until it reads the page, which the sync does.
    const fresh = makeTools(new PageSettings(client, env));
    const out = await fresh.syncSeries({ source: { session_id: id }, targets: { uuids: ["SIM-COPY-9"] }, adaptive_exposure: false, return_image: "none" });
    expect(out.json).toMatchObject({ ok: true });
  });

  it("after the page's log folder changes, lr_sync_series, a recipe_path and lr_get_session_log still find a session in the folder it was written to (Greptile, PR #44)", async () => {
    clean();
    const first = makeTools(new PageSettings(client, env));
    const begun = await first.beginSession({ intent_id: "test_plain", return_image: "none" });
    const id = begun.json["session_id"] as string;
    const ended = await first.endSession({ session_id: id, outcome: "accept" });
    const recipe = ended.json["recipe_path"] as string;
    expect(known.list()).toEqual([path.resolve(pageLogs)]);
    const newer = path.join(tmp, "page-logs-2");
    lr.prefs = { ...defaultSimPrefs(), intents_dir: userDir, log_dir: newer };
    lr.copies.set("SIM-COPY-9", { uuid: "SIM-COPY-9", local_id: 109, copy_name: "Burst 9", settings: structuredClone(lr.settings) });
    // A new engine run (Claude Desktop restarted): the remembered folders come from the file.
    const fresh = makeTools(new PageSettings(client, env), { folders: new KnownLogFolders(path.join(tmp, "known", "log_folders.json")) });
    const bySession = await fresh.syncSeries({ source: { session_id: id }, targets: { uuids: ["SIM-COPY-9"] }, adaptive_exposure: false, return_image: "none" });
    expect(bySession.json).toMatchObject({ ok: true, source: { recipe_path: recipe } });
    const byPath = await fresh.syncSeries({ source: { recipe_path: recipe }, targets: { uuids: ["SIM-COPY-9"] }, adaptive_exposure: false, return_image: "none" });
    expect(byPath.json).toMatchObject({ ok: true });
    const log = await fresh.getSessionLog({ session_id: id });
    expect(path.dirname(log.json["log_path"] as string)).toBe(pageLogs);
    expect(log.json["log_folder"]).toMatchObject({ path: newer, from: "page" });
  });

  it("still refuses a recipe_path outside every log folder", async () => {
    clean();
    const tools = makeTools(new PageSettings(client, env));
    let code = "";
    try {
      await tools.syncSeries({ source: { recipe_path: path.join(tmp, "elsewhere", "x.recipe.json") }, targets: { uuids: ["SIM-UUID"] }, adaptive_exposure: false, return_image: "none" });
    } catch (err) {
      code = toToolError(err).code;
    }
    expect(code).toBe("RECIPE_PATH_REFUSED");
  });

  it("lr_sync_series without the remembered folders or the page's folder does not find the recipe (the checks above are not vacuous)", async () => {
    clean();
    const first = makeTools(new PageSettings(client, env), { folders: null });
    const begun = await first.beginSession({ intent_id: "test_plain", return_image: "none" });
    const id = begun.json["session_id"] as string;
    await first.endSession({ session_id: id, outcome: "accept" });
    lr.prefs = { ...defaultSimPrefs(), intents_dir: userDir, log_dir: "" };
    mkdirSync(path.join(tmp, "local", "LrC-AVG", "logs"), { recursive: true });
    const fresh = makeTools(new PageSettings(client, env), { folders: null });
    let code = "";
    try {
      await fresh.syncSeries({ source: { session_id: id }, targets: { uuids: ["SIM-UUID"] }, adaptive_exposure: false, return_image: "none" });
    } catch (err) {
      code = toToolError(err).code;
    }
    expect(code).toBe("RECIPE_NOT_FOUND");
    expect(existsSync(path.join(pageLogs))).toBe(true);
  });
});
