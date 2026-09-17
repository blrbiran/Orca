import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readClaudeCodeTranscript } from "../../src/level/claudeCode.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "level");
const FIXTURE_SESSION = "0a1b2c3d-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
// Printed by the independent python probe in Task 2 Step 2, run on the same snapshot the fixture was made from
// (session d5688105-065f-41d6-aa5e-a4818e5d78c3, controller-assigned).
const PROBE = { prompt: 235_854, output: 39, at: "2026-09-17T12:27:18.334Z" };

const U = (input: number, cacheRead: number, cacheCreation: number, output: number) => ({ input, cacheRead, cacheCreation, output });
const none = (reason: string) => ({ kind: "no-reading", runtime: "claude-code", sessionRef: SESSION, reason });

describe("readClaudeCodeTranscript (D spec 2.1, 3.1, 9)", () => {
  it("reads the sanitized real transcript to the numbers an independent probe printed", async () => {
    const text = await readFile(join(fixtures, "claude-code-session.jsonl"), "utf8");
    expect(readClaudeCodeTranscript(text, FIXTURE_SESSION, {})).toEqual({
      kind: "reading",
      runtime: "claude-code",
      sessionRef: FIXTURE_SESSION,
      promptTokens: PROBE.prompt,
      outputTokens: PROBE.output,
      windowTokens: 1_000_000,
      observedAt: PROBE.at,
    });
  });

  it("takes the last main-chain call and sums input, cache read and cache creation", () => {
    const text = jsonl([
      modelRow("claude-opus-5[1m]"),
      usageRow(U(1, 2, 3, 4), { at: "2026-09-17T01:00:00.000Z" }),
      usageRow(U(10, 200, 30, 7), { at: "2026-09-17T02:00:00.000Z" }),
    ]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual({
      kind: "reading",
      runtime: "claude-code",
      sessionRef: SESSION,
      promptTokens: 240,
      outputTokens: 7,
      windowTokens: 1_000_000,
      observedAt: "2026-09-17T02:00:00.000Z",
    });
  });

  it("ignores a sidechain call made after the main chain's last one", () => {
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(5, 5, 5, 5)), usageRow(U(900_000, 0, 0, 0), { sidechain: true })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toMatchObject({ kind: "reading", promptTokens: 15 });
  });

  it("ignores a <synthetic> row, whose usage is all zero (measured: 105 of them)", () => {
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(100, 0, 0, 1)), usageRow(U(0, 0, 0, 0), { model: "<synthetic>" })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toMatchObject({ kind: "reading", promptTokens: 100 });
  });

  it("a usage row missing a count is no reading, not zero", () => {
    const row = usageRow(U(1, 1, 1, 1));
    delete row.message.usage.cache_read_input_tokens;
    expect(readClaudeCodeTranscript(jsonl([modelRow("claude-opus-5[1m]"), row]), SESSION, {})).toEqual(
      none("usage on line 2 lacks a count for cache_read_input_tokens"),
    );

    // Correction 1, E2-2: a reading row without a timestamp is no reading, not a reading with an undefined observedAt.
    const noTimestamp: Record<string, unknown> = usageRow(U(1, 1, 1, 1));
    delete noTimestamp.timestamp;
    expect(readClaudeCodeTranscript(jsonl([modelRow("claude-opus-5[1m]"), noTimestamp]), SESSION, {})).toEqual(
      none("usage on line 2 has no timestamp"),
    );
  });

  it("skips a torn final line still being appended, but a malformed line in the middle is no reading", () => {
    const good = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(`${good}{"type":"assist`, SESSION, {}).kind).toBe("reading");
    expect(readClaudeCodeTranscript(`${good}{"type":"assist\n${jsonl([usageRow(U(2, 0, 0, 0))])}`, SESSION, {})).toEqual(
      none("transcript line 3 is not JSON"),
    );

    // Correction 1, E2-2: a line that is valid JSON but not an object (e.g. `null`) is no reading, not a crash.
    expect(readClaudeCodeTranscript(`${good}null\n`, SESSION, {})).toEqual(none("transcript line 3 is not an object"));
  });

  it("the last model attachment decides the window, and [1m] means one million", () => {
    const switched = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0)), modelRow("claude-opus-5"), usageRow(U(2, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(switched, SESSION, { "claude-opus-5": 200_000 })).toMatchObject({ windowTokens: 200_000 });
    const back = jsonl([modelRow("claude-opus-5"), modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(back, SESSION, {})).toMatchObject({ windowTokens: 1_000_000 });

    // Correction 1, E2-2: a model attachment without identity.modelId is no reading, not a silent skip.
    const noModelId = { type: "attachment", sessionId: SESSION, attachment: { type: "model", identity: {} } };
    expect(readClaudeCodeTranscript(jsonl([noModelId, usageRow(U(1, 0, 0, 0))]), SESSION, {})).toEqual(
      none("model attachment on line 1 has no identity.modelId"),
    );
  });

  it("a model with no known window is no reading, never an assumed million (spec 3.1)", () => {
    const text = jsonl([modelRow("claude-opus-5"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual(
      none("no window size known for model claude-opus-5; add it to .orca/level.json windows"),
    );
  });

  it("a row from another session is no reading", () => {
    const other = "ffffffff-0000-4000-8000-000000000000";
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0), { sessionId: other })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual(none(`transcript line 2 belongs to session ${other}, not ${SESSION}`));
  });

  it("before any call, or without a model attachment, there is no reading", () => {
    expect(readClaudeCodeTranscript(jsonl([modelRow("claude-opus-5[1m]")]), SESSION, {})).toEqual(none("no main-chain call with usage yet"));
    expect(readClaudeCodeTranscript(jsonl([usageRow(U(1, 0, 0, 0))]), SESSION, {})).toEqual(none("no model attachment in transcript"));
  });
});
