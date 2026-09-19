import { describe, expect, it } from "vitest";
import { buildExecutionSnapshot, prepareExecutionSnapshot, type ConfirmedProposal } from "../../src/control/executionSnapshot.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";

const hash = (letter: string) => letter.repeat(64);
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number) => ({ tokens, activeMs, attempts, sessions });
const provenance = (kind: "human" | "system" = "human") => ({
  tokens: { provenance: kind, estimateId: null }, activeMs: { provenance: kind, estimateId: null },
  attempts: { provenance: kind, estimateId: null }, sessions: { provenance: kind, estimateId: null },
} as const);

function input(): ConfirmedProposal {
  const work = amount(1_000, 40_000, 2, 2), handoff = amount(100, 5_000, 0, 0);
  const contract = {
    objective: { taskId: "a", goal: "ship", successCondition: "passes", nonGoals: [] },
    context: { repoPath: "/repo", targetPaths: ["a"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
  const originalContractCanonicalJson = canonicalBytes(contract).toString("utf8");
  return {
    groupId: "g", planHash: hash("a"), graphVersion: 1, proposalVersion: 2, groupLimit: amount(2_000, 100_000, 5, 5), budgetMode: "strict",
    contextPolicy: { handoffAtContextTokens: 800_000 },
    profiles: { estimator: { profileId: "e", profileHash: hash("b") }, worker: { profileId: "w", profileHash: hash("c") }, handoff: { profileId: "h", profileHash: hash("d") }, goalReview: { profileId: "r", profileHash: hash("e") } },
    allocations: [
      { ownerKind: "task", ownerId: "a", bucket: "work", amount: work, fieldProvenance: provenance() },
      { ownerKind: "task", ownerId: "a", bucket: "handoff", amount: handoff, fieldProvenance: provenance() },
      { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", amount: amount(1, 1, 1, 1), fieldProvenance: provenance() },
      { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", amount: amount(1, 1, 1, 1), fieldProvenance: provenance("system") },
    ],
    tasks: [{ taskId: "a", originalContractHash: sha256Canonical(contract), originalContractCanonicalJson, work, handoff }],
  };
}

describe("execution snapshot preparation", () => {
  it("derives deterministic immutable contracts and sorted snapshot authority", () => {
    const prepared = prepareExecutionSnapshot(input());
    const again = prepareExecutionSnapshot({ ...input(), allocations: [...input().allocations].reverse() });
    expect(again).toEqual(prepared);
    expect(buildExecutionSnapshot(input())).toEqual(prepared.snapshot);
    expect(prepared.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.snapshot.derivedContracts).toEqual([{ taskId: "a", derivedContractHash: prepared.derivedContracts[0].derivedContractHash }]);
    const record = JSON.parse(prepared.derivedContracts[0].canonicalJson);
    expect(record).toMatchObject({
      schema: "orca-derived-contract-record-v1",
      originalContractHash: input().tasks[0].originalContractHash,
      proposalVersion: 2,
      derivationVersion: "orca-derived-contract-v1",
    });
    expect(prepared.derivedContracts[0].derivedContractHash).toBe(sha256Canonical(record));
    const derived = JSON.parse(record.contractCanonicalJson);
    expect(derived.executionPolicy).toMatchObject({ tokenBudget: 1_000, totalRuntimeBudgetMs: 40_000, maxAttempts: 2, perAttemptTimeoutMs: 40_000, partialOutcomeRecoveryWindowMs: 5_000 });
    expect(derived.objective).toEqual(JSON.parse(input().tasks[0].originalContractCanonicalJson).objective);
  });

  it("rejects missing task buckets and unrepresentable original policies", () => {
    const missing = input();
    missing.allocations = missing.allocations.filter(row => !(row.ownerKind === "task" && row.bucket === "handoff"));
    expect(() => buildExecutionSnapshot(missing)).toThrow();
    const invalid = input();
    invalid.tasks[0].originalContractCanonicalJson = JSON.stringify({ executionPolicy: { perAttemptTimeoutMs: 0, partialOutcomeRecoveryWindowMs: 1 } });
    expect(() => buildExecutionSnapshot(invalid)).toThrow("execution-policy-unrepresentable");
  });
});
