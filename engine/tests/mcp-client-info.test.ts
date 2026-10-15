// The MCP client's identity (src/mcp/client-info.ts), the call context that carries it
// (src/mcp/call-context.ts) and the tool log's pending line (src/log/tool-log.ts), issue #155 R1/R3.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolLogPendingRecord } from "../src/log/index.js";
import { callClient, callLogFields, withCallContext } from "../src/mcp/call-context.js";
import { clientIdentity } from "../src/mcp/client-info.js";

describe("clientIdentity", () => {
  it("cleans, cuts to 64 and drops an empty title", () => {
    expect(clientIdentity({ name: " opencode\n", title: "", version: "1.2%" })).toEqual({ name: "opencode", version: "1.2" });
    expect(clientIdentity({ name: "a", title: "T\u0000", version: "v" })).toEqual({ name: "a", title: "T", version: "v" });
    expect(clientIdentity({ name: "n".repeat(100), version: "v".repeat(100) })).toEqual({ name: "n".repeat(64), version: "v".repeat(64) });
    expect(clientIdentity({ name: "x" })).toEqual({ name: "x", version: "" });
  });

  it("gives null for garbage and never throws", () => {
    for (const raw of [undefined, null, 42, "x", [], {}, { name: "" }, { name: "%\u0001" }, { name: 5, version: "1" }, { name: "x", title: 3 }]) {
      expect(clientIdentity(raw)).toBeNull();
    }
    const hostile = { get name(): string { throw new Error("boom"); } };
    expect(() => clientIdentity(hostile)).not.toThrow();
  });
});

describe("call context", () => {
  const client = { name: "opencode", title: "OpenCode", version: "1.0" };

  it("callClient is null outside a call and the client inside", () => {
    expect(callClient()).toBeNull();
    expect(withCallContext({ progressToken: false, client }, () => callClient())).toEqual(client);
    expect(withCallContext({ progressToken: false }, () => callClient())).toBeNull();
  });

  it("callLogFields carries the client's name and version only", () => {
    expect(callLogFields()).toEqual({});
    expect(withCallContext({ progressToken: true, client }, () => callLogFields())).toEqual({
      progress_token: true,
      client: { name: "opencode", version: "1.0" },
    });
    expect(withCallContext({ progressToken: false, client: null }, () => callLogFields())).toEqual({ progress_token: false });
  });
});

describe("ToolLogPendingRecord", () => {
  it("does not pass for a finished call", () => {
    const record: ToolLogPendingRecord = { ts: "2026-10-15T00:00:00Z", tool: "lr_step", pending: "detached", args: {} };
    expect(z.looseObject({ ts: z.string(), tool: z.string(), ok: z.boolean() }).safeParse(record).success).toBe(false);
  });
});
