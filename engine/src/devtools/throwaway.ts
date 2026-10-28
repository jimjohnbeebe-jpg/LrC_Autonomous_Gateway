// The throwaway-catalog guard of the live checks (GitHub issue #213 item 3, modelled on Automaat's
// requireThrowawayCatalog [upstream claim: Automaat/lightroom-mcp tests/e2e/live/README.md "Safety rules"]).
// `npm run catalog:throwaway` (throwaway-cli.ts) writes MARKER beside the open catalog once Jim says it is a
// throwaway one; the checks that write to photos refuse any other catalog unless `-- --i-know` is passed.
// The open catalog comes from the plugin's hello (`catalog_path`, catalog:getPath(), Bridge.lua).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate } from "../mcp/index.js";
import { describeError } from "./phase1-check.js";

export const MARKER = "lrc-avg-throwaway.json";
export const I_KNOW = "--i-know";

export const markerPath = (catalogPath: string): string => path.join(path.dirname(catalogPath), MARKER);

/** Whether the marker beside `catalogPath` names that catalog file (a folder may hold more than one catalog). */
export function isMarked(catalogPath: string): boolean {
  const file = markerPath(catalogPath);
  if (!existsSync(file)) return false;
  try {
    const marker = JSON.parse(readFileSync(file, "utf8")) as { catalog?: unknown };
    return typeof marker.catalog === "string" && marker.catalog.toLowerCase() === path.basename(catalogPath).toLowerCase();
  } catch {
    return false;
  }
}

/** Why a check must not run on this catalog, or null. `catalogPath` is the hello's (absent from a plugin before issue #213). */
export function throwawayRefusal(catalogPath: string | undefined, argv: readonly string[] = process.argv): string | null {
  if (argv.includes(I_KNOW)) return null;
  if (catalogPath === undefined) {
    return "Lightroom runs an LrC-AVG plugin that does not report its catalog: File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run this again. Nothing was written.";
  }
  if (isMarked(catalogPath)) return null;
  return `the open catalog ${path.basename(catalogPath)} is not marked as a throwaway catalog, so this check wrote nothing. ` +
    "Open a throwaway catalog (File > New Catalog, then import a few photos) and run npm run catalog:throwaway once; " +
    `or, to run on this catalog anyway, add -- ${I_KNOW} to the command.`;
}

/** Throws the refusal for the connected bridge's catalog; call once the bridge is connected. */
export function requireThrowaway(client: BridgeClient): void {
  const why = throwawayRefusal(client.hello()?.catalog_path);
  if (why) throw new Error(why);
}

/**
 * For the phase checks, before they start: connects and returns the refusal, or null. A bridge that does not
 * connect is a refusal too, with the lock given back: the check would otherwise connect later on its own and
 * write without the guard (Greptile, PR #247).
 */
export async function throwawayPreflight(gate: BridgeGate, client: BridgeClient): Promise<string | null> {
  try {
    await gate.ready();
  } catch (err) {
    await gate.release();
    return `Lightroom did not connect (${describeError(err)}), so the catalog could not be checked. Nothing was written.`;
  }
  const why = throwawayRefusal(client.hello()?.catalog_path);
  if (why) await gate.release();
  return why;
}
