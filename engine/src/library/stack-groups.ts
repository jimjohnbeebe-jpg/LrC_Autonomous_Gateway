// lr_import_photos' stack_gap_seconds (GitHub issue #139, decision D3 = A [stated: Jim, 2026-10-29, "Go on all."]):
// consecutive files of the sorted listing whose capture dates (capture-date.ts) lie within the gap of the file
// before them form one group, which the import stacks with its first frame on top. Only differences between
// dates are used, so the camera's time zone, which DateTimeOriginal does not hold, cancels out [inference].
// A file with no readable date starts a group of its own and joins none.

import { captureDate, type CaptureDate } from "./capture-date.js";

export type DateOf = (file: string) => Promise<CaptureDate | null>;

/** The capture date in seconds, read as if UTC, with its subseconds ("5" is 0.5 s). */
export function captureSeconds(d: CaptureDate): number {
  const [h = 0, mi = 0, s = 0] = d.time.split(":").map(Number);
  return Date.UTC(Number(d.yyyy), Number(d.mm) - 1, Number(d.dd), h, mi, s) / 1000 + (d.subsec !== null ? Number(`0.${d.subsec}`) : 0);
}

/** `read`, each file read once: the import reads a file's date for its group and again for its templates. */
export function datesOnce(read: DateOf = captureDate): DateOf {
  const seen = new Map<string, Promise<CaptureDate | null>>();
  return (file) => {
    let date = seen.get(file);
    if (date === undefined) seen.set(file, (date = read(file)));
    return date;
  };
}

/**
 * Whether files[i] is in the group of files[i - 1]. It reads only those two files' dates, so a call reads
 * no further ahead than it imports.
 */
export function joinsPrevious(files: readonly string[], gapSeconds: number, dateOf: DateOf): (i: number) => Promise<boolean> {
  return async (i) => {
    if (i <= 0 || i >= files.length) return false;
    const [a, b] = await Promise.all([dateOf(files[i - 1] as string), dateOf(files[i] as string)]);
    return a !== null && b !== null && Math.abs(captureSeconds(b) - captureSeconds(a)) <= gapSeconds;
  };
}
