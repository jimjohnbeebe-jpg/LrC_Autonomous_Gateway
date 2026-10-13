// The simulated Lightroom's metadata commands (plugin 0.22.0, plugin\LrC-AVG.lrplugin\Metadata.lua):
// set_flag, set_iptc and get_metadata over SimLibrary's photos. As the plugin does, a write that would
// change nothing is not made, a flag read nil is 0 and a text field read nil is "". The stack is set
// by the tests (`stack` on a photo), since no command writes one.

import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import type { SimLibrary, SimLibraryPhoto } from "./lightroom-sim-library.js";

type Stack = { position: number; count: number; collapsed: boolean; top_uuid: string };
export type SimPhotoMetadata = { folder?: string; flag?: number; title?: string; caption?: string; headline?: string; stack?: Stack };

const TEXT = ["title", "caption", "headline"] as const;
const ok = (payload: unknown): FakeReply => ({ ok: true, payload });

export class SimMetadata {
  /** Writes read back the old values, as if Lightroom had not taken them. */
  dropWrites = false;
  /** set_flag and set_iptc commands that changed a photo. */
  writes = 0;
  /** get_metadata cannot read the keywords: they are left out and named in `errors`. */
  keywordsError: string | null = null;
  private readonly library: SimLibrary;

  constructor(library: SimLibrary) {
    this.library = library;
  }

  install(plugin: FakePlugin): void {
    plugin.handlers.set("set_flag", (p) => this.library.write(p, (photo) => this.flag(photo, Number(p["flag"]))));
    plugin.handlers.set("set_iptc", (p) => this.library.write(p, (photo) => this.text(photo, p)));
    plugin.handlers.set("get_metadata", (p) => this.read(String(p["photo_uuid"])));
  }

  private texts(photo: SimLibraryPhoto): Record<string, string> {
    return { title: photo.title ?? "", caption: photo.caption ?? "", headline: photo.headline ?? "" };
  }

  private flag(photo: SimLibraryPhoto, flag: number): FakeReply {
    const before = photo.flag ?? 0;
    if (before !== flag && !this.dropWrites) {
      photo.flag = flag;
      this.writes++;
    }
    return ok({ uuid: photo.uuid, filename: photo.filename, before, after: photo.flag ?? 0 });
  }

  private text(photo: SimLibraryPhoto, p: Record<string, unknown>): FakeReply {
    const before = this.texts(photo);
    const changes = TEXT.filter((f) => typeof p[f] === "string" && p[f] !== before[f]);
    if (changes.length > 0 && !this.dropWrites) {
      for (const f of changes) photo[f] = p[f] as string;
      this.writes++;
    }
    return ok({ uuid: photo.uuid, filename: photo.filename, before, after: this.texts(photo) });
  }

  private read(uuid: string): FakeReply {
    const photo = this.library.find(uuid);
    if (!photo) return { ok: false, error: { code: "unknown_photo", message: `no photo in the catalog has uuid ${uuid}`, recoverable: false } };
    return ok({
      uuid: photo.uuid,
      filename: photo.filename,
      ...this.texts(photo),
      flag: photo.flag ?? 0,
      ...(this.keywordsError ? { errors: [`keywords: ${this.keywordsError}`] } : { keywords: [...photo.keywords] }),
      gps: photo.gps ?? false,
      stack: photo.stack ?? false,
    });
  }
}
