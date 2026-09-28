// What the MCP tool definitions share (server.ts has the list of groups): the definition type, the
// metrics note, and the argument schemas more than one group uses.

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Tools } from "./tools.js";
import { DEFAULT_LONG_EDGE, MAX_LONG_EDGE, MIN_LONG_EDGE, type ToolOutput } from "./tools-shared.js";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject;
  annotations: Tool["annotations"];
  run: (tools: Tools, args: Record<string, unknown>) => Promise<ToolOutput>;
};

export const MEASURED =
  "Metrics are measured on the rendered preview (8-bit sRGB, as Lightroom exported it), not on the raw file: " +
  "clipping here can often be recovered from the raw data with highlights/whites or shadows/blacks. " +
  "clip_high_pct = % of pixels with any channel >= 253; clip_low_pct = % of pixels with all channels <= 2; " +
  "luma = Rec. 709 weights on the 8-bit values (0-255); luma_percentiles p1-p99 by nearest rank; " +
  "dynamic_range = (p99 - p1) / 255; rb_ratio = mean red / mean blue (a white-balance proxy); " +
  "saturation_mean = mean HSV saturation, 0-100; hue_histogram = 12 bins of 30 degrees (bin i centred on i*30: " +
  "0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta), % of the chromatic pixels (HSV saturation and value " +
  ">= 0.1, chromatic_pct of all); hue_mean = their circular mean hue in degrees. Percentages are 0-100.";

export const longEdge = z
  .number()
  .int()
  .min(MIN_LONG_EDGE)
  .max(MAX_LONG_EDGE)
  .optional()
  .describe(`Preview long edge in pixels, ${MIN_LONG_EDGE}-${MAX_LONG_EDGE} (default ${DEFAULT_LONG_EDGE}).`);

export const noArgs = z.object({});
/** A session photo: the master, or a copy of a Variants session. */
export const target = z.enum(["master", "A", "B", "C"]).optional();
export const sessionId = z.string().min(1).describe("the session_id from lr_begin_session");
export const box = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .describe("a box in 0-1 of the image's width and height, from the top-left corner: {x, y, w, h}");
