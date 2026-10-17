// The Phase 9 local-install check (src/devtools/phase9-local*.ts): the state machine, the runner on fake
// steps, and the judgements on a fake Windows account in a temp folder. Nothing real is read or written,
// and no window is opened.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sys } from "../src/devtools/cleanroom-sys.js";
import { entryProblem, installChecks, listFiles, newestLastStart, running, statusProblems, treeDiff } from "../src/devtools/phase9-local-checks.js";
import { headlineOf, localStateSchema, nextStep, newState, recordStep, stateToContinue, STEP_IDS, type LocalState, type StepId } from "../src/devtools/phase9-local-state.js";
import { runLocal, type Ctx, type LocalDeps, type Step } from "../src/devtools/phase9-local.js";

let root: string;
const at = (...p: string[]) => path.join(root, ...p);
const put = (file: string, text = "x") => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, text));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "p9local-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeSys(keys: string[] = []): Sys {
  return {
    env: { LOCALAPPDATA: at("Local"), APPDATA: at("Roaming"), TEMP: at("Temp") },
    home: at("home"),
    repo: at("repo"),
    uninstallKeys: () => keys.map((k) => ({ key: k, displayName: k, installLocation: null, uninstallString: null, mainBinary: null })),
    processes: () => [],
    claude: () => ({ status: 0, output: "" }),
    run: () => 0,
    exeVersion: () => "1.0.0",
    sleep: async () => {},
    now: () => new Date(),
  };
}

const rec = (id: StepId, over: Partial<LocalState["steps"][number]> = {}): LocalState["steps"][number] => ({ id, at: "t", ok: true, stopped: false, checks: [], answers: [], notes: [], ...over });

describe("phase9:local state", () => {
  it("starts at build and goes in order; a stopped step is the next one again", () => {
    const s = newState("t0");
    expect(nextStep(s)).toBe("build");
    recordStep(s, rec("build"));
    recordStep(s, rec("park", { ok: false, stopped: true }));
    expect(nextStep(s)).toBe("park");
    recordStep(s, rec("park"));
    expect(nextStep(s)).toBe("install");
  });

  it("skips a step that failed without stopping, and finishes when every step is recorded", () => {
    const s = newState("t0");
    for (const id of STEP_IDS) recordStep(s, rec(id, id === "chat" ? { ok: false } : {}));
    expect(nextStep(s)).toBeNull();
    expect(headlineOf(s, false)).toEqual({ headline: "FAILED", putBack: true });
  });

  it("says NOT FINISHED, and put back NO while park.json is there or the restore step failed", () => {
    const s = newState("t0");
    recordStep(s, rec("build"));
    expect(headlineOf(s, true)).toEqual({ headline: "NOT FINISHED", putBack: false });
    for (const id of STEP_IDS) recordStep(s, rec(id, id === "restore" ? { ok: false } : {}));
    expect(headlineOf(s, false)).toEqual({ headline: "FAILED", putBack: false });
  });

  it("continues an unfinished state, but not a finished one or with --new", () => {
    const saved = { ...newState("t0"), steps: [rec("build")] };
    expect(stateToContinue(saved, "t1", false)).toEqual({ state: saved, resumed: true });
    expect(stateToContinue(saved, "t1", true).resumed).toBe(false);
    expect(stateToContinue({ ...saved, finished: true }, "t1", false).state.steps).toEqual([]);
    expect(stateToContinue(null, "t1", false).state.started_at).toBe("t1");
  });

  it("round-trips through its schema and rejects a bad answer", () => {
    const s = newState("t0");
    recordStep(s, rec("build", { answers: [{ question: "q", answer: "y", expected: "y" }] }));
    expect(localStateSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(() => localStateSchema.parse({ ...s, steps: [rec("build", { answers: [{ question: "q", answer: "maybe", expected: null } as never] })] })).toThrow();
  });
});

describe("phase9:local runner", () => {
  function harness(steps: Partial<Record<StepId, Step["run"]>>, answers: ("y" | "n" | "no answer")[] = [], store: { state: LocalState | null } = { state: null }) {
    const order: string[] = [];
    const said: string[] = [];
    const all: Step[] = STEP_IDS.map((id) => ({
      id,
      title: id,
      run: async (ctx: Ctx) => {
        order.push(id);
        return steps[id]?.(ctx);
      },
    }));
    const deps: LocalDeps = {
      sys: fakeSys(),
      repo: at("repo"),
      version: "1.0.0",
      testVersion: "0.99.0",
      say: (l) => said.push(l),
      prompt: async () => "",
      ask: async () => answers.shift() ?? "y",
      cleanroom: async () => {
        throw new Error("not used");
      },
      exec: () => 0,
      startDetached: () => {},
      load: () => (store.state ? (JSON.parse(JSON.stringify(store.state)) as LocalState) : null),
      save: (s) => {
        store.state = JSON.parse(JSON.stringify(s)) as LocalState;
      },
      stamp: "s1",
    };
    return { all, deps, order, said, store };
  }

  it("runs the nine steps in order and says WORKED, put back YES", async () => {
    const h = harness({});
    const out = await runLocal(h.deps, h.all);
    expect(h.order).toEqual([...STEP_IDS]);
    expect(out).toMatchObject({ headline: "WORKED", putBack: true, finished: true });
    expect(h.said.join("\n")).toContain("Phase 9 local install: WORKED");
  });

  it("goes on after a failed check and says FAILED at the end", async () => {
    const h = harness({ chat: async (ctx) => void ctx.check("a thing", false, "it was wrong") });
    const out = await runLocal(h.deps, h.all);
    expect(h.order).toHaveLength(STEP_IDS.length);
    expect(out.headline).toBe("FAILED");
    expect(h.said.join("\n")).toContain("FAILED: a thing");
  });

  it("ends the run at a step that stops, and the next run continues there without redoing earlier steps", async () => {
    let stop = true;
    const store = { state: null as LocalState | null };
    const h1 = harness({ install: async () => (stop ? { stop: true } : undefined) }, [], store);
    const out1 = await runLocal(h1.deps, h1.all);
    expect(h1.order).toEqual(["build", "park", "install"]);
    expect(out1).toMatchObject({ headline: "NOT FINISHED", finished: false });
    stop = false;
    const h2 = harness({ install: async () => (stop ? { stop: true } : undefined) }, [], store);
    const out2 = await runLocal(h2.deps, h2.all);
    expect(h2.order).toEqual(STEP_IDS.slice(2));
    expect(out2).toMatchObject({ headline: "WORKED", finished: true });
    expect(store.state?.runs).toEqual(["s1", "s1"]);
  });

  it("records a thrown error as a failed check and stops", async () => {
    const h = harness({
      park: async () => {
        throw new Error("boom");
      },
    });
    const out = await runLocal(h.deps, h.all);
    expect(h.order).toEqual(["build", "park"]);
    expect(out.headline).toBe("NOT FINISHED");
    const park = (out.results["state"] as LocalState).steps.find((s) => s.id === "park");
    expect(park).toMatchObject({ ok: false, stopped: true });
    expect(park?.checks[0]).toMatchObject({ check: "the step ran to the end", ok: false, detail: "boom" });
  });

  it("turns an expected y/n answer into a check, keeps an open question as an answer, and stops when the input closes", async () => {
    const h = harness(
      {
        install: async (ctx) => {
          await ctx.yn("expected yes?", "y");
          await ctx.yn("open question?");
        },
        lightroom: async (ctx) => {
          await ctx.yn("expected yes again?", "y");
        },
      },
      ["n", "y", "no answer"],
    );
    const out = await runLocal(h.deps, h.all);
    const steps = (out.results["state"] as LocalState).steps;
    const install = steps.find((s) => s.id === "install");
    expect(install?.ok).toBe(false);
    expect(install?.checks).toEqual([{ check: "expected yes?", ok: false, detail: "you answered n, expected y" }]);
    expect(install?.answers.map((a) => [a.answer, a.expected])).toEqual([["n", "y"], ["y", null]]);
    expect(steps.find((s) => s.id === "lightroom")).toMatchObject({ stopped: true });
    expect(out.headline).toBe("NOT FINISHED");
  });

  it("says put back NO while park.json is there", async () => {
    put(at("Temp", "LrC-AVG-cleanroom", "park.json"), "{}");
    const h = harness({});
    const out = await runLocal(h.deps, h.all);
    expect(out.putBack).toBe(false);
  });
});

describe("phase9:local checks", () => {
  it("treeDiff lists what only one side has, ignoring case", () => {
    expect(treeDiff(["a/B.js", "x.txt"], ["a/b.js", "y.txt"])).toEqual({ missing: ["y.txt"], extra: ["x.txt"] });
  });

  it("listFiles walks a folder, sorted, with forward slashes", () => {
    put(at("t", "b", "2.txt"));
    put(at("t", "a.txt"));
    expect(listFiles(at("t"))).toEqual(["a.txt", "b/2.txt"]);
    expect(listFiles(at("none"))).toEqual([]);
  });

  it("entryProblem accepts the bundled node and engine, in any letter case, and names what is wrong", () => {
    const node = "C:\\Users\\a\\AppData\\Local\\LrC-AVG\\resources\\node\\node.exe";
    const main = "C:\\Users\\a\\AppData\\Local\\LrC-AVG\\resources\\engine\\dist\\mcp\\main.js";
    const cfg = (command: string, args: string[]) => ({ mcpServers: { "lrc-avg": { command, args }, other: { command: "x" } } });
    expect(entryProblem(cfg(node.toUpperCase(), [main]), node, main)).toBeNull();
    expect(entryProblem(cfg("C:\\Program Files\\nodejs\\node.exe", [main]), node, main)).toContain("command is");
    expect(entryProblem(cfg(node, ["D:\\dev\\main.js"]), node, main)).toContain("args[0]");
    expect(entryProblem({ mcpServers: {} }, node, main)).toContain("no lrc-avg entry");
    expect(entryProblem({}, node, main)).toContain("no mcpServers");
  });

  it("statusProblems accepts the Status dialog's text and names each problem", () => {
    const ok = "LrC-AVG status: READY\n\nPlugin: 1.0.0, loaded from C:\\x (Modules (installed))\nEngine: 1.0.0\n";
    expect(statusProblems(ok, "1.0.0")).toEqual([]);
    expect(statusProblems(ok.replace("READY", "BRIDGE NOT RUNNING"), "1.0.0")).toEqual(["the bridge is not running"]);
    expect(statusProblems(ok.replace("READY", "RESTART LIGHTROOM TO FINISH THE UPDATE"), "1.0.0")).toEqual(["the Status dialog asks for a Lightroom restart"]);
    expect(statusProblems(ok.replace("Modules (installed)", "added in Plug-in Manager").replace("1.0.0,", "0.9.0,"), "1.0.0")).toHaveLength(2);
    expect(statusProblems("nothing", "1.0.0")[0]).toContain("not a status headline");
  });

  it("running tells Claude Desktop from Claude Code by path, and the product's engine from other node processes", () => {
    const node = "C:\\L\\LrC-AVG\\resources\\node\\node.exe";
    const procs = [
      { name: "claude", path: "C:\\Users\\a\\.local\\bin\\claude.exe" },
      { name: "node", path: "C:\\Program Files\\nodejs\\node.exe" },
      { name: "Lightroom", path: null },
    ];
    expect(running(procs, node)).toEqual({ lightroom: true, claudeDesktop: false, deck: false, engine: false });
    const all = [...procs, { name: "claude", path: "C:\\Program Files\\WindowsApps\\Claude_2.4_x64__abc\\app\\Claude.exe" }, { name: "node", path: node.toLowerCase() }, { name: "LrC-AVG Deck", path: null }];
    expect(running(all, node)).toEqual({ lightroom: true, claudeDesktop: true, deck: true, engine: true });
  });

  it("newestLastStart takes the newest record at or after the step, also from the Store Claude Desktop's copy", () => {
    const rec = (time: string, name: string) => JSON.stringify({ time, engine_version: "1.0.0", client_name: name, client_version: "1", exec_path: "n", main_js: "m" });
    put(at("Local", "LrC-AVG", "last-start.json"), rec("2026-10-17T10:00:00.000Z", "old"));
    put(at("Local", "Packages", "Claude_abc", "LocalCache", "Local", "LrC-AVG", "last-start.json"), rec("2026-10-17T12:00:00.000Z", "claude-ai"));
    const sys = fakeSys();
    expect(newestLastStart(sys, new Date("2026-10-17T11:00:00.000Z"))?.start.client_name).toBe("claude-ai");
    expect(newestLastStart(sys, new Date("2026-10-17T13:00:00.000Z"))).toBeNull();
  });

  it("installChecks passes a good install and catches a stale file in resources\\", () => {
    const sys = fakeSys(["LrC-AVG"]);
    const inst = at("Local", "LrC-AVG");
    const files = ["LrC-AVG Deck.exe", "uninstall.exe", "resources/node/node.exe", "resources/engine/dist/mcp/main.js", "resources/engine/dist/setup/setup-cli.js", "resources/plugin/LrC-AVG.lrplugin/Info.lua", "resources/THIRD_PARTY_NOTICES.txt", "resources/LICENSE.txt"];
    for (const f of files) {
      put(path.join(inst, f), "x");
      if (f.startsWith("resources/")) put(at("repo", "build", "setup", f), "x");
    }
    put(at("Roaming", "Adobe", "Lightroom", "Modules", "LrC-AVG.lrplugin", "Info.lua"), "x");
    const nodeExe = path.join(inst, "resources", "node", "node.exe");
    const mainJs = path.join(inst, "resources", "engine", "dist", "mcp", "main.js");
    const config = at("Local", "Claude-Data", "claude_x", "claude_desktop_config.json");
    put(config, JSON.stringify({ mcpServers: { "lrc-avg": { command: nodeExe, args: [mainJs] } } }));
    const now = new Date();
    put(path.join(inst, "setup-result.json"), JSON.stringify({ time: now.toISOString(), version: "1.0.0", action: "add", outcome: "added", config_path: config, message: "ok" }));
    const run = (): { failed: string[] } => {
      const failed: string[] = [];
      const ctx = { sys, version: "1.0.0", since: new Date(now.getTime() - 1000), check: (n: string, ok: boolean) => (ok || failed.push(n), ok), note: () => {} } as unknown as Ctx;
      installChecks(ctx, "1.0.0", ["added"]);
      return { failed };
    };
    expect(run().failed).toEqual([]);
    put(path.join(inst, "resources", "engine", "dist", "old-file.js"), "stale");
    expect(run().failed).toEqual(["resources\\ holds exactly the staged files (none missing, none stale)"]);
  });
});
