// The Deck's copy thumbnails (Phase 7 row 3, E4; spec docs\hud\lrc-avg-hud-spec-v2.md 3.6): each copy's
// last render (`Target.last.jpeg`, the image the contact sheet is built from), made smaller with sharp
// (rule 01, "Images"): 480 px long edge, JPEG quality 70, so Option C's 138 x 92 CSS px card stays
// sharp at 300 % display scaling [inference, spec 3.6]. Made when the Deck asks for a key the state
// lists (`get_thumb`), kept in memory only: one per copy (a newer pass replaces it), all dropped when
// the edit ends or another begins. Nothing is written to disk.
// [handle: tests\hud-thumbs.test.ts]

import sharp from "sharp";
import type { Session, VariantId } from "../session/index.js";

export const THUMB_EDGE = 480;
export const THUMB_QUALITY = 70;

/** `<letter>:<pass>:<first 12 hex characters of the render's hash>`. */
export function thumbKey(letter: VariantId, pass: number, hash: string): string {
  return `${letter}:${pass}:${hash.slice(0, 12)}`;
}

export class ThumbCache {
  private sessionId: string | null = null;
  /** By copy letter: the key of the thumbnail made, and its JPEG. */
  private readonly made = new Map<string, { key: string; jpeg: Promise<Buffer> }>();
  /** How many thumbnails were made (tests). */
  count = 0;

  /** The thumbnail for `key` if it names a copy's current render in session `s`, else null. */
  async get(s: Session | null, key: string): Promise<Buffer | null> {
    if (!s) return null;
    if (s.id !== this.sessionId) this.clear(s.id);
    const t = s.variants.find((v) => v.last && thumbKey(v.id as VariantId, v.passes, v.last.hash) === key);
    if (!t?.last) return null;
    const cached = this.made.get(t.id);
    if (cached?.key === key) return cached.jpeg;
    const jpeg = sharp(t.last.jpeg).resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: THUMB_QUALITY }).toBuffer();
    this.made.set(t.id, { key, jpeg });
    this.count++;
    // A failed resize is not kept: the next request tries again.
    jpeg.catch(() => {
      if (this.made.get(t.id)?.jpeg === jpeg) this.made.delete(t.id);
    });
    return jpeg;
  }

  /** Drop every thumbnail (the edit ended, or `sessionId` began). */
  clear(sessionId: string | null = null): void {
    this.sessionId = sessionId;
    this.made.clear();
  }

  size(): number {
    return this.made.size;
  }
}
