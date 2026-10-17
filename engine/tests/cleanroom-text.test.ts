// The clean room's text edits (src/devtools/cleanroom-text.ts): one entry out of opencode.jsonc or
// Hermes's config.yaml and back, byte for byte, also into a file that changed elsewhere since.

import { describe, expect, it } from "vitest";
import { cut, jsoncSpan, reinsert, yamlSpan } from "../src/devtools/cleanroom-text.js";

// Shaped as Jim's files were on 2026-10-17 (keys and layout; paths shortened).
const OPENCODE = `{
  "$schema": "https://opencode.ai/config.json",
  // Ask before anything runs; LrC-AVG's own tools run without a prompt.
  "permission": {
    "*": "ask",
    "lrc-avg_*": "allow"
  },
  "mcp": {
    "servers": {
      "lrc-avg": {
        "type": "local",
        // Direct lrc-avg_lr_* tool calls, so renders reach the model as images ("not" {through} execute).
        "codemode": false,
        "command": ["C:\\\\node.exe", "D:\\\\engine\\\\dist\\\\mcp\\\\main.js"]
      }
    }
  }
}
`;
const HERMES = "model: x\r\ntelemetry:\r\n  shared_metrics:\r\n    enabled: false\r\n\nmcp_servers:\n  lrc_avg:\n    command: 'C:\\node.exe'\n    args: ['D:\\main.js']\n";

function roundTrip(t: string, s: { start: number; end: number }) {
  const c = cut(t, s);
  expect(reinsert(c.text, c.removed, c.anchor)).toBe(t);
  return c;
}

describe("cleanroom text: opencode.jsonc", () => {
  it("cuts the only server out whole, comments and brackets in strings included, and puts it back", () => {
    const s = jsoncSpan(OPENCODE, "lrc-avg");
    expect(s).not.toBeNull();
    const c = roundTrip(OPENCODE, s!);
    expect(c.text).toContain(`"servers": {\n    }`);
    expect(c.text).toContain(`"lrc-avg_*": "allow"`);
    expect(jsoncSpan(c.text, "lrc-avg")).toBeNull();
  });

  it("takes the trailing comma of a middle member, or the comma before a last one", () => {
    const mid = `{ "mcp": {\n  "lrc-avg": { "a": 1 },\n  "other": { "b": 2 }\n} }`;
    expect(roundTrip(mid, jsoncSpan(mid, "lrc-avg")!).text).toBe(`{ "mcp": {\n  "other": { "b": 2 }\n} }`);
    const last = `{ "mcp": {\n  "other": { "b": 2 },\n  "lrc-avg": { "a": 1 }\n} }`;
    expect(roundTrip(last, jsoncSpan(last, "lrc-avg")!).text).toBe(`{ "mcp": {\n  "other": { "b": 2 }\n} }`);
  });

  it("refuses two entries and ignores the name as a string value", () => {
    expect(() => jsoncSpan(`{"a":{"lrc-avg":{}},"b":{"lrc-avg":{}}}`, "lrc-avg")).toThrow(/2 times/);
    expect(jsoncSpan(`{"name": "lrc-avg"}`, "lrc-avg")).toBeNull();
  });
});

describe("cleanroom text: Hermes config.yaml", () => {
  it("cuts mcp_servers with its only server, mixed line ends kept, and puts it back", () => {
    const c = roundTrip(HERMES, yamlSpan(HERMES, "lrc_avg")!);
    expect(c.text).toBe("model: x\r\ntelemetry:\r\n  shared_metrics:\r\n    enabled: false\r\n\n");
  });

  it("keeps mcp_servers when another server is under it", () => {
    const t = "mcp_servers:\n  lrc_avg:\n    command: n\n  other:\n    command: o\nnext: 1\n";
    expect(roundTrip(t, yamlSpan(t, "lrc_avg")!).text).toBe("mcp_servers:\n  other:\n    command: o\nnext: 1\n");
  });

  it("finds a flow-style entry as written by clients-config.ts, and nothing when absent", () => {
    const t = 'a: 1\nmcp_servers:\n  lrc_avg: {"command":"n","args":[]}\n';
    expect(roundTrip(t, yamlSpan(t, "lrc_avg")!).text).toBe("a: 1\n");
    expect(yamlSpan("a: 1\nmcp_servers:\n  other: {}\n", "lrc_avg")).toBeNull();
  });
});

describe("cleanroom text: reinsert into a file that changed", () => {
  it("puts the entry back at its place when the file changed elsewhere, and refuses when the place changed", () => {
    const c = cut(HERMES, yamlSpan(HERMES, "lrc_avg")!);
    expect(reinsert("# new first line\r\n" + c.text, c.removed, c.anchor)).toBe("# new first line\r\n" + HERMES);
    expect(reinsert(c.text.replace("enabled: false", "enabled: true"), c.removed, c.anchor)).toBeNull();
  });
});
