import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { settleSlowMsFromEnv } from "../../src/control/executionDriver.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { savedResultEligibilitySchema, savedResultPackageSchema, savedResultSourceEligibilitySchema } from "../../src/control/savedResultProtocol.js";

/**
 * Change-sized runs spec 2026-11-19 §6.1 / §6.2 (P2; #363 #366), against ccloop P1 as built (633534c): collect's top-level
 * `attempt` (AttemptRecordV1) is accepted by Orca's strict collect schema and handed to step C; it is an answer to a keyed
 * envelope only; a keyed run has no result repository (`terminal.repoDir` null); `dirs[]` reaches C with its attemptSha.
 */
const FEATURES = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1", transcripts: "v1", attemptRef: "v1" };
const TERMINAL = { status: "succeeded", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-11-19T00:00:00Z", waitingOnHuman: false, stopReason: null,
  budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 100, tokenBudgetRemaining: 100, tokenRemainingStatus: "known" }, recentFailures: [] };
const PUBLISHED = { attempt: 1, sha: "1".repeat(40), base: "2".repeat(40), tree: "3".repeat(40), ref: "refs/ccloop/r/attempts/1", head: "1".repeat(40), capture: "published", worktree: "removed" };

async function fixture(collectExtra: Record<string, unknown>, keyed: boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-attempt-record-port-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), features: FEATURES, terminal: TERMINAL, collectExtra }), { mode: 0o600 });
  const envelope = { protocol: 4, tokenPolicy: { kind: "optional-v1", cap: null }, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" },
    contractHash: "b".repeat(64), inputCheckpoint: null,
    work: { kind: "loop", contract: { objective: "ship" }, targetRepo: root, base: "HEAD", sourceDir: root, ...(keyed ? { attemptDelivery: "ref-v1" } : {}) } } as unknown as StartEnvelope;
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope, root };
}

describe("collect's attempt record (change-sized runs §6.1, P2)", () => {
  // Mutation: drop `attempt` from collectionSchema -> the strict schema refuses the P1 answer (control-response-invalid), red.
  // Mutation: drop the `attempt` spread from the report -> report.attempt is undefined, red.
  it("hands a keyed run's published and failed records to step C, and its terminal names no result repository", async () => {
    const h = await fixture({ attempt: PUBLISHED }, true);
    const report = await h.port.collect(h.envelope, 0);
    expect(report.attempt).toEqual(PUBLISHED);
    // Mutation: keep repoDir as <sourceDir>/repo for keyed runs -> red.
    expect(report.terminal?.repoDir).toBeNull();
    const failed = { attempt: 1, sha: null, reason: "record-failed", detail: "attempt-record-missing" };
    expect((await (await fixture({ attempt: failed }, true)).port.collect((await fixture({}, true)).envelope, 0)).attempt).toEqual(failed);
  });

  // Mutation: drop the attempt-without-delivery check -> the answer is taken, red.
  it("refuses an attempt record answering an envelope without the key, and keeps <sourceDir>/repo there", async () => {
    const h = await fixture({ attempt: PUBLISHED }, false);
    await expect(h.port.collect(h.envelope, 0)).rejects.toThrow("control-response-invalid");
    const legacy = await fixture({}, false);
    const report = await legacy.port.collect(legacy.envelope, 0);
    expect(report.terminal?.repoDir).toBe(join(legacy.root, "repo"));
    expect(Object.hasOwn(report, "attempt")).toBe(false);
  });

  it("refuses a record of any other shape", async () => {
    for (const attempt of [{ ...PUBLISHED, capture: "copied" }, { ...PUBLISHED, extra: 1 }, { attempt: 0, sha: null, reason: "gone" }]) {
      const h = await fixture({ attempt }, true);
      await expect(h.port.collect(h.envelope, 0)).rejects.toThrow("control-response-invalid");
    }
  });
});

describe("dirs[] reaches step C (change-sized runs §5.7, P2)", () => {
  // Mutation: drop the `dirs` spread from the report -> red.
  it("keeps each extra directory's attemptSha from collect's answer", async () => {
    const dirs = [{ key: "alpha", resultRepo: "repos/alpha", changedPaths: ["a.txt"], attemptSha: "4".repeat(40) }];
    const h = await fixture({ dirs }, true);
    const envelope = { ...h.envelope, work: { ...h.envelope.work, additionalRepos: [{ key: "alpha", targetRepo: join(h.root, "alpha"), base: "HEAD" }] } } as unknown as StartEnvelope;
    expect((await h.port.collect(envelope, 0)).dirs).toEqual(dirs);
  });
});

describe("legacy-published-candidate-v2 (change-sized runs §5.5.4, P2)", () => {
  // Mutation: drop the v2 kind from either enum -> red.
  it("is a package authority and an eligibility answer Orca accepts", () => {
    const ref = { artifactId: "saved-result-a", hash: "a".repeat(64) };
    expect(savedResultPackageSchema.parse({ schema: "ccloop-saved-result-package-v1", authorityKind: "legacy-published-candidate-v2", source: ref, admission: ref, artifacts: [] }).authorityKind).toBe("legacy-published-candidate-v2");
    expect(savedResultEligibilitySchema.parse({ status: "eligible", authorityKind: "legacy-published-candidate-v2", normalizedExecutionHash: "b".repeat(64) })).toEqual({ status: "eligible", authorityKind: "legacy-published-candidate-v2", normalizedExecutionHash: "b".repeat(64) });
    const sourceIdentity = { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "e", envelopeHash: "c".repeat(64) };
    const eligible = { status: "eligible", authorityKind: "legacy-published-candidate-v2", sourceIdentity, rawExecutionTokens: 3, limitation: "published-candidate-only; current membership and settled accounting require controller admission",
      recoveryOf: { sourceRunId: "r", sourceAttempt: 1, capsuleHash: "d".repeat(64), snapshotHash: "e".repeat(64), normalizedExecutionHash: "f".repeat(64) } };
    expect(savedResultSourceEligibilitySchema.parse(eligible)).toEqual(eligible);
  });
});

describe("ORCA_SETTLE_SLOW_MS (change-sized runs §6.2, P2)", () => {
  // Mutation: ignore the variable (return undefined) -> red; accept a non-integer -> red.
  it("sets the settle timing bound, 0 included, and refuses anything that is not a whole number of ms", () => {
    expect(settleSlowMsFromEnv({})).toBeUndefined();
    expect(settleSlowMsFromEnv({ ORCA_SETTLE_SLOW_MS: "0" })).toBe(0);
    expect(settleSlowMsFromEnv({ ORCA_SETTLE_SLOW_MS: "2500" })).toBe(2500);
    for (const bad of ["-1", "1.5", "5s", " 3"]) expect(() => settleSlowMsFromEnv({ ORCA_SETTLE_SLOW_MS: bad })).toThrow("control-trusted-config-invalid");
  });
});
