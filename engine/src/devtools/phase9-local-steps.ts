// Steps 1-5 of `npm run phase9:local` (phase9-local.ts): build the two setups, park the development setup,
// install 0.99.0 with its wizard, look at it in Lightroom, start it from Claude Desktop. Steps 6-9 are
// in phase9-local-upgrade.ts. Every instruction Jim reads is printed here, word for word (rule 04
// "Steps for Jim": exact menu paths, what he should see, no optional steps).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blockers, pathsOf } from "./cleanroom-sys.js";
import { PLUGIN_STEP, prefsNaming } from "./cleanroom-scan.js";
import { installChecks, installPaths, mtimeMs, newestLastStart, statusProblems } from "./phase9-local-checks.js";
import type { Ctx, Step } from "./phase9-local.js";

const settingsPath = "Settings > Apps > Installed apps";
export const setupPath = (repo: string, version: string): string => path.join(repo, "release", `LrC-AVG-Setup-${version}.exe`);

/** The wizard's SmartScreen line, for the local build (unsigned; PR 2 signs the release). */
const SMARTSCREEN = 'If a blue box "Windows protected your PC" appears, click "More info", then "Run anyway".';

/** Setups in release\ other than `keep`, copied aside: `npm run setup:build` clears release\ of every earlier setup (tools\setup\build.ts). */
function stashSetups(repo: string): string[] {
  const release = path.join(repo, "release");
  const stash = path.join(repo, "build", "cache", "phase9-setups");
  mkdirSync(stash, { recursive: true });
  const names = existsSync(release) ? readdirSync(release).filter((f) => /^LrC-AVG-Setup-.*\.exe$/.test(f)) : [];
  for (const n of names) copyFileSync(path.join(release, n), path.join(stash, n));
  return names;
}

function unstashSetups(repo: string, names: readonly string[]): void {
  for (const n of names) {
    const back = path.join(repo, "release", n);
    if (!existsSync(back)) copyFileSync(path.join(repo, "build", "cache", "phase9-setups", n), back);
  }
}

export const buildStep: Step = {
  id: "build",
  title: "build the two local setups (nothing for you to do; the first build takes several minutes)",
  async run(ctx) {
    for (const v of [ctx.testVersion, ctx.version]) {
      const target = setupPath(ctx.repo, v);
      if (existsSync(target)) {
        ctx.check(`release\\LrC-AVG-Setup-${v}.exe exists`, true, `${(statSync(target).size / 1e6).toFixed(0)} MB, already built`);
        continue;
      }
      const kept = stashSetups(ctx.repo);
      ctx.say(`Building the ${v} setup ...`);
      const status = ctx.exec(v === ctx.version ? "npm run setup:build" : `npm run setup:build -- --version ${v}`);
      unstashSetups(ctx.repo, kept);
      const built = existsSync(target);
      ctx.check(`release\\LrC-AVG-Setup-${v}.exe was built`, status === 0 && built, status === 0 ? (built ? "unsigned" : "the build ended but the file is missing") : `npm run setup:build exited ${status}`);
      if (!built) return { stop: true };
    }
    if (ctx.testVersion !== ctx.version) ctx.note(`The ${ctx.testVersion} setup carries the same engine and plugin as ${ctx.version}; only the Deck and the setup are numbered ${ctx.testVersion}, so the upgrade in step 6 replaces the Deck and the setup's own files [handle: tools\\setup\\build.ts, --version changes only the Tauri version overlay].`);
  },
};

export const parkStep: Step = {
  id: "park",
  title: "move your development setup aside",
  async run(ctx) {
    const parkFile = pathsOf(ctx.sys).parkFile;
    if (existsSync(parkFile)) ctx.note(`Already parked (${parkFile}): checking that nothing LrC-AVG is left.`);
    // The dev plugin goes first: removing it means starting Lightroom, which loads it once more and writes
    // its bridge files into the data folders; after a park those come back as left-over data.
    for (let i = 0; i < 4 && !existsSync(parkFile) && prefsNaming(pathsOf(ctx.sys)).length > 0; i++) {
      await ctx.pause(`Before anything is moved, do this: ${PLUGIN_STEP.replace(/, then run .*$/, "")}.`);
    }
    if (!existsSync(parkFile) && prefsNaming(pathsOf(ctx.sys)).length > 0) {
      ctx.check("the dev plugin is removed in Plug-in Manager", false, "Lightroom still lists it as installed");
      return { stop: true };
    }
    for (let i = 0; i < 5 && blockers(ctx.sys).length > 0; i++) {
      ctx.say(`Quit these first: ${blockers(ctx.sys).join(" and ")}.`);
      await ctx.pause("Lightroom: File > Exit. Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > Quit.");
    }
    if (blockers(ctx.sys).length > 0) {
      ctx.check("Lightroom and Claude Desktop are quit", false, blockers(ctx.sys).join(" and "));
      return { stop: true };
    }
    if (!existsSync(parkFile)) {
      const park = await ctx.cleanroom("--park");
      printClean(ctx, park.headline, park.actions, park.messages);
      if (!park.ok && park.checks.length === 0) {
        ctx.check("the clean room parked the development setup", false, park.messages.join(" "));
        return { stop: true };
      }
    }
    for (let i = 0; i < 4; i++) {
      const status = await ctx.cleanroom("--status");
      for (const c of status.checks) ctx.say(`    [${c.ok ? "ok" : "LEFT"}] ${c.check}: ${c.detail}`);
      if (status.ok) {
        ctx.check("CLEAN: YES", true, "nothing LrC-AVG is left in this Windows account");
        return;
      }
      await ctx.pause(`Do this now: ${PLUGIN_STEP.replace(/, then run .*$/, "")}.`);
    }
    ctx.check("CLEAN: YES", false, "see the [LEFT] lines above");
    return { stop: true };
  },
};

function printClean(ctx: Ctx, headline: string, actions: string[], messages: string[]): void {
  ctx.say(`  ${headline}`);
  for (const a of [...actions, ...messages]) ctx.say(`    ${a}`);
}

export const installStep: Step = {
  id: "install",
  title: "install LrC-AVG 0.99.0 with its wizard",
  async run(ctx) {
    ctx.say("  1. Open File Explorer and go to D:\\Developer\\LrC_Autonomous_Gateway\\release (type that in the address bar, press Enter).");
    ctx.say(`  2. Double-click LrC-AVG-Setup-${ctx.testVersion}.exe. ${SMARTSCREEN}`);
    ctx.say("  3. Click through the wizard with the defaults. On the last page leave every box as it is, then click Finish.");
    await ctx.pause("Do the three steps, and wait until the wizard has closed.");
    await ctx.yn("Did the wizard finish without an error message?", "y");
    await ctx.yn("Did a message box tell you what happened to Claude Desktop's config (the setup's own message box)?");
    await ctx.yn("Did the wizard's last page have a box to run LrC-AVG (or the Deck) now?");
    installChecks(ctx, ctx.testVersion, ["added"]);
    return existsSync(installPaths(ctx.sys).uninstall) ? undefined : { stop: true };
  },
};

export const lightroomStep: Step = {
  id: "lightroom",
  title: "Lightroom lists the plugin and its Status dialog works",
  async run(ctx) {
    const ip = installPaths(ctx.sys);
    ctx.say("  1. Start Lightroom Classic.");
    ctx.say("  2. Choose File > Plug-in Manager. In the list on the left, click LrC-AVG.");
    await ctx.pause("Do steps 1 and 2.");
    await ctx.yn("Is LrC-AVG listed in the Plug-in Manager's list on the left?", "y");
    await ctx.yn('Does it show a green dot and "Installed and running" under Status on the right (and no "Enable" button)?', "y");
    ctx.say("  3. Click Done. Choose File > Plug-in Extras > LrC-AVG - Status. A dialog opens. Click OK to close it.");
    await ctx.pause("Do step 3.");
    reportStatus(ctx, ip.status, ctx.version);
  },
};

/** Reads status.txt (written by the Status dialog) and checks it; the headline is shown to Jim. */
export function reportStatus(ctx: Ctx, file: string, version: string, since: Date = ctx.since): void {
  if (mtimeMs(file) < since.getTime() - 2000) {
    ctx.check("the Status dialog wrote status.txt", false, `${file} ${existsSync(file) ? "is older than this step" : "is missing"}: did the menu item open a dialog?`);
    return;
  }
  const text = readFileSync(file, "utf8");
  ctx.note(`Status headline: ${text.split(/\r?\n/)[0] ?? ""}`);
  const problems = statusProblems(text, version);
  ctx.check("the Status dialog's text is right", problems.length === 0, problems.join("; ") || file);
}

export const chatStep: Step = {
  id: "chat",
  title: "Claude Desktop starts LrC-AVG and makes one call",
  async run(ctx) {
    ctx.say("  1. In Lightroom, click one photo so it is selected (Library grid or Develop).");
    ctx.say("  2. Start Claude Desktop. It must be started now, not before: it starts LrC-AVG only when it opens.");
    ctx.say("  3. Open a new chat and send exactly this line:");
    ctx.say("       Use LrC-AVG to describe the photo that is selected in Lightroom. Do not change anything.");
    ctx.say('  4. If Claude asks permission to use an LrC-AVG tool, click "Allow once" (or "Always allow"). Wait until Claude has answered.');
    await ctx.pause("Do the four steps.");
    await ctx.yn("Did Claude answer with a description of the selected photo (not an error)?", "y");
    const found = newestLastStart(ctx.sys, ctx.since);
    if (!found) {
      ctx.check("the engine wrote last-start.json for this step", false, "no last-start.json newer than this step: was Claude Desktop already running when the step began? Quit it (tray > Quit), start it, and run the command again");
      return;
    }
    const s = found.start;
    ctx.check("the client that started the engine is Claude Desktop", /claude/i.test(s.client_name ?? ""), `client ${s.client_name ?? "(none)"} ${s.client_version ?? ""} [${found.file}]`);
    ctx.check("the engine is the product's version", s.engine_version === ctx.version, `${s.engine_version}, expected ${ctx.version}`);
    ctx.check("Claude Desktop ran the bundled Node and engine", s.exec_path.toLowerCase() === installPaths(ctx.sys).node.toLowerCase() && s.main_js.toLowerCase() === installPaths(ctx.sys).mainJs.toLowerCase(), `${s.exec_path} ${s.main_js}`);
  },
};
