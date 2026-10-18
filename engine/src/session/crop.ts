// The crop frame of a session photo (GitHub issue #179; params\crop-frame.ts): taken from the settings the
// call has just read, so a crop the user made in Lightroom meanwhile counts. A crop angle also needs the
// photo's pixel size, which get_context gives (getRawMetadata width/height, the full size after a crop
// [handle: LR_SDK_NOTES.md:154; docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json `crop.size_after_crop`]);
// an uncropped or straight crop needs no extra call.

import { z } from "zod";
import { cropFrame, needsSize, type CropFrame, type SdkSettings } from "../params/index.js";
import { bridge } from "./io.js";
import type { Session, SessionContext, Target } from "./types.js";

const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });

/** The crop frame of `sdk`; `context` gives get_context's answer, asked only when the crop has an angle. Also used by `npm run masks:crop`. */
export async function frameFor(sdk: SdkSettings, context: () => Promise<unknown>): Promise<CropFrame> {
  if (!needsSize(sdk)) return cropFrame(sdk, null);
  const size = sizeSchema.safeParse(await context());
  return cropFrame(sdk, size.success ? size.data : null);
}

export const frameOf = (ctx: SessionContext, s: Session, t: Target, sdk: SdkSettings): Promise<CropFrame> =>
  frameFor(sdk, () => bridge(s, t, () => ctx.deps.client.request("get_context", { target_uuid: t.uuid })));
