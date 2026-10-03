/**
 * The control read views sort their sets, and the web protocol checks each set is sorted by UTF-16 code unit
 * (src/control/webProtocol.ts requireSortedUnique). A producer that sorted with localeCompare instead put the same
 * set in a different order whenever ICU collation and code units disagree: a NUL-joined key (ICU ignores NUL, so
 * task `t1`'s "task\0t1\0work" sorted after task `t10`'s) or two ids that differ in case (`ccloop` before `Orca`).
 * The view then failed its own schema and the page got 423 recovery-blocked: a group with tasks t1 and t10 could
 * not be opened at all (seen on a real panel, session 08011394), and a panel given `--repo Orca=… --repo ccloop=…`
 * could not answer its config. These criteria read the real HTTP views over ids shaped exactly like that.
 */
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { buildApi } from "../../src/panel/api.js";
import { createTrustedControlConfig } from "../../src/panel/controlConfig.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import { openTestStore } from "../control/fixtures/store.js";
import { FIXTURE_AGENT_ID, seedPreferences } from "../control/fixtures/agents.js";

// Fixtures copied from tests/panel/controlReadApi.test.ts (contract, profile, port, config), with the ids changed.
const token = "a".repeat(64);
const hash = (letter: string) => letter.repeat(64);
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
  return { schema: "orca-raw-command-v1", commandId, expectedRevision: 0, actorId: "operator", verb: "import-plan", target: { kind: "group", groupId }, payload: { groupId, repoId: "Orca", planId: "plan" } };
}

let root: string;
let server: Server;
let url: string;
let dispose: () => Promise<void>;

beforeEach(async () => {
  const h = await openTestStore();
  root = h.root; dispose = h.dispose;
  const repo = join(root, "repo"), other = join(root, "other"), contracts = join(root, "contracts");
  await mkdir(join(repo, "plans"), { recursive: true });
  await mkdir(other);
  await mkdir(contracts);
  const planPath = join(repo, "plans", "plan.json"), laterPath = join(repo, "plans", "later.json"), binary = join(root, "ccloop"), adapter = join(root, "adapter.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await writeFile(adapter, "{}");
  // t1 and t10: their allocation keys "task\0t1\0…" and "task\0t10\0…" are where ICU and code units disagree.
  const tasks = ["t1", "t10", "t2"];
  for (const taskId of tasks) await writeFile(join(contracts, `${taskId}.json`), JSON.stringify(contract(taskId)));
  await writeFile(planPath, JSON.stringify({
    targetRepo: repo, ccloopBin: binary, runsDir: root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Ship", successConditions: ["tests pass"],
    tasks: tasks.map((taskId, index) => ({ taskId, contract: join(contracts, `${taskId}.json`), dependsOn: [], targetVersion: index + 1 })),
  }));
  await writeFile(laterPath, JSON.stringify({
    targetRepo: repo, ccloopBin: binary, runsDir: root, workBranch: "orca/later", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Later", successConditions: ["tests pass"], tasks: [{ taskId: "t1", contract: join(contracts, "t1.json"), dependsOn: [], targetVersion: 1 }],
  }));
  const snapshot = profile();
  const port: ExecutionPort = {
    resolveAgent: async (partial) => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, capabilities: snapshot.profile.capabilities, singleCallExecution: "v1" }),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }), collect: async () => ({ events: [], candidate: null, terminal: null }),
  };
  const frozen = resolveProfile(snapshot, port);
  const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
  const trustedConfig = createTrustedControlConfig({
    epoch: "epoch-test", stateDir: h.store.stateDir, executablePath: binary, agentsTablePath: adapter, executionPort: "configured" as const,
    archiveRoot: root, exportRoot: root, evidenceRoot: root, shutdownGraceMs: 1_000,
    // `ccloop` sorts before `Orca` under ICU and after it by code unit; so does `plan` before `Zed`.
    repositories: [{ repoId: "Orca", displayName: "Orca", path: repo }, { repoId: "ccloop", displayName: "ccloop", path: other }],
    plans: [{ planId: "plan", repoId: "Orca", displayName: "Plan", path: planPath }, { planId: "Zed", repoId: "Orca", displayName: "Zed", path: laterPath }],
    defaultEstimatorProfileId: "estimator", defaultEstimateMode: "strict",
  }, router);
  seedPreferences(h.store, "operator", { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
  const prepared = await prepareEstimatorSlot({ store: h.store, profileRouter: router }, command("B", "prepare"), router.resolve("budget-estimate", "estimator", frozen.profileHash));
  const deps = {
    store: h.store, trustedConfig, profileRouter: router,
    defaults: () => ({ estimatorProfileId: "estimator", estimatorProfileHash: frozen.profileHash, estimateMode: "strict" as const }),
    estimatorObservation: (selected: typeof frozen) => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null, resolution: { selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" as const }, configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, capabilities: selected.snapshot.profile.capabilities, singleCallExecution: "v1" as const } }),
    estimatorSlot: prepared.outcome,
  };
  // `B` sorts after `a` under ICU and before it by code unit.
  for (const groupId of ["B", "a"]) importControlPlan(deps, command(groupId, `import-${groupId}`));

  const app = express();
  app.use(express.json());
  const reviews = new ReviewsWriter(root);
  await reviews.load();
  buildApi(app, {
    opts: { by: "operator", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: root, repos: [] },
    token, reviews, statics: { get: () => undefined, indexHtml: undefined, names: [] },
    control: { store: h.store, epoch: "epoch-test", config: trustedConfig },
  } as never);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dispose();
});

const read = async (path: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${url}${path}`, { headers: { "x-orca-token": token } });
  return { status: res.status, body: await res.json() };
};
const codeUnitSorted = (values: string[]): string[] => [...values].sort();

describe("control read views sort their sets the way the protocol checks them", () => {
  it("opens a group whose task ids are t1 and t10", async () => {
    const view = await read("/api/control/groups/a");
    expect(view.status).toBe(200);
    const keys = (view.body.allocations as Array<{ ownerKind: string; ownerId: string; bucket: string }>).map((a) => `${a.ownerKind}\0${a.ownerId}\0${a.bucket}`);
    expect(keys).toEqual(codeUnitSorted(keys));
  });

  it("answers the config for repositories and plans whose ids sort differently by case", async () => {
    const config = await read("/api/control/config");
    expect(config.status).toBe(200);
    expect(config.body.repositories.map((r: { repoId: string }) => r.repoId)).toEqual(["Orca", "ccloop"]);
    expect(config.body.plans.map((p: { planId: string }) => p.planId)).toEqual(["Zed", "plan"]);
  });

  it("lists groups B and a in a complete summary and in the group list", async () => {
    for (const path of ["/api/control/summary", "/api/control/groups"]) {
      const summary = await read(path);
      expect(summary.status).toBe(200);
      expect(summary.body.groups.map((g: { groupId: string }) => g.groupId)).toEqual(["B", "a"]);
    }
  });
});
