// Photo headers built byte by byte for the capture-date tests (issue #139): fixtures are never committed (rule 04).

/** A TIFF block: IFD0 holding only the Exif pointer, then an Exif IFD with DateTimeOriginal (and SubSecTimeOriginal). */
export function tiff(le: boolean, date: string, subsec?: string): Buffer {
  const entries = subsec !== undefined ? 2 : 1;
  const exifAt = 26;
  const dataAt = exifAt + 2 + 12 * entries + 4;
  const b = Buffer.alloc(dataAt + date.length + 1);
  const w16 = (o: number, v: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (o: number, v: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  b.write(le ? "II" : "MM", 0, "latin1");
  w16(2, 42);
  w32(4, 8);
  w16(8, 1);
  w16(10, 0x8769);
  w16(12, 4);
  w32(14, 1);
  w32(18, exifAt);
  w16(exifAt, entries);
  w16(exifAt + 2, 0x9003);
  w16(exifAt + 4, 2);
  w32(exifAt + 6, date.length + 1);
  w32(exifAt + 10, dataAt);
  if (subsec !== undefined) {
    w16(exifAt + 14, 0x9291);
    w16(exifAt + 16, 2);
    w32(exifAt + 18, subsec.length + 1); // up to 3 digits: the value sits in the entry itself
    b.write(subsec, exifAt + 22, "latin1");
  }
  b.write(date, dataAt, "latin1");
  return b;
}

/** A JPEG: SOI, a JFIF APP0, the APP1 "Exif" segment around `block`, then SOS. */
export function jpeg(block: Buffer): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const app1 = Buffer.alloc(10);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(2 + 6 + block.length, 2);
  app1.write("Exif\0\0", 4, "latin1");
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, block, Buffer.from([0xff, 0xda, 0x00, 0x02])]);
}
