import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { importControlPlan, importControlPlanAsync, type ImportCommand } from "../../src/control/planImport.js";
import { readArchivedContract, readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { createTrustedControlConfig } from "../../src/panel/controlConfig.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { openTestStore } from "./fixtures/store.js";
import { openControlStore } from "../../src/control/store.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";

const hash = (letter: string) => letter.repeat(64);
const contract = (taskId: string, tokenBudget = 100) => ({
  objective: { taskId, goal: `ship ${taskId}`, successCondition: `${taskId} passes`, nonGoals: [] },
  context: { repoPath: "/trusted/repo", targetPaths: [`${taskId}.txt`], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
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

function command(groupId = "g", commandId = "import-1"): ImportCommand {
  return { schema: "orca-raw-command-v1", commandId, expectedRevision: 0, actorId: "operator", verb: "import-plan", target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", planId: "plan" } };
}

async function setup() {
  const h = await openTestStore();
  const repo = join(h.root, "repo");
  const plans = join(repo, "plans");
  const contracts = join(h.root, "contracts");
  await mkdir(plans, { recursive: true });
  await mkdir(contracts);
  const planPath = join(plans, "plan.json");
  const binary = join(h.root, "ccloop");
  const adapter = join(h.root, "adapter.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await writeFile(adapter, "{}");
  const a = join(contracts, "a.json"), b = join(contracts, "b.json");
  await writeFile(a, JSON.stringify(contract("a")));
  await writeFile(b, JSON.stringify(contract("b")));
  const plan = {
    targetRepo: repo, ccloopBin: binary, runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Ship", successConditions: ["tests pass"],
    tasks: [
      { taskId: "b", contract: b, dependsOn: ["a"], targetVersion: "v2", configHash: hash("e") },
      { taskId: "a", contract: a, dependsOn: [], targetVersion: "v1", configHash: hash("f") },
    ],
  };
  await writeFile(planPath, JSON.stringify(plan));
  const port: ExecutionPort = {
    capabilities: async () => ({ protocol: 1, durableAccept: true, ownershipIsolation: true, evidenceRetention: true, usageObservation: "realtime", budgetEnforcement: "bounded", requestBoundEvidence: "proof" }),
    readEvidence: async () => Buffer.alloc(0),
    accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
    collect: async () => ({ events: [], candidate: null, terminal: null }),
  };
  const frozen = resolveProfile(profile(), port);
  const router = createExecutionProfileRouter([frozen]);
  const trustedConfig = createTrustedControlConfig({
    epoch: "epoch", stateDir: h.store.stateDir, executablePath: binary, adapterConfigPath: adapter,
    archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 1_000,
    repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
    plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: planPath }],
    defaultEstimatorProfileId: "estimator", defaultEstimateMode: "strict",
  }, router);
  let defaults = { estimatorProfileId: "estimator", estimatorProfileHash: frozen.profileHash, estimateMode: "strict" as const };
  return { ...h, repo, planPath, plan, router, trustedConfig, frozen, deps: { store: h.store, trustedConfig, profileRouter: router, defaults: () => defaults, estimatorObservation: (selected: typeof frozen) => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null }) }, setDefaults: (next: typeof defaults) => { defaults = next; } };
}

describe("immutable plan import", () => {
  it("normalizes sets, archives contracts, and keeps imported authority unchanged after source edits", async () => {
    const h = await setup();
    try {
      const imported = importControlPlan(h.deps, command());
      if ("error" in imported) throw new Error(`unexpected import failure: ${imported.error.code}`);
      const archived = readArchivedPlan(h.store, "g");
      expect(imported.result).toMatchObject({ kind: "imported", groupId: "g", estimateState: "queued" });
      expect(archived.plan.tasks.map(task => task.taskId)).toEqual(["a", "b"]);
      expect(archived.plan.tasks[1].dependencyTaskIds).toEqual(["a"]);
      for (const task of archived.plan.tasks) {
        const retained = readArchivedContract(h.store, "g", task.taskId);
        expect(retained.contractHash).toBe(task.originalContractHash);
        expect(retained.canonicalJson).toBe(task.originalContractCanonicalJson);
      }
      const original = archived.canonicalJson;
      await writeFile(h.planPath, JSON.stringify({ ...h.plan, goal: "changed", tasks: [] }));
      expect(readArchivedPlan(h.store, "g")).toEqual({ ...archived, canonicalJson: original });
      expect(readBudgetProposal(h.store, "g")).toMatchObject({ proposalVersion: 1, state: "editable" });
      expect(readEstimateRecord(h.store, "g", imported.result.kind === "imported" ? imported.result.estimateId : "missing")).toMatchObject({ estimateVersion: 1, state: "queued" });
      const group = h.store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id='g'").get();
      expect(group).toEqual({ revision: 1, projection_seq: 1 });
    } finally { await h.dispose(); }
  });

  it("replays the original result without rereading a changed source or changed server defaults", async () => {
    const h = await setup();
    try {
      const first = importControlPlan(h.deps, command());
      await writeFile(h.planPath, "not json");
      h.setDefaults({ estimatorProfileId: "removed", estimatorProfileHash: hash("9"), estimateMode: "strict" });
      expect(importControlPlan(h.deps, command())).toEqual(first);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM estimates WHERE group_id='g'").get()?.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it("replays asynchronously before capability I/O and cannot hang on a lost-response retry", async () => {
    const h = await setup();
    try {
      const first = importControlPlan(h.deps, command());
      const probe = vi.fn(() => new Promise<never>(() => {}));
      const result = await importControlPlanAsync({ ...h.deps, profileRouter: { ...h.router, probe } }, command());
      expect(result).toEqual(first);
      expect(probe).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it("returns a same-id raw conflict before capability I/O", async () => {
    const h = await setup();
    try {
      importControlPlan(h.deps, command());
      const probe = vi.fn(() => new Promise<never>(() => {}));
      await expect(importControlPlanAsync(
        { ...h.deps, profileRouter: { ...h.router, probe } },
        { ...command(), actorId: "different" },
      )).rejects.toThrow("command-id-conflict");
      expect(probe).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it("rechecks command identity after an in-flight probe and creates no duplicate effects", async () => {
    const h = await setup();
    try {
      let release!: (value: ReturnType<typeof h.deps.estimatorObservation> & { observedAt: string }) => void;
      const probe = vi.fn(() => new Promise<ReturnType<typeof h.deps.estimatorObservation> & { observedAt: string }>(resolve => { release = resolve; }));
      const pending = importControlPlanAsync({ ...h.deps, profileRouter: { ...h.router, probe } }, command());
      expect(probe).toHaveBeenCalledTimes(1);
      const committed = importControlPlan(h.deps, command());
      release({ ...h.deps.estimatorObservation(h.frozen), observedAt: new Date(0).toISOString() });
      await expect(pending).resolves.toEqual(committed);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM estimates WHERE group_id='g'").get()?.n).toBe(1);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM commands WHERE group_id='g'").get()?.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it.each([
    ["missing", { estimatorProfileId: "missing" }],
    ["changed", { estimatorProfileHash: hash("9") }],
  ] as const)("persists and replays a durable %s profile rejection across a later config change", async (_label, patch) => {
    const h = await setup();
    try {
      h.setDefaults({
        estimatorProfileId: "estimatorProfileId" in patch ? patch.estimatorProfileId : "estimator",
        estimatorProfileHash: "estimatorProfileHash" in patch ? patch.estimatorProfileHash : h.frozen.profileHash,
        estimateMode: "strict",
      });
      const first = await importControlPlanAsync(h.deps, command());
      expect(first).toMatchObject({ error: { code: "profile-changed", commandRevision: 0, retryable: false } });
      expect(lookupCommandResult(h.store, "g", "import-1")).toMatchObject({
        originalStatus: 409,
        body: { error: { code: "profile-changed" } },
      });

      h.setDefaults({ estimatorProfileId: "estimator", estimatorProfileHash: h.frozen.profileHash, estimateMode: "strict" });
      const resolve = vi.fn(h.router.resolve);
      const probe = vi.fn(h.router.probe);
      await expect(importControlPlanAsync({ ...h.deps, profileRouter: { ...h.router, resolve, probe } }, command())).resolves.toEqual(first);
      expect(resolve).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("lets a concurrent same-id commit win when an in-flight probe rejects durably", async () => {
    const h = await setup();
    try {
      let reject!: (error: Error) => void;
      const probe = vi.fn(() => new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; }));
      const pending = importControlPlanAsync({ ...h.deps, profileRouter: { ...h.router, probe } }, command());
      expect(probe).toHaveBeenCalledTimes(1);
      const committed = importControlPlan(h.deps, command());
      reject(new ControlError("profile-changed"));
      await expect(pending).resolves.toEqual(committed);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM commands WHERE group_id='g'").get()?.n).toBe(1);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM estimates WHERE group_id='g'").get()?.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it.each([
    ["unexpected", () => new Error("probe-crash")],
    ["transient", () => new ControlError("control-capability-probe-failed")],
  ] as const)("does not persist an %s asynchronous preparation failure", async (_label, failure) => {
    const h = await setup();
    try {
      const probe = vi.fn(async () => { throw failure(); });
      await expect(importControlPlanAsync({ ...h.deps, profileRouter: { ...h.router, probe } }, command())).rejects.toThrow();
      expect(h.store.db.prepare("SELECT count(*) AS n FROM commands").get()?.n).toBe(0);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM groups").get()?.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("turns a real probe failure into a terminal import without optimistic capability", async () => {
    const h = await setup();
    try {
      const result = await importControlPlanAsync(h.deps, command());
      expect(result).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
      expect(h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it.each([
    ["blocked-capability", { contextWindowTokens: null }],
    ["input-too-large", { contextWindowTokens: 100 }],
  ] as const)("persists a terminal %s preflight without a scheduler wake", async (state, observedPatch) => {
    const h = await setup();
    try {
      const observed = { ...h.frozen.snapshot.profile.capabilities, ...observedPatch };
      const result = importControlPlan({
        ...h.deps,
        estimatorObservation: selected => ({ profile: selected, observed, probeFailureCode: null }),
      }, command());
      expect(result).toMatchObject({ result: { kind: "imported", estimateState: state } });
      expect(h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g'").get()).toBeUndefined();
      const proposal = readBudgetProposal(h.store, "g");
      expect(proposal.explicitUnallocatedReserve.tokens).toBe(1_820_000);
    } finally { await h.dispose(); }
  });

  it.each([
    ["duplicate task", (plan: any) => ({ ...plan, tasks: [plan.tasks[0], plan.tasks[0]] })],
    ["duplicate dependency", (plan: any) => ({ ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ["a", "a"] }, plan.tasks[1]] })],
    ["dangling dependency", (plan: any) => ({ ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ["missing"] }, plan.tasks[1]] })],
  ])("rejects %s and leaves the group completely absent", async (_label, mutate) => {
    const h = await setup();
    try {
      await writeFile(h.planPath, JSON.stringify(mutate(h.plan)));
      const result = importControlPlan(h.deps, command());
      expect("error" in result).toBe(true);
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g'").get()).toBeUndefined();
      expect(h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g'").get()).toBeUndefined();
      expect(h.store.db.prepare("SELECT id FROM estimates WHERE group_id='g'").get()).toBeUndefined();
      expect(h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND id='import-1'").get()).toBeDefined();
    } finally { await h.dispose(); }
  });

  it("rejects a contract outside the closed ccloop V1 schema", async () => {
    const h = await setup();
    try {
      const path = h.plan.tasks[0].contract;
      await writeFile(path, JSON.stringify({ ...contract("b"), unexpectedBudget: 1 }));
      expect(importControlPlan(h.deps, command())).toMatchObject({ error: { code: "control-plan-rejected" } });
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("rolls back every import row when interrupted before commit", async () => {
    const h = await setup();
    try {
      expect(() => importControlPlan({ ...h.deps, beforeCommit: () => { throw new Error("crash-before-commit"); } }, command())).toThrow("crash-before-commit");
      for (const table of ["groups", "work_items", "budget_proposals", "estimates", "execution_snapshots", "scheduler_wakes", "commands"]) {
        expect(h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
      }
    } finally { await h.dispose(); }
  });

  it("rejects a plan inode swap between trusted resolution and descriptor validation", async () => {
    const h = await setup();
    try {
      const resolved = h.trustedConfig.resolveTarget({ repoId: "repo", planId: "plan" });
      await rename(h.planPath, `${h.planPath}.old`);
      await writeFile(h.planPath, JSON.stringify(h.plan));
      const deps = { ...h.deps, trustedConfig: { resolveTarget: () => resolved } };
      expect(() => importControlPlan(deps, command())).toThrow("control-path-changed");
      for (const table of ["groups", "work_items", "budget_proposals", "estimates", "execution_snapshots", "scheduler_wakes", "commands"]) {
        expect(h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
      }
    } finally { await h.dispose(); }
  });

  it.each(["before-commit", "after-commit"] as const)("is absent or fully replayable after real SIGKILL %s", async point => {
    const h = await setup();
    const config = {
      point, stateDir: h.store.stateDir, repositoryPath: h.repo, planPath: h.planPath,
      profile: h.frozen.snapshot, profileHash: h.frozen.profileHash,
      command: command(), cwd: process.cwd(),
    };
    h.store.close();
    const script = `
      const { writeSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { pathToFileURL } = await import("node:url");
      const c = JSON.parse(process.env.ORCA_IMPORT_CRASH_CONFIG);
      const fromRoot = p => pathToFileURL(join(c.cwd, p)).href;
      const { openControlStore } = await import(fromRoot("src/control/store.ts"));
      const { importControlPlan } = await import(fromRoot("src/control/planImport.ts"));
      const store = await openControlStore({ stateDir: c.stateDir });
      const frozen = { snapshot: c.profile, profileHash: c.profileHash, port: {} };
      const router = { resolve(kind,id,hash) { if (kind !== "budget-estimate" || id !== "estimator" || hash !== c.profileHash) throw new Error("profile"); return frozen; }, list() { return [frozen]; }, async probe() { throw new Error("unused"); } };
      const stop = label => { writeSync(1, label + "\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
      const deps = { store, profileRouter: router, trustedConfig: { resolveTarget() { return { repositoryPath: c.repositoryPath, planPath: c.planPath, validatePlanDescriptor() {} }; } }, defaults: () => ({ estimatorProfileId: "estimator", estimatorProfileHash: c.profileHash, estimateMode: "strict" }), estimatorObservation: selected => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null }), ...(c.point === "before-commit" ? { beforeCommit: () => stop("BEFORE_COMMIT") } : {}) };
      importControlPlan(deps, c.command);
      stop("AFTER_COMMIT");
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ORCA_IMPORT_CRASH_CONFIG: JSON.stringify(config) },
    });
    let stderr = ""; child.stderr.on("data", bytes => { stderr += String(bytes); });
    try {
      await new Promise<void>((resolve, reject) => {
        const expected = point === "before-commit" ? "BEFORE_COMMIT" : "AFTER_COMMIT";
        const timer = setTimeout(() => reject(new Error(`marker-timeout:${stderr}`)), 10_000);
        child.stdout.on("data", bytes => { if (String(bytes).includes(expected)) { clearTimeout(timer); resolve(); } });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`early-exit:${code}:${stderr}`)); });
      });
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      const recovered = await openControlStore({ stateDir: h.store.stateDir, recovery: true });
      try {
        if (point === "before-commit") {
          for (const table of ["groups", "work_items", "budget_proposals", "estimates", "execution_snapshots", "scheduler_wakes", "commands"]) {
            expect(recovered.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
          }
        } else {
          const archived = readArchivedPlan(recovered, "g");
          await writeFile(h.planPath, "damaged after committed response loss");
          expect(importControlPlan({ ...h.deps, store: recovered }, command())).toMatchObject({ result: { kind: "imported", groupId: "g" } });
          expect(readArchivedPlan(recovered, "g")).toEqual(archived);
          expect(recovered.db.prepare("SELECT count(*) AS n FROM estimates WHERE group_id='g'").get()?.n).toBe(1);
        }
      } finally { recovered.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await h.dispose();
    }
  }, 30_000);

  it("fails closed when an archived content-addressed plan is missing or damaged", async () => {
    const h = await setup();
    try {
      importControlPlan(h.deps, command());
      const archived = readArchivedPlan(h.store, "g");
      const contractHash = archived.plan.tasks[0].originalContractHash;
      h.store.db.prepare("UPDATE execution_snapshots SET body='{}' WHERE hash=?").run(contractHash);
      expect(() => readArchivedContract(h.store, "g", archived.plan.tasks[0].taskId)).toThrow("recovery-blocked");
      h.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(contractHash);
      expect(() => readArchivedContract(h.store, "g", archived.plan.tasks[0].taskId)).toThrow("recovery-blocked");
      h.store.db.prepare("UPDATE execution_snapshots SET body='{}' WHERE hash=?").run(archived.planHash);
      expect(() => readArchivedPlan(h.store, "g")).toThrow("recovery-blocked");
      h.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(archived.planHash);
      expect(() => readArchivedPlan(h.store, "g")).toThrow("recovery-blocked");
    } finally { await h.dispose(); }
  });

  it("fails closed on structurally valid but malformed proposal and estimate authority", async () => {
    const h = await setup();
    try {
      const result = importControlPlan(h.deps, command());
      if ("error" in result || result.result.kind !== "imported") throw new Error("expected import");
      const estimateId = result.result.estimateId;
      const proposalRow = h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!;
      const proposal = JSON.parse(String(proposalRow.body));
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'")
        .run(canonicalBytes({ ...proposal, unexpected: true }).toString("utf8"));
      expect(() => readBudgetProposal(h.store, "g")).toThrow("recovery-blocked");
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'")
        .run(canonicalBytes({ ...proposal, planHash: hash("8") }).toString("utf8"));
      expect(() => readBudgetProposal(h.store, "g")).toThrow("recovery-blocked");

      const estimateRow = h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(estimateId)!;
      const estimate = JSON.parse(String(estimateRow.body));
      h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?")
        .run(canonicalBytes({ ...estimate, estimateId: "wrong" }).toString("utf8"), estimateId);
      expect(() => readEstimateRecord(h.store, "g", estimateId)).toThrow("recovery-blocked");
    } finally { await h.dispose(); }
  });

  it("fails closed on noncanonical proposal bytes and an estimate request hash mismatch", async () => {
    const h = await setup();
    try {
      const result = importControlPlan(h.deps, command());
      if ("error" in result || result.result.kind !== "imported") throw new Error("expected import");
      const estimateId = result.result.estimateId;
      const proposal = readBudgetProposal(h.store, "g");
      const reversed = Object.fromEntries(Object.entries(proposal).reverse());
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(JSON.stringify(reversed));
      expect(() => readBudgetProposal(h.store, "g")).toThrow("recovery-blocked");

      const estimateRow = h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(estimateId)!;
      const estimate = JSON.parse(String(estimateRow.body));
      estimate.requestHash = hash("9");
      h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?")
        .run(JSON.stringify(estimate), estimateId);
      expect(() => readEstimateRecord(h.store, "g", estimateId)).toThrow("recovery-blocked");
    } finally { await h.dispose(); }
  });

  it("persists non-allowlisted source rejection without creating a group", async () => {
    const h = await setup();
    try {
      const bad = command();
      bad.payload = { ...bad.payload, planId: "missing" };
      const result = importControlPlan(h.deps, bad);
      expect(result).toMatchObject({ error: { code: "control-target-not-allowed" } });
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });
});
