// Issue #208: the whole tools/list result (names, titles, descriptions, input schemas, annotations),
// pinned in a file, so an MCP SDK upgrade that changes what clients see fails here. A tool change made
// on purpose updates the file: `npx vitest run tests/mcp-tools-list.test.ts -u` in engine\.

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { createServer, type Tools } from "../src/mcp/index.js";

it("serves the pinned tools/list", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({} as Tools).connect(serverSide);
  const client = new Client({ name: "tools-list", version: "0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/tools-list.json");
});
