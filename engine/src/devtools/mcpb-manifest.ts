// The .mcpb manifest (issue #219, #172), built at package time from the server's own tool list, so a tool
// added later is in the bundle with no list kept by hand (upstream shipped a hand-kept list that went stale,
// its fix #330 [upstream claim: issue #219 body]). A test compares it with what a client sees in tools/list.
// Field names follow the MCPB manifest format, version 0.3 [unverified: checked against no copy of the spec
// in this repo; Claude Desktop's install of the bundle is Jim's run].

import type { ToolDef } from "../mcp/defs-shared.js";

export type McpbManifest = {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string };
  license: string;
  repository: { type: string; url: string };
  server: { type: "node"; entry_point: string; mcp_config: { command: string; args: string[] } };
  tools: Array<{ name: string; description: string }>;
  compatibility: { platforms: string[]; runtimes: { node: string } };
};

/** The bundle's server folder is the engine package's contents: dist, intents, schemas, node_modules. */
export const MCPB_ENTRY = "server/dist/mcp/main.js";

/** The first sentence of a tool description (the manifest's list is for people; the full text comes from the server). */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  return m?.[0] ?? flat;
}

export function buildManifest(version: string, defs: ToolDef[]): McpbManifest {
  return {
    manifest_version: "0.3",
    name: "lrc-avg",
    display_name: "LrC-AVG",
    version,
    description: "Edit the photo selected in Lightroom Classic with native Develop settings, one measured pass at a time. Needs the LrC-AVG Lightroom plug-in, added in Lightroom's Plug-in Manager.",
    author: { name: "Jim Beebe" },
    license: "MIT",
    repository: { type: "git", url: "https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway" },
    server: { type: "node", entry_point: MCPB_ENTRY, mcp_config: { command: "node", args: ["${__dirname}/" + MCPB_ENTRY] } },
    tools: defs.map((d) => ({ name: d.name, description: firstSentence(d.description) })),
    compatibility: { platforms: ["win32"], runtimes: { node: ">=22" } },
  };
}
