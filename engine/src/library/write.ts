// The catalog writes kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2): lr_set_rating and
// lr_set_keywords, and lr_set_gps (GitHub issue #60), write one photo per plugin command
// (plugin\LrC-AVG.lrplugin\Library.lua), each photo read before and after. The guard is decision D3-A
// of the row's plan [stated: Jim, 2026-10-02, "Go"]: photos named by uuid only, at most MAX_PHOTOS per
// call, and only between sessions (tools-catalog.ts runs them in SessionManager.whenIdle, as
// lr_sync_series).
//
// Per photo, as lr_sync_series does per target (sync\target.ts): a refusal Lightroom answered (no
// photo with that uuid, a failed read) lists the photo in `failed` and the others are still written;
// a command with no answer stops the call, and when it was sent the error names the photo as
// `maybe_written`, since Lightroom may still carry it out [inference: sync\target.ts UNANSWERED].

import { ToolError, toToolError } from "../mcp/errors.js";
import { UNANSWERED, mayHaveLanded } from "../sync/target.js";

/** Photos per call [inference: the figure; lr_sync_series takes 20, sync\types.ts MAX_TARGETS]. */
export const MAX_PHOTOS = 100;
/** Keyword names per call, added and removed each [inference: the figure; Automaat takes 1000, vendor\automaat\server\src\tool-contracts.ts:13]. */
export const MAX_KEYWORDS = 50;
export const MAX_KEYWORD_LENGTH = 100;

/** A GPS position in decimal degrees; null for none. */
export type Gps = { latitude: number; longitude: number } | null;
/**
 * How far a read-back coordinate may sit from the one written: 1e-5 degrees, about 1 m [inference:
 * the figure; the precision Lightroom keeps is [unverified] until Jim's check].
 */
export const GPS_TOLERANCE = 1e-5;

const where = (p: Gps): string => (p === null ? "no GPS position" : `(${p.latitude}, ${p.longitude})`);

/** What a GPS read-back shows Lightroom did not take, or null. */
export function gpsNotTaken(after: Gps, want: Gps): string | null {
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= GPS_TOLERANCE;
  const taken = want === null ? after === null : after !== null && close(after.latitude, want.latitude) && close(after.longitude, want.longitude);
  return taken ? null : `Lightroom read back ${where(after)}, not ${where(want)}.`;
}

/**
 * A plugin answer for one photo: its value before and after the write. A write gate that raised
 * comes back as `write_error`, a failed read-back as `after_error` with no `after`; `before` is
 * always there (Greptile, PR #57).
 */
export type PhotoWrite<T> = {
  uuid: string;
  filename?: string | undefined;
  before: T;
  after?: T | undefined;
  write_error?: string | undefined;
  after_error?: string | undefined;
};
type ReadBack<T> = PhotoWrite<T> & { after: T };

/** Why a photo's write cannot be trusted, or null: the gate raised, or the value was not read back. */
function unsure<T>(r: PhotoWrite<T>, what: string): string | null {
  const why = [
    ...(r.write_error !== undefined ? [`Lightroom raised an error while writing the ${what}: ${r.write_error}.`] : []),
    ...(r.after === undefined ? [`Lightroom could not read the ${what} back${r.after_error !== undefined ? `: ${r.after_error}` : ""}.`] : []),
  ];
  return why.length === 0 ? null : `${why.join(" ")} The photo may have changed; \`before\` holds its ${what} before the call.`;
}

export type Failed = { uuid: string; code: string; message: string; before?: unknown; after?: unknown };

export type WriteResult<T> = {
  photos: Array<{ uuid: string; filename: string | null; before: T; after: T; changed: boolean }>;
  failed: Failed[];
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Send `write` for each photo in turn. `problem` names what the read-back shows Lightroom did not
 * take (code `notTaken`), or null. `what` names the value in messages ("rating", "keywords").
 */
export async function writeEach<T>(
  uuids: readonly string[],
  write: (uuid: string) => Promise<PhotoWrite<T>>,
  problem: (r: ReadBack<T>) => string | null,
  what: string,
  notTaken: string,
): Promise<WriteResult<T>> {
  const out: WriteResult<T> = { photos: [], failed: [] };
  for (const [i, uuid] of uuids.entries()) {
    let r: PhotoWrite<T>;
    try {
      r = await write(uuid);
    } catch (err) {
      const error = toToolError(err);
      if (UNANSWERED.has(error.code)) throw stopped(err, error, uuid, uuids.slice(i + 1), out, what);
      const unknown = error.code === "PLUGIN_ERROR" ? ` Whether Lightroom wrote the ${what} is unknown: list the photo again to see.` : "";
      out.failed.push({ uuid, code: error.code, message: error.message + unknown });
      continue;
    }
    const doubt = unsure(r, what);
    if (doubt) {
      const code = r.write_error !== undefined ? "WRITE_FAILED" : "READ_BACK_FAILED";
      out.failed.push({ uuid, code, message: doubt, before: r.before, ...(r.after !== undefined ? { after: r.after } : {}) });
      continue;
    }
    const why = problem(r as ReadBack<T>);
    if (why) out.failed.push({ uuid, code: notTaken, message: why, before: r.before, after: r.after });
    else out.photos.push({ uuid, filename: r.filename ?? null, before: r.before, after: r.after as T, changed: !same(r.before, r.after) });
  }
  return out;
}

/** The call stops at `uuid`: Lightroom did not answer. The details list what was done before it. */
function stopped<T>(err: unknown, error: ToolError, uuid: string, rest: string[], out: WriteResult<T>, what: string): ToolError {
  const maybe = mayHaveLanded(err);
  const tail = maybe ? ` Lightroom may still write the ${what} of ${uuid}.` : ` Nothing was sent for ${uuid}.`;
  return new ToolError(error.code, `${error.message}${tail}`, error.recoverable, {
    ...(maybe ? { maybe_written: uuid } : {}),
    written: out.photos,
    failed: out.failed,
    not_sent: maybe ? rest : [uuid, ...rest],
  });
}
