/**
 * Tester #337 (prompt half): cheap, deterministic facts about a changed binary file for the requirement reviewer, read from
 * the blob bytes the review already holds for its sha256. Code answers (Rule 5): the file type from its magic bytes and,
 * for an image whose header gives them, its stored pixel size (EXIF rotation is not read). Nothing is extracted from the content (no PDF page count: without
 * a PDF parser it cannot be counted reliably -- object streams and incremental updates defeat a text scan).
 *
 * Bounded: the type reads the first bytes; a JPEG frame header is searched for in the first JPEG_SCAN_MAX_BYTES; a ZIP's
 * entry names are read from its central directory only when that directory is at most ZIP_DIRECTORY_MAX_BYTES and is
 * found in the blob's last ZIP_TAIL_MAX_BYTES. A huge blob costs the same as a small one.
 */
export const JPEG_SCAN_MAX_BYTES = 1024 * 1024;
export const ZIP_DIRECTORY_MAX_BYTES = 1024 * 1024;
/** The end-of-central-directory record (22 bytes) plus the largest ZIP comment (65,535 bytes). */
export const ZIP_TAIL_MAX_BYTES = 22 + 0xffff;

const startsWith = (bytes: Buffer, magic: readonly number[]): boolean => bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
/** The stored pixel size after the type, or the type only when a dimension is 0 or above `max` (not a real size). */
const sized = (type: string, width: number, height: number, max = 0xffff): string =>
  width === 0 || height === 0 || width > max || height > max ? type : `${type}, ${width}x${height} pixels`;

/** A short phrase ("PNG image, 640x480 pixels"), or null when the type is not one recognised here. */
export function binaryFacts(bytes: Buffer): string | null {
  if (startsWith(bytes, ascii("%PDF-"))) {
    const version = /^%PDF-(\d\.\d)/.exec(bytes.subarray(0, 8).toString("latin1"))?.[1];
    return `PDF document${version === undefined ? "" : ` (version ${version})`}; its page count is not read`;
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // The first chunk of a valid PNG is IHDR: width and height, big-endian, at 16 and 20, each at most 2^31 - 1.
    const ihdr = bytes.length >= 24 && bytes.subarray(12, 16).toString("latin1") === "IHDR";
    return ihdr ? sized("PNG image", bytes.readUInt32BE(16), bytes.readUInt32BE(20), 0x7fffffff) : "PNG image";
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    // The logical screen size, little-endian, right after the signature.
    return bytes.length >= 10 ? sized("GIF image", bytes.readUInt16LE(6), bytes.readUInt16LE(8)) : "GIF image";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(bytes);
    return size === null ? "JPEG image" : sized("JPEG image", size.width, size.height);
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return zipKind(bytes);
  return null;
}

/** The frame size from the first start-of-frame marker, walking the segments from the start; null when not found in bound. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  const end = Math.min(bytes.length, JPEG_SCAN_MAX_BYTES);
  let at = 2;
  while (at + 4 <= end) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) { at += 1; continue; } // fill byte
    // Before the frame header only length-carrying segments are expected: a marker without a length (TEM, RST0..RST7,
    // SOI, EOI) or the scan (SOS) there means the size is not where it should be -- the type only, never a guess.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xda)) return null;
    // A length below 2 lands the walk on its own length bytes (0x00 / 0x01, not 0xFF), which returns null above.
    const length = bytes.readUInt16BE(at + 2);
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC): precision (1 byte), height, width (2 bytes each, big-endian).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > end) return null;
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

/**
 * A ZIP archive, named as the office format its entries make it when they say so: an Office file has
 * `[Content_Types].xml` at its root (an archive that only holds a `word/` folder is not one), an OpenDocument file a
 * `mimetype` entry beside `content.xml`.
 */
function zipKind(bytes: Buffer): string {
  const names = zipEntryNames(bytes);
  if (names === null) return "ZIP archive";
  const office = names.includes("[Content_Types].xml");
  if (office && names.some((name) => name.startsWith("word/"))) return "ZIP archive: a Word document (docx)";
  if (office && names.some((name) => name.startsWith("xl/"))) return "ZIP archive: an Excel workbook (xlsx)";
  if (office && names.some((name) => name.startsWith("ppt/"))) return "ZIP archive: a PowerPoint presentation (pptx)";
  if (names.includes("mimetype") && names.includes("content.xml")) return "ZIP archive: an OpenDocument file";
  return "ZIP archive";
}

/** The entry names from the central directory, or null when it is not found within the bounds (or uses ZIP64). */
function zipEntryNames(bytes: Buffer): string[] | null {
  const tailStart = Math.max(0, bytes.length - ZIP_TAIL_MAX_BYTES);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= tailStart; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) return null;
  const count = bytes.readUInt16LE(eocd + 10), size = bytes.readUInt32LE(eocd + 12), offset = bytes.readUInt32LE(eocd + 16);
  if (size > ZIP_DIRECTORY_MAX_BYTES || offset + size > eocd) return null;
  const names: string[] = [];
  let at = offset;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > offset + size || bytes.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32);
    if (at + 46 + nameLength > offset + size) return null;
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}
