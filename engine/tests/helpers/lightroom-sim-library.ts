// The simulated Lightroom's library commands (plugin 0.8.0, plugin\LrC-AVG.lrplugin\Library.lua):
// search_photos, list_collections, set_rating and set_keywords, over a few photos with a rating,
// keywords and a capture day, and two collections. Its matching of the search descriptor (filename
// contains, rating ==, keywords all, captureTime in / > / < by day) is made up to test the engine,
// not a claim about how Lightroom matches. As the plugin does, a write that would change nothing is
// not made (Library.lua setRating, setKeywords).

import type { FakePlugin, FakeReply } from "./fake-plugin.js";

export type SimLibraryPhoto = { uuid: string; local_id: number; filename: string; rating: number; keywords: string[]; day: string };
export type SimCollection = { local_id: number; name: string; set_path?: string; smart: boolean; photos: string[] };

const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
const fail = (code: string, message: string, recoverable = false): FakeReply => ({ ok: false, error: { code, message, recoverable } });

export class SimLibrary {
  /** The first is the sim's master photo ("SIM-UUID", lightroom-sim.ts). */
  readonly photos: SimLibraryPhoto[] = [
    { uuid: "SIM-UUID", local_id: 1, filename: "20260907-_OZ80093.NEF", rating: 0, keywords: [], day: "2026-09-07" },
    { uuid: "SIM-LIB-2", local_id: 2, filename: "20260907-_OZ80099.NEF", rating: 3, keywords: ["bird"], day: "2026-09-07" },
    { uuid: "SIM-LIB-3", local_id: 3, filename: "20260908-_OZ80100.NEF", rating: 5, keywords: ["bird", "heron"], day: "2026-09-08" },
  ];
  readonly collections: SimCollection[] = [
    { local_id: 501, name: "Birds", smart: false, photos: ["SIM-LIB-2", "SIM-LIB-3"] },
    { local_id: 502, name: "Five stars", set_path: "Best / 2026", smart: true, photos: ["SIM-LIB-3"] },
  ];
  /** set_rating reads back the old rating, as if Lightroom had not taken the write. */
  dropRating = false;
  /** set_keywords leaves these names on the photo. */
  stuckKeywords: string[] = [];
  /** set_rating and set_keywords commands that changed a photo. */
  writes = 0;

  find(uuid: string): SimLibraryPhoto | undefined {
    return this.photos.find((p) => p.uuid === uuid);
  }

  /** What Photos.describe adds for a photo (plugin 0.8.0): rating (absent when unrated) and capture_time. */
  meta(uuid: string): Record<string, unknown> {
    const p = this.find(uuid);
    if (!p) return {};
    return { ...(p.rating > 0 ? { rating: p.rating } : {}), capture_time: `${p.day} 12:00:00` };
  }

  private describe(p: SimLibraryPhoto): Record<string, unknown> {
    return { uuid: p.uuid, local_id: p.local_id, filename: p.filename, is_virtual_copy: false, master_local_id: p.local_id, ...this.meta(p.uuid) };
  }

  private matches(p: SimLibraryPhoto, c: Record<string, unknown>): boolean {
    const v = c["value"];
    switch (`${String(c["criteria"])} ${String(c["operation"])}`) {
      case "filename any":
        return p.filename.includes(String(v));
      case "rating ==":
        return p.rating === v;
      case "keywords all":
        return p.keywords.includes(String(v));
      case "captureTime in":
        return p.day >= String(v) && p.day <= String(c["value2"]);
      case "captureTime >":
        return p.day > String(v);
      case "captureTime <":
        return p.day < String(v);
      default:
        throw new Error(`the sim does not know the criterion ${JSON.stringify(c)}`);
    }
  }

  install(plugin: FakePlugin): void {
    plugin.handlers.set("search_photos", (p) => this.search(p));
    plugin.handlers.set("list_collections", () =>
      ok({ collections: this.collections.map(({ photos, ...c }) => ({ ...c, photo_count: photos.length })) }),
    );
    plugin.handlers.set("set_rating", (p) => this.write(p, (photo) => this.rate(photo, Number(p["rating"]))));
    plugin.handlers.set("set_keywords", (p) => this.write(p, (photo) => this.tag(photo, p["add"] as string[], p["remove"] as string[])));
  }

  private search(p: Record<string, unknown>): FakeReply {
    const criteria = (p["criteria"] ?? []) as Array<Record<string, unknown>>;
    let found = this.photos.filter((photo) => criteria.every((c) => this.matches(photo, c)));
    if (p["collection_id"] !== undefined) {
      const collection = this.collections.find((c) => c.local_id === p["collection_id"]);
      if (!collection) return fail("unknown_collection", `no collection has id ${String(p["collection_id"])}`);
      found = found.filter((photo) => collection.photos.includes(photo.uuid));
    }
    const offset = Number(p["offset"]);
    return ok({ count: found.length, photos: found.slice(offset, offset + Number(p["limit"])).map((photo) => this.describe(photo)) });
  }

  private write(p: Record<string, unknown>, fn: (photo: SimLibraryPhoto) => FakeReply): FakeReply {
    const uuid = String(p["photo_uuid"]);
    const photo = this.find(uuid);
    return photo ? fn(photo) : fail("unknown_photo", `no photo in the catalog has uuid ${uuid}`);
  }

  private rate(photo: SimLibraryPhoto, rating: number): FakeReply {
    const before = photo.rating;
    if (before !== rating && !this.dropRating) {
      photo.rating = rating;
      this.writes++;
    }
    return ok({ uuid: photo.uuid, filename: photo.filename, before, after: photo.rating });
  }

  private tag(photo: SimLibraryPhoto, add: string[], remove: string[]): FakeReply {
    const before = [...photo.keywords];
    const after = [...before.filter((k) => !remove.includes(k) || this.stuckKeywords.includes(k)), ...add.filter((k) => !before.includes(k))];
    if (after.join("\n") !== before.join("\n")) this.writes++;
    photo.keywords = after;
    return ok({ uuid: photo.uuid, filename: photo.filename, before, after });
  }
}
