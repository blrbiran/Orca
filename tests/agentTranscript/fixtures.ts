/**
 * Live transcript criteria fixtures. Secret-shaped strings are assembled at run time (never committed literally), each
 * carrying a MARK the filler never contains, so a leak is counted by searching for the mark (spec §12.2 method).
 * Line shapes follow the real streams recorded for spec §12.1 (`/private/tmp/orca-ffec7b28/o2/evidence/*.stdout.jsonl`);
 * their content here is synthetic.
 */
import { createIndexCache, type LineIndex } from "../../src/agentTranscript/lineIndex.js";
import type { RangeReader } from "../../src/agentTranscript/reader.js";
import { createRedactor } from "../../src/agentTranscript/redact.js";

export const MARK = "Zq9X";
export const countMark = (text: string): number => text.split(MARK).length - 1 + text.split(MARK.toUpperCase()).length - 1;
/** A deterministic alphanumeric run (no MARK in it). */
export function alnum(n: number, seed = 7): string {
  const al = "ABCDEFGHIJKLMNOPRSTUVWYabcdefghijklmnoprstuvwy0123456789";
  let s = "", x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += al[x % al.length]; }
  return s;
}
/** Filler text of exactly n code units: 7-character words separated by spaces (never one long token run, C3). */
export function prose(n: number, seed = 11): string {
  let s = "";
  while (s.length < n) s += alnum(7, seed + s.length) + " ";
  return s.slice(0, n);
}
export const ghp = (tail = ""): string => "gh" + "p_" + MARK + alnum(36) + tail;
export const pem = (body: string): string => "-----BEGIN RSA PRIV" + "ATE KEY-----\n" + body + "\n-----END RSA PRIV" + "ATE KEY-----";

/** The redactor every criterion uses: no environment (the panel's own environment is never read by a test). */
export const redactor = createRedactor({});

export const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const badUnits = (s: string): number => (s.match(LONE)?.length ?? 0) + (s.split("�").length - 1);

/** An in-memory transcript whose reads are recorded (T1: bytes are counted through an injected reader). */
export interface CountingReader extends RangeReader { reads: Array<[number, number]>; bytesRead(): number; reset(): void; bytes: Buffer }
export function memoryReader(bytes: Buffer): CountingReader {
  const reads: Array<[number, number]> = [];
  return {
    bytes, size: bytes.length, reads,
    async read(position, length) {
      const out = bytes.subarray(position, Math.min(bytes.length, position + length));
      reads.push([position, out.length]);
      return Buffer.from(out);
    },
    bytesRead: () => reads.reduce((sum, [, n]) => sum + n, 0),
    reset() { reads.length = 0; },
  };
}

export const jsonl = (lines: unknown[]): Buffer => Buffer.from(lines.map((line) => JSON.stringify(line) + "\n").join(""));

export async function indexOf(reader: RangeReader, key = "k"): Promise<LineIndex> {
  return createIndexCache().get(key, reader);
}

// Real shapes (synthetic content).
export const claude = {
  init: () => ({ type: "system", subtype: "init", cwd: "/w", session_id: "s", tools: ["Bash"], model: "claude-haiku-5-5" }),
  delta: (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }),
  text: (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }),
  thinking: (thinking: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking }] } }),
  toolUse: (id: string, command: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command, description: "d" } }] } }),
  write: (id: string, file_path: string, content: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Write", input: { file_path, content } }] } }),
  toolResult: (id: string, content: string) => ({ type: "user", message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content, is_error: false }] }, tool_use_result: { stdout: content, stderr: "" } }),
  result: (result: string) => ({ type: "result", subtype: "success", is_error: false, result, total_cost_usd: 0.001 }),
};
export const codex = {
  thread: () => ({ type: "thread.started", thread_id: "t" }),
  turn: () => ({ type: "turn.started" }),
  message: (id: string, text: string) => ({ type: "item.completed", item: { id, type: "agent_message", text } }),
  reasoning: (id: string, text: string) => ({ type: "item.completed", item: { id, type: "reasoning", text } }),
  cmdStart: (id: string, command: string) => ({ type: "item.started", item: { id, type: "command_execution", command, aggregated_output: "", exit_code: null, status: "in_progress" } }),
  cmdUpdate: (id: string, command: string, out: string) => ({ type: "item.updated", item: { id, type: "command_execution", command, aggregated_output: out, exit_code: null, status: "in_progress" } }),
  cmdDone: (id: string, command: string, out: string, exit = 0) => ({ type: "item.completed", item: { id, type: "command_execution", command, aggregated_output: out, exit_code: exit, status: "completed" } }),
  fileChange: (id: string, path: string) => ({ type: "item.completed", item: { id, type: "file_change", changes: [{ path, kind: "update" }], status: "completed" } }),
  done: () => ({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }),
};
export const omp = {
  session: () => ({ type: "session", version: 3, id: "s", cwd: "/w" }),
  start: () => ({ type: "agent_start" }),
  delta: (delta: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta } }),
  textEnd: (content: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 1, content } }),
  messageStart: (text: string) => ({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text }] } }),
  messageEnd: (text: string, thinking?: string) => ({ type: "message_end", message: { role: "assistant", content: [...(thinking === undefined ? [] : [{ type: "thinking", thinking }]), { type: "text", text }, { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] } }),
  userEnd: (text: string) => ({ type: "message_end", message: { role: "user", content: [{ type: "text", text }] } }),
  toolStart: (id: string, command: string) => ({ type: "tool_execution_start", toolCallId: id, toolName: "bash", args: { command } }),
  toolUpdate: (id: string, text: string) => ({ type: "tool_execution_update", toolCallId: id, toolName: "bash", partialResult: { content: [{ type: "text", text }] } }),
  toolEnd: (id: string, text: string) => ({ type: "tool_execution_end", toolCallId: id, toolName: "bash", result: { content: [{ type: "text", text }] }, isError: false }),
  toolResultEnd: (id: string, text: string) => ({ type: "message_end", message: { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }] } }),
  turnEnd: () => ({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] }),
  end: () => ({ type: "agent_end", messages: [] }),
};
