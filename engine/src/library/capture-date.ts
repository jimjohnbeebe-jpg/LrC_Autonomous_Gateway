// The capture date of a photo file, read before lr_import_photos copies it, and the folder and name
// templates it fills in (GitHub issue #139 gap 1, decisions D1 = A and D2 = A [stated: Jim, 2026-10-29,
// "Go on all."]). Lightroom reports a photo's capture time only after addPhoto, and sharp cannot read a
// NEF [handle: scratchpad exifprobe.mjs, 2026-10-29: sharp gave "Input file contains unsupported image
// format" on both Z8 NEFs], so this walks the EXIF tags itself: TIFF-based files (NEF, DNG, CR2, ARW,
// TIFF and the other raws with a standard TIFF header) and JPEG. Reading tags is not image work (rule 01).
// It read DateTimeOriginal from five NEFs, a DxO DNG, a JPEG and two "-Edit" TIFFs, each matching
// the yyyymmdd its name starts with, and null from a PSD [handle: Claude Code, 2026-10-29, captureDate()
// on each file in fixtures\; kept as the local-only case in engine\tests\capture-date.test.ts]. Other
// makers' files, and DNGs that keep the Exif IFD only in a SubIFD, are [unverified].
// Anything else (CR3, RAF, HEIC, PNG, PSD, a truncated file) gives null, never a throw.

import fs from "node:fs/promises";
import path from "node:path";

/** DateTimeOriginal as the camera wrote it: its local time, no zone [inference: EXIF 2.3 has no zone in the tag]. */
export type CaptureDate = { yyyy: string; mm: string; dd: string; time: string; subsec: string | null };

const HEAD_BYTES = 1 << 20;
const EXIF_IFD = 0x8769;
const DATE_TIME_ORIGINAL = 0x9003;
const SUBSEC_TIME_ORIGINAL = 0x9291;

/** The tags of the IFD at `off` in a TIFF block, by tag: its count and the offset of its value field. */
function ifd(b: Buffer, le: boolean, off: number): Map<number, { count: number; at: number }> {
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const tags = new Map<number, { count: number; at: number }>();
  const n = u16(off);
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    tags.set(u16(e), { count: le ? b.readUInt32LE(e + 4) : b.readUInt32BE(e + 4), at: e + 8 });
  }
  return tags;
}

/** DateTimeOriginal from a TIFF block (`b` starts at its byte-order mark); throws RangeError when truncated. */
function fromTiff(b: Buffer): CaptureDate | null {
  const mark = b.toString("latin1", 0, 2);
  if (mark !== "II" && mark !== "MM") return null;
  const le = mark === "II";
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  if ((le ? b.readUInt16LE(2) : b.readUInt16BE(2)) !== 42) return null;
  const ascii = (t: { count: number; at: number } | undefined): string | null => {
    if (t === undefined) return null;
    const at = t.count <= 4 ? t.at : u32(t.at);
    if (at + t.count > b.length) throw new RangeError("tag past the end");
    return b.toString("latin1", at, at + t.count).replace(/\0[\s\S]*$/, "").trim();
  };
  const ifd0 = ifd(b, le, u32(4));
  const exifAt = ifd0.get(EXIF_IFD);
  const exif = exifAt !== undefined ? ifd(b, le, u32(exifAt.at)) : ifd0;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})/.exec(ascii(exif.get(DATE_TIME_ORIGINAL) ?? ifd0.get(DATE_TIME_ORIGINAL)) ?? "");
  // An unset camera clock writes zeros or blanks [inference]: no date then, rather than a "0000" folder.
  if (m === null || m[1] === "0000" || m[2] === "00" || m[3] === "00") return null;
  const subsec = ascii(exif.get(SUBSEC_TIME_ORIGINAL) ?? ifd0.get(SUBSEC_TIME_ORIGINAL));
  return { yyyy: m[1] as string, mm: m[2] as string, dd: m[3] as string, time: m[4] as string, subsec: subsec !== null && /^\d+$/.test(subsec) ? subsec : null };
}

/** The TIFF block of a JPEG's APP1 "Exif" segment, or null. */
function jpegTiff(b: Buffer): Buffer | null {
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff) {
    const marker = b[off + 1];
    if (marker === 0xda || marker === 0xd9) return null; // image data: no APP1 after it
    const len = b.readUInt16BE(off + 2);
    if (marker === 0xe1 && b.toString("latin1", off + 4, off + 10) === "Exif\0\0") return b.subarray(off + 10, off + 2 + len);
    off += 2 + len;
  }
  return null;
}

/** The capture date in the first bytes of a photo file; null for any format or file it cannot read. */
export function readCaptureDate(head: Buffer): CaptureDate | null {
  try {
    if (head[0] === 0xff && head[1] === 0xd8) {
      const tiff = jpegTiff(head);
      return tiff !== null ? fromTiff(tiff) : null;
    }
    return fromTiff(head);
  } catch {
    return null; // an offset past what was read: a truncated or unusual file
  }
}

/** The capture date of `file`, from its first megabyte. */
export async function captureDate(file: string): Promise<CaptureDate | null> {
  const fh = await fs.open(file, "r").catch(() => null);
  if (fh === null) return null;
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return readCaptureDate(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

export const TEMPLATE_TOKENS = ["{yyyy}", "{mm}", "{dd}", "{name}"] as const;

/**
 * Why a folder_template (`folder` true: may hold \ or /) or name_template is refused, or null: only the
 * four tokens, no characters Windows refuses in a name, and no empty, "." or ".." folder level, so that
 * the copy always lands below copy_to.
 */
export function templateProblem(t: string, folder: boolean): string | null {
  const rest = TEMPLATE_TOKENS.reduce((s, token) => s.split(token).join(""), t);
  if (/[{}]/.test(rest)) return `only the tokens ${TEMPLATE_TOKENS.join(" ")} can be used`;
  if (/[<>:"|?*\x00-\x1f]/.test(t)) return 'cannot hold < > : " | ? * or control characters';
  if (!folder && /[\\/]/.test(t)) return "cannot hold \\ or / (folder levels go in folder_template)";
  if (!folder && !t.includes("{name}")) return "must hold {name}, the source file's name, so that photos of one day keep apart";
  if (t.split(/[\\/]/).some((level) => level.trim() === "" || level === "." || level === "..")) return 'cannot have an empty, "." or ".." folder level';
  return null;
}

/** The template with the tokens filled in; `name` is the source file's name without its extension. */
export function expandTemplate(t: string, date: CaptureDate, name: string): string {
  const values: Record<string, string> = { "{yyyy}": date.yyyy, "{mm}": date.mm, "{dd}": date.dd, "{name}": name };
  return t.replace(/\{(?:yyyy|mm|dd|name)\}/g, (token) => values[token] ?? token);
}

export type ImportTemplates = { folder?: string | undefined; name?: string | undefined };

/**
 * Where `file` (found under `sourceRoot`) is copied in `copyTo`. Without templates its path below the
 * source is kept (a single-file source lands directly in `copyTo`); folder_template replaces that folder,
 * name_template the name. The extension is always kept.
 */
export function importDestination(file: string, sourceRoot: string, copyTo: string, templates: ImportTemplates = {}, date: CaptureDate | null = null): string {
  const rel = file === sourceRoot ? path.basename(file) : path.relative(sourceRoot, file);
  if (date === null || (templates.folder === undefined && templates.name === undefined)) return path.join(copyTo, rel);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const folder = templates.folder !== undefined ? expandTemplate(templates.folder, date, stem) : path.dirname(rel);
  const name = templates.name !== undefined ? expandTemplate(templates.name, date, stem) + ext : path.basename(file);
  return path.join(copyTo, folder, name);
}
