/**
 * The operator note's bound and byte count, shared by the flow run page's note (live transcript spec §10.5) and a task
 * continuation's note (#226 ii). The server's own bound is operatorNoteSchema (src/control/schema.ts): 1-4096 UTF-8 bytes.
 */
export const NOTE_MAX_BYTES = 4096;
export function utf8Bytes(text: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
export type NoteScope = "next-attempt" | "remaining-attempts";
