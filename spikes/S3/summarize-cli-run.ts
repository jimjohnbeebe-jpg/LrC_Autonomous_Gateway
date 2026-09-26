// AVG-S3: summarise a Claude Code CLI run of the S3 prompt, captured with
//   claude -p "<prompt>" --mcp-config spikes\S3\claude-code.mcp.json --strict-mcp-config
//     --allowedTools "mcp__lrc-avg-spike-s3__get_fixture_preview" --output-format stream-json --verbose
// so the report's Claude Code CLI column comes from one command.
//
// Run (PowerShell, from the repo root):
//   node spikes/S3/summarize-cli-run.ts <run.jsonl> [redacted-out.jsonl]
//
// Prints the model, the MCP server status, each tool call, what each tool result contained
// (image blocks: media type, base64 length, decoded size, JPEG start marker) and Claude's final
// text. With a second argument it also writes a copy that is small enough to commit and says
// nothing about the rest of Jim's setup (the repo is public): base64 image payloads and thinking
// signatures are replaced by placeholders; the init event keeps only the fields the report uses
// (its full form lists every installed plugin, skill and agent); rate-limit and thinking-token
// progress events are dropped; the result event keeps only its outcome fields.

import { readFileSync, writeFileSync } from "node:fs";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile) {
  console.error("usage: node spikes/S3/summarize-cli-run.ts <run.jsonl> [redacted-out.jsonl]");
  process.exit(2);
}

type Json = Record<string, unknown>;
const lines = readFileSync(inFile, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
const events = lines.map((l) => JSON.parse(l) as Json);
const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const contentOf = (e: Json): Json[] => asArray((e["message"] as Json | undefined)?.["content"]);

console.log(`file: ${inFile} (${events.length} events)`);

const init = events.find((e) => e["type"] === "system" && e["subtype"] === "init");
if (init) {
  const servers = asArray(init["mcp_servers"]).map((s) => `${String(s["name"])}=${String(s["status"])}`);
  const mcpTools = (init["tools"] as string[] | undefined)?.filter((t) => t.startsWith("mcp__")) ?? [];
  console.log(`model: ${String(init["model"])}; mcp servers: ${servers.join(", ") || "-"}; mcp tools: ${mcpTools.join(", ") || "-"}`);
}

for (const e of events) {
  for (const block of contentOf(e)) {
    if (block["type"] === "tool_use") {
      console.log(`tool call: ${String(block["name"])} ${JSON.stringify(block["input"])}`);
    }
    if (block["type"] === "tool_result") {
      for (const part of asArray(block["content"])) {
        if (part["type"] === "image") {
          const source = (part["source"] ?? {}) as Json;
          const data = typeof source["data"] === "string" ? source["data"] : "";
          const bytes = Buffer.from(data, "base64");
          const soi = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
          console.log(`  tool result image: media_type=${String(source["media_type"])} base64_chars=${data.length} decoded_bytes=${bytes.length} jpeg_soi=${soi}`);
        } else if (part["type"] === "text") {
          console.log(`  tool result text: ${String(part["text"])}`);
        } else {
          console.log(`  tool result ${String(part["type"])}: ${JSON.stringify(part).slice(0, 120)}`);
        }
      }
    }
  }
}

const result = events.find((e) => e["type"] === "result");
if (result) {
  console.log(`result: subtype=${String(result["subtype"])} is_error=${String(result["is_error"])} duration_ms=${String(result["duration_ms"])} num_turns=${String(result["num_turns"])}`);
}
const finalText = [...events].reverse().flatMap((e) => contentOf(e)).find((b) => b["type"] === "text");
console.log("\n--- Claude's final text ---");
console.log(finalText ? String(finalText["text"]) : "(none)");

if (outFile) {
  const redact = (_key: string, value: unknown): unknown => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const o = value as Json;
      if (o["type"] === "base64" && typeof o["data"] === "string") {
        return { ...o, data: `<base64 removed: ${o["data"].length} chars>` };
      }
      if (o["type"] === "thinking" && typeof o["signature"] === "string") {
        return { ...o, signature: "<signature removed>" };
      }
    }
    return value;
  };
  const pick = (o: Json, keys: string[]): Json => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  const kept = events.flatMap((e): Json[] => {
    if (e["type"] === "rate_limit_event") return [];
    if (e["type"] === "system" && e["subtype"] === "thinking_tokens") return [];
    if (e["type"] === "system" && e["subtype"] === "init") {
      const mcpTools = (e["tools"] as string[] | undefined)?.filter((t) => t.startsWith("mcp__")) ?? [];
      return [{ ...pick(e, ["type", "subtype", "cwd", "model", "mcp_servers", "claude_code_version", "permissionMode"]), mcp_tools: mcpTools }];
    }
    if (e["type"] === "result") return [pick(e, ["type", "subtype", "is_error", "duration_ms", "duration_api_ms", "num_turns", "stop_reason"])];
    return [e];
  });
  writeFileSync(outFile, kept.map((e) => JSON.stringify(e, redact)).join("\n") + "\n");
  console.log(`\nredacted copy written: ${outFile}`);
}
