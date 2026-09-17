/**
 * Tier 0 gate spec 3.1: a conservative shell tokenizer. It does not execute or expand anything; it only
 * finds the simple commands a Bash tool call will run, including those inside command substitutions and
 * heredocs that the shell itself will execute. Anything it cannot delimit is reported as `problem`.
 */
export interface Word { text: string; dynamic: boolean }
export interface Heredoc { body: string; quoted: boolean }
export interface SimpleCommand { words: Word[]; heredocs: Heredoc[] }
export interface Parsed { commands: SimpleCommand[]; substitutions: string[]; grouping: boolean; problem: string | null }

type Span = { end: number; body: string } | string;

const GLOB = new Set(["*", "?", "["]);

/** Reads `<<[-]DELIM` starting at the first `<`; returns the delimiter and where the operator ends. */
function readHeredocOperator(src: string, at: number): { delimiter: string; quoted: boolean; stripTabs: boolean; end: number } | string {
  let j = at + 2;
  const stripTabs = src[j] === "-";
  if (stripTabs) j++;
  while (src[j] === " " || src[j] === "\t") j++;
  let raw = "";
  while (j < src.length && !/[\s;&|<>()]/.test(src[j])) raw += src[j++];
  const delimiter = raw.replace(/['"\\]/g, "");
  if (delimiter === "") return "heredoc without a delimiter";
  return { delimiter, quoted: /['"\\]/.test(raw), stripTabs, end: j };
}

/** From `from` (the start of a line), consumes lines up to and including the delimiter line. */
function readHeredocBody(src: string, from: number, delimiter: string, stripTabs: boolean): { body: string; end: number } | string {
  let i = from;
  let body = "";
  while (i < src.length) {
    const nl = src.indexOf("\n", i);
    const lineEnd = nl < 0 ? src.length : nl;
    const line = src.slice(i, lineEnd);
    const next = nl < 0 ? src.length : nl + 1;
    if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) return { body, end: next };
    body += `${line}\n`;
    i = next;
  }
  return `heredoc delimiter ${delimiter} not found`;
}

function readParen(src: string, at: number): Span {
  let depth = 1;
  let k = at + 2;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\") k += 2;
    else if (c === "'") {
      const end = src.indexOf("'", k + 1);
      if (end < 0) return "unterminated command substitution";
      k = end + 1;
    } else if (c === '"') {
      k++;
      while (k < src.length && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
      if (k >= src.length) return "unterminated command substitution";
      k++;
    } else if (c === "<" && src[k + 1] === "<" && src[k + 2] !== "<") {
      const op = readHeredocOperator(src, k);
      if (typeof op === "string") return op;
      const nl = src.indexOf("\n", op.end);
      if (nl < 0) return `heredoc delimiter ${op.delimiter} not found`;
      const body = readHeredocBody(src, nl + 1, op.delimiter, op.stripTabs);
      if (typeof body === "string") return body;
      k = body.end;
    } else if (c === "(") {
      depth++;
      k++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return { end: k + 1, body: src.slice(at + 2, k) };
      k++;
    } else k++;
  }
  return "unterminated command substitution";
}

function readBackquote(src: string, at: number): Span {
  let k = at + 1;
  while (k < src.length) {
    if (src[k] === "\\") k += 2;
    else if (src[k] === "`") return { end: k + 1, body: src.slice(at + 1, k) };
    else k++;
  }
  return "unterminated backquote";
}

/** Substitutions the shell will run inside an unquoted heredoc body. */
function substitutionsIn(body: string, into: string[]): string | null {
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\\") i += 2;
    else if (body[i] === "$" && body[i + 1] === "(") {
      const s = readParen(body, i);
      if (typeof s === "string") return s;
      into.push(s.body);
      i = s.end;
    } else if (body[i] === "`") {
      const s = readBackquote(body, i);
      if (typeof s === "string") return s;
      into.push(s.body);
      i = s.end;
    } else i++;
  }
  return null;
}

export function parseShell(src: string): Parsed {
  const commands: SimpleCommand[] = [];
  const substitutions: string[] = [];
  let grouping = false;
  let words: Word[] = [];
  let heredocs: Heredoc[] = [];
  let pending: { delimiter: string; quoted: boolean; stripTabs: boolean; into: Heredoc[] }[] = [];
  let text = "";
  let dynamic = false;
  let started = false;
  let redirectTarget = false;
  const done = (problem: string | null): Parsed => ({ commands, substitutions, grouping, problem });

  const endWord = () => {
    if (!started) return;
    if (redirectTarget) redirectTarget = false;
    else if ((text === "{" || text === "}") && !dynamic) grouping = true;
    else words.push({ text, dynamic });
    text = "";
    dynamic = false;
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push({ words, heredocs });
    words = [];
    heredocs = [];
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      if (src[i + 1] !== "\n" && i + 1 < src.length) {
        text += src[i + 1];
        started = true;
      }
      i += 2;
    } else if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return done("unterminated single quote");
      text += src.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (ch === '"') {
      started = true;
      let k = i + 1;
      for (;;) {
        if (k >= src.length) return done("unterminated double quote");
        const c = src[k];
        if (c === '"') break;
        if (c === "\\" && k + 1 < src.length && '$`"\\\n'.includes(src[k + 1])) {
          if (src[k + 1] !== "\n") text += src[k + 1];
          k += 2;
        } else if ((c === "$" && src[k + 1] === "(") || c === "`") {
          const s = c === "`" ? readBackquote(src, k) : readParen(src, k);
          if (typeof s === "string") return done(s);
          substitutions.push(s.body);
          text += src.slice(k, s.end);
          dynamic = true;
          k = s.end;
        } else {
          if (c === "$") dynamic = true;
          text += c;
          k++;
        }
      }
      i = k + 1;
    } else if ((ch === "$" && src[i + 1] === "(") || ch === "`") {
      const s = ch === "`" ? readBackquote(src, i) : readParen(src, i);
      if (typeof s === "string") return done(s);
      substitutions.push(s.body);
      text += src.slice(i, s.end);
      dynamic = true;
      started = true;
      i = s.end;
    } else if (ch === " " || ch === "\t") {
      endWord();
      i++;
    } else if (ch === "\n") {
      endCommand();
      i++;
      for (const p of pending) {
        const body = readHeredocBody(src, i, p.delimiter, p.stripTabs);
        if (typeof body === "string") return done(body);
        if (!p.quoted) {
          const problem = substitutionsIn(body.body, substitutions);
          if (problem !== null) return done(problem);
        }
        p.into.push({ body: body.body, quoted: p.quoted });
        i = body.end;
      }
      pending = [];
    } else if (ch === "&" && src[i + 1] === ">") {
      endWord();
      i += 2;
      while (src[i] === ">") i++;
      redirectTarget = true;
    } else if (ch === ";" || ch === "&" || ch === "|") {
      endCommand();
      i++;
    } else if (ch === "(" || ch === ")") {
      grouping = true;
      endCommand();
      i++;
    } else if (ch === "<" && src.startsWith("<<<", i)) {
      endWord();
      i += 3;
      redirectTarget = true;
    } else if (ch === "<" && src[i + 1] === "<") {
      endWord();
      const op = readHeredocOperator(src, i);
      if (typeof op === "string") return done(op);
      pending.push({ delimiter: op.delimiter, quoted: op.quoted, stripTabs: op.stripTabs, into: heredocs });
      i = op.end;
    } else if (ch === ">" || ch === "<") {
      if (started && !dynamic && /^\d+$/.test(text)) {
        text = "";
        started = false;
      } else endWord();
      i++;
      while (src[i] === ">" || src[i] === "&" || src[i] === "|") i++;
      redirectTarget = true;
    } else if (ch === "#" && !started) {
      while (i < src.length && src[i] !== "\n") i++;
    } else {
      if (GLOB.has(ch) || ch === "$") dynamic = true;
      text += ch;
      started = true;
      i++;
    }
  }
  endCommand();
  if (pending.length > 0) return done(`heredoc delimiter ${pending[0].delimiter} not found`);
  return done(null);
}
