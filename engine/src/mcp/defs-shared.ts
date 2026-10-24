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
  "clip_high_pct = % of pixels with any channel >= 253; clip_high_tone_pct = % with 2+ channels >= 253 (the high guard's); " +
  "clip_low_pct = % of pixels with all channels <= 2; " +
  "luma = Rec. 709 weights on the 8-bit values (0-255); luma_percentiles p1-p99 by nearest rank; " +
  "dynamic_range = (p99 - p1) / 255; rb_ratio = mean red / mean blue (a white-balance proxy); " +
  "saturation_mean = mean HSV saturation, 0-100; hue_histogram = 12 bins of 30 degrees (bin i centred on i*30: " +
  "0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta), % of the chromatic pixels (HSV saturation and value " +
  ">= 0.1, chromatic_pct of all); hue_mean = their circular mean hue in degrees. Percentages are 0-100.";

/** The tools that stop starting photos after library\files.ts CALL_BUDGET_MS (export, import, sync). */
export const TIMED =
  "A call works for about 30 seconds, then stops starting new photos and returns `not_yet` and `next`, saying how to go on: keep calling " +
  "until `not_yet` is gone, and tell the user how far along it is. A call still busy at 50 seconds returns `pending` with `next`.";

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
/**
 * The one frame of every point and box the tools take or give (GitHub issue #179): the preview, which follows
 * a Lightroom crop [handle: src\mcp\tools-context.ts regionPreview, "The export follows a Lightroom crop"];
 * mask geometry is mapped to the uncropped photo by params\crop-frame.ts.
 */
export const FRAME = "0-1 of the preview you see (the photo as cropped in Lightroom, upright), from its top-left corner";
export const box = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .describe(`a box in ${FRAME}: {x, y, w, h}`);
