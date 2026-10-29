// The judging part of `npm run presets:msix` (issue #182): where did the preset that Claude Desktop's engine saved land,
// in Lightroom's real preset folder or in the Claude package's private copy? The disk work is presets-msix-cli.ts.
// Mechanism: new files a packaged (MSIX) app creates under AppData\Roaming go to
// %LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming [handle:
// https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes, "Common file system
// operations"; observed for AppData\Local in docs\reports\phase8.5\issue108\msix-intents-folder.txt:23-30]. Whether
// it happens to the preset folder is what this check finds out.

import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";

export type Place = { kind: "real" | "package"; dir: string; exists: boolean; files: string[] };
export type Verdict = { where: "REDIRECTED" | "NOT REDIRECTED" | "IN BOTH" | "NOT FOUND"; found: boolean; detail: string };

/** A preset name no earlier run used: "AVG msix check <6 hex>". */
export const presetName = (hex: string = randomBytes(3).toString("hex")): string => `AVG msix check ${hex}`;

/** What Jim pastes into a new Claude Desktop chat. */
export const chatPrompt = (name: string): string =>
  `Use lr_create_preset_from_active to save the selected photo's settings as a Develop preset named "${name}" (default group). ` +
  "I approve it. Then show me the file path from the result.";

/** Lightroom's real preset folder and every Claude package's private copy of it (dirs only; scanning is the CLI's). */
export function presetFolders(env: NodeJS.ProcessEnv): Array<{ kind: Place["kind"]; dir: string }> {
  const out: Array<{ kind: Place["kind"]; dir: string }> = [];
  const appData = env["APPDATA"];
  if (appData) out.push({ kind: "real", dir: path.join(appData, "Adobe", "CameraRaw", "Settings") });
  const local = env["LOCALAPPDATA"];
  if (!local) return out;
  try {
    for (const pkg of readdirSync(path.join(local, "Packages")).filter((n) => n.toLowerCase().startsWith("claude_")).sort()) {
      out.push({ kind: "package", dir: path.join(local, "Packages", pkg, "LocalCache", "Roaming", "Adobe", "CameraRaw", "Settings") });
    }
  } catch {
    // no Packages folder: Claude Desktop is not the Microsoft Store build
  }
  return out;
}

/** Where the preset is, from the scanned places. */
export function judge(places: Place[], name: string): Verdict {
  const inReal = places.filter((p) => p.kind === "real" && p.files.length > 0);
  const inPkg = places.filter((p) => p.kind === "package" && p.files.length > 0);
  const list = (ps: Place[]): string => ps.flatMap((p) => p.files.map((f) => path.join(p.dir, f))).join("; ");
  if (inReal.length > 0 && inPkg.length > 0) return { where: "IN BOTH", found: true, detail: `"${name}" is in Lightroom's folder and in a Claude package: ${list([...inReal, ...inPkg])}` };
  if (inPkg.length > 0) return { where: "REDIRECTED", found: true, detail: `"${name}" is only inside the Claude package, where Lightroom does not look: ${list(inPkg)}` };
  if (inReal.length > 0) return { where: "NOT REDIRECTED", found: true, detail: `"${name}" is in Lightroom's own preset folder: ${list(inReal)}` };
  return { where: "NOT FOUND", found: false, detail: `"${name}" is in none of: ${places.map((p) => p.dir).join("; ")}` };
}
