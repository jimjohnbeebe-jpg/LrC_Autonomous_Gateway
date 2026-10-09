// The params module's structured error ({code, message, recoverable}, PRD NFR-7); mcp\errors.ts maps
// each code to the tool's error code.

export type ParamErrorCode =
  | "unknown_parameter"
  | "wrong_type"
  | "out_of_range"
  /** Older than the supported ones (or none): update the photo in Lightroom. */
  | "unsupported_process_version"
  /** Newer than the supported ones: it comes with a Lightroom this engine does not know yet. */
  | "newer_process_version"
  /** The photo's settings match neither pipeline (pipeline.ts). */
  | "pipeline_unknown"
  /** A value of the other pipeline, e.g. a raw camera profile for a JPEG. */
  | "wrong_pipeline";

export class ParamError extends Error {
  readonly code: ParamErrorCode;
  readonly parameter: string | null;
  readonly recoverable = false;

  constructor(code: ParamErrorCode, message: string, parameter: string | null = null) {
    super(message);
    this.name = "ParamError";
    this.code = code;
    this.parameter = parameter;
  }
}
