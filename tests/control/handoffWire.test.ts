import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import { dispatchEnvelopeSchema } from "../../src/control/webProtocol.js";

/**
 * Tester follow-up G Parts 4–5 (spec 2026-11-12 §10.2; ccloop C1–C4): the start envelope's optional `work.handoff`
 * and collect's `handoffFiles` / `liveNotes`. An envelope without the handoff must keep its bytes and hash (every run
 * dispatched before the upgrade was hashed that way), and Orca's strict collect parse must take ccloop's two new keys --
 * and the live-ceiling stop record a later repin brings (part B consumes it) -- or every collect of such a run would be
 * refused as control-response-invalid.
 */
const hx = (v: string) => v.repeat(64);
const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
const ledger = () => dispatchEnvelopeSchema.parse({
  schema: "orca-dispatch-envelope-v1", phase: "work", groupId: "g1", workItemId: "w1", runId: "run-1", generation: 2,
  claimIdentity: "claim-identity-1", ownerTokenHash: hx("a"), continuationIntentId: null, claimOrdinal: 1, derivedContractHash: hx("b"),
  grants: { work: amount(5), handoff: amount(3) }, profiles: { estimator: null, worker: { profileId: "worker", profileHash: hx("9") }, handoff: { profileId: "handoff", profileHash: hx("9") } },
});
const runRow = {
  groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2, graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1",
  configHash: hx("c"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
};
const work = { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" };
const HANDOFF = { inputDir: "/tmp/state/groups/g1/handoffs/runs/run-1/in", outputDir: "/tmp/state/groups/g1/handoffs/runs/run-1/out" };

describe("work.handoff on the start envelope (spec §10.2)", () => {
  // mutation M-O1a: emit `handoff: work.handoff` unconditionally -> the key appears (undefined) and the keys differ, red
  it("toStartEnvelope without handoff is byte-identical (keys and sha256Canonical); with it, work.handoff is the input", () => {
    const without = toStartEnvelope(ledger(), runRow, work, { objective: "ship" });
    expect(Object.keys(without.work).sort()).toEqual(["base", "contract", "kind", "sourceDir", "targetRepo"]);
    expect(Object.hasOwn(without.work, "handoff")).toBe(false);
    // Built literally, as the envelope was before handoffs existed: the hash must be the same one.
    const literal = { protocol: 3, claim: { ...runRow }, contractHash: hx("b"), inputCheckpoint: null,
      work: { kind: "loop", contract: { objective: "ship" }, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } };
    expect(sha256Canonical(without)).toBe(sha256Canonical(literal));
    const withHandoff = toStartEnvelope(ledger(), runRow, { ...work, handoff: HANDOFF }, { objective: "ship" });
    expect((withHandoff.work as { handoff?: unknown }).handoff).toEqual(HANDOFF);
    expect(startEnvelopeSchema.parse(withHandoff)).toEqual(withHandoff);
  });

  it("refuses an extra key inside handoff, and an empty directory", () => {
    const base = toStartEnvelope(ledger(), runRow, work, { objective: "ship" });
    const ok = (handoff: unknown) => startEnvelopeSchema.safeParse({ ...base, work: { ...base.work, handoff } }).success;
    expect(ok(HANDOFF)).toBe(true);
    expect(ok({ ...HANDOFF, extra: "x" })).toBe(false);
    expect(ok({ ...HANDOFF, outputDir: "" })).toBe(false);
    expect(ok({ inputDir: HANDOFF.inputDir })).toBe(false);
  });

  // mutation M-O1b: drop the superRefine clause -> the recovery envelope with a handoff parses, red
  it("startEnvelopeSchema refuses handoff beside mode verify-saved-result", () => {
    const base = toStartEnvelope(ledger(), runRow, work, { objective: "ship" });
    const recovery = { ...base, protocol: 4, mode: "verify-saved-result",
      savedResultRecovery: { packagePath: "/p", packageHash: hx("c"), admissionHash: hx("d"), recoveryOf: { sourceRunId: "r0", sourceAttempt: 1, capsuleHash: hx("e"), snapshotHash: hx("f"), normalizedExecutionHash: hx("1") } } };
    expect(startEnvelopeSchema.safeParse(recovery).success).toBe(true);
    const refused = startEnvelopeSchema.safeParse({ ...recovery, work: { ...recovery.work, handoff: HANDOFF } });
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((issue) => issue.message)).toContain("handoff-with-saved-result");
  });
});

const FEATURES = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1", transcripts: "v1" };
const FAILED_TERMINAL = { status: "failed", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-10-24T00:00:00Z", waitingOnHuman: false, stopReason: null, budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 0, tokenBudgetRemaining: null, tokenRemainingStatus: "known" }, recentFailures: [] };
const FILES = { handoff: { present: true, bytes: 11 }, summary: { present: false, bytes: null } };
const NOTES = { delivered: [{ id: "cmd-1", phase: "execute", attempt: 2, at: "2026-11-12T01:02:03.000Z" }] };
const CEILING = { revision: 1, tokens: 1000, cause: "group", observedTokens: 1200, phase: "execute", at: "mid-call" };

async function fixture(extra: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-handoff-wire-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), ...extra }), { mode: 0o600 });
  const envelope: StartEnvelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: root, base: "HEAD", sourceDir: root } };
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("collect's handoffFiles and liveNotes through the real port (ccloop C4)", () => {
  // mutation: drop either key from collectionSchema -> the answer is refused (control-response-invalid), red
  // mutation: drop the pass-through in collect's mapper -> report.handoffFiles / report.liveNotes undefined, red
  it("the collection schema accepts handoffFiles and liveNotes and hands them on, on protocol 3 and 4", async () => {
    const v3 = await fixture({ collectExtra: { handoffFiles: FILES, liveNotes: NOTES } });
    const report = await v3.port.collect(v3.envelope, 0);
    expect(report.handoffFiles).toEqual(FILES);
    expect(report.liveNotes).toEqual(NOTES);
    const v4 = await fixture({ features: FEATURES, terminal: FAILED_TERMINAL, collectExtra: { handoffFiles: FILES, liveNotes: NOTES } });
    const v4Report = await v4.port.collect({ ...v4.envelope, protocol: 4 }, 0);
    expect(v4Report.handoffFiles).toEqual(FILES);
    expect(v4Report.liveNotes).toEqual(NOTES);
  });
  it("states neither key when ccloop sent neither", async () => {
    const h = await fixture();
    const report = await h.port.collect(h.envelope, 0);
    expect(Object.hasOwn(report, "handoffFiles")).toBe(false);
    expect(Object.hasOwn(report, "liveNotes")).toBe(false);
  });
  // mutation: .passthrough() on either inner object -> the extra key is accepted, red
  it("refuses an extra key inside either", async () => {
    for (const collectExtra of [
      { handoffFiles: { ...FILES, extra: 1 } },
      { handoffFiles: { ...FILES, handoff: { present: true, bytes: 1, path: "/x" } } },
      { liveNotes: { ...NOTES, extra: 1 } },
      { liveNotes: { delivered: [{ ...NOTES.delivered[0], text: "leak" }] } },
      { liveNotes: { delivered: [{ ...NOTES.delivered[0], phase: "setup" }] } },
    ]) {
      const h = await fixture({ collectExtra });
      await expect(h.port.collect(h.envelope, 0), JSON.stringify(collectExtra)).rejects.toThrow("control-response-invalid");
    }
  });
  // Only-add for the stacked part B: a ccloop that ends a run at its live ceiling reports this top-level record.
  // mutation: drop liveCeilingStop from collectionSchema -> refused, red
  it("accepts ccloop's liveCeilingStop record, and refuses one of the wrong shape", async () => {
    const h = await fixture({ collectExtra: { liveCeilingStop: CEILING } });
    await expect(h.port.collect(h.envelope, 0)).resolves.toBeDefined();
    const bad = await fixture({ collectExtra: { liveCeilingStop: { ...CEILING, cause: "other" } } });
    await expect(bad.port.collect(bad.envelope, 0)).rejects.toThrow("control-response-invalid");
  });
});
