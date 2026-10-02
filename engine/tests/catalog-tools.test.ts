// The catalog tools kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2): lr_search_photos,
// lr_get_selected_photos, lr_list_collections, lr_set_rating and lr_set_keywords, through the Tools
// class against the simulated Lightroom (lightroom-sim-library.ts), and their argument schemas.

import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeError, type CommandName } from "../src/bridge/index.js";
import { searchCriteria, shiftDay } from "../src/library/index.js";
import { CATALOG_DEFS } from "../src/mcp/defs-catalog.js";
import { toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { client, lr, sent, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();
afterEach(() => vi.restoreAllMocks());

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const schema = (name: string) => CATALOG_DEFS.find((d) => d.name === name)?.schema as (typeof CATALOG_DEFS)[number]["schema"];
const uuidsOf = (out: ToolOutput) => (out.json["photos"] as Array<{ uuid: string }>).map((p) => p.uuid);

describe("the search descriptor", () => {
  it("builds Automaat's entries: filename any, rating ==, keywords all, captureTime in / > / <", () => {
    expect(searchCriteria({ filename: "OZ8", rating: 0, keywords: ["bird", "heron"], start_date: "2026-09-07", end_date: "2026-09-08" })).toEqual([
      { criteria: "filename", operation: "any", value: "OZ8" },
      { criteria: "rating", operation: "==", value: 0 },
      { criteria: "keywords", operation: "all", value: "bird" },
      { criteria: "keywords", operation: "all", value: "heron" },
      { criteria: "captureTime", operation: "in", value: "2026-09-07", value2: "2026-09-08" },
    ]);
    expect(searchCriteria({ start_date: "2026-03-01" })).toEqual([{ criteria: "captureTime", operation: ">", value: "2026-02-28" }]);
    expect(searchCriteria({ end_date: "2026-12-31" })).toEqual([{ criteria: "captureTime", operation: "<", value: "2027-01-01" }]);
    expect(searchCriteria({})).toEqual([]);
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("refuses a date that is not a calendar day, and a start after the end", () => {
    const search = schema("lr_search_photos");
    expect(search.safeParse({ start_date: "2026-02-30" }).success).toBe(false);
    expect(search.safeParse({ end_date: "26-02-01" }).success).toBe(false);
    expect(search.safeParse({ start_date: "2026-09-08", end_date: "2026-09-07" }).success).toBe(false);
    expect(search.safeParse({ start_date: "2026-09-07", end_date: "2026-09-07", limit: 500 }).success).toBe(true);
    expect(search.safeParse({ limit: 501 }).success).toBe(false);
  });
});

describe("lr_search_photos", () => {
  it("sends the descriptor and lists the matches with uuid, rating and capture time", async () => {
    const out = await tools.searchPhotos({ keywords: ["bird"], start_date: "2026-09-08" });
    expect(sent("search_photos")[0]).toEqual({
      criteria: [
        { criteria: "keywords", operation: "all", value: "bird" },
        { criteria: "captureTime", operation: ">", value: "2026-09-07" },
      ],
      offset: 0,
      limit: 100,
    });
    expect(out.json).toMatchObject({ count: 1, returned: 1, has_more: false });
    expect(out.json["photos"]).toEqual([
      { uuid: "SIM-LIB-3", filename: "20260908-_OZ80100.NEF", rating: 5, capture_time: "2026-09-08 12:00:00", virtual_copy: false },
    ]);
    expect(out.json["warning"]).toBeUndefined();
  });

  it("pages, warns when nothing filters the search, and lists an unrated photo with rating 0", async () => {
    const first = await tools.searchPhotos({ limit: 2 });
    expect(first.json).toMatchObject({ count: 3, returned: 2, has_more: true });
    expect(first.json["warning"]).toMatch(/every photo in the catalog/);
    expect((first.json["photos"] as Array<Record<string, unknown>>)[0]).toMatchObject({ uuid: "SIM-UUID", rating: 0 });
    const next = await tools.searchPhotos({ limit: 2, offset: 2 });
    expect(next.json).toMatchObject({ count: 3, offset: 2, returned: 1, has_more: false });
  });

  it("limits to a collection, and refuses an unknown one", async () => {
    const out = await tools.searchPhotos({ collection_id: 501, rating: 3 });
    expect(uuidsOf(out)).toEqual(["SIM-LIB-2"]);
    expect(out.json["warning"]).toBeUndefined();
    expect((await fails(tools.searchPhotos({ collection_id: 9 }))).code).toBe("UNKNOWN_COLLECTION");
  });
});

describe("lr_get_selected_photos and lr_list_collections", () => {
  it("lists the selection, the active photo first, and refuses when none is selected", async () => {
    lr.alsoSelected = ["SIM-LIB-3"];
    const out = await tools.getSelectedPhotos({ limit: 1 });
    expect(sent("get_selection")[0]).toEqual({ max: 1 });
    expect(out.json).toMatchObject({ count: 2, returned: 1, has_more: true });
    expect(uuidsOf(out)).toEqual(["SIM-UUID"]);
    lr.selected = "";
    expect((await fails(tools.getSelectedPhotos())).code).toBe("NO_ACTIVE_PHOTO");
  });

  it("lists the collections with id, set path, smart and photo count, paged", async () => {
    const out = await tools.listCollections({ offset: 1 });
    expect(out.json).toMatchObject({ count: 2, offset: 1, returned: 1, has_more: false });
    expect(out.json["collections"]).toEqual([{ id: 502, name: "Five stars", set: "Best / 2026", smart: true, photo_count: 1 }]);
    expect((await tools.listCollections()).json["collections"]).toContainEqual({ id: 501, name: "Birds", set: null, smart: false, photo_count: 2 });
  });
});

describe("lr_set_rating", () => {
  it("rates each photo by uuid, with before and after; one already rated so is unchanged", async () => {
    const out = await tools.setRating({ uuids: ["SIM-UUID", "SIM-LIB-2"], rating: 3 });
    expect(sent("set_rating")).toEqual([
      { photo_uuid: "SIM-UUID", rating: 3 },
      { photo_uuid: "SIM-LIB-2", rating: 3 },
    ]);
    expect(out.json).toMatchObject({ rating: 3, changed: 1, failed: [] });
    expect(out.json["photos"]).toEqual([
      { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF", before: 0, after: 3, changed: true },
      { uuid: "SIM-LIB-2", filename: "20260907-_OZ80099.NEF", before: 3, after: 3, changed: false },
    ]);
    expect(lr.library.writes).toBe(1);
    expect(lr.selected).toBe("SIM-UUID");
  });

  it("lists an unknown photo and one whose read-back differs in failed, and still rates the rest", async () => {
    lr.library.dropRating = true;
    const dropped = await tools.setRating({ uuids: ["SIM-LIB-3"], rating: 1 });
    expect(dropped.json["failed"]).toEqual([{ uuid: "SIM-LIB-3", code: "RATING_NOT_TAKEN", message: "Lightroom read back rating 5, not 1.", before: 5, after: 5 }]);
    lr.library.dropRating = false;
    const out = await tools.setRating({ uuids: ["NOPE", "SIM-LIB-3"], rating: 0 });
    expect((out.json["failed"] as Array<Record<string, unknown>>).map((f) => f.code)).toEqual(["UNKNOWN_PHOTO"]);
    expect(out.json["photos"]).toEqual([{ uuid: "SIM-LIB-3", filename: "20260908-_OZ80100.NEF", before: 5, after: 0, changed: true }]);
  });

  it("keeps a photo's earlier rating when the read-back or the write gate fails after the write (Greptile, PR #57)", async () => {
    lr.library.readBackError = "getRawMetadata: catalog busy";
    const lost = await tools.setRating({ uuids: ["SIM-LIB-2"], rating: 1 });
    expect(lost.json["photos"]).toEqual([]);
    expect(lost.json["failed"]).toEqual([
      {
        uuid: "SIM-LIB-2",
        code: "READ_BACK_FAILED",
        message: "Lightroom could not read the rating back: getRawMetadata: catalog busy. The photo may have changed; `before` holds its rating before the call.",
        before: 3,
      },
    ]);
    lr.library.readBackError = null;
    lr.library.writeError = "blocked by another write access call";
    const raised = await tools.setKeywords({ uuids: ["SIM-LIB-3"], add: ["pond"] });
    expect(raised.json["failed"]).toEqual([
      {
        uuid: "SIM-LIB-3",
        code: "WRITE_FAILED",
        message: "Lightroom raised an error while writing the keywords: blocked by another write access call. The photo may have changed; `before` holds its keywords before the call.",
        before: ["bird", "heron"],
        after: ["bird", "heron", "pond"],
      },
    ]);
  });

  // The client's own errors for a command sent without an answer, and for one never sent
  // [handle: src\bridge\client.ts send(), the "timeout" BridgeError; request(), "not_connected"].
  const failOn = (uuid: string, error: BridgeError): void => {
    const real = client.request.bind(client);
    vi.spyOn(client, "request").mockImplementation(((name: CommandName, payload: Record<string, unknown>, options?: { timeoutMs?: number }) =>
      payload["photo_uuid"] === uuid ? Promise.reject(error) : real(name, payload as never, options)) as typeof client.request);
  };

  it("stops at a photo with no answer, names it maybe_written, and sends nothing after it", async () => {
    failOn("SIM-LIB-2", new BridgeError("timeout", "set_rating: no response within 30000 ms", true, "set_rating"));
    const err = await fails(tools.setRating({ uuids: ["SIM-UUID", "SIM-LIB-2", "SIM-LIB-3"], rating: 2 }));
    expect(err.code).toBe("BRIDGE_TIMEOUT");
    expect(err.message).toMatch(/may still write the rating of SIM-LIB-2/);
    expect(err.details).toMatchObject({ maybe_written: "SIM-LIB-2", not_sent: ["SIM-LIB-3"], failed: [] });
    expect((err.details as { written: Array<{ uuid: string }> }).written.map((w) => w.uuid)).toEqual(["SIM-UUID"]);
    expect(sent("set_rating").map((p) => p["photo_uuid"])).toEqual(["SIM-UUID"]);
  });

  it("says a photo whose command was never sent was not written", async () => {
    failOn("SIM-LIB-2", new BridgeError("not_connected", "not connected", true));
    const err = await fails(tools.setRating({ uuids: ["SIM-LIB-2", "SIM-LIB-3"], rating: 2 }));
    expect(err.code).toBe("BRIDGE_DISCONNECTED");
    expect(err.message).toMatch(/Nothing was sent for SIM-LIB-2/);
    expect(err.details).toEqual({ written: [], failed: [], not_sent: ["SIM-LIB-2", "SIM-LIB-3"] });
  });

  it("is refused while a session is open, and sends nothing", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const err = await fails(tools.setRating({ uuids: ["SIM-LIB-2"], rating: 4 }));
    expect(err.code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("set_rating")).toEqual([]);
    expect((await tools.searchPhotos({ rating: 3 })).json["count"]).toBe(1);
  });

  it("takes 1-100 different uuids and a whole rating from 0 to 5", () => {
    const rating = schema("lr_set_rating");
    expect(rating.safeParse({ uuids: ["A"], rating: 5 }).success).toBe(true);
    expect(rating.safeParse({ uuids: [], rating: 1 }).success).toBe(false);
    expect(rating.safeParse({ uuids: ["A", "A"], rating: 1 }).success).toBe(false);
    expect(rating.safeParse({ uuids: Array.from({ length: 101 }, (_, i) => `U${i}`), rating: 1 }).success).toBe(false);
    expect(rating.safeParse({ uuids: ["A"], rating: 2.5 }).success).toBe(false);
    expect(rating.safeParse({ uuids: ["A"], rating: 6 }).success).toBe(false);
  });
});

describe("lr_set_keywords", () => {
  it("adds and removes keywords by name, with each photo's keywords before and after", async () => {
    const out = await tools.setKeywords({ uuids: ["SIM-LIB-2", "SIM-LIB-3"], add: ["heron", "pond"], remove: ["bird"] });
    expect(sent("set_keywords")[0]).toEqual({ photo_uuid: "SIM-LIB-2", add: ["heron", "pond"], remove: ["bird"] });
    expect(out.json).toMatchObject({ changed: 2, failed: [] });
    expect(out.json["photos"]).toEqual([
      { uuid: "SIM-LIB-2", filename: "20260907-_OZ80099.NEF", before: ["bird"], after: ["heron", "pond"], changed: true },
      { uuid: "SIM-LIB-3", filename: "20260908-_OZ80100.NEF", before: ["bird", "heron"], after: ["heron", "pond"], changed: true },
    ]);
  });

  it("lists a photo whose read-back still has a removed keyword in failed", async () => {
    lr.library.stuckKeywords = ["bird"];
    const out = await tools.setKeywords({ uuids: ["SIM-LIB-2"], remove: ["bird"] });
    expect(out.json["failed"]).toEqual([
      { uuid: "SIM-LIB-2", code: "KEYWORDS_NOT_TAKEN", message: 'Lightroom read back keywords without [] and still with ["bird"].', before: ["bird"], after: ["bird"] },
    ]);
  });

  it("needs a keyword to add or remove, never the same in both, trimmed and different", () => {
    const kw = schema("lr_set_keywords");
    expect(kw.safeParse({ uuids: ["A"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: [], remove: [] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["x"], remove: ["x"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["x", " x "] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["  "] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], remove: [" x "] }).data).toEqual({ uuids: ["A"], remove: ["x"] });
  });
});
