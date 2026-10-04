// The simulated Lightroom's collection and file commands (plugin 0.17.0, plugin\LrC-AVG.lrplugin\
// Transfer.lua): create_collection and collection_photos over SimLibrary's collections, export_photo
// writing a small file into a new folder under `exportDir` as the plugin does under its temp folder,
// and import_photo keeping a path -> uuid catalog. Made up to test the engine, not a claim about
// Lightroom; its rules copy Transfer.lua's (names case aside, nothing written when nothing changes).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import type { SimLibrary } from "./lightroom-sim-library.js";

const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
const fail = (code: string, message: string, recoverable = false): FakeReply => ({ ok: false, error: { code, message, recoverable } });
const EXT: Record<string, string> = { jpeg: ".jpg", png: ".png", tiff: ".tif", original: ".NEF" };

export class SimFiles {
  /** Where export_photo writes; the test's Tools gets the same folder as exportDir. */
  exportDir = "";
  /** Catalog photos by path (import_photo). */
  readonly byPath = new Map<string, string>();
  /** The export_photo payloads, in order. */
  readonly exports: Array<Record<string, unknown>> = [];
  /** collection_photos takes nothing (reads back the old membership). */
  dropCollection = false;
  private exportCount = 0;
  private nextId = 900;

  private readonly library: SimLibrary;

  constructor(library: SimLibrary) {
    this.library = library;
  }

  install(plugin: FakePlugin): void {
    plugin.handlers.set("create_collection", (p) => this.create(p));
    plugin.handlers.set("collection_photos", (p) => this.change(p));
    plugin.handlers.set("export_photo", (p) => this.export(p));
    plugin.handlers.set("import_photo", (p) => this.import(p));
  }

  private create(p: Record<string, unknown>): FakeReply {
    const name = String(p["name"]);
    const levels = p["set_path"] as string[];
    const setPath = levels.length > 0 ? levels.join(" / ") : undefined;
    const same = (a: string | undefined, b: string | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
    const found = this.library.collections.find((c) => same(c.name, name) && same(c.set_path, setPath));
    if (found?.smart) return fail("smart_collection", `a smart collection named ${found.name} is already there`);
    const c = found ?? { local_id: this.nextId++, name, smart: false, photos: [], ...(setPath ? { set_path: setPath } : {}) };
    if (!found) this.library.collections.push(c);
    return ok({ local_id: c.local_id, name: c.name, ...(c.set_path ? { set_path: c.set_path } : {}), smart: c.smart, photo_count: c.photos.length, created: !found });
  }

  private change(p: Record<string, unknown>): FakeReply {
    const c = this.library.collections.find((x) => x.local_id === p["collection_id"]);
    if (!c) return fail("unknown_collection", `no collection has id ${String(p["collection_id"])}`);
    if (c.smart) return fail("smart_collection", "a smart collection");
    const uuids = p["uuids"] as string[];
    const found = uuids.filter((u) => this.library.find(u));
    const members = () => found.filter((u) => c.photos.includes(u));
    const before = members();
    if (!this.dropCollection) {
      c.photos = p["remove"] === true ? c.photos.filter((u) => !found.includes(u)) : [...new Set([...c.photos, ...found])];
    }
    return ok({ collection_id: c.local_id, name: c.name, before_in: before, after_in: members(), not_found: uuids.filter((u) => !found.includes(u)) });
  }

  private export(p: Record<string, unknown>): FakeReply {
    const photo = this.library.find(String(p["photo_uuid"]));
    if (!photo) return fail("unknown_photo", `no photo in the catalog has uuid ${String(p["photo_uuid"])}`);
    this.exports.push(p);
    const dir = path.join(this.exportDir, `req-${++this.exportCount}`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, photo.filename.replace(/\.[^.]+$/, "") + (EXT[String(p["format"])] ?? ".bin"));
    writeFileSync(file, `export of ${photo.uuid}`);
    return ok({ uuid: photo.uuid, filename: photo.filename, dir, files: [file], export_ms: 5 });
  }

  private import(p: Record<string, unknown>): FakeReply {
    const file = String(p["path"]);
    if (file.endsWith(".bad.jpg")) return fail("import_failed", `Lightroom did not import ${file}: unsupported`);
    const known = this.byPath.get(file);
    if (known) return ok({ status: "already", uuid: known, filename: path.basename(file) });
    const uuid = `SIM-IMP-${this.byPath.size + 1}`;
    this.byPath.set(file, uuid);
    this.library.photos.push({ uuid, local_id: 2000 + this.byPath.size, filename: path.basename(file), rating: 0, keywords: [], day: "2026-10-04", gps: null });
    return ok({ status: "imported", uuid, filename: path.basename(file) });
  }
}
