import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { prepareExecutionSnapshot, type PreparedExecutionSnapshot } from "../../src/control/executionSnapshot.js";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { recordProjectionChange, readProjectionState } from "../../src/control/projectionJournal.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type {
  BudgetEstimateV1,
  ControlSummaryV1,
  EvidenceManifestV1,
  ExecutionProfileSnapshotV1,
  GroupViewV1,
  RecoveryViewV1,
} from "../../src/control/webProtocol.js";
import { buildApi } from "../../src/panel/api.js";
import { createTrustedControlConfig } from "../../src/panel/controlConfig.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import { openTestStore } from "../control/fixtures/store.js";
import { FIXTURE_AGENT_ID, seedPreferences } from "../control/fixtures/agents.js";

const token = "a".repeat(64);
const hash = (letter: string) => letter.repeat(64);
const amount = (tokens: number, activeMs = 1_000, attempts = 1, sessions = 1) => ({ tokens, activeMs, attempts, sessions });

const contract = (taskId: string) => ({
  objective: { taskId, goal: `ship ${taskId}`, successCondition: `${taskId} passes`, nonGoals: [] },
  context: { repoPath: "/trusted/repo", targetPaths: [`${taskId}.txt`], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 100, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
});

function profile(): ExecutionProfileSnapshotV1 {
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): profile v2 (spec §6.5): no adapter identity
  // fields; the declared capabilities and the remaining resolved hashes these criteria depend on are the same.
  return {
    schema: "orca-execution-profile-snapshot-v2",
    profile: {
      profileId: "estimator", allowedWorkKinds: ["budget-estimate"], contextTokenizer: null, workMaxOutputTokens: null,
      capabilities: {
        usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable",
        handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
        requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["activeMs", "attempts", "sessions", "tokens"], handoffDimensions: ["activeMs"], evidenceKind: "proof" },
      },
      estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 1_000, framingTokenOverhead: 10, tokenizer: { kind: "utf8-upper-bound", numerator: 1, denominator: 1, proofRef: "proof" } },
    },
    resolved: { proofDocumentContentHashes: [hash("c")], tokenizerArtifactHashes: [], secretValueHashes: [] },
  };
}

function command(groupId: string, commandId: string): ImportCommand {
  return { schema: "orca-raw-command-v1", commandId, expectedRevision: 0, actorId: "operator", verb: "import-plan", target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", planId: "plan" } };
}

interface Harness {
  root: string;
  store: Awaited<ReturnType<typeof openTestStore>>["store"];
  trustedConfig: ReturnType<typeof createTrustedControlConfig>;
  profileHash: string;
  url: string;
  server: Server;
  disposeStore(): Promise<void>;
}

async function setup(): Promise<Harness> {
  const h = await openTestStore();
  const repo = join(h.root, "repo"), plans = join(repo, "plans"), contracts = join(h.root, "contracts");
  await mkdir(plans, { recursive: true });
  await mkdir(contracts);
  const planPath = join(plans, "plan.json"), binary = join(h.root, "ccloop"), adapter = join(h.root, "adapter.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await writeFile(adapter, "{}");
  const a = join(contracts, "a.json"), b = join(contracts, "b.json");
  await writeFile(a, JSON.stringify(contract("a")));
  await writeFile(b, JSON.stringify(contract("b")));
  await writeFile(planPath, JSON.stringify({
    targetRepo: repo, ccloopBin: binary, runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Ship", successConditions: ["tests pass"],
    tasks: [
      // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): plan tasks carry no configHash (spec §6.2); confirmation freezes ccloop's.
      { taskId: "b", contract: b, dependsOn: ["a"], targetVersion: 2 },
      { taskId: "a", contract: a, dependsOn: [], targetVersion: 1 },
    ],
  }));
  const snapshot = profile();
  // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
  // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
  // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
  const port: ExecutionPort = {
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3.
    resolveAgent: async (partial) => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, capabilities: snapshot.profile.capabilities }),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }), collect: async () => ({ events: [], candidate: null, terminal: null }),
  };
  const frozen = resolveProfile(snapshot, port);
  const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
  const trustedConfig = createTrustedControlConfig({
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    epoch: "epoch-test", stateDir: h.store.stateDir, executablePath: binary, agentsTablePath: adapter,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
    archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 1_000,
    repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
    plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: planPath }],
    defaultEstimatorProfileId: "estimator", defaultEstimateMode: "strict",
  }, router);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the importing operator prefers
  // the fixture agent, so both groups import with the estimator slot the port answers for it (spec §6.4).
  seedPreferences(h.store, "operator", { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
  const prepared = await prepareEstimatorSlot({ store: h.store, profileRouter: router }, command("group-b", "prepare"), router.resolve("budget-estimate", "estimator", frozen.profileHash));
  const deps = {
    store: h.store, trustedConfig, profileRouter: router,
    defaults: () => ({ estimatorProfileId: "estimator", estimatorProfileHash: frozen.profileHash, estimateMode: "strict" as const }),
    estimatorObservation: (selected: typeof frozen) => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null }),
    estimatorSlot: prepared.outcome,
  };
  for (const groupId of ["group-b", "group-a"]) importControlPlan(deps, command(groupId, `import-${groupId}`));

  const app = express();
  app.use(express.json());
  const reviews = new ReviewsWriter(h.root);
  await reviews.load();
  buildApi(app, {
    opts: { by: "operator", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: h.root, repos: [] },
    token, reviews, statics: { get: () => undefined, indexHtml: undefined, names: [] },
    control: { store: h.store, epoch: "epoch-test", config: trustedConfig },
  } as never);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  return { root: h.root, store: h.store, trustedConfig, profileHash: frozen.profileHash, url: `http://127.0.0.1:${address.port}`, server, disposeStore: h.dispose };
}

async function request(h: Harness, path: string, authenticated = true, init: RequestInit = {}) {
  return fetch(`${h.url}${path}`, { ...init, headers: { ...(authenticated ? { "x-orca-token": token } : {}), ...init.headers } });
}

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): what a confirmation freezes for the selection this
// file's port answers (spec §6.4 step 4): each task's fields, and the group's reconcile slot. confirmGroup writes them
// into the snapshot, the work items and the group, and insertValidTaskRun copies them onto the run, exactly as the
// product does; the read model's judgement of everything else is unchanged.
const frozenAgent = () => ({
  agent: { agent: FIXTURE_AGENT_ID, model: "fixture-model", contextWindow: "agent-default" as const },
  agentProvenance: { agent: "operator" as const, model: "descriptor" as const, contextWindow: "descriptor" as const },
  configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, agentCapabilities: profile().profile.capabilities,
});
const frozenReconcile = () => {
  const { agent, agentProvenance, agentCapabilities, ...rest } = frozenAgent();
  return { partial: { agent: FIXTURE_AGENT_ID }, provenance: agentProvenance, selection: agent, capabilities: agentCapabilities, ...rest };
};

async function confirmGroup(h: Harness, groupId: string, stopped = false): Promise<{
  estimateId: string;
  output: BudgetEstimateV1;
  outputHash: string;
  prepared: PreparedExecutionSnapshot;
}> {
  const plan = readArchivedPlan(h.store, groupId);
  const proposal = readBudgetProposal(h.store, groupId);
  const estimateId = String(h.store.db.prepare("SELECT id FROM estimates WHERE group_id=?").get(groupId)?.id);
  const estimate = readEstimateRecord(h.store, groupId, estimateId);
  const output: BudgetEstimateV1 = {
    schema: "budget-estimate-v1", planHash: plan.planHash,
    tasks: plan.plan.tasks.map(task => ({ taskId: task.taskId, complexity: "M", confidence: "high", work: amount(10), handoff: amount(2), rationale: `budget ${task.taskId}`, assumptions: ["clean tree"] })),
    goalReviewReserve: amount(3), groupRationale: "bounded fixture",
  };
  const outputHash = sha256Canonical(output);
  const readyEstimate = { ...estimate, state: "ready" as const, output, outputHash, reasonCode: null };
  h.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?")
    .run("ready", canonicalBytes(readyEstimate).toString("utf8"), groupId, estimateId);

  const binding = { profileId: "estimator", profileHash: h.profileHash };
  const profiles = { estimator: binding, worker: binding, handoff: binding, goalReview: binding };
  const allocations = proposal.allocations.map(({ state: _state, ...allocation }) => allocation);
  const prepared = prepareExecutionSnapshot({
    store: h.store,
    groupId,
    planHash: plan.planHash,
    graphVersion: plan.graphVersion,
    proposalVersion: proposal.proposalVersion,
    proposalIdentity: { groupId, planHash: plan.planHash, proposalVersion: proposal.proposalVersion },
    groupLimit: proposal.groupLimit,
    budgetMode: "strict",
    contextPolicy: { handoffAtContextTokens: 80_000 },
    profiles,
    allocations,
    tasks: plan.plan.tasks.map(task => ({
      taskId: task.taskId,
      originalContractHash: task.originalContractHash,
      originalContractCanonicalJson: task.originalContractCanonicalJson,
      work: allocations.find(row => row.ownerKind === "task" && row.ownerId === task.taskId && row.bucket === "work")!.amount,
      handoff: allocations.find(row => row.ownerKind === "task" && row.ownerId === task.taskId && row.bucket === "handoff")!.amount,
    })),
    agents: { tasks: plan.plan.tasks.map(task => ({ taskId: task.taskId, ...frozenAgent() })), reconcile: frozenReconcile() },
  });
  const confirmedProposal = {
    ...proposal,
    state: "confirmed" as const,
    budgetMode: "strict" as const,
    contextPolicy: prepared.snapshot.contextPolicy,
    profiles,
    executionSnapshotHash: prepared.snapshotHash,
  };
  h.store.transaction(() => {
    for (const derived of prepared.derivedContracts) writeCanonicalRecord(h.store, groupId, derived.derivedContractHash, derived.canonicalJson);
    writeCanonicalRecord(h.store, groupId, prepared.snapshotHash, prepared.canonicalJson);
    h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?")
      .run(canonicalBytes(confirmedProposal).toString("utf8"), groupId);
    const row = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
    const body = JSON.parse(String(row.body));
    body.status = "ready";
    body.stopped = stopped;
    body.reconcileSlot = frozenReconcile();
    body.proposal = {
      state: "confirmed", proposalVersion: proposal.proposalVersion, planHash: plan.planHash,
      budgetMode: "strict", contextPolicy: prepared.snapshot.contextPolicy, profiles,
      executionSnapshotHash: prepared.snapshotHash,
    };
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
    for (const derived of prepared.derivedContracts) {
      const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, derived.taskId)!;
      const work = JSON.parse(String(workRow.body));
      work.status = "ready";
      work.derivedContractHash = derived.derivedContractHash;
      Object.assign(work, frozenAgent());
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?")
        .run(JSON.stringify(work), groupId, derived.taskId);
    }
    if (stopped) {
      const stop = { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null };
      h.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,?,?,?)")
        .run(groupId, "pause", 1, canonicalBytes(stop).toString("utf8"));
    }
    recordProjectionChange(h.store, [groupId]);
  });
  return { estimateId, output, outputHash, prepared };
}

function insertValidTaskRun(h: Harness, groupId: string, runId = "run-one"): Record<string, unknown> {
  const proposal = readBudgetProposal(h.store, groupId);
  const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
  const work = JSON.parse(String(workRow.body));
  const zero = amount(0, 0, 0, 0);
  const binding = proposal.profiles!.worker;
  const run = {
    groupId, workItemId: "a", taskId: "a", estimateId: null, runId, generation: 1,
    graphVersion: 1, targetVersion: work.targetVersion, commandId: `start-${runId}`,
    configHash: work.configHash, agent: work.agent, agentProvenance: work.agentProvenance, timeoutMs: work.timeoutMs,
    killGraceMs: work.killGraceMs, agentCapabilities: work.agentCapabilities, grant: work.grant, ownerToken: `owner-${runId}`,
    executionProfile: { workKind: "task", ...binding },
    handoffProfile: { workKind: "handoff", ...proposal.profiles!.handoff },
    executionId: `execution-${runId}`, state: "accepted", checkpointId: null, recoverable: false,
    remaining: work.grant, cumulative: { work: zero, handoff: zero }, unknown: { work: false, handoff: false },
    highWater: 0, breaches: [], handoffWorkItemId: null,
    phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1, failureCode: null,
  };
  work.status = "running";
  work.currentRunId = runId;
  work.pendingRunId = null;
  work.lineageRunIds = [runId];
  h.store.transaction(() => {
    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
    h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)")
      .run(runId, groupId, "a", 1, 1, canonicalBytes(run).toString("utf8"));
  });
  return run;
}

describe("canonical control read API", () => {
  let h: Harness;
  beforeEach(async () => { h = await setup(); });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => h.server.close(error => error ? reject(error) : resolve()));
    await h.disposeStore();
  });

  it("authenticates reads, enforces canonical sinceChangeSeq spelling, and keeps immediate kill absent", async () => {
    const unauthenticated = await request(h, "/api/control/config", false);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: { code: "token-required", message: "this panel needs its one-time token", commandRevision: null, evidenceIds: [], retryable: false } });

    for (const query of ["", "00", "-1", "+1", "1.0", "1e2", "%201", "9007199254740992", "1&sinceChangeSeq=2"]) {
      const response = await request(h, `/api/control/summary?sinceChangeSeq=${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toEqual({ error: { code: "query-invalid", message: "sinceChangeSeq must be a canonical decimal safe integer", commandRevision: null, evidenceIds: [], retryable: false } });
    }
    const misspelled = await request(h, "/api/control/summary?since_change_seq=1");
    expect(misspelled.status).toBe(400);
    expect(await misspelled.json()).toMatchObject({ error: { code: "query-invalid" } });

    const forged = await request(h, "/api/control/groups/group-a/immediate-kill", true, { method: "POST" });
    expect(forged.status).toBe(404);
    expect(await forged.json()).toEqual({ error: { code: "route-not-found", message: "No control route matches this request.", commandRevision: null, evidenceIds: [], retryable: false } });
  });

  it("returns sorted complete, incremental, ahead, and retained-gap summaries", async () => {
    const groupsResponse = await request(h, "/api/control/groups");
    expect(groupsResponse.status).toBe(200);
    const complete = await groupsResponse.json() as ControlSummaryV1;
    expect(complete).toMatchObject({ schema: "orca-control-summary-v1", epoch: "epoch-test", resetRequired: true, dispatchBlocked: false });
    expect(complete.groups.map(group => group.groupId)).toEqual(["group-a", "group-b"]);

    const seq = complete.changeSeq;
    const unchanged = await request(h, `/api/control/summary?sinceChangeSeq=${seq}`);
    expect(await unchanged.json()).toEqual({ ...complete, resetRequired: false, groups: [] });
    recordProjectionChange(h.store, ["group-b"]);
    const incremental = await request(h, `/api/control/summary?sinceChangeSeq=${seq}`);
    expect((await incremental.json() as ControlSummaryV1).groups.map(group => group.groupId)).toEqual(["group-b"]);

    const ahead = await request(h, "/api/control/summary?sinceChangeSeq=9007199254740991");
    expect(await ahead.json()).toMatchObject({ resetRequired: true, groups: [{ groupId: "group-a" }, { groupId: "group-b" }] });
    for (let index = 0; index < 66; index += 1) recordProjectionChange(h.store, ["group-a"]);
    const gap = await request(h, "/api/control/summary?sinceChangeSeq=0");
    expect(await gap.json()).toMatchObject({ resetRequired: true, groups: [{ groupId: "group-a" }, { groupId: "group-b" }] });
  });

  it("reloads confirmed profiles, snapshot hashes, estimate output, and paused state without exposing trusted paths", async () => {
    const groupId = "group-a";
    const { estimateId, output, outputHash, prepared } = await confirmGroup(h, groupId, true);

    const response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(200);
    const view = await response.json() as GroupViewV1;
    expect(view.proposal).toMatchObject({ state: "confirmed", executionSnapshotHash: prepared.snapshotHash });
    expect(view.estimates[0]).toMatchObject({ estimateId, state: "ready", outputHash, output });
    expect(view.summary).toMatchObject({ state: "ready", stopMode: "pause", stopState: "paused" });
    expect(view.stop).toEqual({ mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null });
    expect(view.workItems.map(item => item.taskId)).toEqual(["a", "b"]);
    expect(JSON.stringify(view)).not.toContain(h.root);
    expect(JSON.stringify(view)).not.toContain("repoPath");
  });

  it("fails closed when confirmed allocation or derived-contract authority is missing, forged, or belongs to another task", async () => {
    const groupId = "group-a";
    const { prepared } = await confirmGroup(h, groupId);
    const [taskA, taskB] = prepared.derivedContracts;

    h.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(taskA.derivedContractHash);
    let response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);
    writeCanonicalRecord(h.store, groupId, taskA.derivedContractHash, taskA.canonicalJson);

    h.store.db.prepare("UPDATE execution_snapshots SET body='{}' WHERE hash=?").run(taskA.derivedContractHash);
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);
    h.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(taskA.derivedContractHash);
    writeCanonicalRecord(h.store, groupId, taskA.derivedContractHash, taskA.canonicalJson);

    const forgedRecord = JSON.parse(taskA.canonicalJson);
    const forgedContract = JSON.parse(String(forgedRecord.contractCanonicalJson));
    forgedContract.objective.goal = "forged but canonical";
    forgedRecord.contractCanonicalJson = canonicalBytes(forgedContract).toString("utf8");
    const forgedHash = sha256Canonical(forgedRecord);
    const forgedSnapshot = {
      ...prepared.snapshot,
      derivedContracts: prepared.snapshot.derivedContracts.map(row => row.taskId === "a"
        ? { taskId: "a", derivedContractHash: forgedHash }
        : row),
    };
    const forgedSnapshotHash = sha256Canonical(forgedSnapshot);
    h.store.transaction(() => {
      writeCanonicalRecord(h.store, groupId, forgedHash, canonicalBytes(forgedRecord).toString("utf8"));
      writeCanonicalRecord(h.store, groupId, forgedSnapshotHash, canonicalBytes(forgedSnapshot).toString("utf8"));
      const proposal = readBudgetProposal(h.store, groupId);
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?")
        .run(canonicalBytes({ ...proposal, executionSnapshotHash: forgedSnapshotHash }).toString("utf8"), groupId);
      const groupRow = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
      const group = JSON.parse(String(groupRow.body));
      group.proposal.executionSnapshotHash = forgedSnapshotHash;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
      const work = JSON.parse(String(workRow.body));
      work.derivedContractHash = forgedHash;
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
    });
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);

    const wrongTaskSnapshot = {
      ...prepared.snapshot,
      derivedContracts: prepared.snapshot.derivedContracts.map(row => row.taskId === "a"
        ? { taskId: "a", derivedContractHash: taskB.derivedContractHash }
        : row),
    };
    const wrongTaskHash = sha256Canonical(wrongTaskSnapshot);
    h.store.transaction(() => {
      writeCanonicalRecord(h.store, groupId, wrongTaskHash, canonicalBytes(wrongTaskSnapshot).toString("utf8"));
      const proposal = readBudgetProposal(h.store, groupId);
      const changedProposal = { ...proposal, executionSnapshotHash: wrongTaskHash };
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?")
        .run(canonicalBytes(changedProposal).toString("utf8"), groupId);
      const groupRow = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
      const group = JSON.parse(String(groupRow.body));
      group.proposal.executionSnapshotHash = wrongTaskHash;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
      const work = JSON.parse(String(workRow.body));
      work.derivedContractHash = taskB.derivedContractHash;
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
    });
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);

    const allocationMismatch = {
      ...prepared.snapshot,
      allocations: prepared.snapshot.allocations.map((row, index) => index === 0
        ? { ...row, amount: { ...row.amount, tokens: row.amount.tokens + 1 } }
        : row),
    };
    const mismatchHash = sha256Canonical(allocationMismatch);
    h.store.transaction(() => {
      writeCanonicalRecord(h.store, groupId, mismatchHash, canonicalBytes(allocationMismatch).toString("utf8"));
      const proposal = readBudgetProposal(h.store, groupId);
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?")
        .run(canonicalBytes({ ...proposal, executionSnapshotHash: mismatchHash }).toString("utf8"), groupId);
      const groupRow = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
      const group = JSON.parse(String(groupRow.body));
      group.proposal.executionSnapshotHash = mismatchHash;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
      const work = JSON.parse(String(workRow.body));
      work.derivedContractHash = taskA.derivedContractHash;
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
    });
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);
  });

  it("accepts a globally deduplicated derived contract when each group snapshot independently proves its authority", async () => {
    const first = await confirmGroup(h, "group-a");
    const second = await confirmGroup(h, "group-b");
    expect(second.prepared.derivedContracts.map(record => record.derivedContractHash))
      .toEqual(first.prepared.derivedContracts.map(record => record.derivedContractHash));

    const sharedHash = first.prepared.derivedContracts[0].derivedContractHash;
    expect(h.store.db.prepare("SELECT group_id FROM execution_snapshots WHERE hash=?").get(sharedHash))
      .toEqual({ group_id: "group-a" });
    expect((await request(h, "/api/control/groups/group-a")).status).toBe(200);
    expect((await request(h, "/api/control/groups/group-b")).status).toBe(200);

    const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id='group-b' AND id='a'").get()!;
    const work = JSON.parse(String(workRow.body));
    work.derivedContractHash = second.prepared.derivedContracts.find(record => record.taskId === "b")!.derivedContractHash;
    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='group-b' AND id='a'").run(JSON.stringify(work));
    expect((await request(h, "/api/control/groups/group-b")).status).toBe(423);
  });

  it("rejects malformed or cross-record-inconsistent persisted run authority instead of synthesizing display values", async () => {
    const groupId = "group-a";
    await confirmGroup(h, groupId);
    const valid = insertValidTaskRun(h, groupId);
    const baseline = await request(h, `/api/control/groups/${groupId}`);
    expect(baseline.status).toBe(200);
    expect((await baseline.json() as GroupViewV1).runs).toMatchObject([{
      runId: "run-one", taskId: "a", estimateId: null, phase: "work", state: "running",
      claimOrdinal: 1, providerAttemptOrdinal: 1, used: amount(0, 0, 0, 0),
    }]);

    const invalidBodies = [
      (({ executionProfile: _removed, ...body }) => body)(valid),
      { ...valid, phase: "invented" },
      (({ providerAttemptOrdinal: _removed, ...body }) => body)(valid),
      { ...valid, cumulative: { work: { tokens: -1, activeMs: 0, attempts: 0, sessions: 0 }, handoff: amount(0, 0, 0, 0) } },
      { ...valid, executionProfile: { workKind: "task", profileId: "other", profileHash: hash("9") } },
      { ...valid, taskId: "b" },
      { ...valid, graphVersion: 2 },
    ];
    for (const body of invalidBodies) {
      h.store.db.prepare("UPDATE runs SET body=? WHERE id='run-one'").run(JSON.stringify(body));
      const response = await request(h, `/api/control/groups/${groupId}`);
      expect(response.status).toBe(423);
    }

    h.store.db.prepare("UPDATE runs SET body=?,work_item_id='b' WHERE id='run-one'")
      .run(canonicalBytes(valid).toString("utf8"));
    const wrongRowIdentity = await request(h, `/api/control/groups/${groupId}`);
    expect(wrongRowIdentity.status).toBe(423);

    h.store.db.prepare("UPDATE runs SET body=?,work_item_id='a' WHERE id='run-one'")
      .run(canonicalBytes(valid).toString("utf8"));
    const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
    const work = JSON.parse(String(workRow.body));
    delete work.currentRunId;
    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
    const missingCurrentRun = await request(h, `/api/control/groups/${groupId}`);
    expect(missingCurrentRun.status).toBe(423);
  });

  it("requires canonical stop authority and preserves revision and blocker evidence on group read failures", async () => {
    const groupId = "group-a";
    const row = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
    const group = JSON.parse(String(row.body));
    group.stopped = true;
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
    h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
      .run("stop-authority", groupId, null, "group", "shutdown-frozen-set-inconsistent", canonicalBytes({ evidenceIds: ["stop-evidence"] }).toString("utf8"));

    let response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({
      error: { code: "recovery-blocked", message: "recovery-blocked:stop-intent-missing", commandRevision: 1, evidenceIds: ["stop-evidence"], retryable: false },
    });

    const stop = { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null };
    h.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,?,?,?)")
      .run(groupId, "pause", 1, JSON.stringify(stop));
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);

    h.store.db.prepare("UPDATE stop_intents SET body=? WHERE group_id=?")
      .run(canonicalBytes(stop).toString("utf8"), groupId);
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(200);

    group.stopped = false;
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
    response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(423);
  });

  it("rejects budget and graph legacy stopped flags without canonical stop intents", async () => {
    for (const [groupId, status] of [["group-a", "running"], ["group-b", "blocked"]] as const) {
      const row = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
      const group = JSON.parse(String(row.body));
      group.stopped = true;
      group.status = status;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      const response = await request(h, `/api/control/groups/${groupId}`);
      expect(response.status).toBe(423);
    }
  });

  it.each([
    { source: "checkpoint", kind: "null", element: null },
    { source: "checkpoint", kind: "invalid", element: { artifactId: "malformed" } },
    { source: "outbox", kind: "null", element: null },
    { source: "outbox", kind: "invalid", element: { artifactId: "malformed" } },
    { source: "handoff", kind: "null", element: null },
    { source: "handoff", kind: "invalid", element: { artifactId: "malformed" } },
    { source: "recovery", kind: "null", element: null },
    { source: "recovery", kind: "invalid", element: { artifactId: "malformed" } },
  ])("blocks a $source evidence collection containing a $kind element", async ({ source, element }) => {
    await confirmGroup(h, "group-a");
    const run = insertValidTaskRun(h, "group-a");
    run.phase = "handoff";
    h.store.db.prepare("UPDATE runs SET body=? WHERE id='run-one'").run(canonicalBytes(run).toString("utf8"));
    const checkpointHandoff = await writeArtifact(h.store, "checkpoint-handoff", Buffer.from("handoff"));
    const handoff: Record<string, unknown> & { evidenceIds: unknown[] } = {
      requestId: "request-one", runId: "run-one", state: "latched", deadlineAt: "2030-01-01T00:00:00.000Z",
      phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [],
    };
    h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,?,?)")
      .run("request-one", "group-a", "run-one", "latched", canonicalBytes(handoff).toString("utf8"));

    if (source === "checkpoint") {
      const checkpoint = {
        checkpointId: "checkpoint-one", runId: "run-one", taskId: "a", result: "partial",
        artifacts: [element], snapshot: null, missing: [], handoff: checkpointHandoff, stopProof: null,
      };
      h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)")
        .run("checkpoint-one", "run-one", hash("7"), canonicalBytes(checkpoint).toString("utf8"));
    } else if (source === "outbox") {
      h.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,0)")
        .run("evidence-outbox", "archive", canonicalBytes({ runId: "run-one", artifacts: [element] }).toString("utf8"));
    } else if (source === "handoff") {
      handoff.evidenceIds = [element];
      h.store.db.prepare("UPDATE handoff_requests SET body=? WHERE id='request-one'")
        .run(canonicalBytes(handoff).toString("utf8"));
    } else {
      h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
        .run("run-blocker", "group-a", "run-one", "run", "start-proof-outcome-unknown", canonicalBytes({ evidenceIds: [element] }).toString("utf8"));
    }

    const response = await request(h, "/api/control/runs/run-one/evidence");
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ error: { code: "recovery-blocked" } });
  });

  it("returns persisted command results, sorted recovery, verified evidence manifests, and exact typed misses", async () => {
    const persisted = lookupCommandResult(h.store, "group-a", "import-group-a");
    const lookup = await request(h, "/api/control/groups/group-a/commands/import-group-a");
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toEqual(persisted);

    const missingCommand = await request(h, "/api/control/groups/group-a/commands/missing");
    expect(missingCommand.status).toBe(404);
    expect(await missingCommand.json()).toEqual({ error: { code: "command-result-not-found", message: "No retained command result was found.", commandRevision: 1, evidenceIds: [], retryable: false } });
    const missingGroup = await request(h, "/api/control/groups/missing");
    expect(missingGroup.status).toBe(404);
    expect(await missingGroup.json()).toEqual({ error: { code: "group-not-found", message: "No control group was found.", commandRevision: null, evidenceIds: [], retryable: false } });

    h.store.dispatchBlocked = true;
    h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
      .run("blocker-b", "group-b", null, "group", "claim-capability-unavailable", canonicalBytes({ evidenceIds: ["evidence-z"] }).toString("utf8"));
    h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
      .run("blocker-a", "group-a", null, "global", "start-proof-outcome-unknown", canonicalBytes({ evidenceIds: [] }).toString("utf8"));
    const recoveryResponse = await request(h, "/api/control/recovery");
    const recovery = await recoveryResponse.json() as RecoveryViewV1;
    expect(recovery).toEqual({ schema: "orca-control-recovery-v1", epoch: "epoch-test", dispatchBlocked: true, blockers: [
      { scope: "global", groupId: "group-a", runId: null, code: "start-proof-outcome-unknown", evidenceIds: [] },
      { scope: "group", groupId: "group-b", runId: null, code: "claim-capability-unavailable", evidenceIds: ["evidence-z"] },
    ] });

    await confirmGroup(h, "group-a");
    const evidenceRun = insertValidTaskRun(h, "group-a");
    evidenceRun.phase = "handoff";
    h.store.db.prepare("UPDATE runs SET body=? WHERE id='run-one'").run(canonicalBytes(evidenceRun).toString("utf8"));
    const first = await writeArtifact(h.store, "evidence-z", Buffer.from("longer evidence"));
    const second = await writeArtifact(h.store, "evidence-a", Buffer.from("a"));
    const handoffEvidence = await writeArtifact(h.store, "evidence-handoff", Buffer.from("handoff"));
    const blockerEvidence = await writeArtifact(h.store, "evidence-blocker", Buffer.from("blocker"));
    h.store.transaction(() => {
      h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)")
        .run("run-one", 1, hash("1"), canonicalBytes({ runId: "run-one", generation: 1, eventSeq: 1, bucket: "work", cumulative: amount(0, 0, 0, 0), source: first }).toString("utf8"));
      h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)")
        .run("run-one", 2, hash("2"), canonicalBytes({ runId: "run-one", generation: 1, eventSeq: 2, bucket: "handoff", cumulative: amount(0, 0, 0, 0), source: second }).toString("utf8"));
      const handoff = {
        requestId: "request-one", runId: "run-one", state: "latched", deadlineAt: "2030-01-01T00:00:00.000Z",
        phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [second.artifactId, handoffEvidence.artifactId],
      };
      h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,?,?)")
        .run("request-one", "group-a", "run-one", "latched", canonicalBytes(handoff).toString("utf8"));
      h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
        .run("run-blocker", "group-a", "run-one", "run", "start-proof-outcome-unknown", canonicalBytes({ evidenceIds: [blockerEvidence.artifactId, first.artifactId] }).toString("utf8"));
      const checkpoint = {
        checkpointId: "checkpoint-one", runId: "run-one", taskId: "a", result: "partial",
        artifacts: [first], snapshot: null, missing: [], handoff: handoffEvidence, stopProof: null,
      };
      h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)")
        .run("checkpoint-one", "run-one", hash("7"), canonicalBytes(checkpoint).toString("utf8"));
      h.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,0)")
        .run("valid-evidence-outbox", "archive", canonicalBytes({ runId: "run-one", artifacts: [second, first] }).toString("utf8"));
    });
    const evidenceResponse = await request(h, "/api/control/runs/run-one/evidence");
    expect(evidenceResponse.status).toBe(200);
    const manifest = await evidenceResponse.json() as EvidenceManifestV1;
    expect(manifest.entries.map(entry => entry.evidenceId)).toEqual(["evidence-a", "evidence-blocker", "evidence-handoff", "evidence-z"]);
    expect(manifest.entries.map(entry => entry.byteLength)).toEqual([1, 7, 7, 15]);
    expect(manifest.entries.every(entry => entry.downloadUrl.startsWith("/api/control/runs/run-one/evidence/"))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(h.root);

    h.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,0)")
      .run("malformed-evidence-outbox", "archive", canonicalBytes({ runId: "run-one", artifacts: {} }).toString("utf8"));
    let corrupted = await request(h, "/api/control/runs/run-one/evidence");
    expect(corrupted.status).toBe(423);
    h.store.db.prepare("DELETE FROM outbox WHERE id='malformed-evidence-outbox'").run();

    h.store.db.prepare("UPDATE usage_events SET body=? WHERE run_id='run-one' AND seq=1")
      .run(canonicalBytes({ source: { artifactId: "malformed" } }).toString("utf8"));
    corrupted = await request(h, "/api/control/runs/run-one/evidence");
    expect(corrupted.status).toBe(423);
    const fullGroup = await request(h, "/api/control/groups/group-a");
    expect(fullGroup.status).toBe(423);

    h.store.db.prepare("UPDATE usage_events SET body=? WHERE run_id='run-one' AND seq=1")
      .run(canonicalBytes({ runId: "run-one", generation: 1, eventSeq: 1, bucket: "work", cumulative: amount(0, 0, 0, 0), source: first }).toString("utf8"));
    const handoffRow = h.store.db.prepare("SELECT body FROM handoff_requests WHERE id='request-one'").get()!;
    const handoff = JSON.parse(String(handoffRow.body));
    handoff.evidenceIds = ["missing-evidence"];
    h.store.db.prepare("UPDATE handoff_requests SET body=? WHERE id='request-one'")
      .run(canonicalBytes(handoff).toString("utf8"));
    corrupted = await request(h, "/api/control/runs/run-one/evidence");
    expect(corrupted.status).toBe(423);

    handoff.evidenceIds = [handoffEvidence.artifactId];
    h.store.db.prepare("UPDATE handoff_requests SET group_id='group-b',body=? WHERE id='request-one'")
      .run(canonicalBytes(handoff).toString("utf8"));
    corrupted = await request(h, "/api/control/runs/run-one/evidence");
    expect(corrupted.status).toBe(423);

    const config = await request(h, "/api/control/config");
    const configBody = await config.json() as { errorCatalog: Array<{ code: string; status: number }> };
    expect(configBody.errorCatalog).toEqual([...configBody.errorCatalog].sort((left, right) => left.code.localeCompare(right.code)));
    expect(configBody.errorCatalog).toContainEqual({ code: "query-invalid", status: 400 });
    expect(configBody.errorCatalog).toContainEqual({ code: "token-required", status: 401 });
    expect(readProjectionState(h.store).changeSeq).toBeGreaterThan(0);
  });
});
