/**
 * Gaps spec §4.1 / §4.3: anchors of a run-level feedback and the one normalisation `norm()` that both extraction and
 * locating share. Pure; no I/O. `loc1` is frozen once released (the fold table below is part of it).
 */
export type Anchor = { quote?: string; heading?: string; paragraph?: number };

export const MAX_ANCHORS = 5;
/** A normalised quote shorter than this would match everywhere, so it is not a quote (§4.3 rung 2). */
export const MIN_QUOTE_CHARS = 6;

/** `norm()` (§4.3): NFKC, then the fixed CJK fold table, then inline Markdown off, all whitespace off, Latin lower-case. */
export function norm(s: string): string {
  let t = s.normalize("NFKC");
  t = t.replace(/。/g, ".").replace(/[、，]/g, ",").replace(/：/g, ":").replace(/；/g, ";").replace(/！/g, "!").replace(/？/g, "?")
    .replace(/[“”「」『』]/g, '"').replace(/[‘’]/g, "'").replace(/（/g, "(").replace(/）/g, ")").replace(/【/g, "[").replace(/】/g, "]")
    .replace(/——/g, "-").replace(/…/g, "...");
  t = t.split("\n").map((line) => line.replace(/^\s*(?:>\s*)+/, "").replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")).join("\n");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/~~/g, "").replace(/[*_`]/g, "");
  return t.replace(/\s+/g, "").toLowerCase();
}

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 一…九十九 (and Arabic digits); anything else is not a paragraph number. */
function ordinal(raw: string): number | null {
  if (/^\d+$/.test(raw)) { const n = Number(raw); return n >= 1 ? n : null; }
  const m = /^(?:([一二三四五六七八九])?十([一二三四五六七八九])?|([一二三四五六七八九]))$/.exec(raw);
  if (m === null) return null;
  if (m[3] !== undefined) return CN_DIGIT[m[3]] ?? null;
  return (m[1] !== undefined ? CN_DIGIT[m[1]]! : 1) * 10 + (m[2] !== undefined ? CN_DIGIT[m[2]]! : 0);
}

const key = (a: Anchor): string => JSON.stringify([a.quote ?? null, a.heading ?? null, a.paragraph ?? null]);

/** §4.1: given anchors first, then the ones found in `text` (text order), deduplicated, at most 5. Headings are never extracted. */
export function extractAnchors(text: string, given: readonly Anchor[]): Anchor[] {
  const found: Array<{ at: number; anchor: Anchor }> = [];
  for (const m of text.matchAll(/「([^」]*)」|『([^』]*)』|“([^”]*)”|"([^"]*)"/g)) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (norm(inner).length >= MIN_QUOTE_CHARS) found.push({ at: m.index ?? 0, anchor: { quote: inner } });
  }
  for (const m of text.matchAll(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*段|\bpara(?:graph)?\s+(\d+)/gi)) {
    const n = ordinal(m[1] ?? m[2] ?? "");
    if (n !== null) found.push({ at: m.index ?? 0, anchor: { paragraph: n } });
  }
  found.sort((a, b) => a.at - b.at);
  const out: Anchor[] = [];
  const seen = new Set<string>();
  for (const anchor of [...given, ...found.map((f) => f.anchor)]) {
    if (seen.has(key(anchor))) continue;
    seen.add(key(anchor));
    out.push(anchor);
  }
  return out.slice(0, MAX_ANCHORS);
}
