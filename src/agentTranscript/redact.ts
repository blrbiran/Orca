/**
 * Live transcript spec 2026-10-23 §10.6.2 as corrected by §12.4 C3-C6: redaction of what Orca serves from an agent
 * transcript. It runs on DECODED text only (a JSON-parsed string value, or the output of the streaming unescaper for an
 * oversized or unparsable line) -- never on raw JSON text, where an escape such as `\n` hides a secret from `\b` (C6;
 * measured in §12.2: a regex over raw JSON leaked 112 of 578 planted secrets).
 *
 * Units (C3): decoded text is measured in UTF-16 code units. A served range [a, b) is redacted over [a-LOOK, b+LOOK) and
 * only [a, b) is emitted; a match covering `a` is one leading `[redacted]`; the cut is at the redacted position of the
 * original offset `b` (a match starting before `b` is emitted whole as `[redacted]`, never an original character at or
 * past `b`); an edge between a high and a low surrogate moves back by one.
 *
 * Prototype and measurements: /private/tmp/orca-ffec7b28/o3/redact-bench4.mjs (spec §12.2).
 */
export const HEAD = 4096;
export const LOOK = 4096;
export const PAGE = 65536;
export const REDACTED = "[redacted]";

// §10.6.2 shapes that are case-sensitive, in one alternation (V8's first-character scan stays on, §12.2).
const SHAPES = [
  String.raw`\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}`,
  String.raw`\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{36,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{22,}`,
  String.raw`\bglpat-[A-Za-z0-9_-]{20,}`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{35}`,
  String.raw`\bnpm_[A-Za-z0-9]{36}`,
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])`,
  // C3: a JWT with or without its third segment.
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?`,
  // C3: a BEGIN without its END in the span redacts to the span end.
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
].join("|");
// Case-insensitive rules. Groups: 1 = authorization header prefix, 2/3 = URL user prefix and `@`, 4 = assignment prefix
// (C5: the NAME match is case-insensitive; `monkey=…` is an accepted false positive).
// Review 7753e97d (spec §12.6): the URL scheme and the parts of an assignment name around its secret word are bounded
// ({0,31}, {0,64}); unbounded, each word start rescanned the rest of a dotted or dashed run (35 s over 128K characters
// of `a.`, on the panel's event loop). The assignment name may be followed by a closing quote: decoded JSON text (an
// oversized or unparsable line) keeps its quotes, `"API_TOKEN": "…"`.
const INSENSITIVE = [
  String.raw`\bbearer\s+[A-Za-z0-9._~+/=-]{8,}`,
  String.raw`((?:proxy-)?authorization\s*:\s*)[^\r\n"]+`,
  String.raw`(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@\/]+:)[^\s@\/]+(@)`,
  String.raw`(\b[A-Za-z0-9_]{0,64}(?:key|token|secret|password|passwd|pass|pwd|credential|auth)[A-Za-z0-9_]{0,64}["']?\s*[=:]\s*["']?)([^\s"']{8,})`,
].join("|");
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const TOKEN_RUN = /^[A-Za-z0-9_\-+/=.~]+/;
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL|AUTH/i;
const URL_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/i;

export interface Redactor {
  /** The merged, sorted match intervals of `s`, where `a` is the start of the served range inside `s`. */
  intervals(s: string, a: number): Array<[number, number]>;
}

const escapeLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The redactor for one environment. C4: the literal environment matcher is a second net behind the shapes, built once:
 * values (8 or more characters) of variables whose names carry a secret word, and the password of a `*_URL` variable
 * that carries credentials.
 */
export function createRedactor(env: Record<string, string | undefined>): Redactor {
  const literals = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (SECRET_NAME.test(name) && value.length >= 8) literals.add(value);
    if (/_URL$/i.test(name)) {
      const password = URL_PASSWORD.exec(value)?.[1];
      if (password !== undefined && password.length >= 8) literals.add(password);
    }
  }
  const literal = literals.size === 0 ? null : new RegExp([...literals].sort((x, y) => y.length - x.length).map(escapeLiteral).join("|"), "g");
  const shapes = new RegExp(SHAPES, "g");
  const insensitive = new RegExp(INSENSITIVE, "gi");
  return {
    intervals(s, a) {
      const found: Array<[number, number]> = [];
      for (const m of s.matchAll(shapes)) found.push([m.index, m.index + m[0].length]);
      for (const m of s.matchAll(insensitive)) {
        const end = m.index + m[0].length;
        if (m[1] !== undefined) found.push([m.index + m[1].length, end]);
        else if (m[2] !== undefined) found.push([m.index + m[2].length, end - 1]);
        else if (m[4] !== undefined) found.push([m.index + m[4].length, end]);
        else found.push([m.index, end]);
      }
      if (literal !== null) for (const m of s.matchAll(literal)) found.push([m.index, m.index + m[0].length]);
      // C3 span rule: an END without a BEGIN before it in the span redacts from the span start to the END.
      const pemEnd = PEM_END.exec(s);
      if (pemEnd !== null) {
        const begin = PEM_BEGIN.exec(s);
        if (begin === null || begin.index > pemEnd.index) found.push([0, pemEnd.index + pemEnd[0].length]);
      }
      // C3 span rule: a token run that begins at the span start and reaches the served range is redacted (it is at least
      // LOOK long, so its beginning is out of sight; a long base64 blob is an accepted false positive).
      if (a > 0) {
        const run = TOKEN_RUN.exec(s);
        if (run !== null && run[0].length > a) found.push([0, run[0].length]);
      }
      found.sort((x, y) => x[0] - y[0]);
      const merged: Array<[number, number]> = [];
      for (const next of found) {
        const last = merged[merged.length - 1];
        if (last !== undefined && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
        else merged.push([next[0], next[1]]);
      }
      return merged;
    },
  };
}

let shared: Redactor | null = null;
/** The panel's redactor, built once from its own environment (§10.6.2 "built once"). */
export function panelRedactor(): Redactor {
  shared ??= createRedactor(process.env);
  return shared;
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** C3 (review N3): an edge that falls between a high and a low surrogate moves to edge - 1. */
export function edge(s: string, x: number): number {
  return x > 0 && x < s.length && isHigh(s.charCodeAt(x - 1)) ? x - 1 : x;
}

/** Emit [a, b) of span `s`, redacted over the whole span (C3). */
export function render(redactor: Redactor, s: string, a: number, b: number): string {
  let out = "";
  let pos = a;
  for (const [x, y] of redactor.intervals(s, a)) {
    if (y <= a) continue;
    if (x >= b) break;
    if (x > pos) out += s.slice(pos, x);
    out += REDACTED;
    pos = y;
    if (pos >= b) return out;
  }
  return out + s.slice(pos, b);
}

/** A whole decoded value, redacted. */
export const redactFull = (redactor: Redactor, s: string): string => (s.length < 8 ? s : render(redactor, s, 0, s.length));

/**
 * A deep copy of a decoded JSON value with every string redacted whole (F4: every decoded string, not only rendered ones).
 * Review 7753e97d (spec §12.6): a key/value pair is the JSON form of a §10.6.2 assignment, whose name and value are never
 * in one decoded string -- so a string value of 8 or more characters under a key with a secret name (`AUTH` covers
 * `authorization`) is redacted whole. Keys are redacted too: a key is a decoded string like any other.
 */
export function redactValue(redactor: Redactor, value: unknown): unknown {
  if (typeof value === "string") return redactFull(redactor, value);
  if (Array.isArray(value)) return value.map((item) => redactValue(redactor, item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[redactFull(redactor, key)] = typeof item === "string" && item.length >= 8 && SECRET_NAME.test(key) ? REDACTED : redactValue(redactor, item);
    }
    return out;
  }
  return value;
}

/** A served field: its head (redacted), its full length in code units, and whether more can be expanded. */
export interface FieldHead { text: string; length: number; more: boolean }

/** C3: a field's head is [0, HEAD) redacted over [0, HEAD+LOOK), cut at the redacted position of HEAD. */
export function headOf(redactor: Redactor, s: string): FieldHead {
  if (s.length <= HEAD) return { text: redactFull(redactor, s), length: s.length, more: false };
  const span = s.slice(0, HEAD + LOOK);
  return { text: render(redactor, span, 0, edge(span, HEAD)), length: s.length, more: true };
}

/** A page of a decoded value: page k is [k·PAGE, (k+1)·PAGE) with both edges surrogate-safe, redacted over ±LOOK. */
export interface Page { text: string; page: number; pages: number; length: number }
export function pageOf(redactor: Redactor, s: string, k: number): Page {
  const pages = Math.max(1, Math.ceil(s.length / PAGE));
  const a = edge(s, Math.min(k * PAGE, s.length));
  const b = edge(s, Math.min((k + 1) * PAGE, s.length));
  // The span is [k·PAGE - LOOK, (k+1)·PAGE + LOOK), as an oversized line's resumed page computes it (window.ts).
  const s0 = Math.max(0, k * PAGE - LOOK);
  const span = s.slice(s0, Math.min(s.length, (k + 1) * PAGE + LOOK));
  return { text: render(redactor, span, a - s0, b - s0), page: k, pages, length: s.length };
}

/** A page of a value that was already redacted whole (a composite field): plain surrogate-safe slicing. */
export function slicePage(s: string, k: number): Page {
  const pages = Math.max(1, Math.ceil(s.length / PAGE));
  const a = edge(s, Math.min(k * PAGE, s.length));
  const b = edge(s, Math.min((k + 1) * PAGE, s.length));
  return { text: s.slice(a, b), page: k, pages, length: s.length };
}

/** The head of a value that was already redacted whole. */
export function sliceHead(s: string): FieldHead {
  return s.length <= HEAD ? { text: s, length: s.length, more: false } : { text: s.slice(0, edge(s, HEAD)), length: s.length, more: true };
}
