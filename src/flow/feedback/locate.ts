/**
 * Gaps spec §4.3 `loc1` (frozen once released): locate feedback anchors in the markdown files that steps wrote. Pure:
 * the caller reads the files (the flow head, not the person's folder) and tags each with its last writer.
 */
import { MIN_QUOTE_CHARS, norm, type Anchor } from "./anchors.js";

export interface SearchFile { path: string; text: string; writerIndex: number; writerKey: string }
export interface Hit { file: string; paragraph: number; headingPath: string[]; excerpt: string }
export type LocateResult = { anchor: Anchor; located: Hit } | { anchor: Anchor; hits: Hit[]; more: number };

const MAX_HITS = 5;
const EXCERPT = 120;

interface Para { ordinal: number; text: string; headingPath: string[]; section: number[] }
interface Heading { text: string; level: number; path: string[]; firstOrdinal: number; paras: Para[] }
interface Parsed { paras: Para[]; headings: Heading[] }

const THEMATIC = /^\s*([-*_])(\s*\1){2,}\s*$/;
const IMAGE_ONLY = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

function parse(raw: string): Parsed {
  let lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) lines = lines.slice(end + 1);
  }
  lines = lines.join("\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const paras: Para[] = [];
  const headings: Heading[] = [];
  const stack: Heading[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    if (buf.length === 0) return;
    const block = buf;
    buf = [];
    if (THEMATIC.test(block.join("\n")) || block.every((l) => IMAGE_ONLY.test(l))) return;
    const para: Para = { ordinal: paras.length + 1, text: block.join("\n"), headingPath: stack.map((h) => h.text), section: [] };
    paras.push(para);
    for (const h of stack) h.paras.push(para);
  };
  for (const line of lines) {
    if (fence !== null) {
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const open = /^\s*(```|~~~)/.exec(line);
    if (open !== null) { flush(); fence = open[1]!; continue; }
    const h = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (h !== null) {
      flush();
      const level = h[1]!.length;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      const heading: Heading = { text: h[2]!, level, path: [...stack.map((s) => s.text), h[2]!], firstOrdinal: paras.length + 1, paras: [] };
      stack.push(heading);
      headings.push(heading);
      continue;
    }
    if (line.trim() === "") flush();
    else buf.push(line);
  }
  flush();
  return { paras, headings };
}

const cut = (s: string): string => Array.from(s.trim()).slice(0, EXCERPT).join("");
const hitOf = (file: string, p: Para): Hit => ({ file, paragraph: p.ordinal, headingPath: p.headingPath, excerpt: cut(p.text) });

/** `…` or `...` splits a quote; every part must occur, in order, inside one paragraph. */
const split = (q: string): string[] => q.split(/…|\.\.\./).filter((part) => part.trim() !== "");
function inOrder(hay: string, parts: readonly string[]): boolean {
  let at = 0;
  for (const part of parts) {
    const i = hay.indexOf(part, at);
    if (i === -1) return false;
    at = i + part.length;
  }
  return parts.length > 0;
}

/** The files whose last writer is the latest among those that have hits (the most derived version). */
function latest(hits: ReadonlyArray<{ hit: Hit; writerIndex: number }>): Hit[] {
  const top = Math.max(...hits.map((h) => h.writerIndex));
  return hits.filter((h) => h.writerIndex === top).map((h) => h.hit);
}

export function readingFile(files: readonly SearchFile[]): { file: SearchFile } | { ambiguous: string[] } {
  const top = Math.max(...files.map((f) => f.writerIndex));
  const last = files.filter((f) => f.writerIndex === top);
  return last.length === 1 ? { file: last[0]! } : { ambiguous: last.map((f) => f.path) };
}

export function locate(anchors: readonly Anchor[], files: readonly SearchFile[]): LocateResult[] {
  const parsed = files.map((file) => ({ file, doc: parse(file.text) }));
  return anchors.map((anchor) => resolve(anchor, parsed, files));
}

function resolve(anchor: Anchor, parsed: ReadonlyArray<{ file: SearchFile; doc: Parsed }>, files: readonly SearchFile[]): LocateResult {
  const found: Array<{ hit: Hit; writerIndex: number }> = [];
  const add = (file: SearchFile, hit: Hit): number => found.push({ hit, writerIndex: file.writerIndex });
  const done = (): LocateResult => {
    const hits = found.length === 0 ? [] : latest(found);
    if (hits.length === 1) return { anchor, located: hits[0]! };
    return { anchor, hits: hits.slice(0, MAX_HITS), more: Math.max(0, hits.length - MAX_HITS) };
  };
  const quote = anchor.quote;
  if (quote !== undefined) {
    const exact = split(quote);
    for (const { file, doc } of parsed) for (const p of doc.paras) if (inOrder(p.text, exact)) add(file, hitOf(file.path, p));
    if (found.length > 0) return done();
    const normed = exact.map(norm).filter((part) => part !== "");
    if (normed.join("").length >= MIN_QUOTE_CHARS) {
      for (const { file, doc } of parsed) for (const p of doc.paras) if (inOrder(norm(p.text), normed)) add(file, hitOf(file.path, p));
      if (found.length > 0) return done();
    }
  }
  const heading = anchor.heading;
  if (heading !== undefined && anchor.paragraph === undefined) {
    const want = norm(heading);
    for (const { file, doc } of parsed) {
      for (const h of doc.headings) {
        if (norm(h.text) === want) add(file, { file: file.path, paragraph: h.firstOrdinal, headingPath: h.path, excerpt: cut(h.text) });
      }
    }
    if (found.length > 0) return done();
  }
  const n = anchor.paragraph;
  if (n !== undefined) {
    if (heading !== undefined) {
      const want = norm(heading);
      for (const { file, doc } of parsed) {
        for (const h of doc.headings) {
          const p = norm(h.text) === want ? h.paras[n - 1] : undefined;
          if (p !== undefined) add(file, hitOf(file.path, p));
        }
      }
    } else {
      const reading = readingFile(files);
      const targets = "file" in reading ? [reading.file.path] : reading.ambiguous;
      for (const { file, doc } of parsed) {
        const p = targets.includes(file.path) ? doc.paras[n - 1] : undefined;
        if (p !== undefined) add(file, hitOf(file.path, p));
      }
      // Several files by the reading writer: the ordinal is ambiguous even if only one of them has that paragraph.
      if ("ambiguous" in reading) return { anchor, hits: found.map((f) => f.hit).slice(0, MAX_HITS), more: Math.max(0, found.length - MAX_HITS) };
    }
  }
  return done();
}
