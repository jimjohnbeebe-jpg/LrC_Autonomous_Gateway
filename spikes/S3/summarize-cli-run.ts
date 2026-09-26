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
// progress events are dropped; the result event keeps only its outcome fields. Local paths are
// scrubbed from everything printed or written: the CLI's "[Image: source: <path>]" note loses its
// path, and the home folder becomes "~".

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile) {
  console.error("usage: node spikes/S3/summarize-cli-run.ts <run.jsonl> [redacted-out.jsonl]");
  process.exit(2);
}

// Only the fields this script reads are checked; everything else passes through untouched.
const Part = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  source: z.looseObject({ type: z.string(), media_type: z.string().optional(), data: z.string().optional() }).optional(),
});
const Block = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  text: z.string().optional(),
  content: z.union([z.array(Part), z.string()]).optional(),
});
const Event = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  mcp_servers: z.array(z.looseObject({ name: z.string(), status: z.string() })).optional(),
  message: z.looseObject({ content: z.union([z.array(Block), z.string()]).optional() }).optional(),
  is_error: z.boolean().optional(),
  duration_ms: z.number().optional(),
  num_turns: z.number().optional(),
});
type EventT = z.infer<typeof Event>;
type BlockT = z.infer<typeof Block>;

const events: EventT[] = readFileSync(inFile, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "")
  .map((l, i) => {
    const parsed = Event.safeParse(JSON.parse(l) as unknown);
    if (!parsed.success) throw new Error(`line ${i + 1}: unexpected event shape: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return parsed.data;
  });
const blocksOf = (e: EventT): BlockT[] => (Array.isArray(e.message?.content) ? e.message.content : []);

const home = os.homedir();
const homePattern = new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
const scrub = (s: string): string =>
  s.replace(/\[Image: source: [^\]]*\]/g, "[Image: source: <local path removed>]").replace(homePattern, "~");

console.log(`file: ${path.basename(inFile)} (${events.length} events)`);

const init = events.find((e) => e.type === "system" && e.subtype === "init");
if (init) {
  const servers = (init.mcp_servers ?? []).map((s) => `${s.name}=${s.status}`);
  const mcpTools = (init.tools ?? []).filter((t) => t.startsWith("mcp__"));
  console.log(`model: ${init.model ?? "-"}; mcp servers: ${servers.join(", ") || "-"}; mcp tools: ${mcpTools.join(", ") || "-"}`);
}

for (const e of events) {
  for (const block of blocksOf(e)) {
    if (block.type === "tool_use") {
      console.log(`tool call: ${block.name ?? "-"} ${scrub(JSON.stringify(block.input))}`);
    }
    if (block.type === "tool_result") {
      const parts = Array.isArray(block.content) ? block.content : [{ type: "text", text: block.content ?? "" }];
      for (const part of parts) {
        if (part.type === "image") {
          const data = part.source?.data ?? "";
          const bytes = Buffer.from(data, "base64");
          const soi = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
          console.log(`  tool result image: media_type=${part.source?.media_type ?? "-"} base64_chars=${data.length} decoded_bytes=${bytes.length} jpeg_soi=${soi}`);
        } else if (part.type === "text") {
          console.log(`  tool result text: ${scrub(part.text ?? "")}`);
        } else {
          console.log(`  tool result ${part.type}: ${scrub(JSON.stringify(part)).slice(0, 120)}`);
        }
      }
    }
  }
}

const result = events.find((e) => e.type === "result");
if (result) {
  console.log(`result: subtype=${result.subtype ?? "-"} is_error=${String(result.is_error)} duration_ms=${String(result.duration_ms)} num_turns=${String(result.num_turns)}`);
}
const finalText = [...events].reverse().flatMap(blocksOf).find((b) => b.type === "text");
console.log("\n--- Claude's final text ---");
console.log(finalText ? scrub(finalText.text ?? "") : "(none)");

if (outFile) {
  const redact = (_key: string, value: unknown): unknown => {
    if (typeof value === "string") return scrub(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      if (o["type"] === "base64" && typeof o["data"] === "string") {
        return { ...o, data: `<base64 removed: ${o["data"].length} chars>` };
      }
      if (o["type"] === "thinking" && typeof o["signature"] === "string") {
        return { ...o, signature: "<signature removed>" };
      }
    }
    return value;
  };
  const pick = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
    Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  const kept = events.flatMap((e): Record<string, unknown>[] => {
    if (e.type === "rate_limit_event") return [];
    if (e.type === "system" && e.subtype === "thinking_tokens") return [];
    if (e.type === "system" && e.subtype === "init") {
      const mcpTools = (e.tools ?? []).filter((t) => t.startsWith("mcp__"));
      return [{ ...pick(e, ["type", "subtype", "cwd", "model", "mcp_servers", "claude_code_version", "permissionMode"]), mcp_tools: mcpTools }];
    }
    if (e.type === "result") return [pick(e, ["type", "subtype", "is_error", "duration_ms", "duration_api_ms", "num_turns", "stop_reason"])];
    return [e];
  });
  writeFileSync(outFile, kept.map((e) => JSON.stringify(e, redact)).join("\n") + "\n");
  console.log(`\nredacted copy written: ${path.basename(outFile)}`);
}
