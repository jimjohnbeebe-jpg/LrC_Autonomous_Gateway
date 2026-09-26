// Newline framing for the bridge sockets (Phase 0, P-14).

import { StringDecoder } from "node:string_decoder";
import { describe, expect, it } from "vitest";
import { LineSplitter, LineTooLongError } from "../src/bridge/lines.js";

describe("bridge: LineSplitter", () => {
  it("returns every complete line in one chunk", () => {
    expect(new LineSplitter().push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("joins a line split across chunks and keeps the unfinished rest", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push("1}\n{")).toEqual(['{"a":1}']);
    expect(s.buffered()).toBe(1);
    expect(s.push('"b":2}\n')).toEqual(['{"b":2}']);
    expect(s.buffered()).toBe(0);
  });

  it("drops empty lines and a trailing carriage return", () => {
    expect(new LineSplitter().push("\n\r\nx\r\n\n")).toEqual(["x"]);
  });

  it("joins a large line from many chunks", () => {
    const s = new LineSplitter();
    const piece = "x".repeat(64 * 1024);
    for (let i = 0; i < 32; i++) expect(s.push(piece)).toEqual([]);
    const [line] = s.push("\n");
    expect(line).toHaveLength(32 * 64 * 1024);
  });

  it("keeps UTF-8 intact when a character is split across socket chunks", () => {
    // The client sets the socket encoding to utf8; Node's decoder holds a split character.
    const bytes = Buffer.from('{"nonce":"é漢字 ✓"}\n', "utf8");
    const decoder = new StringDecoder("utf8");
    const s = new LineSplitter();
    const cut = bytes.indexOf(0xe6) + 1; // inside the 3-byte "漢"
    const lines = [...s.push(decoder.write(bytes.subarray(0, cut))), ...s.push(decoder.write(bytes.subarray(cut)))];
    expect(lines).toEqual(['{"nonce":"é漢字 ✓"}']);
  });

  it("refuses a line longer than the limit and starts over", () => {
    const s = new LineSplitter(10);
    expect(() => s.push("x".repeat(11))).toThrow(LineTooLongError);
    expect(s.buffered()).toBe(0);
    expect(s.push("ok\n")).toEqual(["ok"]);
  });
});
