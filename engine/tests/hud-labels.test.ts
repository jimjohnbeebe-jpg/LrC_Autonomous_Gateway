// What the HUD says about a pass (fix/hud-p1, critique P1 "Engine words throughout"): Lightroom's
// panel labels for the sliders (src/params/labels.ts) and one sentence per guardrail status
// (src/hud/payload.ts hudGuardrail), built from the clamps and refusals session/plan.ts really
// writes, each within the HUD's text limit and free of engine words.

import { describe, expect, it } from "vitest";
import { HUD_LIMITS } from "../src/bridge/index.js";
import { hudGuardrail } from "../src/hud/index.js";
import type { GuardrailAction } from "../src/log/index.js";
import type { MetricsSummary } from "../src/metrics/index.js";
import { CAMERA_PROFILE_PARAM, CANONICAL_PARAMS, lightroomLabel, loadDefaultParamMap } from "../src/params/index.js";
import { applyProjectedGuardrail, planStep, type Limits, type StepPlan } from "../src/session/index.js";
import { hudWordProblems } from "./helpers/hud-harness.js";

const map = loadDefaultParamMap();
const limits: Limits = { clipHighPct: 0.5, clipLowPct: 1 };
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const of = (plan: StepPlan) => hudGuardrail({ guardrail_actions: [], refused: plan.refused, clamped: plan.clamped }, limits);
const acted = (...actions: Array<Pick<GuardrailAction, "kind" | "limit" | "reason">>) =>
  hudGuardrail({ guardrail_actions: actions.map((a) => ({ ...a, history_name: null, changes: {}, metrics_after: null })), refused: [], clamped: [] }, limits);
const last = (clipHigh: number): MetricsSummary => ({ clip_high_pct: clipHigh, clip_low_pct: 0 }) as MetricsSummary;

describe("Lightroom's labels", () => {
  it("label every canonical parameter and the camera profile", () => {
    const names = [...CANONICAL_PARAMS.keys(), CAMERA_PROFILE_PARAM];
    expect(names.filter((n) => lightroomLabel(n) === n)).toEqual([]);
    expect(names.length).toBe(CANONICAL_PARAMS.size + 1);
  });

  it("use the Develop panel's words, Jim's check of LrC 15.5.1", () => {
    expect(
      ["temperature", "camera_profile", "hsl.orange.sat", "hsl.aqua.lum", "grading.midtones.hue", "grading.global.sat", "grading.blending", "sharpening.masking", "noise.color", "lens.corrections_enable", "lens.ca_remove", "tone_curve.master", "tone_curve.blue"].map(lightroomLabel),
    ).toEqual(["Temp", "Profile", "Orange Saturation", "Aqua Luminance", "Midtones Hue", "Global Saturation", "Blending", "Sharpening Masking", "Noise Reduction Color", "Lens Corrections (panel on/off)", "Remove Chromatic Aberration", "Point Curve", "Point Curve Blue"]);
  });

  it("fall back to the name itself for a name they do not know", () => {
    expect(lightroomLabel("vignette.amount")).toBe("vignette.amount");
  });
});

describe("The guardrail sentence", () => {
  it("green: none, the plugin says the clipping is within limits", () => {
    expect(of(planStep({ exposure: 0.2 }, { exposure: 0 }, 1, map))).toEqual({ status: "green" });
  });

  it("clamped: by the pass's limit, the slider's range, or the probe's slope", () => {
    expect(of(planStep({ clarity: 100 }, { clarity: 0 }, 1, map))).toEqual({ status: "clamped", reason: "Clarity: change held to ±40 this pass." });
    expect(of(planStep({ exposure: 0.5 }, { exposure: 4.8 }, 1, map))).toEqual({ status: "clamped", reason: "Exposure: held at the end of its range." });
    const sloped = applyProjectedGuardrail(planStep({ exposure: 0.5 }, { exposure: 0 }, 1, map), last(0.2), limits, new Map([["exposure", { luma_mean: 0, clip_high_pct: 1, clip_low_pct: 0 }]]));
    expect(of(sloped)).toEqual({ status: "clamped", reason: "Exposure: change held back to keep clipping within limits." });
  });

  it("refused: not on this photo, no room left, or the clipping guardrail", () => {
    expect(of(planStep({ "hsl.red.sat": 10 }, {}, 1, map))).toEqual({ status: "refused", reason: "Red Saturation: not available on this photo, not changed." });
    expect(of(planStep({ exposure: 0.5 }, { exposure: 5 }, 1, map))).toEqual({ status: "refused", reason: "Exposure: not changed, no room left within this pass's limit." });
    expect(of(applyProjectedGuardrail(planStep({ exposure: 0.3 }, { exposure: 0 }, 1, map), last(0.8), limits))).toEqual({
      status: "refused",
      reason: "Exposure: not changed, it would push clipping over the limit.",
    });
  });

  it("corrected, unmet and undone, from the actions' limits and readings (session/guardrail.ts reasons)", () => {
    expect(acted({ kind: "corrected", limit: "clip_high", reason: "clip_high_pct was 1.2345 %, over the limit of 0.5 %" })).toEqual({
      status: "corrected",
      reason: "Highlight clipping was 1.23 % (limit 0.5 %); corrected.",
    });
    expect(acted({ kind: "corrected", limit: "clip_low", reason: "x" }, { kind: "unmet", limit: "clip_low", reason: "clip_low_pct is still 3 %, over the limit of 1 %, after the corrections this pass allows" })).toEqual({
      status: "unmet",
      reason: "Shadow clipping is still 3 % (limit 1 %) after corrections.",
    });
    expect(acted({ kind: "reverted", limit: "clip_high", reason: "clip_high_pct is 2 % after the corrections" })).toEqual({ status: "undone", reason: "Pass undone: highlight clipping went over the limit." });
    expect(acted({ kind: "reverted", limit: "region", reason: 'region "face" drifted' })).toEqual({ status: "undone", reason: "Pass undone: a region changed more than allowed." });
  });

  it("keeps every guardrail sentence within the HUD's text limit, in the photographer's words", () => {
    const sentences: string[] = [];
    for (const [name, spec] of CANONICAL_PARAMS) {
      if (spec.kind !== "number") continue; // only numeric sliders are clamped or refused (session/plan.ts)
      const reasons = ["pass 9 allows at most ±12345.67", "the slider's range is 0..1", "the probe's slope projects a clipping breach"];
      for (const reason of reasons) sentences.push(String(hudGuardrail({ guardrail_actions: [], refused: [], clamped: [{ name, requested: 1, applied: 12345.67, reason }] }, limits).reason));
      for (const r of [{ by: "slider" as const, reason: "x is not available" }, { by: "slider" as const, reason: "no change is left" }, { by: "guardrail" as const, reason: "x" }]) {
        sentences.push(String(hudGuardrail({ guardrail_actions: [], refused: [{ name, ...r }], clamped: [] }, limits).reason));
      }
    }
    sentences.push(String(acted({ kind: "unmet", limit: "clip_high", reason: "clip_high_pct is still 100 %, over the limit of 0.5 %" }).reason));
    expect(sentences.filter((s) => bytes(s) > HUD_LIMITS.text)).toEqual([]);
    expect(sentences.filter((s) => hudWordProblems(s).length > 0)).toEqual([]);
  });
});
