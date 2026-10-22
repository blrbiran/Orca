/**
 * Gaps spec §7: the `hints.equals` projection of an execution's output (closed set, F §3.2). `{{param.*}}` is expanded
 * by the caller. Returns a sha256 hex, or `null` when there is nothing to compare (missing file, bad JSON, missing
 * pointer, no headings): `null` is "no cutoff", never an error.
 */
import { createHash } from "node:crypto";
import { norm } from "../feedback/anchors.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Ordered ATX headings outside front matter and fences, each `level:norm(text)`. */
function headingLines(text: string): string[] {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) lines = lines.slice(end + 1);
  }
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    if (fence !== null) { if (line.trimStart().startsWith(fence)) fence = null; continue; }
    const open = /^\s*(```|~~~)/.exec(line);
    if (open !== null) { fence = open[1]!; continue; }
    const h = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (h !== null) out.push(`${h[1]!.length}:${norm(h[2]!)}`);
  }
  return out;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** RFC 6901; `undefined` when the pointer does not resolve. */
function pointed(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) cur = /^(0|[1-9]\d*)$/.test(token) ? cur[Number(token)] : undefined;
    else if (cur !== null && typeof cur === "object" && Object.hasOwn(cur, token)) cur = (cur as Record<string, unknown>)[token];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function projectionOf(spec: string, read: (path: string) => Buffer | null, verdict: string | null): string | null {
  const s = spec.trim();
  if (s === "verdict") return verdict === null ? null : sha(`verdict:${verdict}`);
  const h = /^headings\((.+)\)$/.exec(s);
  if (h !== null) {
    const buf = read(h[1]!.trim());
    if (buf === null) return null;
    const lines = headingLines(buf.toString("utf8"));
    return lines.length === 0 ? null : sha(lines.join("\n"));
  }
  const j = /^json\(([^,]+),\s*(.+)\)$/.exec(s);
  if (j !== null) {
    const buf = read(j[1]!.trim());
    if (buf === null) return null;
    let doc: unknown;
    try { doc = JSON.parse(buf.toString("utf8")); } catch { return null; }
    const value = pointed(doc, j[2]!.trim());
    return value === undefined ? null : sha(canonical(value));
  }
  return null;
}
