import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { importControlPlan, type ImportCommand } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { recordProjectionChange, readProjectionState } from "../../src/control/projectionJournal.js";
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
  return {
    schema: "orca-execution-profile-snapshot-v1",
    profile: {
      profileId: "estimator", allowedWorkKinds: ["budget-estimate"], adapter: "bounded",
      adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null, workMaxOutputTokens: null,
      capabilities: {
        usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable",
        handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
        requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["activeMs", "attempts", "sessions", "tokens"], handoffDimensions: ["activeMs"], evidenceKind: "proof" },
      },
      estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 1_000, framingTokenOverhead: 10, tokenizer: { kind: "utf8-upper-bound", numerator: 1, denominator: 1, proofRef: "proof" } },
    },
    resolved: { adapterConfigContentHash: hash("a"), modelPolicyContentHash: hash("b"), proofDocumentContentHashes: [hash("c")], adapterImplementationHash: hash("d"), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [] },
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
      { taskId: "b", contract: b, dependsOn: ["a"], targetVersion: "v2", configHash: hash("e") },
      { taskId: "a", contract: a, dependsOn: [], targetVersion: "v1", configHash: hash("f") },
    ],
  }));
  const snapshot = profile();
  const port: ExecutionPort = {
    probeProfileCapabilities: async () => snapshot.profile.capabilities,
    capabilities: async () => ({ protocol: 1, durableAccept: true, ownershipIsolation: true, evidenceRetention: true, usageObservation: "realtime", budgetEnforcement: "bounded", requestBoundEvidence: "proof" }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }), collect: async () => ({ events: [], candidate: null, terminal: null }),
  };
  const frozen = resolveProfile(snapshot, port);
  const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
  const trustedConfig = createTrustedControlConfig({
    epoch: "epoch-test", stateDir: h.store.stateDir, executablePath: binary, adapterConfigPath: adapter,
    archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 1_000,
    repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
    plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: planPath }],
    defaultEstimatorProfileId: "estimator", defaultEstimateMode: "strict",
  }, router);
  const deps = {
    store: h.store, trustedConfig, profileRouter: router,
    defaults: () => ({ estimatorProfileId: "estimator", estimatorProfileHash: frozen.profileHash, estimateMode: "strict" as const }),
    estimatorObservation: (selected: typeof frozen) => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null }),
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
    const plan = readArchivedPlan(h.store, groupId);
    const proposal = readBudgetProposal(h.store, groupId);
    const estimateRow = h.store.db.prepare("SELECT id FROM estimates WHERE group_id=?").get(groupId);
    const estimateId = String(estimateRow?.id);
    const estimate = readEstimateRecord(h.store, groupId, estimateId);
    const output: BudgetEstimateV1 = {
      schema: "budget-estimate-v1", planHash: plan.planHash,
      tasks: plan.plan.tasks.map(task => ({ taskId: task.taskId, complexity: "M", confidence: "high", work: amount(10), handoff: amount(2), rationale: `budget ${task.taskId}`, assumptions: ["clean tree"] })),
      goalReviewReserve: amount(3), groupRationale: "bounded fixture",
    };
    const outputHash = sha256Canonical(output);
    const readyEstimate = { ...estimate, state: "ready" as const, output, outputHash, reasonCode: null };
    const binding = { profileId: "estimator", profileHash: h.profileHash };
    const profiles = { estimator: binding, worker: binding, handoff: binding, goalReview: binding };
    const derivedContracts = plan.plan.tasks.map((task, index) => ({ taskId: task.taskId, derivedContractHash: hash(index === 0 ? "7" : "8") }));
    const snapshot = {
      schema: "orca-execution-snapshot-v1" as const, groupId, planHash: plan.planHash, graphVersion: 1, proposalVersion: 1,
      groupLimit: proposal.groupLimit, budgetMode: "strict" as const, contextPolicy: { handoffAtContextTokens: 80_000 }, profiles,
      allocations: proposal.allocations.map(({ state: _state, ...allocation }) => allocation), derivedContracts,
    };
    const snapshotHash = sha256Canonical(snapshot);
    const confirmedProposal = { ...proposal, state: "confirmed" as const, budgetMode: "strict" as const, contextPolicy: snapshot.contextPolicy, profiles, executionSnapshotHash: snapshotHash };
    h.store.transaction(() => {
      h.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run("ready", canonicalBytes(readyEstimate).toString("utf8"), groupId, estimateId);
      h.store.db.prepare("INSERT INTO execution_snapshots(hash,group_id,body) VALUES (?,?,?)").run(snapshotHash, groupId, canonicalBytes(snapshot).toString("utf8"));
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(confirmedProposal).toString("utf8"), groupId);
      const row = h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
      const body = JSON.parse(String(row.body));
      body.status = "ready"; body.stopped = true; body.proposal = { state: "confirmed", proposalVersion: 1, planHash: plan.planHash, budgetMode: "strict", contextPolicy: snapshot.contextPolicy, profiles, executionSnapshotHash: snapshotHash };
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
      for (const derived of derivedContracts) {
        const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, derived.taskId)!;
        const work = JSON.parse(String(workRow.body)); work.status = "ready"; work.derivedContractHash = derived.derivedContractHash;
        h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), groupId, derived.taskId);
      }
      recordProjectionChange(h.store, [groupId]);
    });

    const response = await request(h, `/api/control/groups/${groupId}`);
    expect(response.status).toBe(200);
    const view = await response.json() as GroupViewV1;
    expect(view.proposal).toEqual({ state: "confirmed", proposalVersion: 1, planHash: plan.planHash, budgetMode: "strict", contextPolicy: snapshot.contextPolicy, profiles, executionSnapshotHash: snapshotHash });
    expect(view.estimates[0]).toMatchObject({ estimateId, state: "ready", outputHash, output });
    expect(view.summary).toMatchObject({ state: "ready", stopMode: "pause", stopState: "paused" });
    expect(view.stop).toEqual({ mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null });
    expect(view.workItems.map(item => item.taskId)).toEqual(["a", "b"]);
    expect(JSON.stringify(view)).not.toContain(h.root);
    expect(JSON.stringify(view)).not.toContain("repoPath");

    h.store.transaction(() => {
      const row = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(groupId)!;
      const work = JSON.parse(String(row.body)); work.derivedContractHash = hash("9");
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='a'").run(JSON.stringify(work), groupId);
      recordProjectionChange(h.store, [groupId]);
    });
    const inconsistent = await request(h, `/api/control/groups/${groupId}`);
    expect(inconsistent.status).toBe(423);
    expect(await inconsistent.json()).toMatchObject({ error: { code: "recovery-blocked", retryable: false } });
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

    const first = await writeArtifact(h.store, "evidence-z", Buffer.from("longer evidence"));
    const second = await writeArtifact(h.store, "evidence-a", Buffer.from("a"));
    h.store.transaction(() => {
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)")
        .run("run-one", "group-a", "a", 1, 0, JSON.stringify({ runId: "run-one", groupId: "group-a", taskId: "a" }));
      h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)")
        .run("run-one", 1, hash("1"), JSON.stringify({ source: first }));
      h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)")
        .run("run-one", 2, hash("2"), JSON.stringify({ source: second }));
    });
    const evidenceResponse = await request(h, "/api/control/runs/run-one/evidence");
    expect(evidenceResponse.status).toBe(200);
    const manifest = await evidenceResponse.json() as EvidenceManifestV1;
    expect(manifest.entries.map(entry => entry.evidenceId)).toEqual(["evidence-a", "evidence-z"]);
    expect(manifest.entries.map(entry => entry.byteLength)).toEqual([1, 15]);
    expect(manifest.entries.every(entry => entry.downloadUrl.startsWith("/api/control/runs/run-one/evidence/"))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(h.root);

    const config = await request(h, "/api/control/config");
    const configBody = await config.json() as { errorCatalog: Array<{ code: string; status: number }> };
    expect(configBody.errorCatalog).toEqual([...configBody.errorCatalog].sort((left, right) => left.code.localeCompare(right.code)));
    expect(configBody.errorCatalog).toContainEqual({ code: "query-invalid", status: 400 });
    expect(configBody.errorCatalog).toContainEqual({ code: "token-required", status: 401 });
    expect(readProjectionState(h.store).changeSeq).toBeGreaterThan(0);
  });
});
