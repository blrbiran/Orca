import { describe, expect, it } from "vitest";
import { acceptanceCommands } from "../../src/control/groupAcceptance.js";
import { frozenWorkAgent } from "../../src/control/agentFreeze.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { newDraft, writeDraft } from "../../src/control/requirementRecords.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { git } from "./fixtures/driverHarness.js";
import { reviewWorld, verdicts } from "./fixtures/reviewWorld.js";

/**
 * Tester follow-up G spec §3.4-§3.5 (human: 「自动在同一组里开一个修复任务（把复核的发现当说明）」): a review round with
 * unmet criteria opens one fix task in the same group covering all of them, whose goal is the findings and whose write
 * set is the files the review named; once it lands the group is accepted and reviewed again. At most two automatic
 * rounds: a third not-met stops the group in Problems.
 */
const fixFiles = (id: string): Record<string, string | null> => (id.startsWith("review-fix-") ? { a: `fixed a by ${id}\n` } : { [id]: `${id}\n` });

describe("a not-met review opens a fix task in the same group (tester follow-up G §3.4)", () => {
  it("inherits the traced task's agent, grant and policy when its id sorts after an integration task", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a-integration", dependsOn: ["z-core"], targetPaths: ["integration"], perAttemptTimeoutMs: 60_000,
        safetyPolicy: { allowlistPaths: ["integration-only"], denylistPaths: ["a-denied"] }, requiredChecks: ["true"] },
      { taskId: "z-core", targetPaths: ["core"], agent: { agent: "claude" }, perAttemptTimeoutMs: 45_000, tokenBudget: 50_000,
        safetyPolicy: { allowlistPaths: ["core-only"], denylistPaths: ["z-denied"] }, requiredChecks: ["true"] },
    ], harness: { files: (id) => ({ [id === "a-integration" ? "integration" : "core"]: `${id}\n` }) },
    answer: () => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null }], summary: "core needs work",
    } }) });
    try {
      w.t.h.store.transaction(() => {
        const row = w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
        const body = JSON.parse(String(row.body));
        body.requirement.acceptedDraftNo = 1;
        w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
        writeDraft(w.t.h.store, "g", { ...newDraft(1, 0), state: "accepted", output: { notes: "", tasks: [
          { taskId: "a-integration", title: "integration", labels: [], goal: "integrate", successCondition: "passes", targetPaths: ["integration"], checks: ["true"], dependsOn: ["z-core"], traces: ["AC2"] },
          { taskId: "z-core", title: "core", labels: [], goal: "build", successCondition: "passes", targetPaths: ["core"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
        ] } });
      });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      const fix = readWork(w.t.h.store, "g", "review-fix-1");
      // Mutation: selecting plan.tasks[0] inherits a-integration, despite AC1 tracing z-core.
      expect(frozenWorkAgent(fix).agent.agent).toBe("claude");
      expect(fix.grant.work).toEqual(readWork(w.t.h.store, "g", "z-core").grant.work);
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract;
      expect(contract.executionPolicy.perAttemptTimeoutMs).toBe(45_000);
      expect(contract.context.targetPaths).toEqual(["core"]);
      expect(contract.verification.requiredChecks).toEqual(acceptanceCommands(w.t.h.store, "g").checks);
      // The policy comes from the source, while the allow/deny lists stay the group's union.
      expect(contract.safetyPolicy.allowlistPaths).toEqual(["integration-only", "core-only", "core"]);
      expect(contract.safetyPolicy.denylistPaths).toEqual(["a-denied", "z-denied"]);
      expect(readArchivedContract(w.t.h.store, "g", "a-integration").contract.executionPolicy.perAttemptTimeoutMs).toBe(60_000);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("chooses the authored first source when two tasks trace the same unmet criterion", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a-integration", targetPaths: ["integration"] },
      { taskId: "z-core", targetPaths: ["core"], agent: { agent: "claude" } },
    ], harness: { files: (id) => ({ [id === "a-integration" ? "integration" : "core"]: `${id}\n` }) },
    answer: () => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null }], summary: "core needs work",
    } }) });
    try {
      w.t.h.store.transaction(() => {
        const body = JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
        body.requirement.acceptedDraftNo = 1;
        w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
        writeDraft(w.t.h.store, "g", { ...newDraft(1, 0), state: "accepted", output: { notes: "", tasks: [
          { taskId: "z-core", title: "core", labels: [], goal: "build", successCondition: "passes", targetPaths: ["core"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
          { taskId: "a-integration", title: "integration", labels: [], goal: "integrate", successCondition: "passes", targetPaths: ["integration"], checks: ["true"], dependsOn: [], traces: ["AC1", "AC2"] },
        ] } });
      });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      expect(frozenWorkAgent(readWork(w.t.h.store, "g", "review-fix-1")).agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("picks the task that traces more of the unmet criteria", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a-integration", targetPaths: ["integration"] },
      { taskId: "z-core", targetPaths: ["core"], agent: { agent: "claude" } },
    ], harness: { files: (id) => ({ [id === "a-integration" ? "integration" : "core"]: `${id}\n` }) },
    answer: () => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete" },
        { id: "AC2", verdict: "not-met", evidence: [{ path: "core", line: 2 }], missing: "core lacks tests" }], summary: "core needs work",
    } }) });
    try {
      w.t.h.store.transaction(() => {
        const body = JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
        body.requirement.acceptedDraftNo = 1;
        w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
        writeDraft(w.t.h.store, "g", { ...newDraft(1, 0), state: "accepted", output: { notes: "", tasks: [
          { taskId: "a-integration", title: "integration", labels: [], goal: "integrate", successCondition: "passes", targetPaths: ["integration"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
          { taskId: "z-core", title: "core", labels: [], goal: "build", successCondition: "passes", targetPaths: ["core"], checks: ["true"], dependsOn: [], traces: ["AC1", "AC2"] },
        ] } });
      });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      expect(frozenWorkAgent(readWork(w.t.h.store, "g", "review-fix-1")).agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a requirement without a stored draft inherits the dependency root instead of the alphabetical first task", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a-integration", dependsOn: ["z-core"], targetPaths: ["integration"] },
      { taskId: "z-core", targetPaths: ["core"], agent: { agent: "claude" } },
    ], harness: { files: (id) => ({ [id === "a-integration" ? "integration" : "core"]: `${id}\n` }) },
    answer: () => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null }], summary: "core needs work",
    } }) });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      expect(frozenWorkAgent(readWork(w.t.h.store, "g", "review-fix-1")).agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a not-met round opens one fix task covering every unmet criterion, and the review runs again after it lands", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "not-met" }), verdicts({ AC1: "met", AC2: "met" })];
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      const fixes = w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all().map((r) => String(r.id));
      // mutation M9a: one fix task per criterion -> two tasks, red
      expect(fixes).toEqual(["review-fix-1"]);
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract;
      expect(contract.objective.goal).toContain("AC1");
      expect(contract.objective.goal).toContain("AC2");
      expect(contract.context.targetPaths).toEqual(["a", "b"]);
      // the fix task's checks are the group's union of required checks
      expect(contract.verification.requiredChecks).toEqual(acceptanceCommands(w.t.h.store, "g").checks);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(w.review()).toMatchObject({ autoFixRounds: 1, rounds: [expect.objectContaining({ result: "not-met", fixTaskId: "review-fix-1", fixBy: "auto" }), expect.objectContaining({ result: "passed" })] });
      expect(git(w.t.repo, "show", "refs/heads/orca/g:a")).toBe("fixed a by review-fix-1");
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  // Follow-up L (dogfood g-28d9b560): in an expectation-model group (optional-v1, a task's work grant has no token
  // number) the fix task was appended with tokens 0, which deriveContract refuses, so no fix task could ever open -- the
  // automatic round stopped `failed` and `review-fix` answered a bare recovery-blocked:review-fix.
  it("opens the fix task in an expectation-model group, whose tasks' work grants carry no token number", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "met" }), verdicts({ AC1: "met", AC2: "met" })];
    const w = await reviewWorld({ tasks: [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }] as never,
      harness: { files: fixFiles, tokenPolicy: "optional-v1" }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    try {
      const grantTokens = (id: string) => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).grant.work.tokens;
      expect(grantTokens("a")).toBeNull();
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1 });
      // the fix task is funded like its siblings: no token number, the expectation model's grant
      expect(grantTokens("review-fix-1")).toBeNull();
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(git(w.t.repo, "show", "refs/heads/orca/g:a")).toBe("fixed a by review-fix-1");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("the third not-met round stops the group in Problems", async () => {
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: verdicts({ AC1: "not-met", AC2: "met" }) }) });
    try {
      for (let i = 0; i < 4 && w.review()?.state !== "not-passed"; i += 1) {
        const before = w.review()?.rounds.length ?? 0;
        await w.runAll();
        await w.t.until(w.driver, () => (w.review()?.rounds.length ?? 0) > before && w.review()?.state !== "reviewing", 120);
      }
      // mutation M9b: `<=` for `<` on the bound -> a third fix task, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "rounds-exhausted", autoFixRounds: 2 });
      expect(w.review()!.rounds.map((r) => r.fixTaskId ?? null)).toEqual(["review-fix-1", "review-fix-2", null]);
      expect(w.t.h.store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").get()!.n).toBe(2);
      expect(w.groupStatus()).not.toBe("done");
    } finally { await w.t.h.dispose(); }
  }, 600000);
});
