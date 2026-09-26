import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { openTestStore } from "./store.js";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
import { resolveProfile, createExecutionProfileRouter } from "../../../src/control/profiles.js";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../../src/control/planImport.js";
import { canonicalBytes } from "../../../src/control/canonicalJson.js";
import { resolveGroupSelections } from "../../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
import type { AgentSelection, OperatorPreferences, PartialSelection } from "../../../src/control/agentSelection.js";
import { FIXTURE_AGENT_ID, fixtureResolveAgent, seedPanelOperator, seedPreferences } from "./agents.js";
import type { CapabilityViewV1, ExecutionProfileSnapshotV1, RawAuthorityCommandV1, ConfirmPayload } from "../../../src/control/webProtocol.js";

// Agent selection spec §6.5: profile v2 carries no adapter identity (plan T11).
export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
      requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: [], evidenceKind: "proof" } },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
});

// Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
export interface WebFixtureTask { taskId: string; dependsOn?: string[]; targetVersion?: number; targetPaths?: string[]; agent?: PartialSelection }
/**
 * Agent selection plan T10 (spec §6.2): the importing operator's ("human") preferences -- `null` leaves them unset, absent
 * seeds a default agent so the import-time estimator slot resolves -- and the plan's group layers (R7: no estimatorAgent).
 */
export interface WebFixtureOptions {
  preferences?: OperatorPreferences | null;
  planAgents?: { agent?: PartialSelection; reconcileAgent?: PartialSelection };
  /** The killGraceMs the fixture's ccloop answers for every selection (5 000 unless said otherwise), frozen at confirmation. */
  killGraceMs?: number;
  /** Audit 2026-09-26 (seat B): the fixture's ccloop answers each selection its own configHash (agents.ts `fixtureConfigHashOf`). */
  distinctConfigHash?: boolean;
}

/** Agent selection spec §3: the complete selection this fixture's task work items are frozen with. */
export const FIXTURE_AGENT: AgentSelection = { agent: FIXTURE_AGENT_ID, model: "fixture-model", contextWindow: "agent-default" };

export async function webFixture(snapshot = profileSnapshot(), tasks: readonly WebFixtureTask[] = [{ taskId: "a" }], options: WebFixtureOptions = {}) {
  const h = await openTestStore();
  let observed: CapabilityViewV1 = structuredClone(snapshot.profile.capabilities);
  const accept = vi.fn(async () => ({ kind: "unknown" as const }));
  // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
  // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
  // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the probe is now a resolution of
  // the selection being asked about (capabilities protocol 3); its capability view is still the mutable `observed`.
  // T7 fix round 1: every selection the port is asked about, in order, so a criterion can pin which one a gate asked.
  // Plan T11: the answer is `resolveAgent`, a mock a criterion may inspect or re-implement (agents.ts), which refuses an
  // installation it does not know as ccloop would.
  const asked: PartialSelection[] = [];
  const resolveAgent = fixtureResolveAgent(() => observed, { killGraceMs: options.killGraceMs, ...(options.distinctConfigHash ? { distinctConfigHash: true } : {}) });
  const port = { accept, resolveAgent: async (partial: PartialSelection) => (asked.push(structuredClone(partial)), resolveAgent(partial)),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
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
    planTasks.push({ taskId: task.taskId, contract: contractPath, dependsOn: task.dependsOn ?? [], targetVersion: task.targetVersion ?? 1, ...(task.agent ? { agent: task.agent } : {}) });
  }
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: "/bin/true", runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], ...options.planAgents, tasks: planTasks }));
  // Agent selection plan T10 (spec §6.4): the import freezes the estimator slot resolved from the importing operator's
  // layers, so the operator prefers the fixture agent unless a criterion says otherwise.
  const preferences = options.preferences === undefined ? { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} } : options.preferences;
  // The panel's operator (a criterion that mounts the mutation routes acts as it) is given the same preferences.
  if (preferences !== null) { seedPreferences(h.store, "human", preferences); seedPanelOperator(h.store, preferences); }
  const importCommand: ImportCommand = { schema: "orca-raw-command-v1", commandId: "import", expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", planId: "plan" } };
  const prepared = await prepareEstimatorSlot({ store: h.store, profileRouter: router }, importCommand, frozen);
  const deps = { store: h.store, port, admissionGate: createAdmissionGate(), profileRouter: router, trustedConfig: { resolveTarget: () => ({ repositoryPath: repo, planPath, validatePlanDescriptor() {} }) },
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: frozen.profileHash, estimateMode: "soft" as const }), estimatorSlot: prepared.outcome };
  const imported = importControlPlan({ ...deps, estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null }) }, importCommand);
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
  // Agent selection spec §6.4 step 3: the payload carries the hash of the selections the operator ("human") would see
  // now. A refused slot has none; the confirmation is then refused as agent-selection-rejected whatever hash it carries.
  const confirmPayload = async (): Promise<ConfirmPayload> => ({ planHash: readArchivedPlan(h.store, "g").planHash, proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, budgetMode: "strict",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: frozen.profileHash, worker: frozen.profileHash, handoff: frozen.profileHash, goalReview: frozen.profileHash }, contextPolicy: { handoffAtContextTokens: 800_000 },
    selectionsHash: (await resolveGroupSelections({ store: h.store, port }, "g", "human")).selectionsHash ?? "0".repeat(64) });
  return { ...h, deps, frozen, accept, imported, command, taskCommand, runCommand, rawCommand: raw, confirmPayload, estimateId: imported.result.estimateId, setObserved: (value: typeof observed) => { observed = value; }, asked, resolveAgent };
}
