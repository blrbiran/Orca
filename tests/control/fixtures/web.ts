import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { openTestStore } from "./store.js";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
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

// Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
export interface WebFixtureTask { taskId: string; dependsOn?: string[]; targetVersion?: number; configHash?: string; targetPaths?: string[] }

export async function webFixture(snapshot = profileSnapshot(), tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
  const h = await openTestStore();
  let observed: CapabilityViewV1 = structuredClone(snapshot.profile.capabilities);
  const accept = vi.fn(async () => ({ kind: "unknown" as const }));
  // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
  // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
  // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
  const port = { accept, probeProfileCapabilities: async () => observed,
    capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
    readEvidence: async () => Buffer.alloc(0), inspect: async () => ({ kind: "unknown" }), requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }) } as unknown as ExecutionPort;
  const supplied = resolveProfile(snapshot, port), router = createExecutionProfileRouter([supplied]);
  const frozen = router.resolve("budget-estimate", "all", supplied.profileHash);
  const repo = join(h.root, "repo"); await mkdir(repo);
  const planPath = join(repo, "plan.json");
  const planTasks = [];
  for (const task of tasks) {
    const contract = { objective: { taskId: task.taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths ?? [task.taskId], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] } };
    const contractPath = join(h.root, `contract-${task.taskId}.json`);
    await writeFile(contractPath, canonicalBytes(contract));
    // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
    planTasks.push({ taskId: task.taskId, contract: contractPath, dependsOn: task.dependsOn ?? [], targetVersion: task.targetVersion ?? 1, configHash: task.configHash ?? sha256Canonical({}) });
  }
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: "/bin/true", runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], tasks: planTasks }));
  const deps = { store: h.store, admissionGate: createAdmissionGate(), profileRouter: router, trustedConfig: { resolveTarget: () => ({ repositoryPath: repo, planPath, validatePlanDescriptor() {} }) },
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: frozen.profileHash, estimateMode: "soft" as const }) };
  const imported = importControlPlan({ ...deps, estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null }) }, {
    schema: "orca-raw-command-v1", commandId: "import", expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", planId: "plan" } });
  if ("error" in imported || imported.result.kind !== "imported") throw new Error(JSON.stringify(imported));
  let sequence = 0;
  const raw = (commandId: string, expectedRevision: number, verb: RawAuthorityCommandV1["verb"], target: RawAuthorityCommandV1["target"], payload: unknown) => ({
    schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision, verb, target, payload,
  });
  const currentRevision = () => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
  const command = <V extends RawAuthorityCommandV1["verb"]>(verb: V, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"], commandId = `command-${++sequence}`): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(commandId, currentRevision(), verb, { kind: "group", groupId: "g" }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  /** A task-scoped command under the current group revision, for the per-task `continue` path. */
  const taskCommand = <V extends RawAuthorityCommandV1["verb"]>(verb: V, taskId: string, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"]): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(`command-${++sequence}`, currentRevision(), verb, { kind: "task", groupId: "g", taskId }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  /** A run-scoped command; run-scope `recovery-retry` requires its target to name the same run as its payload. */
  const runCommand = <V extends RawAuthorityCommandV1["verb"]>(verb: V, runId: string, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"]): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(`command-${++sequence}`, currentRevision(), verb, { kind: "run", groupId: "g", runId }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  const confirmPayload = (): ConfirmPayload => ({ planHash: readArchivedPlan(h.store, "g").planHash, proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, budgetMode: "strict",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: frozen.profileHash, worker: frozen.profileHash, handoff: frozen.profileHash, goalReview: frozen.profileHash }, contextPolicy: { handoffAtContextTokens: 800_000 } });
  return { ...h, deps, frozen, accept, command, taskCommand, runCommand, rawCommand: raw, confirmPayload, estimateId: imported.result.estimateId, setObserved: (value: typeof observed) => { observed = value; } };
}
