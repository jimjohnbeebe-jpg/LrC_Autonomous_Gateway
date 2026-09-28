// `npm run preset:capture [-- --precheck] [-- --second]` (preset-capture.ts): run from the repo root with
// Lightroom open, the LrC-AVG plugin enabled and Claude Desktop not using LrC-AVG (this takes the
// engine's instance lock). It writes nothing to Lightroom. The fixtures go to
// engine\tests\fixtures\presets\ with the user folder written as %USERPROFILE%; the run's report to
// %TEMP%\LrC-AVG\presets\capture_<time>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { defaultPresetDir } from "../presets/index.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { capturePreset, REFERENCES, type Capture, type ReferenceSpec } from "./preset-capture.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE_DIR = path.join(repoRoot, "engine", "tests", "fixtures", "presets");
const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "presets");
const SETTINGS_DIR = defaultPresetDir();
const redact = (text: string): string => redactHome(text, os.homedir());

async function capture(precheck: boolean, spec: ReferenceSpec): Promise<Capture> {
  if (SETTINGS_DIR === null) throw new Error("no preset folder: %APPDATA% is not set, nor LRC_AVG_PRESET_DIR");
  const settingsDir = SETTINGS_DIR;
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: () => {}, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  try {
    await gate.ready();
    return await capturePreset(
      {
        photo: async () => {
          const context = await client.request("get_context", {});
          return { uuid: context.uuid, filename: typeof context["filename"] === "string" ? context["filename"] : null, lrc_version: context.lrc_version };
        },
        settings: async (uuid) => (await client.request("get_settings", { target_uuid: uuid })).settings,
        settingsDir,
        save: (file, text) => {
          mkdirSync(FIXTURE_DIR, { recursive: true });
          writeFileSync(path.join(FIXTURE_DIR, file), redact(text));
        },
        now: () => new Date(),
      },
      loadDefaultParamMap(),
      { precheck, spec },
    );
  } finally {
    await gate.release();
  }
}

async function main(): Promise<number> {
  const precheck = process.argv.includes("--precheck");
  const spec = process.argv.includes("--second") ? REFERENCES.second : REFERENCES.first;
  const result = await capture(precheck, spec);
  const what = `${precheck ? "Photo check" : "Preset capture"} ("${spec.name}")`;
  console.log(`${what}: ${result.worked ? "WORKED" : "FAILED"}`);
  for (const line of result.problems) console.log(`  problem: ${line}`);
  for (const line of result.findings) console.log(`  finding: ${line}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `capture_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${redact(JSON.stringify({ precheck, ...result }, null, 2))}\n`);
  console.log(`Report: ${redact(file)}`);
  return result.worked ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.log(`FAILED: ${describeError(err)}`);
    process.exitCode = 1;
  },
);
