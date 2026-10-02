import type { MemoryPage, MemoryRecord, MemorySearchOptions } from "./adapter.js";

/** Memory tab spec §3.5 and §5.1. Done in Orca: ccmem's own retrieval writes to its database (spec §3.1). */
export const MEMORY_QUERY_MAX = 200;
export const MEMORY_LIMIT_MAX = 200;
export const MEMORY_LIMIT_DEFAULT = 50;

const fold = (text: string): string => text.normalize("NFC").toLowerCase();

export function searchRecords(records: readonly MemoryRecord[], options: MemorySearchOptions): MemoryPage {
  const needle = fold(options.query.trim());
  const hits = needle === "" ? [...records] : records.filter((r) => fold(r.content).includes(needle) || r.tags.some((tag) => fold(tag).includes(needle)));
  hits.sort(compareRecords);
  const shown = hits.slice(0, options.limit);
  return { records: shown, total: hits.length, truncated: hits.length > shown.length };
}

/** A fixed key, not relevance: pinned first, newest update first, then the larger ref (ISO strings of one length compare as dates). */
function compareRecords(a: MemoryRecord, b: MemoryRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return Number(b.ref) - Number(a.ref);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** An express query value is a string, an array (the parameter was repeated) or absent. Only one string, or absent, is accepted. */
const single = (raw: unknown): string | undefined | null => (raw === undefined ? undefined : typeof raw === "string" ? raw : null);

export function parseQuery(raw: unknown): Parsed<string> {
  const text = single(raw);
  if (text === null) return { ok: false, message: "q was given more than once" };
  const query = (text ?? "").trim();
  if ([...query].length > MEMORY_QUERY_MAX) return { ok: false, message: `q is longer than ${MEMORY_QUERY_MAX} characters` };
  if (/\p{Cc}/u.test(query)) return { ok: false, message: "q contains a control character" };
  return { ok: true, value: query };
}

export function parseLimit(raw: unknown): Parsed<number> {
  const text = single(raw);
  if (text === null) return { ok: false, message: "limit was given more than once" };
  if (text === undefined) return { ok: true, value: MEMORY_LIMIT_DEFAULT };
  const limit = /^[0-9]{1,3}$/.test(text) ? Number(text) : NaN;
  if (!(limit >= 1 && limit <= MEMORY_LIMIT_MAX)) return { ok: false, message: `limit wants an integer 1-${MEMORY_LIMIT_MAX}, got ${JSON.stringify(text)}` };
  return { ok: true, value: limit };
}

export function parseRef(raw: unknown): Parsed<string> {
  const text = single(raw);
  if (typeof text !== "string" || !/^[1-9][0-9]{0,15}$/.test(text)) return { ok: false, message: `ref wants a memory id (1-16 digits), got ${JSON.stringify(raw ?? null)}` };
  return { ok: true, value: text };
}
