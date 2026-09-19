import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExecutionSnapshot, prepareExecutionSnapshot, type ConfirmedProposal } from "../../src/control/executionSnapshot.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { controlPlanSchema } from "../../src/control/webProtocol.js";
import { openTestStore } from "./fixtures/store.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";

const hash = (letter: string) => letter.repeat(64);
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number) => ({ tokens, activeMs, attempts, sessions });
const provenance = (kind: "human" | "system" = "human") => ({
  tokens: { provenance: kind, estimateId: null }, activeMs: { provenance: kind, estimateId: null },
  attempts: { provenance: kind, estimateId: null }, sessions: { provenance: kind, estimateId: null },
} as const);

function authority() {
  const contract = {
    objective: { taskId: "a", goal: "ship", successCondition: "passes", nonGoals: [] },
    context: { repoPath: "/repo", targetPaths: ["a"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
  const originalContractCanonicalJson = canonicalBytes(contract).toString("utf8");
  const plan = controlPlanSchema.parse({
    schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
    tasks: [{ taskId: "a", dependencyTaskIds: [], targetVersion: "v1", configHash: hash("f"),
      originalContractHash: sha256Canonical(contract), originalContractCanonicalJson }],
  });
  const planCanonicalJson = canonicalBytes(plan).toString("utf8");
  const planHash = sha256Canonical(plan);
  return { contract, originalContractCanonicalJson, plan, planCanonicalJson, planHash };
}

let harness: Awaited<ReturnType<typeof openTestStore>>;
beforeEach(async () => {
  harness = await openTestStore();
  const a = authority();
  const work = amount(1_000, 40_000, 2, 2), handoff = amount(100, 5_000, 0, 0);
  const proposalAllocations = [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: work, fieldProvenance: provenance() },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: handoff, fieldProvenance: provenance() },
    { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", state: "draft-encumbered", amount: amount(1, 1, 1, 1), fieldProvenance: provenance() },
    { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", state: "draft-encumbered", amount: amount(1, 1, 1, 1), fieldProvenance: provenance("system") },
  ].sort((left, right) => `${left.ownerKind}\0${left.ownerId}\0${left.bucket}`.localeCompare(`${right.ownerKind}\0${right.ownerId}\0${right.bucket}`));
  const group = {
    groupId: "g", graphVersion: 1, planHash: a.planHash,
    plan: { repoId: "repo", planId: "plan", planHash: a.planHash, goal: "ship", successConditions: ["passes"] },
    proposal: { state: "editable", proposalVersion: 2, planHash: a.planHash, budgetMode: null,
      contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: amount(2_000, 100_000, 5, 5) },
  };
  harness.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('g',1,1,1,?)").run(JSON.stringify(group));
  writeCanonicalRecord(harness.store, "g", a.planHash, a.planCanonicalJson);
  writeCanonicalRecord(harness.store, "g", a.plan.tasks[0].originalContractHash, a.originalContractCanonicalJson);
  const proposal = {
    proposalVersion: 2, state: "editable", planHash: a.planHash, groupLimit: amount(2_000, 100_000, 5, 5),
    explicitUnallocatedReserve: amount(1, 1, 1, 1), allocations: proposalAllocations,
    budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null,
  };
  harness.store.db.prepare("INSERT INTO budget_proposals(group_id,proposal_version,body) VALUES ('g',2,?)")
    .run(canonicalBytes(proposal).toString("utf8"));
  const request = {
    schema: "budget-estimate-request-v1", planHash: a.planHash, planSnapshotCanonicalJson: a.planCanonicalJson,
    estimatorProfile: { profileId: "e", profileHash: hash("b") },
    estimatorCapabilities: { contextWindowTokens: 1_000_000, usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable" },
    responseSchemaVersion: "budget-estimate-v1", instructionVersion: "1",
  };
  const estimate = {
    estimateId: "estimate-1", estimateVersion: 1, state: "queued",
    profile: { profileId: "e", profileHash: hash("b") }, mode: "strict",
    requestHash: sha256Canonical(request), request, outputHash: null, output: null,
    reasonCode: null, grant: amount(10, 10, 1, 1),
  };
  harness.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES ('g','estimate-1',1,'queued',?)")
    .run(canonicalBytes(estimate).toString("utf8"));
});
afterEach(async () => { await harness.dispose(); });

function input(): ConfirmedProposal {
  const work = amount(1_000, 40_000, 2, 2), handoff = amount(100, 5_000, 0, 0);
  const a = authority();
  return {
    store: harness.store,
    groupId: "g", planHash: a.planHash, graphVersion: 1, proposalVersion: 2, groupLimit: amount(2_000, 100_000, 5, 5), budgetMode: "strict",
    proposalIdentity: { groupId: "g", planHash: a.planHash, proposalVersion: 2 },
    contextPolicy: { handoffAtContextTokens: 800_000 },
    profiles: { estimator: { profileId: "e", profileHash: hash("b") }, worker: { profileId: "w", profileHash: hash("c") }, handoff: { profileId: "h", profileHash: hash("d") }, goalReview: { profileId: "r", profileHash: hash("e") } },
    allocations: [
      { ownerKind: "task", ownerId: "a", bucket: "work", amount: work, fieldProvenance: provenance() },
      { ownerKind: "task", ownerId: "a", bucket: "handoff", amount: handoff, fieldProvenance: provenance() },
      { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", amount: amount(1, 1, 1, 1), fieldProvenance: provenance() },
      { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", amount: amount(1, 1, 1, 1), fieldProvenance: provenance("system") },
      { ownerKind: "estimate", ownerId: "estimate-1", bucket: "work", amount: amount(10, 10, 1, 1), fieldProvenance: provenance("system") },
    ],
    tasks: [{ taskId: "a", originalContractHash: sha256Canonical(a.contract), originalContractCanonicalJson: a.originalContractCanonicalJson, work, handoff }],
  };
}

function rewriteEstimateGrant(grant: ReturnType<typeof amount>): void {
  const row = harness.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id='estimate-1'").get()!;
  const estimate = { ...JSON.parse(String(row.body)), grant };
  harness.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id='estimate-1'")
    .run(canonicalBytes(estimate).toString("utf8"));
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
    invalid.tasks[0].work = { ...invalid.tasks[0].work, attempts: 0 };
    expect(() => buildExecutionSnapshot(invalid)).toThrow("execution-policy-unrepresentable");
  });

  it.each(["omitted", "extra"] as const)("rejects an %s task relative to archived plan authority", kind => {
    const candidate = input();
    if (kind === "omitted") candidate.tasks = [];
    else candidate.tasks.push({ ...candidate.tasks[0], taskId: "b" });
    expect(() => buildExecutionSnapshot(candidate)).toThrow("plan-version-conflict");
  });

  it("rejects component over-limit and safe-integer sum overflow", () => {
    const over = input();
    const overEstimate = over.allocations.find(allocation => allocation.ownerKind === "estimate")!;
    overEstimate.amount.tokens = 2_000;
    rewriteEstimateGrant(overEstimate.amount);
    expect(() => buildExecutionSnapshot(over)).toThrow("group-budget-unavailable");

    const overflow = input();
    const overflowEstimate = overflow.allocations.find(allocation => allocation.ownerKind === "estimate")!;
    overflowEstimate.amount = amount(Number.MAX_SAFE_INTEGER, 0, 0, 0);
    rewriteEstimateGrant(overflowEstimate.amount);
    expect(() => buildExecutionSnapshot(overflow)).toThrow("numeric-overflow");
  });

  it.each([
    ["omitted", (candidate: ConfirmedProposal) => {
      candidate.allocations = candidate.allocations.filter(allocation => allocation.ownerKind !== "estimate");
    }],
    ["substituted", (candidate: ConfirmedProposal) => {
      const estimate = candidate.allocations.find(allocation => allocation.ownerKind === "estimate")!;
      estimate.amount = amount(10, 11, 1, 1);
    }],
    ["understated", (candidate: ConfirmedProposal) => {
      const estimate = candidate.allocations.find(allocation => allocation.ownerKind === "estimate")!;
      estimate.amount = amount(9, 10, 1, 1);
    }],
    ["duplicate", (candidate: ConfirmedProposal) => {
      const estimate = candidate.allocations.find(allocation => allocation.ownerKind === "estimate")!;
      candidate.allocations.push(structuredClone(estimate));
    }],
    ["wrong-ID", (candidate: ConfirmedProposal) => {
      const estimate = candidate.allocations.find(allocation => allocation.ownerKind === "estimate")!;
      estimate.ownerId = "estimate-other";
    }],
  ] as const)("rejects an %s estimate allocation relative to persisted authority", (_label, mutate) => {
    const candidate = input();
    mutate(candidate);
    expect(() => buildExecutionSnapshot(candidate)).toThrow("execution-policy-unrepresentable");
  });

  it.each([
    ["group", "execution-identity-conflict", (candidate: ConfirmedProposal) => { candidate.proposalIdentity.groupId = "other"; }],
    ["plan", "plan-version-conflict", (candidate: ConfirmedProposal) => { candidate.proposalIdentity.planHash = hash("9"); }],
    ["proposal", "proposal-version-conflict", (candidate: ConfirmedProposal) => { candidate.proposalIdentity.proposalVersion = 3; }],
  ] as const)("rejects mismatched %s identity", (_label, code, mutate) => {
    const candidate = input();
    mutate(candidate);
    expect(() => buildExecutionSnapshot(candidate)).toThrow(code);
  });
});
