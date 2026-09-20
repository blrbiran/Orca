import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { openTestStore } from "./store.js";
import { resolveProfile, createExecutionProfileRouter } from "../../../src/control/profiles.js";
import { importControlPlan } from "../../../src/control/planImport.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
import type { CapabilityViewV1, ExecutionProfileSnapshotV1, RawAuthorityCommandV1, ConfirmPayload } from "../../../src/control/webProtocol.js";

export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v1",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], adapter: "test", adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
      requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: [], evidenceKind: "proof" } },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { adapterConfigContentHash: "a".repeat(64), modelPolicyContentHash: "b".repeat(64), proofDocumentContentHashes: ["c".repeat(64)], adapterImplementationHash: "d".repeat(64), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [] },
});

export async function webFixture(snapshot = profileSnapshot()) {
  const h = await openTestStore();
  let observed: CapabilityViewV1 = structuredClone(snapshot.profile.capabilities);
  const accept = vi.fn(async () => ({ kind: "unknown" as const }));
  const port = { accept, probeProfileCapabilities: async () => observed,
    capabilities: async () => ({ protocol: 1, durableAccept: true, ownershipIsolation: true, evidenceRetention: true, usageObservation: "realtime", budgetEnforcement: "bounded", requestBoundEvidence: "proof" }),
    readEvidence: async () => Buffer.alloc(0), inspect: async () => ({ kind: "unknown" }), requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }) } as unknown as ExecutionPort;
  const supplied = resolveProfile(snapshot, port), router = createExecutionProfileRouter([supplied]);
  const frozen = router.resolve("budget-estimate", "all", supplied.profileHash);
  const repo = join(h.root, "repo"); await mkdir(repo);
  const contract = { objective: { taskId: "a", goal: "ship", successCondition: "passes", nonGoals: [] },
    context: { repoPath: repo, targetPaths: ["a"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] } };
  const contractPath = join(h.root, "contract.json"), planPath = join(repo, "plan.json");
  await writeFile(contractPath, canonicalBytes(contract));
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: "/bin/true", runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: "v1", configHash: sha256Canonical({}) }] }));
  const deps = { store: h.store, profileRouter: router, trustedConfig: { resolveTarget: () => ({ repositoryPath: repo, planPath, validatePlanDescriptor() {} }) },
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: frozen.profileHash, estimateMode: "soft" as const }) };
  const imported = importControlPlan({ ...deps, estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null }) }, {
    schema: "orca-raw-command-v1", commandId: "import", expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", planId: "plan" } });
  if ("error" in imported || imported.result.kind !== "imported") throw new Error(JSON.stringify(imported));
  let sequence = 0;
  const command = <V extends RawAuthorityCommandV1["verb"]>(verb: V, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"]): Extract<RawAuthorityCommandV1, { verb: V }> => ({
    schema: "orca-raw-command-v1", commandId: `command-${++sequence}`, actorId: "human", expectedRevision: Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision), verb, target: { kind: "group", groupId: "g" }, payload,
  } as Extract<RawAuthorityCommandV1, { verb: V }>);
  const confirmPayload = (): ConfirmPayload => ({ planHash: readArchivedPlan(h.store, "g").planHash, proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, budgetMode: "strict",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: frozen.profileHash, worker: frozen.profileHash, handoff: frozen.profileHash, goalReview: frozen.profileHash }, contextPolicy: { handoffAtContextTokens: 800_000 } });
  return { ...h, deps, frozen, accept, command, confirmPayload, estimateId: imported.result.estimateId, setObserved: (value: typeof observed) => { observed = value; } };
}
