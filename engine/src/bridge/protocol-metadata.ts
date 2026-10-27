// Result schemas of plugin 0.22.0's metadata commands (plugin\LrC-AVG.lrplugin\Metadata.lua; GitHub
// issues #111, #112, #139 gap 4), kept apart from protocol-results.ts by size; protocol.ts merges both
// into COMMANDS. The GPS schemas live here, so this file imports nothing of the bridge's own.

import { z } from "zod";

/** A GPS position as the plugin sends it (Photos.lua position). */
export const gpsPosition = z.object({ latitude: z.number(), longitude: z.number() });

/**
 * A photo's GPS position as set_gps reads it (plugin 0.10.0, Library.lua gpsOf), `false` for none:
 * a Lua table cannot hold a nil field, so "none" needs a value the plugin's Json.lua writes [inference].
 */
export const gpsWire = z.union([gpsPosition, z.literal(false)]);

const targeted = { uuid: z.string().min(1) };

/**
 * A photo's text fields as Metadata.lua reads them, "" for none, by SDK metadata key: title, caption and headline;
 * plugin 1.5.0 adds creator, copyright, the location fields and (Lightroom 13.2 or later) the accessibility texts.
 */
const iptcText = z.record(z.string(), z.string());

/** One photo before and after a write, as set_rating's result (protocol-results.ts). */
const written = <T extends z.ZodType>(value: T) =>
  z.object({
    ...targeted,
    filename: z.string().optional(),
    before: value,
    after: value.optional(),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  });

export const METADATA_RESULTS = {
  // The pick flag (1, 0, -1) or title, caption and headline before and after; not written when the
  // photo already held them.
  set_flag: written(z.number()),
  set_iptc: written(iptcText),
  // A part whose read failed is absent and named in `errors`. `stack` is false outside a stack. Loose: plugin
  // 1.5.0 sends every text field of iptcText by its SDK key, and label, rating, capture_time, path, copy_name
  // and virtual_copy.
  get_metadata: z.looseObject({
    label: z.string().optional(),
    rating: z.number().optional(),
    capture_time: z.string().optional(),
    path: z.string().optional(),
    copy_name: z.string().optional(),
    virtual_copy: z.boolean().optional(),
    ...targeted,
    filename: z.string().optional(),
    title: z.string().optional(),
    caption: z.string().optional(),
    headline: z.string().optional(),
    flag: z.number().optional(),
    keywords: z.array(z.string()).optional(),
    gps: gpsWire.optional(),
    stack: z
      .union([
        z.literal(false),
        z.object({ position: z.number().optional(), count: z.number().optional(), collapsed: z.boolean(), top_uuid: z.string().optional() }),
      ])
      .optional(),
    errors: z.array(z.string()).optional(),
  }),
} as const;
