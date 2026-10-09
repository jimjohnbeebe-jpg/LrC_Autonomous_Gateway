// npm run offline:check (src/devtools/offline-check.ts) against the simulated Lightroom: WORKED when the
// missing photo is reported and refused at every step and Jim's selection comes back; FAILED, with the
// line that says why, when the photo is found or the plugin is older.

import { describe, expect, it } from "vitest";
import { MISSING, PRESENT, runOfflineCheck } from "../src/devtools/offline-check.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { clean, client, lr, map, plugin, sent, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

/** The check's two photos as library photos with Develop settings of their own (lightroom-sim-library.ts). */
function addPhotos(): void {
  for (const [i, p] of [MISSING, PRESENT].entries()) {
    lr.library.photos.push({ uuid: p.uuid, local_id: 3000 + i, filename: p.filename, rating: 0, keywords: [], day: "2026-10-09", gps: null, settings: structuredClone(lr.settings), file_format: "TIFF" });
  }
}

const run = () => {
  const said: string[] = [];
  const gate = { released: 0, ready: () => client.waitConnected(2000).then(() => undefined), release: async () => void gate.released++ };
  const out = runOfflineCheck({ client, gate, tools, map, ask: async () => "y", say: (l) => said.push(l) });
  return out.then((r) => ({ ...r, said, released: gate.released }));
};

describe("npm run offline:check", () => {
  it("WORKED: the missing original is reported and refused, nothing is written, the selection comes back", async () => {
    clean();
    addPhotos();
    lr.missing.add(MISSING.uuid);
    const { worked, results, said, released } = await run();
    expect(results["errors"]).toEqual([]);
    expect(worked).toBe(true);
    expect(released).toBe(1); // the command can end, and Claude Desktop connect (Greptile, PR #101)
    expect(results["lines"]).toEqual({ missing_reported: true, present_reported: true, context_tool_reports: true, begin_refused: true, write_refused: true, export_refused: true, nothing_written: true, selection_restored: true });
    expect(results["menu_find_missing_photos"]).toBe("y");
    expect(lr.writes).toEqual([]);
    expect(sent("create_snapshot")).toEqual([]);
    expect(lr.selected).toBe("SIM-UUID");
    expect(said.at(-1)).toBe("Offline original check: WORKED");
  });

  it("FAILED when the photo's original is there, and stops before any session or write", async () => {
    clean();
    addPhotos();
    const { worked, results, said } = await run();
    expect(worked).toBe(false);
    expect(results["lines"]).toEqual({ missing_reported: false, present_reported: true, selection_restored: true });
    expect(results["errors"]).toEqual([expect.stringMatching(/does not report .* as missing, so nothing was tried/)]);
    expect([lr.writes, sent("create_snapshot"), sent("select_photo").map((p) => p["uuid"])]).toEqual([[], [], ["SIM-UUID"]]);
    expect(said).toContain("  begin refused: not run");
  });

  it("puts the photo back when the begin goes through after all (the file came back meanwhile; Greptile, PR #101)", async () => {
    clean();
    addPhotos();
    lr.missing.add(MISSING.uuid);
    const before = structuredClone(lr.settingsOf(MISSING.uuid));
    const select = plugin.handlers.get("select_photo");
    plugin.handlers.set("select_photo", (p, id) => {
      if (p["uuid"] === MISSING.uuid) lr.missing.delete(MISSING.uuid); // found again just before the begin
      return (select as NonNullable<typeof select>)(p, id);
    });
    const { worked, results, released } = await run();
    expect(worked).toBe(false);
    expect(results["session_reverted"]).toBe(true);
    expect(results["errors"]).toEqual([expect.stringMatching(/left session .* open; the check ended it with revert: the photo is put back/)]);
    expect(lr.settingsOf(MISSING.uuid)).toEqual(before);
    expect(tools.sessionManager()?.current() ?? null).toBeNull();
    expect(released).toBe(1);
  });

  it("FAILED, saying what to do, with a plugin older than 0.19.0", async () => {
    clean();
    lr.pluginVersion = "0.18.1";
    plugin.dropEventClient(); // the next hello reports 0.18.1
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    const { worked, results } = await run();
    expect(worked).toBe(false);
    expect(results["errors"]).toEqual([expect.stringMatching(/not 0\.19\.0 or later: File > Plug-in Manager > LrC-AVG > Reload Plug-in/)]);
  });
});
