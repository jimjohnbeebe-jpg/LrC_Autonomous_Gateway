// The AI's display name and model (src/session/client.ts, issue #155 R1/R2).

import { describe, expect, it } from "vitest";
import { UNNAMED, displayModel, displayName, sentenceName } from "../src/session/index.js";

describe("displayName", () => {
  it("prefers the title, then the known name, then the raw name", () => {
    expect(displayName({ name: "opencode", title: "My Client", version: "1" })).toBe("My Client");
    expect(displayName({ name: "opencode", version: "1" })).toBe("OpenCode");
    expect(displayName({ name: "codex-mcp-client", version: "1" })).toBe("Codex");
    expect(displayName({ name: "some-agent", version: "" })).toBe("some-agent");
  });

  it("says 'the AI' for no client and for the MCP SDK's default name", () => {
    expect(UNNAMED).toBe("the AI");
    expect(displayName(null)).toBe("the AI");
    expect(displayName()).toBe("the AI");
    expect(displayName({ name: "mcp", version: "0.1.0" })).toBe("the AI");
  });

  it("cleans and cuts to 32 characters", () => {
    expect(displayName({ name: "x", title: " A\u0007b%c\n ", version: "" })).toBe("Abc");
    expect(displayName({ name: "x", title: "y".repeat(50), version: "" })).toBe("y".repeat(32));
    expect(displayName({ name: "%%\u0001", version: "" })).toBe("the AI");
  });
});

describe("sentenceName", () => {
  it("upper-cases the first letter", () => {
    expect(sentenceName()).toBe("The AI");
    expect(sentenceName({ name: "opencode", version: "" })).toBe("OpenCode");
  });
});

describe("displayModel", () => {
  it("cleans, cuts to 80 and gives null for nothing", () => {
    expect(displayModel("openai/gpt-6%\t")).toBe("openai/gpt-6");
    expect(displayModel("m".repeat(100))).toBe("m".repeat(80));
    expect(displayModel(" \u0000 ")).toBeNull();
    expect(displayModel(undefined)).toBeNull();
    expect(displayModel(null)).toBeNull();
  });
});
