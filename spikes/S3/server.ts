// AVG-S3: minimal stdio MCP server that returns a fixture as a 1600 px q75 JPEG
// image content block, to test whether Claude Desktop (and Claude Code) render
// image tool results and whether Claude can describe them.
//
// Run by an MCP client, not by hand:  node <repo>/spikes/S3/server.ts
// Only stderr is used for logging; stdout carries the MCP JSON-RPC stream.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sharp from "sharp";
import { z } from "zod";

const LONG_EDGE = 1600;
const QUALITY = 75;
// LRC_AVG_FIXTURES_DIR exists only so smoke-client.ts can exercise the image path without
// writing into the real fixtures folder.
const fixturesDir =
  process.env["LRC_AVG_FIXTURES_DIR"] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function listFixtures(): string[] {
  return readdirSync(fixturesDir).filter((n) => !n.startsWith(".")).sort();
}

const server = new McpServer({ name: "lrc-avg-spike-s3", version: "0.0.0" });

server.registerTool(
  "get_fixture_preview",
  {
    title: "Get fixture preview",
    description:
      `Render one file from the LrC-AVG fixtures folder to a JPEG (long edge ${LONG_EDGE} px, quality ${QUALITY}) and return it as an image, plus a text line with its byte size. ` +
      "sharp cannot decode Nikon NEF raw files; use a JPEG exported from Lightroom into the fixtures folder.",
    inputSchema: { name: z.string().min(1).describe("File name inside fixtures\\, e.g. 20260907-_OZ80093.jpg") },
  },
  async ({ name }) => {
    const available = listFixtures();
    if (path.basename(name) !== name || !available.includes(name)) {
      return {
        isError: true,
        content: [{ type: "text", text: `No fixture named "${name}". Available: ${available.join(", ")}` }],
      };
    }
    const started = performance.now();
    try {
      const { data, info } = await sharp(path.join(fixturesDir, name))
        .rotate()
        .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: QUALITY })
        .toBuffer({ resolveWithObject: true });
      const ms = Math.round(performance.now() - started);
      console.error(`[s3] ${name} -> ${info.width}x${info.height} ${data.length} B in ${ms} ms`);
      return {
        content: [
          { type: "image", data: data.toString("base64"), mimeType: "image/jpeg" },
          {
            type: "text",
            text: `fixture=${name} jpeg_bytes=${data.length} base64_chars=${Math.ceil(data.length / 3) * 4} size=${info.width}x${info.height} quality=${QUALITY} render_ms=${ms}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `sharp could not render ${name}: ${String((err as Error).message).split("\n")[0]}` }],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
console.error(`[s3] lrc-avg-spike-s3 ready on stdio; fixtures: ${fixturesDir}`);
