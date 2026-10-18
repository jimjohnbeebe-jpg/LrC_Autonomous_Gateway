// `npm run phase9:local -- --download` (Phase 9 PR 3, run 2; report docs\reports\phase9\PHASE9.md): the
// setup that GitHub's release workflow built, downloaded by Jim in his browser, in place of the local
// build. These two steps replace `build` and `install` (phase9-local-steps.ts); park, lightroom, chat,
// uninstall_keep and restore run as in run 1, and the upgrade steps are skipped (run 1 covered them:
// docs\reports\phase9\local-install.md).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installChecks, installPaths } from "./phase9-local-checks.js";
import type { Ctx, Step } from "./phase9-local.js";

export const RELEASE_URL = "https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/releases";
export const downloadsDir = (): string => path.join(os.homedir(), "Downloads");
export const downloadedSetup = (dir: string, version: string): string => path.join(dir, `LrC-AVG-Setup-${version}.exe`);

/**
 * The Mark of the Web: the ZoneId in the file's Zone.Identifier stream (3 = Internet), or null without one.
 * SmartScreen checks only files that carry it [inference: PHASE9_PLAN "How to apply", a local build showed no prompt in run 1].
 */
export function zoneId(file: string): number | null {
  try {
    const m = /^ZoneId=(\d+)/m.exec(readFileSync(`${file}:Zone.Identifier`, "utf8"));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** The SHA-256 that a sha256sum-format SHA256SUMS.txt gives for `name` (tools\setup\build.ts), or null. */
export function listedSha256(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1] ?? null;
  }
  return null;
}

export const fileSha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

export const downloadStep: Step = {
  id: "build",
  title: "download the setup from GitHub (in your browser)",
  async run(ctx) {
    const dir = downloadsDir();
    const setup = downloadedSetup(dir, ctx.version);
    const sumsFile = path.join(dir, "SHA256SUMS.txt");
    ctx.say(`  1. In Microsoft Edge (or your usual browser), open ${RELEASE_URL} and click "LrC-AVG v${ctx.version}-rc.1".`);
    ctx.say(`  2. Under "Assets", click LrC-AVG-Setup-${ctx.version}.exe, then SHA256SUMS.txt. Both go to your Downloads folder.`);
    // Edge's wording for an unsigned download is [unverified]: no download from the release has been made yet.
    ctx.say('  3. If the browser warns that the file "isn\'t commonly downloaded" or could harm your device, choose Keep (in Edge: the three dots next to the file > Keep > Show more > Keep anyway).');
    ctx.say(`  Do not open the setup yet. If an older LrC-AVG-Setup-${ctx.version}.exe or SHA256SUMS.txt is already in Downloads, delete it first, so the browser does not add " (1)" to the new name.`);
    await ctx.pause("Download the two files.");
    if (!ctx.check(`${path.basename(setup)} is in Downloads`, existsSync(setup), setup)) return { stop: true };
    const zone = zoneId(setup);
    ctx.check("the setup carries the Mark of the Web (downloaded from the internet)", zone === 3, zone === null ? "no Zone.Identifier stream: SmartScreen will not check it" : `ZoneId=${zone}, expected 3`);
    const listed = existsSync(sumsFile) ? listedSha256(readFileSync(sumsFile, "utf8"), path.basename(setup)) : null;
    const got = fileSha256(setup);
    // A bad or missing sum stops here, so the next run checks the new download before the install step.
    if (!ctx.check("its SHA-256 matches SHA256SUMS.txt", listed === got, listed === null ? `${sumsFile} is missing or does not list the setup` : `file ${got}, listed ${listed}`)) return { stop: true };
  },
};

export const downloadInstallStep: Step = {
  id: "install",
  title: "install LrC-AVG from the downloaded setup",
  async run(ctx) {
    ctx.say(`  1. Open File Explorer, go to ${downloadsDir()} and double-click LrC-AVG-Setup-${ctx.version}.exe.`);
    ctx.say('  2. A blue box "Windows protected your PC" should appear. Click "More info", then "Run anyway".');
    ctx.say("  3. Click through the wizard with the defaults. On the last page leave every box as it is, then click Finish.");
    await ctx.pause("Do the three steps, and wait until the wizard has closed.");
    await ctx.yn('Did the blue box "Windows protected your PC" appear?', "y");
    await ctx.yn('After "More info", did "Run anyway" start the wizard?', "y");
    await ctx.yn("Did the wizard finish without an error message?", "y");
    installChecks(ctx, ctx.version, ["added"]);
    return existsSync(installPaths(ctx.sys).uninstall) ? undefined : { stop: true };
  },
};
