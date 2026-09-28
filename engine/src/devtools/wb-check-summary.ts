// The white balance check's summary and last lines (wb-check.ts runs the steps). Split out to keep
// wb-check.ts under the module size target (.claude\rules\01-stack.md "Module size").

import { CUSTOM_WHITE_BALANCE } from "../params/index.js";
import { yn, type Json } from "./phase3-config.js";

/**
 * What a step's write came to, so a step never reads as NO unless Lightroom answered NO (Greptile,
 * PR #39 rounds 2-3): null, not run (nothing sent); "failed", Lightroom answered with an error;
 * "unknown", sent with no answer (Lightroom may have applied it); else the step's yes/no `field`.
 */
export type Outcome = boolean | null | "failed" | "unknown";
export function outcome(s: Json | undefined, field: string): Outcome {
  if (s === undefined || s["written"] === null) return null;
  if (s["maybe_written"] !== undefined) return "unknown";
  if (s["error"] !== undefined) return "failed";
  return s[field] === true;
}
const WORDS: Record<string, string> = { null: "not run", failed: "write failed", unknown: "unknown (sent, no answer)" };
const said = (v: Outcome): string => (typeof v === "boolean" ? yn(v) : (WORDS[String(v)] as string));

/** The summary in the results and the headlines in the window. WORKED: no error, and the photo put back. */
export function summarize(results: Json, errors: readonly string[], say: (line: string) => void, now: () => Date): { worked: boolean; results: Json } {
  const putBackOk = results["put_back"] !== undefined && (results["put_back"] as Json)["ok"] === true;
  const worked = errors.length === 0 && putBackOk;
  const preset = results["preset"] as Json | undefined;
  const alone = results["temperature_alone"] as Json | undefined;
  const aloneWrite = outcome(alone, "temperature_taken");
  const summary = {
    suggestion: worked ? "WORKED" : "FAILED",
    // The white balance Lightroom read back after step 1; null unless it answered (the step's entry says why).
    white_balance_after_temperature_alone: typeof aloneWrite === "boolean" ? (alone?.["white_balance"] ?? null) : null,
    custom_taken_with_temperature: outcome(results["temperature_custom"] as Json | undefined, "custom_taken"),
    custom_taken_with_tint: outcome(results["tint_custom"] as Json | undefined, "custom_taken"),
    preset_carries_temperature_after_custom: preset ? (preset["after_custom"] as Json)["temperature_carried"] === true : null,
    put_back: putBackOk,
  };
  results["summary"] = summary;
  results["finished_at"] = now().toISOString();
  say("");
  say(`White balance check: ${summary.suggestion}`);
  say(`  Temperature alone left white balance: ${typeof aloneWrite === "boolean" ? `"${String(summary.white_balance_after_temperature_alone)}"` : said(aloneWrite)}`);
  say(`  Lightroom took "${CUSTOM_WHITE_BALANCE}" with a temperature: ${said(summary.custom_taken_with_temperature)}; with a tint: ${said(summary.custom_taken_with_tint)}; a preset then carries the temperature: ${said(summary.preset_carries_temperature_after_custom)}`);
  say(`  PUT BACK: ${results["put_back"] === undefined ? "not run (nothing was written)" : yn(putBackOk)}`);
  return { worked, results };
}
