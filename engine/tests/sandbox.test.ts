// `npm run sandbox:check` (src/devtools/sandbox-*.ts): the .wsb text, the guest's results file, the
// verdict, and the guest script's PowerShell syntax (parsed by Windows PowerShell's own parser).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENABLE_SANDBOX, judge, lastProgress, MIN_CHECKS, parseGuestResults, wsbText } from "../src/devtools/sandbox-model.js";

const GUEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "devtools", "sandbox-guest.ps1");

const checks = (n: number, bad: number[] = []) => Array.from({ length: n }, (_, i) => ({ check: `check ${i}`, ok: !bad.includes(i), detail: "d" }));
const results = (over: Record<string, unknown> = {}) => JSON.stringify({ finished: true, version: "1.0.0", checks: checks(MIN_CHECKS), facts: {}, ...over });

describe("sandbox .wsb", () => {
  const wsb = wsbText("D:\\Developer\\Lr & C\\release", "C:\\Temp\\LrC-AVG\\phase9\\sandbox_1", "1.0.0", "24.11.1");

  it("maps release read-only and the results folder writable, with the network on for the WebView2 download", () => {
    expect(wsb).not.toContain("<Networking>");
    expect(wsb).toContain("<HostFolder>D:\\Developer\\Lr &amp; C\\release</HostFolder>\n      <SandboxFolder>C:\\Release</SandboxFolder>\n      <ReadOnly>true</ReadOnly>");
    expect(wsb).toContain("<HostFolder>C:\\Temp\\LrC-AVG\\phase9\\sandbox_1</HostFolder>\n      <SandboxFolder>C:\\Results</SandboxFolder>\n      <ReadOnly>false</ReadOnly>");
  });

  it("runs the guest script from the results folder with the version and the pinned Node", () => {
    expect(wsb).toContain("<Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Results\\guest.ps1 -Version 1.0.0 -NodeVersion 24.11.1</Command>");
  });

  it("is well-formed: every opened element is closed", () => {
    const stack: string[] = [];
    for (const [, close, name] of wsb.matchAll(/<(\/?)(\w+)>/g)) {
      if (close) expect(stack.pop()).toBe(name);
      else stack.push(name as string);
    }
    expect(stack).toEqual([]);
  });
});

describe("sandbox results", () => {
  it("parses the guest's file, with the BOM Windows PowerShell may write and a null detail", () => {
    const r = parseGuestResults("\uFEFF" + results({ checks: [{ check: "a", ok: true, detail: null }] }));
    expect(r.checks).toEqual([{ check: "a", ok: true, detail: "" }]);
  });

  it("rejects a file that is not the guest's", () => {
    expect(() => parseGuestResults("{}")).toThrow();
    expect(() => parseGuestResults("not json")).toThrow();
  });

  it("passes only when finished, the version matches, enough checks ran and all passed", () => {
    expect(judge(parseGuestResults(results()), "1.0.0").pass).toBe(true);
    const failed = judge(parseGuestResults(results({ checks: checks(MIN_CHECKS, [3]) })), "1.0.0");
    expect(failed.pass).toBe(false);
    expect(failed.lines.filter((l) => l.startsWith("[FAIL]")).join("\n")).toContain("check 3");
    expect(judge(parseGuestResults(results({ finished: false })), "1.0.0").pass).toBe(false);
    expect(judge(parseGuestResults(results({ version: "0.99.0" })), "1.0.0").pass).toBe(false);
    expect(judge(parseGuestResults(results({ checks: checks(2) })), "1.0.0").pass).toBe(false);
  });

  it("lastProgress is the last non-empty line, or says there was none", () => {
    expect(lastProgress("a\r\nb\r\n\r\n")).toBe("b");
    expect(lastProgress("")).toContain("no progress");
  });

  it("tells Jim the one administrator command, marked [unverified]", () => {
    expect(ENABLE_SANDBOX).toContain("Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All");
    expect(ENABLE_SANDBOX).toContain("[unverified]");
  });
});

describe("sandbox guest script", () => {
  it("has the parameters the .wsb passes and ends by shutting the Sandbox down", () => {
    const text = readFileSync(GUEST, "utf8");
    expect(text).toMatch(/\[string\]\$Version/);
    expect(text).toMatch(/\[string\]\$NodeVersion/);
    expect(text.trimEnd().endsWith("shutdown.exe /s /t 5")).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("parses without a syntax error in Windows PowerShell", () => {
    const ps = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:GUEST,[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.Message+' line '+$_.Extent.StartLineNumber};exit 1}";
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", env: { ...process.env, GUEST }, timeout: 60_000 });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
