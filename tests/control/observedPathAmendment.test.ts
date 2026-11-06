import { describe, expect, it } from "vitest";
import { appendObservedPaths, mirrorObservedWrites } from "../../src/control/observedPathAmendment.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { deriveContract } from "../../src/control/executionSnapshot.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { effectivePlanTask, readObservedPathChain, workBodyOf } from "../../src/control/taskAmendments.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { applyObservedPathAmendment, readWebGroup } from "../../src/control/webService.js";
import { handoff } from "./fixtures/unknownFailure.js";

const base = () => taskContractSchema.parse({
  objective: { taskId: "a", goal: "Fix math", successCondition: "all checks pass" },
  context: { repoPath: "/repo", targetPaths: ["src/math.js"], buildTestCommands: ["npm test"] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000,
    tokenBudget: 100_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
  safetyPolicy: { allowlistPaths: ["src/math.js"], denylistPaths: ["secrets/**"], maxFilesTouched: 4 },
  verification: { verifierType: "command", requiredChecks: ["npm test"], rejectOn: ["failure"] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
});

describe("an observed path amendment changes only the authorized repository's path lists", () => {
  it("adds primary test paths without changing checks, limits or the source contract", () => {
    const source = base();
    const next = appendObservedPaths(source, [{ repoKey: null, path: "test/math.test.js" }, { repoKey: null, path: "test/add.test.js" }]);
    expect(next.context.targetPaths).toEqual(["src/math.js", "test/math.test.js", "test/add.test.js"]);
    expect(next.safetyPolicy.allowlistPaths).toEqual(["src/math.js", "test/math.test.js", "test/add.test.js"]);
    expect(next.verification.requiredChecks).toEqual(["npm test"]);
    expect(next.executionPolicy).toEqual(source.executionPolicy);
    expect(next.safetyPolicy.maxFilesTouched).toBe(4);
    expect(source.context.targetPaths).toEqual(["src/math.js"]);
  });

  it("adds an extra-repository path without touching the primary or another repository", () => {
    const source = base();
    source.context.repoKey = "app";
    source.context.additionalRepos = [
      { key: "lib", repoPath: "/lib", targetPaths: ["src/lib.js"], allowlistPaths: ["src/lib.js"], requiredChecks: ["npm test"] },
      { key: "docs", repoPath: "/docs", targetPaths: ["README.md"], allowlistPaths: ["README.md"] },
    ];
    const next = appendObservedPaths(source, [{ repoKey: "lib", path: "test/lib.test.js" }]);
    expect(next.context.additionalRepos?.[0]).toEqual({ key: "lib", repoPath: "/lib",
      targetPaths: ["src/lib.js", "test/lib.test.js"], allowlistPaths: ["src/lib.js", "test/lib.test.js"], requiredChecks: ["npm test"] });
    expect(next.context.additionalRepos?.[1]).toEqual(source.context.additionalRepos[1]);
    expect(next.context.targetPaths).toEqual(["src/math.js"]);
    expect(next.verification.requiredChecks).toEqual(["npm test"]);
  });

  it("keeps a multi-directory work item's writes mirror and checks aligned with the new path", () => {
    const source = base();
    source.context.repoKey = "app";
    source.context.additionalRepos = [{ key: "lib", repoPath: "/lib", targetPaths: ["src/lib.js"], allowlistPaths: ["src/lib.js"], requiredChecks: ["npm test"] }];
    const writes = [{ dir: "app", targetPaths: ["src/math.js"], checks: ["npm test"] },
      { dir: "lib", targetPaths: ["src/lib.js"], checks: ["npm test"] }];
    const next = mirrorObservedWrites(writes, source, [{ repoKey: "lib", path: "test/lib.test.js" }]);
    expect(next).toEqual([{ dir: "app", targetPaths: ["src/math.js"], checks: ["npm test"] },
      { dir: "lib", targetPaths: ["src/lib.js", "test/lib.test.js"], checks: ["npm test"] }]);
    expect(writes[1]!.targetPaths).toEqual(["src/lib.js"]);
  });

  it("refuses a path the frozen repository does not name or one it already permits", () => {
    const source = base();
    expect(() => appendObservedPaths(source, [{ repoKey: "ghost", path: "test/a.test.js" }])).toThrow();
    expect(() => appendObservedPaths(source, [{ repoKey: null, path: "src/math.js" }])).toThrow();
    expect(() => appendObservedPaths(source, [{ repoKey: null, path: "../escape" }])).toThrow();
  });
});

describe("an observed path record projects an immutable contract for the next claim", { timeout: 60_000 }, () => {
  it("validates two successive blocked runs and keeps both added paths in the next contract", async () => {
    let miss = { repoKey: null, path: "test/first.test.js" };
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => `allowlist miss: ${miss.path}`, pathPolicyMisses: () => [miss],
    });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: Object.fromEntries(
        (["tokens", "activeMs", "attempts", "sessions"] as const).map((dimension) => [dimension, limit[dimension]! * 5])) } as never))).not.toHaveProperty("error");
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: first }))).not.toHaveProperty("error");
      t.h.store.transaction(() => applyObservedPathAmendment(t.h.store, "g", "a", first, [miss], "extend-first", "agent:cli"));
      miss = { repoKey: null, path: "test/second.test.js" };
      const second = await t.claim();
      await t.until(driver, () => t.body(second).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: second }))).not.toHaveProperty("error");
      t.h.store.transaction(() => applyObservedPathAmendment(t.h.store, "g", "a", second, [miss], "extend-second", "agent:cli"));
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a", "test/first.test.js", "test/second.test.js"]);
      const records = readObservedPathChain(t.h.store, "g", "a", workBodyOf(t.h.store, "g", "a"));
      expect(records.map((record) => [record.version, record.sourceRunId])).toEqual([[1, first], [2, second]]);
    } finally { await t.h.dispose(); }
  });

  it("keeps a reduced-grant retry source valid when the next contract has new paths", async () => {
    const misses = [{ repoKey: null, path: "test/a.test.js" }];
    let behaviour: "stoppable" | "blocked-waiting-human" = "stoppable";
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      behaviour: () => behaviour, stopReason: () => "allowlist miss: test/a.test.js", pathPolicyMisses: () => misses,
    });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: Object.fromEntries(
        (["tokens", "activeMs", "attempts", "sessions"] as const).map((dimension) => [dimension, limit[dimension]! * 5])) } as never))).not.toHaveProperty("error");
      const first = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(first).state === "accepted");
      await handoff(t, first, driver);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [
        { taskId: "a", predecessorRunId: first, checkpointId: t.body(first).checkpointId },
      ] } as never))).not.toHaveProperty("error");
      behaviour = "blocked-waiting-human";
      const sourceRunId = await t.claim();
      await t.until(driver, () => t.body(sourceRunId).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: sourceRunId }))).not.toHaveProperty("error");
      const work = workBodyOf(t.h.store, "g", "a") as { retryGrantSourceRunId?: string };
      expect(work.retryGrantSourceRunId).toBe(sourceRunId);
      t.h.store.transaction(() => applyObservedPathAmendment(t.h.store, "g", "a", sourceRunId, misses, "observed-paths-reduced", "agent:cli"));
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a", "test/a.test.js"]);
    } finally { await t.h.dispose(); }
  });

  it("moves only the next contract and confirmed snapshot after the old run is settled", async () => {
    const misses = [{ repoKey: null, path: "test/a.test.js" }];
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/a.test.js", pathPolicyMisses: () => misses,
    });
    try {
      const sourceRunId = await t.claim();
      await t.until(t.driver(), () => t.body(sourceRunId).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: sourceRunId }))).not.toHaveProperty("error");
      const oldRun = JSON.stringify(t.body(sourceRunId));
      const before = readConfirmedTaskExecution(t.h.store, "g", "a");
      const written = t.h.store.transaction(() => applyObservedPathAmendment(t.h.store, "g", "a", sourceRunId, misses,
        "observed-paths-1", "agent:cli"));
      const after = readConfirmedTaskExecution(t.h.store, "g", "a");
      expect(after.contract.context.targetPaths).toEqual(["a", "test/a.test.js"]);
      expect(after.contract.verification.requiredChecks).toEqual(before.contract.verification.requiredChecks);
      expect(after.derivedContractHash).toBe(written.derivedContractHash);
      expect(after.derivedContractHash).not.toBe(before.derivedContractHash);
      expect(JSON.stringify(t.body(sourceRunId))).toBe(oldRun);
      expect(readControlGroup(t.h.store, "epoch", "g").workItems.find((item) => item.taskId === "a")?.originalContractHash).toBe(written.originalContractHash);
    } finally { await t.h.dispose(); }
  });

  it("validates the source run's evidence and keeps the loop recipe's old checks", async () => {
    const misses = [{ repoKey: null, path: "test/a.test.js" }];
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/a.test.js", pathPolicyMisses: () => misses,
    });
    try {
      const sourceRunId = await t.claim();
      await t.until(t.driver(), () => t.body(sourceRunId).state === "blocked");
      const archived = readArchivedPlan(t.h.store, "g").plan.tasks[0]!;
      const work = workBodyOf(t.h.store, "g", "a") as Record<string, any>;
      const baseTask = effectivePlanTask(t.h.store, "g", archived, work);
      const nextContract = appendObservedPaths(taskContractSchema.parse(JSON.parse(baseTask.originalContractCanonicalJson)), misses);
      const nextJson = canonicalBytes(nextContract).toString("utf8"), nextHash = sha256Canonical(nextContract);
      const proposal = readBudgetProposal(t.h.store, "g");
      const derived = deriveContract({ ...baseTask, originalContractHash: nextHash, originalContractCanonicalJson: nextJson,
        work: work.grant.work, handoff: work.grant.handoff }, proposal.proposalVersion);
      const record = { schema: "orca-observed-path-amendment-v1", groupId: "g", taskId: "a", version: 1,
        previousAmendmentHash: null, sourceRunId, misses, previousOriginalContractHash: baseTask.originalContractHash,
        nextOriginalContractHash: nextHash, previousDerivedContractHash: work.derivedContractHash,
        nextDerivedContractHash: derived.derivedContractHash, commandId: "observed-paths-1", actor: "agent:cli" };
      const recordHash = sha256Canonical(record);
      writeCanonicalRecord(t.h.store, "g", nextHash, nextJson);
      writeCanonicalRecord(t.h.store, "g", recordHash, canonicalBytes(record).toString("utf8"));
      Object.assign(work, { observedPathsVersion: 1, observedPathAmendmentHash: recordHash });
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      const effective = effectivePlanTask(t.h.store, "g", archived, work);
      expect(effective.originalContractHash).toBe(nextHash);
      expect(taskContractSchema.parse(JSON.parse(effective.originalContractCanonicalJson)).context.targetPaths).toEqual(["a", "test/a.test.js"]);
      expect(taskContractSchema.parse(JSON.parse(effective.originalContractCanonicalJson)).verification.requiredChecks).toEqual(["true"]);
      const forgedRecipe = { ...archived, loop: { ...archived.loop!, inputs: { ...archived.loop!.inputs, goal: "forged goal" } } };
      expect(() => effectivePlanTask(t.h.store, "g", forgedRecipe, work)).toThrow("task-amendment-invalid");
      const forged = { ...record, misses: [{ repoKey: null, path: "test/forged.test.js" }] };
      const forgedHash = sha256Canonical(forged);
      writeCanonicalRecord(t.h.store, "g", forgedHash, canonicalBytes(forged).toString("utf8"));
      work.observedPathAmendmentHash = forgedHash;
      expect(() => effectivePlanTask(t.h.store, "g", archived, work)).toThrow("observed-path-amendment-invalid");
    } finally { await t.h.dispose(); }
  });
});
