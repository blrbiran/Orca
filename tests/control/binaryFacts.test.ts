import { describe, expect, it } from "vitest";
import { binaryFacts, JPEG_SCAN_MAX_BYTES, ZIP_DIRECTORY_MAX_BYTES } from "../../src/control/binaryFacts.js";

/**
 * Tester #337 (prompt half): a criterion about a binary deliverable ("the logo is 512x512", "a Word document") is judgeable
 * only if the reviewer is told the file's type and size; these are read by code from the header, never guessed. A file that
 * is not recognised, or whose header is past the bound, says less -- never something wrong.
 */
const u16be = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const png = (width: number, height: number) => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const dims = Buffer.alloc(8); dims.writeUInt32BE(width, 0); dims.writeUInt32BE(height, 4);
  return Buffer.concat([head, Buffer.from("IHDR"), dims, Buffer.from([8, 6, 0, 0, 0])]);
};
const segment = (marker: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
const sof = (marker: number, width: number, height: number) => segment(marker, Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3])]));
const jpeg = (...segments: Buffer[]) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3])]);
/** A minimal ZIP: empty stored entries, their central directory and the end record. */
const zip = (names: readonly string[]) => {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(n.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(n.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, n); central.push(entry, n);
    offset += 30 + n.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

describe("binary facts for the requirement review (#337)", () => {
  it("names a PDF and its version, and says its page count is not read", () => {
    // mutation: drop the PDF branch -> null, red
    expect(binaryFacts(Buffer.from("%PDF-1.7\n%âã\n1 0 obj", "latin1"))).toBe("PDF document (version 1.7); its page count is not read");
  });

  it("gives a PNG's size from IHDR, and only its type when the header is cut", () => {
    // mutation: drop the PNG branch -> null, red; swap width and height -> 480x640, red
    expect(binaryFacts(png(640, 480))).toBe("PNG image, 640x480 pixels");
    // mutation: drop the IHDR check -> reads past a cut header (throws), red
    expect(binaryFacts(png(640, 480).subarray(0, 20))).toBe("PNG image");
  });

  it("gives a GIF's size from its logical screen descriptor", () => {
    // mutation: drop the GIF branch -> null, red
    expect(binaryFacts(Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x10, 0x01, 0x20, 0x00]), Buffer.from([0, 0, 0])]))).toBe("GIF image, 272x32 pixels");
    expect(binaryFacts(Buffer.from("GIF87a\u0001"))).toBe("GIF image");
  });

  it("gives a JPEG's size from the first frame header, past other segments and Huffman tables", () => {
    const app0 = segment(0xe0, Buffer.from("JFIF\u0000\u0001\u0001\u0000\u0000\u0001\u0000\u0001\u0000\u0000", "latin1"));
    const dht = segment(0xc4, Buffer.alloc(20, 1));
    // mutation: drop the JPEG branch -> null, red
    expect(binaryFacts(jpeg(app0, sof(0xc0, 800, 600)))).toBe("JPEG image, 800x600 pixels");
    // mutation: treat DHT (C4) as a frame header -> reads its bytes as the size, red
    expect(binaryFacts(jpeg(app0, dht, sof(0xc2, 1024, 768)))).toBe("JPEG image, 1024x768 pixels");
    // No frame header before the scan: the type only.
    expect(binaryFacts(jpeg(app0))).toBe("JPEG image");
  });

  it("stops looking for a JPEG frame header at the bound", () => {
    const filler: Buffer[] = [];
    for (let size = 0; size <= JPEG_SCAN_MAX_BYTES; size += 65_537) filler.push(segment(0xe1, Buffer.alloc(65_533)));
    // mutation: scan the whole blob -> finds the frame header past the bound, red
    expect(binaryFacts(jpeg(...filler, sof(0xc0, 10, 20)))).toBe("JPEG image");
    expect(binaryFacts(jpeg(filler[0]!, sof(0xc0, 10, 20)))).toBe("JPEG image, 10x20 pixels");
  });

  it("names a ZIP-based office document from its entries", () => {
    // mutation: drop the docx / xlsx / pptx / OpenDocument line -> "ZIP archive", red
    expect(binaryFacts(zip(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]))).toBe("ZIP archive: a Word document (docx)");
    expect(binaryFacts(zip(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]))).toBe("ZIP archive: an Excel workbook (xlsx)");
    expect(binaryFacts(zip(["[Content_Types].xml", "ppt/presentation.xml"]))).toBe("ZIP archive: a PowerPoint presentation (pptx)");
    expect(binaryFacts(zip(["mimetype", "content.xml", "styles.xml"]))).toBe("ZIP archive: an OpenDocument file");
    // mutation: drop the ZIP branch -> null, red
    expect(binaryFacts(zip(["src/a.txt"]))).toBe("ZIP archive");
  });

  it("does not read a ZIP central directory larger than the bound", () => {
    const long = (i: number) => `${String(i).padStart(4, "0")}${"x".repeat(60_000)}`;
    const names = ["word/document.xml", ...Array.from({ length: Math.ceil(ZIP_DIRECTORY_MAX_BYTES / 60_000) + 1 }, (_, i) => long(i))];
    // mutation: drop the directory-size check -> reads it and says docx, red
    expect(binaryFacts(zip(names))).toBe("ZIP archive");
  });

  it("says nothing about a type it does not recognise", () => {
    expect(binaryFacts(Buffer.from("\u0000PNG-BYTES-SECRET"))).toBeNull();
    expect(binaryFacts(Buffer.alloc(0))).toBeNull();
  });
});
