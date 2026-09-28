// `npm run preset:pin`: writes engine\src\params\preset-format.lrc15.json from the reference presets
// (preset-pin.ts). Run it after `npm run preset:capture`; tests\presets-format.test.ts fails while
// the pinned file differs from what the references give.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultParamMap } from "../params/index.js";
import { derivePresetFormat, PRESET_SOURCES } from "./preset-pin.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = path.join(repoRoot, "engine", "src", "params", "preset-format.lrc15.json");

const texts = PRESET_SOURCES.map((file) => readFileSync(path.join(repoRoot, file), "utf8"));
const format = derivePresetFormat(loadDefaultParamMap(), texts);
writeFileSync(OUT, `${JSON.stringify(format, null, 2)}\n`);
const inferred = Object.entries(format.numbers).filter(([, f]) => f.basis !== "observed").length;
console.log(`Wrote ${path.relative(repoRoot, OUT)}: ${format.order.length} settings in order, ${Object.keys(format.numbers).length} number formats (${inferred} by the range rule).`);
