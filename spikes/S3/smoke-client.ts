// AVG-S3 plumbing check (no Claude involved): spawn server.ts over stdio with the
// MCP SDK client, list tools, call get_fixture_preview, and report what came back.
// Proves the server emits a valid image content block; it does NOT answer whether
// Claude Desktop renders it — that is Jim's observation.
//
// Run: node spikes/S3/smoke-client.ts <fixture-name> [fixtures-dir]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [name, dirOverride] = process.argv.slice(2);
if (!name) {
  console.error("usage: node spikes/S3/smoke-client.ts <fixture-name> [fixtures-dir]");
  process.exit(2);
}

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.ts");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
if (dirOverride) env["LRC_AVG_FIXTURES_DIR"] = path.resolve(dirOverride);

const client = new Client({ name: "s3-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "inherit" }));

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const result = await client.callTool({ name: "get_fixture_preview", arguments: { name } });
const content = (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
console.log(`isError: ${result.isError === true}`);
for (const block of content) {
  if (block.type === "image") {
    const bytes = Buffer.from(block.data ?? "", "base64");
    const soi = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    console.log(`image block: mimeType=${block.mimeType} base64_chars=${block.data?.length} decoded_bytes=${bytes.length} jpeg_soi=${soi}`);
  } else {
    console.log(`${block.type} block: ${block.text}`);
  }
}
await client.close();
