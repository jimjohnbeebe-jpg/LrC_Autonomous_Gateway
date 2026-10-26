// The intent errors (split out of loader.ts with validate.ts, Phase 10 row 5).

export type IntentErrorCode = "intent_not_found" | "invalid_intent" | "intent_exists";

/** A structured intent failure ({code, message, recoverable}, PRD NFR-7). */
export class IntentError extends Error {
  readonly code: IntentErrorCode;
  readonly problems: string[];

  constructor(code: IntentErrorCode, message: string, problems: string[] = []) {
    super(message);
    this.name = "IntentError";
    this.code = code;
    this.problems = problems;
  }
}
