// AVG-S3 pre-check: which fixtures can sharp (libvips) decode on its own?
// Run: node spikes/S3/probe-decoders.ts
// Prints one line per fixture. No Lightroom involved; this is a Claude Code-side check.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type SharpOptions } from "sharp";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

async function describe(file: string, options: SharpOptions): Promise<string> {
  try {
    const meta = await sharp(file, options).metadata();
    const rendered = await sharp(file, options)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer({ resolveWithObject: true });
    const stats = await sharp(rendered.data).stats();
    const means = stats.channels.slice(0, 3).map((c) => c.mean.toFixed(1)).join(",");
    return `decoded ${meta.format} ${meta.width}x${meta.height} -> jpeg ${rendered.info.width}x${rendered.info.height} ${rendered.data.length} B, mean RGB ${means}`;
  } catch (err) {
    return `FAIL ${String((err as Error).message).split("\n")[0]}`;
  }
}

console.log(`sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips} / node ${process.version}`);
for (const name of readdirSync(fixturesDir).sort()) {
  const file = path.join(fixturesDir, name);
  console.log(`${name}\n  default:            ${await describe(file, {})}`);
  if (/\.dng$/i.test(name)) {
    // DNG is TIFF-based: IFD0 is usually a small preview; SubIFDs hold the main/preview images.
    for (const subifd of [0, 1]) {
      console.log(`  failOn=none subifd=${subifd}: ${await describe(file, { failOn: "none", subifd })}`);
    }
  }
}
