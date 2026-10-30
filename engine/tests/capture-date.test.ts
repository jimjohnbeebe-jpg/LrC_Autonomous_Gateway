// Issue #139 gap 1: the capture-date reader and the import templates (library\capture-date.ts). The
// photos are built byte by byte (helpers\exif.ts), as fixtures are never committed (rule 04); one case reads
// the repo's own fixtures\ folder where it exists (Jim's machine) and skips elsewhere.

import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureDate, expandTemplate, importDestination, readCaptureDate, templateProblem, type CaptureDate } from "../src/library/index.js";
import { FILE_DEFS } from "../src/mcp/defs-files.js";
import { jpeg, tiff } from "./helpers/exif.js";

const sept6: CaptureDate = { yyyy: "2026", mm: "09", dd: "06", time: "11:12:07", subsec: null };

describe("readCaptureDate", () => {
  it("reads DateTimeOriginal and SubSecTimeOriginal from a little-endian TIFF block (NEF, DNG)", () => {
    expect(readCaptureDate(tiff(true, "2026:09:06 11:12:07", "23"))).toEqual({ ...sept6, subsec: "23" });
  });

  it("reads a big-endian one", () => {
    expect(readCaptureDate(tiff(false, "2026:09:06 11:12:07"))).toEqual(sept6);
  });

  it("finds it in a JPEG's APP1 Exif segment", () => {
    expect(readCaptureDate(jpeg(tiff(false, "2026:09:06 11:12:07", "5")))).toEqual({ ...sept6, subsec: "5" });
  });

  it("gives null, never a throw, for a truncated file, a PNG, a camera without a clock and an empty file", () => {
    expect(readCaptureDate(tiff(true, "2026:09:06 11:12:07").subarray(0, 40))).toBeNull();
    expect(readCaptureDate(jpeg(tiff(true, "2026:09:06 11:12:07")).subarray(0, 30))).toBeNull();
    expect(readCaptureDate(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBeNull();
    expect(readCaptureDate(tiff(true, "0000:00:00 00:00:00"))).toBeNull();
    expect(readCaptureDate(Buffer.alloc(0))).toBeNull();
  });

  it("reads a file from disk, and gives null for one that is not there", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "avg-capture-"));
    writeFileSync(path.join(dir, "a.NEF"), tiff(true, "2025:04:13 06:04:18"));
    expect(await captureDate(path.join(dir, "a.NEF"))).toMatchObject({ yyyy: "2025", mm: "04", dd: "13", time: "06:04:18" });
    expect(await captureDate(path.join(dir, "missing.NEF"))).toBeNull();
  });

  const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
  it.skipIf(!existsSync(fixtures))("reads the date each fixture's name starts with (local only: fixtures are not in git)", async () => {
    const named = readdirSync(fixtures).filter((f) => /^\d{8}-.*\.(nef|dng|jpg|tif)$/i.test(f));
    expect(named.length).toBeGreaterThan(0);
    for (const f of named) {
      const d = await captureDate(path.join(fixtures, f));
      expect(d && `${d.yyyy}${d.mm}${d.dd}`, f).toBe(f.slice(0, 8));
    }
  });
});

describe("import templates", () => {
  it("fills in the tokens and keeps the extension and the sidecar's folder", () => {
    expect(expandTemplate("{yyyy}{mm}{dd}-{name}", sept6, "_OZ80005")).toBe("20260906-_OZ80005");
    const file = path.join("G:", "DCIM", "100NCZ_8", "_OZ80005.NEF");
    const source = path.join("G:", "DCIM");
    const root = path.join("D:", "Photos");
    expect(importDestination(file, source, root, { folder: "{yyyy}-{mm}-{dd}", name: "{yyyy}{mm}{dd}-{name}" }, sept6)).toBe(path.join(root, "2026-09-06", "20260906-_OZ80005.NEF"));
    expect(importDestination(file, source, root, { folder: "{yyyy}/{yyyy}-{mm}-{dd}" }, sept6)).toBe(path.join(root, "2026", "2026-09-06", "_OZ80005.NEF"));
    expect(importDestination(file, source, root, { name: "{yyyy}{mm}{dd}-{name}" }, sept6)).toBe(path.join(root, "100NCZ_8", "20260906-_OZ80005.NEF"));
    // No template: the path below the source, as before issue #139.
    expect(importDestination(file, source, root)).toBe(path.join(root, "100NCZ_8", "_OZ80005.NEF"));
  });

  it("refuses unknown tokens, '..', separators in a name and names without {name}", () => {
    expect(templateProblem("{yyyy}-{mm}-{dd}", true)).toBeNull();
    expect(templateProblem("{yyyy}\\{mm}", true)).toBeNull();
    expect(templateProblem("{year}", true)).toMatch(/only the tokens/);
    expect(templateProblem("{yyyy", true)).toMatch(/only the tokens/);
    expect(templateProblem("..\\{yyyy}", true)).toMatch(/"\.\."/);
    expect(templateProblem("/{yyyy}", true)).toMatch(/empty/);
    expect(templateProblem("C:{yyyy}", true)).toMatch(/:/);
    expect(templateProblem("{yyyy}/{name}", false)).toMatch(/cannot hold \\ or \//);
    expect(templateProblem("{yyyy}{mm}{dd}", false)).toMatch(/\{name\}/);
  });

  it("is checked by the tool's arguments, and both templates need copy_to", () => {
    const s = FILE_DEFS.find((d) => d.name === "lr_import_photos")?.schema as (typeof FILE_DEFS)[number]["schema"];
    const ok = { source: "G:\\DCIM", copy_to: "D:\\Photos", folder_template: "{yyyy}-{mm}-{dd}", name_template: "{yyyy}{mm}{dd}-{name}", dry_run: true };
    expect(s.safeParse(ok).success).toBe(true);
    expect(s.safeParse({ ...ok, folder_template: "{yyyy}\\..\\x" }).success).toBe(false);
    expect(s.safeParse({ ...ok, name_template: "{date}-{name}" }).success).toBe(false);
    expect(s.safeParse({ source: "G:\\DCIM", folder_template: "{yyyy}" }).success).toBe(false);
    expect(s.safeParse({ source: "G:\\DCIM", name_template: "{name}" }).success).toBe(false);
  });
});
