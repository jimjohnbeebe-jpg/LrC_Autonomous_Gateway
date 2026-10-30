// Reference photos (Phase 10 row 8; src/session/references.ts, src/metrics/reference-gap.ts): measured at
// lr_begin_session by uuid or collection against the simulated Lightroom, the begin argument over the
// intent's, a reference_gap in every pass result, the set in the session log; and the gap's arithmetic.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { collectionPhotos } from "../src/mcp/collection-find.js";
import { aggregate, referenceGap, type Perceptual } from "../src/metrics/index.js";
import { PreviewService, type RenderedPreview } from "../src/preview/index.js";
import { MAX_REFERENCES, loadReferences } from "../src/session/references.js";
import type { SessionContext } from "../src/session/types.js";
import { ID, client, clean, intent, lr, map, newManager, readLog, tmp, useSessionHarness } from "./helpers/session-harness.js";

describe("references in a session", () => {
  useSessionHarness();
  let manager: ReturnType<typeof newManager>;
  beforeEach(() => {
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    manager = newManager({
      renderReference: (r) => previews.render({ longEdge: r.longEdge, quality: r.quality, photoUuid: r.uuid, measureEdge: r.measureEdge }),
      collectionPhotos: (name, limit) => collectionPhotos(client, name, limit),
    });
    clean();
    const lib = lr.library.photos;
    (lib[1] as { settings?: Record<string, unknown> }).settings = { ...lr.settings, Exposure2012: 1 };
    (lib[2] as { settings?: Record<string, unknown> }).settings = { ...lr.settings, Exposure2012: 0.5 };
  });

  it("measures each uuid at begin, leaves out one it cannot render, and reports the gap at begin and in every pass", async () => {
    const out = await manager.begin({ references: { uuids: ["SIM-LIB-2", "SIM-LIB-3", "NO-SUCH-UUID"] }, return_image: "none" });
    const refs = out.json["references"] as { source: string; measured: string[]; warnings: string[] };
    expect(refs.source).toBe("begin");
    expect(refs.measured).toEqual(["SIM-LIB-2", "SIM-LIB-3"]);
    expect(refs.warnings.join(" ")).toContain("NO-SUCH-UUID");
    expect(lr.selected).toBe("SIM-UUID"); // the references were exported by photo_uuid; the selection stayed
    const gap = out.json["reference_gap"] as Record<string, { v: number; ref: number[]; at: string }>;
    expect(gap["n"]).toBe(2);
    // Both references are brighter (+1 and +0.5 EV in the sim's tonal model), so the photo's median L* is below their range.
    expect(gap["L.p50"]?.at).toBe("below");
    const step = await manager.step({ session_id: ID, settings: { exposure: 0.6 }, rationale: "brighter" });
    expect(step.json["reference_gap"]).toMatchObject({ n: 2, "L.p50": { ref: gap["L.p50"]?.ref } });
    const log = readLog();
    expect(log.references?.uuids).toEqual(["SIM-LIB-2", "SIM-LIB-3", "NO-SUCH-UUID"]);
    expect(log.references?.measured.map((m) => m.uuid)).toEqual(["SIM-LIB-2", "SIM-LIB-3"]);
    expect(log.references?.aggregate["L.p50"]?.n).toBe(2);
  });

  it("takes the intent's references, here a collection", async () => {
    intent("look_refs", { schema_version: 3, references: { collection: "Birds" } });
    const fromIntent = await manager.begin({ intent_id: "look_refs", return_image: "none" });
    expect(fromIntent.json["references"]).toMatchObject({ source: "intent", collection: "Birds", measured: ["SIM-LIB-2", "SIM-LIB-3"] });
  });

  it("takes the begin argument over the intent's references", async () => {
    intent("look_refs", { schema_version: 3, references: { collection: "Birds" } });
    const fromBegin = await manager.begin({ intent_id: "look_refs", references: { uuids: ["SIM-LIB-3"] }, return_image: "none" });
    expect(fromBegin.json["references"]).toMatchObject({ source: "begin", collection: null, measured: ["SIM-LIB-3"] });
  });

  it("begins without references when a collection is unknown, and says why", async () => {
    const out = await manager.begin({ references: { collection: "No such" }, return_image: "none" });
    expect(out.json["ok"]).toBe(true);
    expect((out.json["references"] as { warnings: string[] }).warnings.join(" ")).toContain("No such");
    expect(out.json["reference_gap"]).toBeUndefined();
  });

  it("takes references in a schema v3 intent only", () => {
    const lib = new IntentLibrary({ map, userDir: tmp });
    const look = { id: "x", label: "x", category: "c", brief: "b", priors: {}, references: { uuids: ["SIM-LIB-2"] } };
    expect(() => lib.check({ ...look, schema_version: 2 })).toThrow(/references need schema_version 3/);
    expect(lib.check({ ...look, schema_version: 3 })).toMatchObject({ references: { uuids: ["SIM-LIB-2"] } });
    expect(() => lib.check({ ...look, schema_version: 3, references: {} })).toThrow();
  });

  it("has no references and no gap without the argument or an intent's", async () => {
    const out = await manager.begin({ return_image: "none" });
    expect(out.json["references"]).toBeUndefined();
    expect(out.json["reference_gap"]).toBeUndefined();
    expect(readLog().references).toBeUndefined();
  });
});

const perceptual = (over: { p50?: number; wheel?: number | null; C?: number } = {}): Perceptual => ({
  L: { p2: 1, p5: 3, p20: 20, p50: over.p50 ?? 50, p80: 70, p95: 90, p98: 95 },
  zones: [1, 2, 3, 10, 20, 30, 20, 8, 3, 2, 1],
  cast: { sh: { a: 1, b: 5, C: over.C ?? 5, h: 80, wheel: over.wheel === undefined ? 50 : over.wheel }, mid: null, hi: null },
  bands: { red: 10, orange: 40, yellow: 20, green: 10, aqua: 5, blue: 10, purple: 3, magenta: 2 },
  cf: 30,
  rms: 0.2,
});

describe("the reference gap", () => {
  it("takes min, median and max per measure, and places the photo below, within or above", () => {
    const refs = aggregate([perceptual({ p50: 40 }), perceptual({ p50: 60 }), perceptual({ p50: 45 })]);
    expect(refs["L.p50"]).toEqual({ min: 40, med: 45, max: 60, n: 3 });
    expect(refs["dark"]).toEqual({ min: 6, med: 6, max: 6, n: 3 });
    expect(referenceGap(perceptual({ p50: 30 }), refs)["L.p50"]).toEqual({ v: 30, ref: [40, 45, 60], at: "below" });
    expect(referenceGap(perceptual({ p50: 50 }), refs)["L.p50"]?.at).toBe("within");
    expect(referenceGap(perceptual({ p50: 61 }), refs)["L.p50"]?.at).toBe("above");
  });

  it("keeps wheel hues across 0 degrees together, and places a hue by its shortest turn", () => {
    const refs = aggregate([perceptual({ wheel: 350 }), perceptual({ wheel: 10 }), perceptual({ wheel: 0 })]);
    expect(refs["sh.wheel"]).toEqual({ min: 350, med: 0, max: 10, n: 3 });
    expect(referenceGap(perceptual({ wheel: 5 }), refs)["sh.wheel"]?.at).toBe("within");
    expect(referenceGap(perceptual({ wheel: 30 }), refs)["sh.wheel"]?.at).toBe("above");
    expect(referenceGap(perceptual({ wheel: 330 }), refs)["sh.wheel"]?.at).toBe("below");
  });

  it("leaves out a measure no reference has (a cast without a hue, or a tone range without pixels)", () => {
    const refs = aggregate([perceptual({ wheel: null })]);
    expect(refs["sh.wheel"]).toBeNull();
    expect(refs["mid.C"]).toBeNull();
    expect(referenceGap(perceptual(), refs)["sh.wheel"]).toBeUndefined();
    expect(referenceGap(perceptual(), refs)["sh.C"]).toBeDefined();
  });

  it("uses at most 8 references, and warns when more are named or the engine cannot render them", async () => {
    const rendered: string[] = [];
    const deps = { renderReference: async (r: { uuid: string }) => (rendered.push(r.uuid), { metrics: { perceptual: perceptual() } }) as unknown as RenderedPreview };
    const ctx = { deps } as unknown as SessionContext;
    const size = { longEdge: 1600, quality: 85, measureEdge: null };
    const nine = Array.from({ length: 9 }, (_, i) => `U${i}`);
    const set = await loadReferences(ctx, { uuids: nine }, "begin", size);
    expect(rendered).toHaveLength(MAX_REFERENCES);
    expect(set?.warnings.join(" ")).toContain("9 references");
    const none = await loadReferences({ deps: {} } as unknown as SessionContext, { uuids: ["A"] }, "begin", size);
    expect(none?.measured).toEqual([]);
    expect(none?.warnings.join(" ")).toContain("cannot render");
    expect(await loadReferences(ctx, undefined, "begin", size)).toBeNull();
  });
});
