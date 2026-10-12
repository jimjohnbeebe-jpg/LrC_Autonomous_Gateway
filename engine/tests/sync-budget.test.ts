// lr_sync_series' time budget (issue #116): after the budget no new target starts, the rest come back
// as `not_yet`, and a second call with them finishes the sync. A fake clock stands in for 40 s.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { PreviewService, type PreviewRequest } from "../src/preview/index.js";
import { syncSeries, type SyncArgs } from "../src/sync/index.js";
import { addCopy, clean, client, logDir, lr, map, tmp, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

describe("lr_sync_series: time budget", () => {
  it("stops starting targets once the budget is spent and lists the rest; a call with them finishes", async () => {
    clean();
    const uuids = [1, 2, 3, 4, 5].map((n) => addCopy(n));
    let t = 0;
    // Each clock read moves 10 s on: start, then 10 s before the second target, 20 s before the third, over 15 s.
    const budget = { now: () => (t += 10_000), ms: 15_000 };
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    const deps = { client, map, logDir, render: (r: PreviewRequest) => previews.render(r), budget };
    const args = (targets: string[]): SyncArgs => ({ source: { settings: { contrast: 15 } }, targets: { uuids: targets }, adaptive_exposure: false, return_image: "none", long_edge: 1600, quality: 75 });

    const first = await syncSeries(deps, args(uuids));
    expect(first.json["applied"]).toBe(2);
    expect(first.json["not_yet"]).toEqual(uuids.slice(2));
    expect(first.json["next"]).toMatch(/call again with targets \{uuids: not_yet\} \(3 photos\)/);
    expect(first.log?.["not_yet"]).toBe(3);
    expect(lr.writes.map((w) => w.uuid)).toEqual(uuids.slice(0, 2));

    t = 0;
    const second = await syncSeries({ ...deps, budget: { now: () => t, ms: 25_000 } }, args(first.json["not_yet"] as string[]));
    expect([second.json["applied"], second.json["not_yet"], second.json["next"]]).toEqual([3, undefined, undefined]);
    expect(lr.writes.map((w) => w.uuid)).toEqual(uuids);
  });

  it("always starts the first target, even with the budget already spent", async () => {
    clean();
    const [a, b] = [addCopy(1), addCopy(2)];
    let t = 0;
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    const deps = { client, map, logDir, render: (r: PreviewRequest) => previews.render(r), budget: { now: () => (t += 100_000), ms: 1 } };
    const out = await syncSeries(deps, { source: { settings: { contrast: 15 } }, targets: { uuids: [a, b] }, adaptive_exposure: false, return_image: "none", long_edge: 1600, quality: 75 });
    expect([out.json["applied"], out.json["not_yet"]]).toEqual([1, [b]]);
  });
});
