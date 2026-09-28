// How Lightroom writes a Develop preset file (LrC 15.5.1, Camera Raw 18.5.1 [handle: the references'
// crs:Version and reference-settings.lrc15.json `lrc_version`]), pinned by
// `npm run preset:pin` (devtools\preset-pin.ts) from the two reference presets Lightroom wrote
// (engine\tests\fixtures\presets\) into preset-format.lrc15.json. presets\xmp-write.ts writes with it;
// tests\presets-format.test.ts fails when the pinned file is stale. A number's format either was
// observed ("observed") or follows the slider's range ("inference: …"): the file says which.

import { readFileSync } from "node:fs";
import { z } from "zod";

const pair = z.tuple([z.string().min(1), z.string()]);

const numberFormatSchema = z.strictObject({
  /** A value above zero is written with "+" (e.g. crs:Exposure2012="+0.33"). */
  signed: z.boolean(),
  /** Decimal places Lightroom writes (Exposure2012 "0.00": 2); more are kept when the value needs them. */
  decimals: z.number().int().min(0).max(6),
  /** The texts Lightroom wrote for this key in the references, e.g. ["+0.33", "0.00"]. */
  observed: z.array(z.string()),
  /** "observed", or the inference the format rests on. */
  basis: z.string().min(1),
});
export type NumberFormat = z.infer<typeof numberFormatSchema>;

const presetFormatSchema = z.strictObject({
  schema_version: z.literal(1),
  generated_by: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  /** The x:xmptk attribute of x:xmpmeta. */
  xmptk: z.string().min(1),
  /** The preset's own attributes before its settings, in Lightroom's order; UUID's value is replaced per preset. */
  envelope: z.array(pair).min(1),
  /** Attributes after the settings that every preset keeps. */
  trailer: z.array(pair),
  /** The order Lightroom writes settings attributes in (keys it never wrote go after these). */
  order: z.array(z.string().min(1)),
  numbers: z.record(z.string().min(1), numberFormatSchema),
});
export type PresetFormat = z.infer<typeof presetFormatSchema>;

export function parsePresetFormat(raw: unknown): PresetFormat {
  return presetFormatSchema.parse(raw);
}

export function readPresetFormatFile(file: string): PresetFormat {
  return parsePresetFormat(JSON.parse(readFileSync(file, "utf8")));
}
