import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { readGroupIntegration, schemeHash, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { createExecutionDriver, DriverCrash, replenishStartWakes, stepA1, stepA2, stepB, stepC } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { stepD } from "../../src/control/driverLanding.js";
import { historySourcePinRef } from "../../src/control/historySource.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { answerSingleCalls } from "./fixtures/singleCallAnswers.js";

const HISTORY: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main",
  historyExpectation: { version: 1, targetRef: "refs/heads/main", directSecondParent: true,
    sourceRefs: [{ taskId: "a", ref: "refs/heads/feature/source" }], artifactPaths: ["a"] } };
const record = (store: Awaited<ReturnType<typeof driverHarness>>["h"]["store"]): any =>
  readGroupIntegration(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)));

describe("a named source is bound at its mapped task landing (#328)", () => {
  it("stores the registered branch's real commit with its landed task and keeps it after the branch moves", async () => {
    const t = await driverHarness([{ taskId: "a" }], { integration: HISTORY }); try {
      git(t.repo, "branch", "feature/source", "main");
      const sourceSha = git(t.repo, "rev-parse", "refs/heads/feature/source");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "landed");
      const landedCommit = t.body(runId).drive.landedCommit;
      expect(record(t.h.store).historyBindings).toEqual([{ taskId: "a", runId, landedCommit,
        sourceRef: "refs/heads/feature/source", sourceSha, contractHash: schemeHash(HISTORY) }]);
      const moved = git(t.repo, "commit-tree", `${sourceSha}^{tree}`, "-p", sourceSha, "-m", "move source");
      git(t.repo, "update-ref", "refs/heads/feature/source", moved, sourceSha);
      expect(record(t.h.store).historyBindings[0].sourceSha).toBe(sourceSha);
      expect(git(t.repo, "rev-parse", historySourcePinRef("g", "a", runId))).toBe(sourceSha);
      expect(git(t.repo, "rev-parse", "refs/heads/feature/source")).toBe(moved);
    } finally { await t.h.dispose(); }
  });

  it("reuses the pinned source after a crash between the group-branch CAS and the landing record", async () => {
    const t = await driverHarness([{ taskId: "a" }], { integration: HISTORY });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const sourceSha = git(t.repo, "rev-parse", "refs/heads/feature/source"), runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: point => { if (point === "D-after-cas") throw new DriverCrash(point); } });
      try { await t.until(crashing, () => crashing.crashed === "D-after-cas"); }
      finally { await crashing.stop(); }
      expect(t.body(runId).state).toBe("collected");
      const landedBeforeRecord = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const moved = git(t.repo, "commit-tree", `${sourceSha}^{tree}`, "-p", sourceSha, "-m", "move source");
      git(t.repo, "update-ref", "refs/heads/feature/source", moved, sourceSha);
      await t.until(t.driver(), () => t.body(runId).state === "landed");
      expect(t.body(runId).drive.landedCommit).toBe(landedBeforeRecord);
      expect(record(t.h.store).historyBindings[0]).toMatchObject({ sourceSha, runId, landedCommit: landedBeforeRecord });
      expect(git(t.repo, "rev-parse", historySourcePinRef("g", "a", runId))).toBe(sourceSha);
    } finally { await t.h.dispose(); }
  });

  it("binds the source of a task that lands through conflict reconciliation", { timeout: 60_000 }, async () => {
    const integration: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main",
      historyExpectation: { version: 1, targetRef: "refs/heads/main", directSecondParent: true,
        sourceRefs: [{ taskId: "b", ref: "refs/heads/feature/source" }] } };
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }],
      { integration, files: id => ({ "shared.txt": `${id}\n` }) });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const sha = git(t.repo, "rev-parse", "refs/heads/feature/source");
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "a\nb\n" } }));
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }))).toHaveProperty("result");
      const ids = [await t.claim(), await t.claim()];
      for (const id of ids) {
        expect(stepA1(t.deps, id)).toBe(true);
        expect(await stepA2(t.deps, id)).toBe(true);
        expect(await stepB(t.deps, id)).toBe(true);
        expect(await stepC(t.deps, id)).toBe(true);
        expect(t.body(id).state).toBe("collected");
      }
      const a = ids.find(id => t.body(id).taskId === "a")!, b = ids.find(id => t.body(id).taskId === "b")!;
      expect(await stepD(t.deps, a)).toBe(true);
      expect(t.body(a).state).toBe("landed");
      expect(await stepD(t.deps, b)).toBe(true);
      expect(t.body(b).state).toBe("reconciling");
      const driver = t.driver();
      for (let i = 0; i < 120 && !["landed", "settled", "blocked"].includes(t.body(b).state); i++) {
        await driver.round(); await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(t.body(b).state).toMatch(/landed|settled/);
      expect(t.body(b).drive.reconcile).not.toBeNull();
      expect(record(t.h.store).historyBindings).toMatchObject([{ taskId: "b", runId: b, sourceSha: sha,
        landedCommit: t.body(b).drive.landedCommit }]);
    } finally { await t.h.dispose(); }
  });

  it("binds a checked no-change source without pretending the task made a merge commit", async () => {
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { integration: HISTORY, files: () => ({}) });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const sourceSha = git(t.repo, "rev-parse", "refs/heads/feature/source"), runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).drive.landedCommit).toBeNull();
      expect(record(t.h.store).historyBindings).toMatchObject([{ taskId: "a", runId, sourceSha, noChange: true,
        landedCommit: git(t.repo, "rev-parse", "refs/heads/orca/g") }]);
    } finally { await t.h.dispose(); }
  });

  it("a goal judge's no-change approval binds the real source before completing the task", { timeout: 60_000 }, async () => {
    const t = await driverHarness([{ taskId: "a" }], { integration: HISTORY, files: () => ({}) });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const sourceSha = git(t.repo, "rev-parse", "refs/heads/feature/source");
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4,
        attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }))).toHaveProperty("result");
      const answered = answerSingleCalls(t, () => ({ outcome: "complete", output: { verdict: "met", finding: "already present" } }));
      const runId = await t.claim();
      const workStatus = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;
      await t.until(t.driver(), () => workStatus() === "done", 120);
      expect(answered.calls.map(call => call.purpose)).toEqual(["no-change-judge"]);
      expect(record(t.h.store).historyBindings).toMatchObject([{ taskId: "a", runId, sourceSha, noChange: true,
        landedCommit: git(t.repo, "rev-parse", "refs/heads/orca/g") }]);
    } finally { await t.h.dispose(); }
  });

  it("a no-change source with a decision binds the actual group tip after its ledger commit", async () => {
    const entry = { question: "Should this add a file?", chose: "No change needed", alternatives: [{ option: "Add", why_not: "Checks already pass" }],
      because: "the contract's checks decide the goal", undo: { how: "No change made; nothing to revert", cost: "none", blast_radius: "none", kind: "no-change" },
      scope: "task", kind: "criteria" };
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }],
      { integration: HISTORY, files: () => ({}), decisions: () => [entry] });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(record(t.h.store).historyBindings).toMatchObject([{ taskId: "a", noChange: true,
        landedCommit: git(t.repo, "rev-parse", "refs/heads/orca/g") }]);
    } finally { await t.h.dispose(); }
  });

  it("a reopened no-change source revokes its old binding and accepts the next run's source", { timeout: 60_000 }, async () => {
    const t = await driverHarness([{ taskId: "a", verifierType: "agent" }], { integration: HISTORY, files: () => ({}) });
    try {
      git(t.repo, "branch", "feature/source", "main");
      const firstSha = git(t.repo, "rev-parse", "refs/heads/feature/source"), first = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(first).drive?.cleanedUp === true);
      expect(record(t.h.store).historyBindings).toMatchObject([{ runId: first, sourceSha: firstSha }]);
      expect(t.service.reopenTask(t.h.command("reopen-task", { taskId: "a", runId: first, note: "recheck source" })))
        .toMatchObject({ result: { kind: "task-reopened" } });
      const nextSha = git(t.repo, "commit-tree", `${firstSha}^{tree}`, "-p", firstSha, "-m", "new source");
      git(t.repo, "update-ref", "refs/heads/feature/source", nextSha, firstSha);
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
      const next = delivered.runId;
      await t.until(driver, () => t.body(next).drive?.cleanedUp === true || t.body(next).state === "blocked");
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status).toBe("done");
      expect(record(t.h.store).historyBindings).toMatchObject([{ runId: next, sourceSha: nextSha }]);
      expect(record(t.h.store).historyWithdrawnBindings).toMatchObject([{ binding: { runId: first, sourceSha: firstSha } }]);
    } finally { await t.h.dispose(); }
  });

  it("blocks a missing source before moving the group branch or calling its task done", async () => {
    const t = await driverHarness([{ taskId: "a" }], { integration: HISTORY }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      await t.until(driver, () => t.body(runId).state === "blocked" || t.body(runId).state === "landed");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "D", blockedReason: "history-source-missing:refs/heads/feature/source" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
      expect(record(t.h.store).historyBindings ?? []).toEqual([]);
      git(t.repo, "branch", "feature/source", "main");
      const retry = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retry).toMatchObject({ result: { resolved: true } });
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(record(t.h.store).historyBindings).toMatchObject([{ taskId: "a", runId,
        sourceSha: git(t.repo, "rev-parse", "refs/heads/feature/source") }]);
    } finally { await t.h.dispose(); }
  });
});
