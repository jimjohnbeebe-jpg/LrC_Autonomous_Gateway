// Steps 6-9 of `npm run phase9:local` (phase9-local.ts): the 1.0.0 setup over a running 0.99.0, the
// uninstall with the data box unticked and then ticked, and putting Jim's development setup back.
// Steps 1-5 are in phase9-local-steps.ts.

import { existsSync } from "node:fs";
import path from "node:path";
import { KEPT_DATA } from "./cleanroom-scan.js";
import { pathsOf } from "./cleanroom-sys.js";
import { installChecks, installPaths, running, sayRunning } from "./phase9-local-checks.js";
import { reportStatus, setupPath } from "./phase9-local-steps.js";
import type { Ctx, Step } from "./phase9-local.js";

const SMARTSCREEN = 'If a blue box "Windows protected your PC" appears, click "More info", then "Run anyway".';

/** The Windows uninstall, numbered from `first`; the box decides whether the data goes too. */
const uninstallSteps = (box: "unticked" | "ticked", first: number): string[] =>
  [
    "Press the Windows key, type Installed apps, press Enter (Settings > Apps > Installed apps opens).",
    "Type LrC-AVG in the search box. Click the three dots at the right of LrC-AVG, then Uninstall, then Uninstall again.",
    `In the uninstaller window the box "Delete the application data" must be ${box.toUpperCase()}: ${box === "ticked" ? "click it so it shows a tick" : "do not tick it"}. Click Uninstall.`,
    "When it says it is finished, click Finish (or Close).",
  ].map((line, i) => `  ${first + i}. ${line}`);

/** The clean room's --verify-gone, shown and recorded as checks; returns whether it said GONE: YES. */
async function verifyGone(ctx: Ctx, expectDataGone: boolean): Promise<void> {
  const gone = await ctx.cleanroom("--verify-gone", expectDataGone);
  for (const c of gone.checks) ctx.check(`gone: ${c.check}`, c.ok, c.detail);
  ctx.check(gone.headline, gone.ok, expectDataGone ? "the data folders are gone too" : "only the kept data may stay");
}

export const upgradeStep: Step = {
  id: "upgrade",
  title: "install LrC-AVG 1.0.0 over the running 0.99.0 (Lightroom, Claude Desktop and the Deck stay open)",
  async run(ctx) {
    const ip = installPaths(ctx.sys);
    if (!existsSync(ip.deck)) {
      ctx.check("0.99.0 is installed", false, `${ip.deck} is missing: step 3 did not install it`);
      return { stop: true };
    }
    if (!running(ctx.sys.processes(), ip.node).deck) {
      ctx.startDetached(ip.deck);
      await ctx.sys.sleep(4000);
    }
    let before = running(ctx.sys.processes(), ip.node);
    for (let i = 0; i < 3 && !(before.lightroom && before.claudeDesktop && before.deck && before.engine); i++) {
      ctx.say(`  Not all of them are running: ${sayRunning(before)}.`);
      ctx.say("  Start what is missing: Lightroom Classic, or Claude Desktop (then send it the line from step 5 so it starts LrC-AVG). If the Deck is the one missing, start it from the Start menu (type LrC-AVG).");
      await ctx.pause("Start the missing ones.");
      before = running(ctx.sys.processes(), ip.node);
    }
    ctx.check("Lightroom, Claude Desktop, the Deck and the engine are all running before the upgrade", before.lightroom && before.claudeDesktop && before.deck && before.engine, sayRunning(before));
    ctx.say(`  1. Open File Explorer, go to ${path.join(ctx.repo, "release")} and double-click LrC-AVG-Setup-${ctx.version}.exe. ${SMARTSCREEN}`);
    ctx.say('  2. Answer the setup like this. A box "Please close: ..." with Retry, Ignore and Abort: click Ignore. A box "The LrC-AVG engine is running ...": click OK.');
    ctx.say("  3. A page about the version already installed (a maintenance page, or an offer to uninstall the old version first): keep what is selected and click Next or Install. If an uninstall window of the old version opens, leave \"Delete the application data\" unticked and click Uninstall. On the last page leave every box as it is, then click Finish.");
    await ctx.pause("Do the three steps, and wait until the wizard has closed.");
    await ctx.yn("Did the wizard finish without an error message?", "y");
    await ctx.yn("Did a box ask you to close Lightroom or Claude Desktop?");
    await ctx.yn('Did a box say "The LrC-AVG engine is running"?');
    await ctx.yn("Did the wizard show a page about the version that was already installed?");
    ctx.note(`After the upgrade: ${sayRunning(running(ctx.sys.processes(), ip.node))}`);
    installChecks(ctx, ctx.version, ["added", "unchanged"]);
    const restarted = new Date();
    ctx.say("  4. In Lightroom choose File > Exit, then start Lightroom again.");
    ctx.say("  5. Choose File > Plug-in Extras > LrC-AVG - Status. Click OK to close the dialog.");
    await ctx.pause("Do steps 4 and 5.");
    reportStatus(ctx, ip.status, ctx.version, restarted);
  },
};

export const uninstallKeepStep: Step = {
  id: "uninstall_keep",
  title: "uninstall with the data box UNticked",
  async run(ctx) {
    ctx.say("  1. Quit Lightroom (File > Exit) and Claude Desktop (right-click the Claude icon in the system tray > Quit).");
    for (const line of uninstallSteps("unticked", 2)) ctx.say(line);
    await ctx.pause("Do the steps, and wait until the uninstaller has closed.");
    await ctx.yn('Did the uninstaller window have a box "Delete the application data"?', "y");
    await ctx.yn("Did the uninstaller ask to close a program that was running?");
    await verifyGone(ctx, false);
    const kept = KEPT_DATA.filter((n) => existsSync(path.join(pathsOf(ctx.sys).install, n)));
    ctx.check("the data stays when the box is unticked", kept.length > 0, kept.length > 0 ? `kept: ${kept.join(", ")}` : "nothing of logs, intents, last-start.json, setup-result.json, status.txt is left");
  },
};

export const reinstallClearStep: Step = {
  id: "reinstall_clear",
  title: "reinstall 1.0.0 silently, then uninstall with the data box TICKED",
  async run(ctx) {
    const status = ctx.exec("npm run setup:install");
    ctx.check("npm run setup:install installed LrC-AVG silently (INSTALLED: YES)", status === 0, `exit code ${status}`);
    if (status !== 0) return { stop: true };
    installChecks(ctx, ctx.version, ["added"]);
    ctx.say("  Do not start Lightroom or Claude Desktop now.");
    for (const line of uninstallSteps("ticked", 1)) ctx.say(line);
    await ctx.pause("Do the steps, and wait until the uninstaller has closed.");
    await verifyGone(ctx, true);
  },
};

export const restoreStep: Step = {
  id: "restore",
  title: "put your development setup back",
  async run(ctx) {
    const parkFile = pathsOf(ctx.sys).parkFile;
    for (let i = 0; i < 3; i++) {
      const run = await ctx.cleanroom("--restore");
      ctx.say(`  ${run.headline}`);
      for (const line of [...run.actions, ...run.messages]) ctx.say(`    ${line}`);
      if (run.ok || i === 2 || !existsSync(parkFile)) break;
      await ctx.pause("Fix what is listed above first (if LrC-AVG is still installed, uninstall it in Settings > Apps > Installed apps; if no built Deck installer was found, run npm run deck:build in a second PowerShell window in this folder), then retry: this step runs the restore again.");
    }
    const back = !existsSync(parkFile);
    ctx.check("RESTORED: YES", back, back ? "everything parked is back" : `${parkFile} is still there: run npm run cleanroom -- --restore`);
    if (!back) return { stop: true };
    ctx.say("  1. Start Lightroom Classic. Choose File > Plug-in Manager.");
    ctx.say('  2. If "LrC-AVG (dev)" is in the list on the left: select it and click Enable (under Status, on the right).');
    ctx.say("     If it is not in the list: click Add (bottom left), pick the folder below (type it in the File name box, press Enter, then click Add Plug-in):");
    ctx.say(`       ${path.join(ctx.repo, "plugin", "LrC-AVG.lrplugin")}`);
    ctx.say("  3. Click Done. Start Claude Desktop again when you want it: its LrC-AVG entry is back.");
    await ctx.pause("Do the three steps.");
    await ctx.yn('Does the Plug-in Manager list "LrC-AVG (dev)" with "Installed and running"?', "y");
  },
};
