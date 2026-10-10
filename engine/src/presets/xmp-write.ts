// Writes a Develop preset file the way Lightroom writes its own: the same element layout,
// indentation and attribute order, and each number in the format pinned from Lightroom's files
// (params\preset-format.lrc15.json). What goes in is presets\select.ts's choice. The layout is
// Lightroom's [handle: engine\tests\fixtures\presets\reference-2.lrc15.xmp; tests\presets-reference.test.ts
// compares the two].

import type { NumberFormat, PresetFormat } from "../params/preset-format.js";
import type { PresetEntry } from "./select.js";

export type PresetText = { uuid: string; name: string; group: string; entries: PresetEntry[] };

const NS_RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const NS_CRS = "http://ns.adobe.com/camera-raw-settings/1.0/";
/** The rdf:Alt elements Lightroom writes after the attributes, in its order; empty ones as <rdf:li …/>. */
const ALT_ELEMENTS = ["Name", "ShortName", "SortName", "Group", "Description"] as const;

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

/** At least `decimals` places, more when the value needs them, so nothing is rounded away. */
function exact(value: number, decimals: number): string {
  for (let d = decimals; d <= 10; d++) {
    const text = value.toFixed(d);
    if (Number(text) === value) return text;
  }
  return String(value);
}

/** A boolean as Lightroom writes one [handle: every reference file's crs:ConvertToGrayscale="False" / "True", crs:HasSettings="True"]. */
export const formatBoolean = (value: boolean): string => (value ? "True" : "False");

/** A number as Lightroom writes that key: "+0.33", "-21", "25", "0.00". */
export function formatNumber(value: number, format: NumberFormat | undefined): string {
  const text = exact(value, format?.decimals ?? 0);
  return format?.signed && value > 0 ? `+${text}` : text;
}

function altElement(name: string, text: string): string[] {
  const li = text === "" ? '     <rdf:li xml:lang="x-default"/>' : `     <rdf:li xml:lang="x-default">${escapeXml(text)}</rdf:li>`;
  return [`   <crs:${name}>`, "    <rdf:Alt>", li, "    </rdf:Alt>", `   </crs:${name}>`];
}

/** A point curve [x0, y0, x1, y1, …] as Lightroom's rdf:Seq of "x, y". */
function curveElement(key: string, points: number[]): string[] {
  const items: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) items.push(`     <rdf:li>${points[i]}, ${points[i + 1]}</rdf:li>`);
  return [`   <crs:${key}>`, "    <rdf:Seq>", ...items, "    </rdf:Seq>", `   </crs:${key}>`];
}

/** The settings attributes in Lightroom's order; keys it never wrote come after, in the order given. */
function settingsAttributes(format: PresetFormat, entries: PresetEntry[]): Array<[string, string]> {
  const rank = (key: string): number => {
    const i = format.order.indexOf(key);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return entries
    .filter((e) => !Array.isArray(e.value))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.key) - rank(b.e.key) || a.i - b.i)
    .map(({ e }): [string, string] => [e.key, typeof e.value === "number" ? formatNumber(e.value, format.numbers[e.key]) : typeof e.value === "boolean" ? formatBoolean(e.value) : String(e.value)]);
}

export function renderPreset(format: PresetFormat, preset: PresetText): string {
  const envelope = format.envelope.map(([k, v]): [string, string] => [k, k === "UUID" ? preset.uuid : v]);
  const attrs = [...envelope, ...settingsAttributes(format, preset.entries), ...format.trailer];
  const alts: Record<(typeof ALT_ELEMENTS)[number], string> = { Name: preset.name, ShortName: "", SortName: "", Group: preset.group, Description: "" };
  const lines = [
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${escapeXml(format.xmptk)}">`,
    ` <rdf:RDF xmlns:rdf="${NS_RDF}">`,
    '  <rdf:Description rdf:about=""',
    `    xmlns:crs="${NS_CRS}"`,
    ...attrs.map(([k, v], i) => `   crs:${k}="${escapeXml(v)}"${i === attrs.length - 1 ? ">" : ""}`),
    ...ALT_ELEMENTS.flatMap((name) => altElement(name, alts[name])),
    ...preset.entries.flatMap((e) => (Array.isArray(e.value) ? curveElement(e.key, e.value) : [])),
    "  </rdf:Description>",
    " </rdf:RDF>",
    "</x:xmpmeta>",
  ];
  return `${lines.join("\n")}\n`;
}
