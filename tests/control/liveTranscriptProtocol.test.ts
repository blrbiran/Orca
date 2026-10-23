import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { startEnvelopeSchema } from "../../src/control/schema.js";

/**
 * Live transcript spec 2026-10-23 §10.2.4 / §10.2.6, as ccloop f4de340 ships them: `features` answers `transcripts: "v1"`,
 * collect may carry a top-level `transcripts` listing, and the loop envelope may carry `work.operatorNote`. Orca's parses are
 * strict, so without these mirrors the re-pin would make every features probe -- and so every protocol-4 start -- and every
 * collect of a run with an agent call fail with control-response-invalid.
 */
const FAILED_TERMINAL = { status: "failed", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-10-24T00:00:00Z", waitingOnHuman: false, stopReason: null, budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 0, tokenBudgetRemaining: null }, recentFailures: [] };
const FEATURES = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1", transcripts: "v1" };
const ENTRY = { attempt: 1, phase: "execute", seq: 1, path: "claude/attempt-1/execute/call-a1/transcript.jsonl", bytes: 1234, final: false, truncatedAt: null };
const LEGACY = { attempt: 1, phase: "plan", seq: 1, path: null, bytes: 0, final: true, truncatedAt: null };

async function fixture(extra: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-live-transcript-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), ...extra }), { mode: 0o600 });
  const envelope: StartEnvelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: root, base: "HEAD", sourceDir: root } };
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("features: transcripts v1 (spec §10.2.4)", () => {
  // mutation: drop `transcripts` from featuresSchema -> the f4de340 answer is refused (control-response-invalid), red
  it("accepts ccloop f4de340's full features answer and returns the flag", async () => {
    const h = await fixture({ features: FEATURES });
    expect(await h.port.readFeatures?.()).toEqual(FEATURES);
  });
  it("still refuses an unknown feature key and a wrong transcripts value", async () => {
    const extra = await fixture({ features: { ...FEATURES, somethingElse: "v1" } });
    await expect(extra.port.readFeatures?.()).rejects.toThrow("control-response-invalid");
    const wrong = await fixture({ features: { ...FEATURES, transcripts: "v2" } });
    await expect(wrong.port.readFeatures?.()).rejects.toThrow("control-response-invalid");
  });
});

describe("collect's transcripts listing through the real port (spec §10.2.4)", () => {
  // mutation: drop `transcripts` from collectionSchema -> both protocols refuse the answer, red
  // mutation: drop the pass-through in collect's mapper -> report.transcripts undefined, red
  it("accepts and hands on the listing as given, on protocol 3 and 4", async () => {
    const v3 = await fixture({ collectExtra: { transcripts: [ENTRY, LEGACY] } });
    expect((await v3.port.collect(v3.envelope, 0)).transcripts).toEqual([ENTRY, LEGACY]);
    const v4 = await fixture({ features: FEATURES, terminal: { ...FAILED_TERMINAL, budgetSnapshot: { ...FAILED_TERMINAL.budgetSnapshot, tokenRemainingStatus: "known" } }, collectExtra: { transcripts: [ENTRY] } });
    expect((await v4.port.collect({ ...v4.envelope, protocol: 4 }, 0)).transcripts).toEqual([ENTRY]);
  });
  it("states no transcripts key when ccloop listed none", async () => {
    const h = await fixture();
    expect("transcripts" in (await h.port.collect(h.envelope, 0))).toBe(false);
  });
  // mutation: .passthrough() instead of .strict() on the entry -> the extra key is accepted, red
  // mutation: drop .min(1) on the array -> the empty listing is accepted, red
  it("refuses a listing of the wrong shape: an extra entry key, a missing one, an empty array, attempt 0", async () => {
    for (const transcripts of [[{ ...ENTRY, extra: 1 }], [{ ...ENTRY, final: undefined }], [], [{ ...ENTRY, attempt: 0 }], [{ ...ENTRY, path: "" }]]) {
      const h = await fixture({ collectExtra: { transcripts } });
      await expect(h.port.collect(h.envelope, 0), JSON.stringify(transcripts)).rejects.toThrow("control-response-invalid");
    }
  });
  it("still refuses an unknown top-level key beside a valid listing, on protocol 3 and 4", async () => {
    const v3 = await fixture({ collectExtra: { transcripts: [ENTRY], extra: 1 } });
    await expect(v3.port.collect(v3.envelope, 0)).rejects.toThrow("control-response-invalid");
    const v4 = await fixture({ features: FEATURES, collectExtra: { transcripts: [ENTRY], extra: 1 } });
    await expect(v4.port.collect({ ...v4.envelope, protocol: 4 }, 0)).rejects.toThrow("control-response-invalid");
  });
});

describe("work.operatorNote on the loop envelope (spec §10.2.6)", () => {
  const hx = (v: string) => v.repeat(64);
  const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
  const claim = {
    groupId: "g", workItemId: "w", taskId: "a", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c",
    configHash: hx("a"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(0) }, ownerToken: "owner",
  };
  const work = { kind: "loop", contract: { objective: "ship" }, targetRepo: "/r", base: "b", sourceDir: "/s" };
  const envelope = (note?: unknown, extra: Record<string, unknown> = {}) => ({ protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, ...extra,
    work: note === undefined ? work : { ...work, operatorNote: note } });
  const ok = (value: unknown) => startEnvelopeSchema.safeParse(value).success;
  // Recorded by sha256Canonical of exactly this literal envelope at b225f664, before operatorNote existed.
  const GOLDEN_WITHOUT_NOTE = "0a28575da64d3aebc16f2f617b9a5bdd7f6e4b9c96b5c6c0db7bdd2a73c53ca1";

  // mutation: operatorNoteSchema.default(...) / .nullable().default(null) -> the parsed envelope gains a key and a new hash, red
  it("keeps an envelope without the note byte-identical: the parse adds no key, the hash is the recorded one", () => {
    const parsed = startEnvelopeSchema.parse(envelope());
    expect(Object.keys(parsed.work).sort()).toEqual(["base", "contract", "kind", "sourceDir", "targetRepo"]);
    expect(sha256Canonical(parsed)).toBe(GOLDEN_WITHOUT_NOTE);
    expect(sha256Canonical(envelope())).toBe(GOLDEN_WITHOUT_NOTE);
  });
  // mutation: drop operatorNote from loopWorkSchema -> the strict work refuses it, red
  it("accepts a note of either scope and keeps it exactly", () => {
    for (const scope of ["next-attempt", "remaining-attempts"]) {
      const parsed = startEnvelopeSchema.parse(envelope({ text: "use the v2 API", scope }));
      expect((parsed.work as { operatorNote?: unknown }).operatorNote).toEqual({ text: "use the v2 API", scope });
    }
  });
  // mutation: .max(4096) instead of the UTF-8 byte refine -> 1366 × "中" (4098 bytes) accepted, red
  it("bounds the text in UTF-8 bytes and refuses an empty text, an unknown scope, an extra key", () => {
    expect(ok(envelope({ text: "中".repeat(1365), scope: "next-attempt" }))).toBe(true);
    expect(ok(envelope({ text: "中".repeat(1366), scope: "next-attempt" }))).toBe(false);
    expect(ok(envelope({ text: "", scope: "next-attempt" }))).toBe(false);
    expect(ok(envelope({ text: "x", scope: "forever" }))).toBe(false);
    expect(ok(envelope({ text: "x", scope: "next-attempt", by: "me" }))).toBe(false);
  });
  // mutation: drop the saved-result refusal -> accepted, red (ccloop f4de340 refuses it there too)
  it("is refused with a saved-result recovery, which builds no prompt", () => {
    const recovery = { mode: "verify-saved-result", protocol: 4, savedResultRecovery: { packagePath: "/p", packageHash: hx("c"), admissionHash: hx("d"), recoveryOf: { sourceRunId: "r0", sourceAttempt: 1, capsuleHash: hx("e"), snapshotHash: hx("f"), normalizedExecutionHash: hx("1") } } };
    expect(ok(envelope(undefined, recovery))).toBe(true);
    expect(ok(envelope({ text: "x", scope: "next-attempt" }, recovery))).toBe(false);
  });
});
