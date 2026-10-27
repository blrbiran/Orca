/**
 * T4 (spec §10.7, §12.4 C3-C5, C8 "T4 adds"): redaction of what is served. Spec §12.1 found that no runtime masks a
 * secret in its stream (F1), so this is the only redaction for all three runtimes. Every case plants a MARK inside the
 * secret and asserts the mark is planted (counted in the decoded source) before asserting it is not served -- a
 * criterion whose source holds no mark could never go red (Rule 9).
 */
import { describe, expect, it } from "vitest";
import { createRedactor, headOf, HEAD, PAGE, pageOf, redactFull, REDACTED } from "../../src/agentTranscript/redact.js";
import { expandField, expandOversized, windowAfter, windowTail } from "../../src/agentTranscript/window.js";
import { alnum, claude, countMark, ghp, indexOf, jsonl, MARK, memoryReader, omp, pem, prose, redactor } from "./fixtures.js";

const mark = (prefix: string, n = 24) => prefix + MARK + alnum(n);

describe("T4: each §10.6.2 shape is redacted, and each false-positive case is not", () => {
  const shapes: Array<[string, string]> = [
    ["openai project key", "sk-" + "proj-" + MARK + alnum(40)],
    ["anthropic key", "sk-" + "ant-" + MARK + alnum(40)],
    ["stripe live key", "sk_" + "live_" + MARK + alnum(20)],
    ["stripe restricted test key", "rk_" + "test_" + MARK + alnum(20)],
    ["github token", ghp()],
    ["github oauth token", "gh" + "o_" + MARK + alnum(36)],
    ["github fine-grained pat", "github_" + "pat_" + MARK + alnum(30)],
    ["gitlab pat", "glpat-" + MARK + alnum(20)],
    ["slack bot token", "xox" + "b-" + MARK + alnum(20)],
    ["google api key", "AI" + "za" + MARK + alnum(31)],
    ["npm token", "npm_" + MARK + alnum(32)],
    ["aws access key id", "AK" + "IA" + MARK.toUpperCase() + alnum(12).toUpperCase()],
    ["aws session key id", "AS" + "IA" + MARK.toUpperCase() + alnum(12).toUpperCase()],
    ["jwt, three segments", "eyJ" + alnum(12) + ".eyJ" + MARK + alnum(12) + "." + alnum(20)],
    ["jwt, two segments (C3)", "eyJ" + alnum(12) + ".eyJ" + MARK + alnum(12)],
    ["bearer token", "curl -H 'x' bearer " + MARK + alnum(30)],
    ["authorization header", "Authorization: Basic " + MARK + alnum(10)],
    ["proxy-authorization header", "Proxy-Authorization: token " + MARK + alnum(10)],
    ["url password", "postgres://app:" + MARK + alnum(10) + "@db.local/x"],
    ["pem private key", pem(MARK + alnum(60) + "\n" + alnum(64))],
    ["assignment NAME=value", "OPENAI_API_KEY=" + MARK + alnum(20)],
    ["assignment NAME: value", "SERVICE_TOKEN: " + MARK + alnum(20)],
    ["assignment PASSWD", "DB_PASSWD=" + MARK + alnum(8)],
    ["assignment CREDENTIAL", "GCP_CREDENTIAL='" + MARK + alnum(12) + "'"],
    // C5 (controller ruling on review M4): the name match is case-insensitive.
    ["lower-case api_key (C5)", 'api_key = "' + MARK + alnum(24) + '"'],
    ["mixed-case Password (C5)", "Password: " + MARK + alnum(16)],
  ];
  it.each(shapes)("%s", (_name, secret) => {
    const text = `before ${secret} after`;
    expect(countMark(text)).toBeGreaterThan(0);
    const out = redactFull(redactor, text);
    expect(countMark(out)).toBe(0);
    expect(out).toContain(REDACTED);
    expect(out.startsWith("before ")).toBe(true);
  });

  const notSecrets: Array<[string, string]> = [
    ["short sk- run", "sk-" + "abc123"],
    ["sk- inside a word", "the risk-" + alnum(30) + " remains"],
    ["short github token", "gh" + "p_" + alnum(20)],
    ["AKIA with 15 characters", "AK" + "IA" + alnum(15).toUpperCase() + " x"],
    ["one jwt segment", "eyJ" + alnum(30)],
    ["url without credentials", "https://example.com/path?q=1"],
    ["certificate block", "-----BEGIN CERTIFICATE-----\n" + alnum(60) + "\n-----END CERTIFICATE-----"],
    ["short assignment value", "API_KEY=short"],
    ["a plain sentence", "The token budget is fine; the key point is speed."],
    ["bearer with a short word", "bearer of bad news"],
  ];
  it.each(notSecrets)("%s is not redacted", (_name, text) => {
    expect(redactFull(redactor, text)).toBe(text);
  });

  it("C4: the panel environment's secret values are a second net (and only values of 8+ characters with secret names)", () => {
    const value = "envValue" + MARK + alnum(10);
    const withEnv = createRedactor({ MY_SERVICE_TOKEN: value, HOME: "/Users/someone-long", SHORT_KEY: "abc", DATABASE_URL: "postgres://u:" + "pw" + MARK + "12345@h/d" });
    expect(countMark(redactFull(withEnv, `x ${value} y`))).toBe(0);
    expect(countMark(redactFull(withEnv, `pw${MARK}12345`))).toBe(0);
    expect(redactFull(withEnv, "/Users/someone-long and abc")).toBe("/Users/someone-long and abc");
  });
});

describe("T4: redaction runs on decoded values (C6), on every served path", () => {
  it("a PEM inside a JSON string (with \\n escapes) is redacted after decoding, and a token right after a \\n escape too", async () => {
    const content = "out:\n" + pem(MARK + alnum(50)) + "\n" + ghp() + "\nend";
    const bytes = jsonl([claude.toolResult("t1", content)]);
    // The raw JSON text holds `\n` before each secret: a regex over it cannot see `\b` before `ghp_` (§12.2: 112 leaks).
    expect(bytes.toString()).toContain("\\n" + "gh" + "p_" + MARK);
    expect(countMark(content)).toBe(2);
    const reader = memoryReader(bytes);
    const window = await windowTail(await indexOf(reader), reader, { runtime: "claude", redactor });
    const served = JSON.stringify(window.events);
    expect(window.events.map((e) => e.kind)).toEqual(["tool_result"]);
    expect(countMark(served)).toBe(0);
    expect(served).toContain(REDACTED);
  });

  it("window, follow and expand pages are all redacted", async () => {
    const long = prose(70_000) + " " + ghp() + " " + prose(80_000);
    const first = jsonl([claude.text("hello " + ghp())]);
    const second = jsonl([claude.toolResult("t2", long), claude.text("bye OPENAI_API_KEY=" + MARK + alnum(20))]);
    const reader = memoryReader(Buffer.concat([first, second]));
    const index = await indexOf(reader);
    const tail = await windowTail(index, reader, { runtime: "claude", redactor });
    expect(countMark(JSON.stringify(tail.events))).toBe(0);
    const follow = await windowAfter(index, reader, first.length, { runtime: "claude", redactor });
    expect(follow.events.map((e) => e.kind)).toEqual(["tool_result", "message"]);
    expect(countMark(JSON.stringify(follow.events))).toBe(0);
    const result = follow.events[0]!;
    expect(result.fields!.output!.more).toBe(true);
    expect(countMark(long)).toBe(1);
    let pages = "";
    for (let page = 0, total = 1; page < total; page++) {
      const p = await expandField(index, reader, result.at, result.i, "output", page, { runtime: "claude", redactor });
      total = p.pages;
      pages += p.text;
    }
    expect(pages.length).toBeGreaterThan(long.length - 100);
    expect(countMark(pages)).toBe(0);
  });

  it("C8: an omp message_update line's text is never served, and a secret split across two delta lines is in no window", async () => {
    const secret = ghp();
    const half = secret.length / 2;
    const bytes = jsonl([omp.session(), omp.delta(secret.slice(0, half)), omp.delta(secret.slice(half)), omp.textEnd(secret), omp.messageEnd("said " + secret)]);
    const reader = memoryReader(bytes);
    const window = await windowTail(await indexOf(reader), reader, { runtime: "omp", redactor });
    const served = JSON.stringify(window.events);
    expect(window.events.map((e) => e.kind)).toEqual(["notice", "message"]);
    expect(countMark(served)).toBe(0);
    expect(served).not.toContain(secret.slice(0, 10));
    expect(served).not.toContain(secret.slice(half, half + 10));
  });
});

describe("T4 / C3: heads and pages cut at the original offset, with spans", () => {
  it("in a long field, a ghp_ token straddling 4096 shows no fragment in the head", () => {
    const s = prose(4093) + " " + ghp() + " " + prose(9000);
    expect(s.slice(4094, 4098)).toBe("gh" + "p_");
    const head = headOf(redactor, s);
    expect(head.more).toBe(true);
    expect(head.text.endsWith("gh")).toBe(false);
    expect(head.text.endsWith(REDACTED)).toBe(true);
    expect(countMark(head.text)).toBe(0);
  });

  it("a head whose first 4096 units hold a PEM, then a token straddling 8192, shows no fragment of that token", () => {
    const block = pem(alnum(4090 - 62));
    expect(block.length).toBeGreaterThan(4000);
    const filler = prose(8192 - 30 - block.length - 1) + " ";
    const token = "gh" + "p_" + alnum(26) + MARK + alnum(20);
    const s = block + filler + token + " " + prose(9000);
    expect(s.indexOf(token)).toBe(8162);
    const head = headOf(redactor, s);
    expect(head.text).not.toContain("gh" + "p_");
    expect(countMark(head.text)).toBe(0);
    // The head never carries an original character at or past 4096.
    expect(head.text).toBe(REDACTED + s.slice(block.length, HEAD));
  });

  it("N4: a ghp_ token starting 19 units before a page edge is one leading [redacted] on the next page", () => {
    const s = prose(PAGE - 20) + " " + "gh" + "p_" + alnum(30) + MARK + alnum(10) + " tail " + prose(PAGE);
    expect(s.indexOf(MARK)).toBeGreaterThan(PAGE);
    const p0 = pageOf(redactor, s, 0), p1 = pageOf(redactor, s, 1);
    expect(p0.text.endsWith(REDACTED)).toBe(true);
    expect(p1.text.startsWith(REDACTED + " tail ")).toBe(true);
    expect(countMark(p0.text + p1.text)).toBe(0);
  });
});

describe("T4 / C8: an oversized line's pages (decoded, from checkpoints)", () => {
  it("secrets after \\n escapes, a PEM split at a page edge and a 9000-character token across a page edge", async () => {
    const P = 3 * PAGE;
    // A PEM body as real ones are (64-character lines), so no token run hides what the END rule must catch.
    const pemBody = (n: number): string => Array.from({ length: Math.ceil(n / 65) }, (_, k) => alnum(64, k)).join("\n").slice(0, n);
    let body = prose(PAGE) + "\n" + ghp() + "\n";
    body += prose(P - 5000 - body.length);
    // BEGIN more than 4096 units before the edge P, the mark 200 units after it, END after the mark (spec §12.2 fixture).
    body += "\n" + pem(pemBody(5000 + 200 - 34) + "\n" + MARK + alnum(40) + "\n" + pemBody(1500)) + "\n";
    body += prose(6 * PAGE - 6000 - body.length);
    const token = alnum(9000, 3);
    body += "\nSERVICE_TOKEN=" + token.slice(0, 8000) + MARK + token.slice(8000) + "\n";
    body += prose(1_200_000 - body.length);
    const line = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "big", content: body }] } };
    const bytes = jsonl([claude.text("before"), line, claude.text("after")]);
    const reader = memoryReader(bytes);
    const index = await indexOf(reader);
    expect(index.long).toHaveLength(1);
    const at = index.long[0]!.start;
    let decoded = "", served = "";
    for (let page = 0, total = 1; page < total; page++) {
      const p = await expandOversized(index, reader, at, page, redactor);
      total = p.pages;
      served += p.text;
    }
    decoded = JSON.stringify(line);
    const markIn = countMark(decoded);
    expect(markIn).toBe(3);
    expect(body.indexOf(MARK, P - 6000) - P).toBeGreaterThan(0);
    expect(countMark(served)).toBe(0);
    expect(served).toContain(REDACTED);
  });
});

describe("T4 / review 7753e97d: a secret held as a JSON key/value pair, on every composite source", () => {
  // A §10.6.2 assignment in JSON form: its name is a key and its value another decoded string, so a rule over one string
  // at a time never sees `NAME: value`. Each source below parses its line into a composite (or decodes it with quotes).
  const secret = (n = 20): string => MARK + alnum(n);
  const served = async (runtime: "claude" | "codex" | "omp", lines: unknown[]): Promise<string> => {
    const reader = memoryReader(jsonl(lines));
    return JSON.stringify((await windowTail(await indexOf(reader), reader, { runtime, redactor })).events);
  };
  const cases: Array<[string, "claude" | "codex" | "omp", unknown[]]> = [
    ["claude tool_use input without command", "claude", [{ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "mcp__x__deploy", input: { env: { API_TOKEN: secret(), DB_PASSWORD: secret() } } }] } }]],
    ["codex mcp_tool_call arguments", "codex", [{ type: "item.started", item: { id: "m", type: "mcp_tool_call", server: "s", tool: "t", arguments: { password: secret(), authorization: "Basic " + secret(8) } } }]],
    ["codex mcp_tool_call result", "codex", [{ type: "item.completed", item: { id: "m", type: "mcp_tool_call", server: "s", tool: "t", result: { content: [{ session_token: secret() }] } } }]],
    ["omp tool_execution_start args without command", "omp", [{ type: "tool_execution_start", toolCallId: "c", toolName: "deploy", args: { clientSecret: secret() } }]],
    ["an unknown line", "claude", [{ type: "mystery", detail: { api_key: secret() } }]],
    ["a secret in a key", "claude", [{ type: "mystery", detail: { [ghp()]: 1 } }]],
  ];
  it.each(cases)("%s", async (_name, runtime, lines) => {
    expect(countMark(JSON.stringify(lines))).toBeGreaterThan(0);
    const out = await served(runtime, lines);
    expect(countMark(out)).toBe(0);
    expect(out).toContain(REDACTED);
  });

  it("decoded JSON text keeps its quotes: an unparsable line and an oversized line's pages", async () => {
    expect(redactFull(redactor, `{"API_TOKEN": "${secret()}"}`)).toBe(`{"API_TOKEN": "${REDACTED}"}`);
    const cut = JSON.stringify({ type: "mystery", DB_PASSWORD: secret() }).slice(0, -2);
    const unparsable = memoryReader(Buffer.from(cut + "\n"));
    expect(countMark(cut)).toBe(1);
    const window = await windowTail(await indexOf(unparsable), unparsable, { runtime: "claude", redactor });
    expect(window.events.map((e) => e.kind)).toEqual(["unknown"]);
    expect(countMark(JSON.stringify(window.events))).toBe(0);
    const big = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: { pad: prose(1_100_000), SERVICE_TOKEN: secret() } }] } };
    const reader = memoryReader(jsonl([big]));
    const index = await indexOf(reader);
    expect(index.long).toHaveLength(1);
    let pages = "";
    for (let page = 0, total = 1; page < total; page++) {
      const p = await expandOversized(index, reader, 0, page, redactor);
      total = p.pages;
      pages += p.text;
    }
    expect(pages).toContain('"SERVICE_TOKEN":"');
    expect(countMark(pages)).toBe(0);
  });
});

describe("review 7753e97d: redaction is linear in its input (it runs on the panel's event loop)", () => {
  // Unbounded, the URL scheme and the assignment name rescanned the rest of a run from every word start: 1.5 s at 32K
  // characters of `a.`, 35 s at 128K. Linear, each of these takes milliseconds; the bound is generous for a loaded machine.
  const n = 65536;
  const cases: Array<[string, string]> = [
    ["dotted", "a.".repeat(n / 2)],
    ["dashed", "ab-".repeat(n / 3)],
    ["a run of `key`", "key".repeat(n / 3)],
    ["a run of `pass_`", "pass_".repeat(n / 5)],
    ["dotted jwt heads", "eyJaaaaaaaaa.".repeat(n / 13)],
  ];
  it.each(cases)("%s, 64K characters, in under a second", (_name, text) => {
    const t0 = performance.now();
    redactFull(redactor, text);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
