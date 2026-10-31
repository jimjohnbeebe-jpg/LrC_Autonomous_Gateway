// The types of a session's reference photos (references.ts), apart so types.ts can name them without an import cycle.

import type { Perceptual, ReferenceAggregate } from "../metrics/index.js";

export type ReferenceSpec = { uuids?: string[] | undefined; collection?: string | undefined };
export type ReferenceSet = {
  source: "begin" | "intent";
  collection: string | null;
  /** The uuids asked for, after the collection's were added and the list cut to MAX_REFERENCES. */
  uuids: string[];
  measured: Array<{ uuid: string; perceptual: Perceptual }>;
  warnings: string[];
  aggregate: ReferenceAggregate;
};
/** What a reference is rendered at: the session's preview (and measure) size. */
export type ReferenceSize = { longEdge: number; quality: number; measureEdge: number | null };
