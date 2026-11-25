import { describe, expect, it } from "vitest";
import { acceptanceCommands } from "../../src/control/groupAcceptance.js";
import { frozenWorkAgent } from "../../src/control/agentFreeze.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { newDraft, writeDraft } from "../../src/control/requirementRecords.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { git } from "./fixtures/driverHarness.js";
import { CRITERIA, reviewWorld, verdicts } from "./fixtures/reviewWorld.js";
import { autoFixTokenCeiling, classifyReviewOutput, fixTaskContract, fixTaskPaths, requirementReviewResponseSchema } from "../../src/control/requirementReview.js";

/**
 * Tester follow-up G spec §3.4-§3.5 (human: 「自动在同一组里开一个修复任务（把复核的发现当说明）」): a review round with
 * unmet criteria opens one fix task in the same group covering all of them, whose goal is the findings and whose write
 * set is the files the review named; once it lands the group is accepted and reviewed again. At most two automatic
 * rounds: a third not-met stops the group in Problems.
 */
const fixFiles = (id: string): Record<string, string | null> => (id.startsWith("review-fix-") ? { a: `fixed a by ${id}\n` } : { [id]: `${id}\n` });

describe("a not-met review opens a fix task in the same group (tester follow-up G §3.4)", () => {
  it("stops before an automatic fix when the reviewer reports a conflict with a person's no-repair instruction (#322)", async () => {
    const command = "test ! -f base.txt";
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: {
      ...verdicts({ AC1: "not-met", AC2: "met" }),
      checkConflict: { criterionId: "AC1", requiredCheck: command,
        because: "The person forbids repairing an existing failing test, but this check requires that repair." },
    } }) });
    const group = () => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    try {
      const body = group();
      body.requirement.idea = "Deliver only new files; do not repair a pre-existing failing test.";
      w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command } } });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      expect(group().acceptance).toMatchObject({ result: "passed-relative", fullSuite: { command, baseline: { exits: ["1", "1"] } } });
      expect(w.calls[0]?.prompt).toContain("do not repair a pre-existing failing test");
      expect(w.calls[0]?.prompt).toContain("failed at the group's base");
      expect(w.calls[0]?.prompt).toContain("Tip failure:");
      // Ruling: human 2026-11-17 (「这一轮允许改必要的判据」, tester #340) -- why was "cannot-judge" (the round is a
      // definite not-met that conflicts with the person's restriction) and the three facts lived only in the summary.
      // mutation: keep why "cannot-judge" -> red; mutation: drop checkConflict from the round -> red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "check-conflict", autoFixRounds: 0,
        rounds: [expect.objectContaining({ result: "not-met", summary: expect.stringContaining("check conflict"),
          checkConflict: { criterionId: "AC1", requiredCheck: command, because: "The person forbids repairing an existing failing test, but this check requires that repair." } })] });
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all()).toEqual([]);
      expect(group().requirement.idea).toContain("do not repair");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("records a plan-level not-met as left to a person even when another criterion is a check conflict (#502)", async () => {
    const command = "test ! -f base.txt";
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: {
      ...verdicts({ AC1: "not-met", AC2: "not-met" }, { AC1: "plan" }),
      checkConflict: { criterionId: "AC2", requiredCheck: command,
        because: "The person forbids repairing an existing failing test, but this check requires that repair." },
    } }) });
    try {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command } } });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "not-passed" && w.review()?.why === "check-conflict", 120);
      // Tester #502: the conflict branch used to skip settleNotPassed, so AC1 never entered leftToPerson and no next step
      // could change the plan. mutation: skip leftToPerson in the conflict branch -> undefined, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "check-conflict", autoFixRounds: 0,
        rounds: [expect.objectContaining({ result: "not-met", leftToPerson: ["AC1"],
          checkConflict: expect.objectContaining({ criterionId: "AC2" }) })] });
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all()).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("binds a reported check conflict to the acceptance command even when settings change during review (#322)", async () => {
    const command = "test ! -f base.txt";
    let w!: Awaited<ReturnType<typeof reviewWorld>>;
    w = await reviewWorld({ answer: () => {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo")!;
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command: "true" } } });
      return { outcome: "complete", output: { ...verdicts({ AC1: "not-met", AC2: "met" }),
        checkConflict: { criterionId: "AC1", requiredCheck: command, because: "a human instruction forbids repairing the old failure" } } };
    } });
    try {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command } } });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "not-passed" || w.review()?.state === "fixing", 120);
      // Ruling: human 2026-11-17 (tester #340) -- why "check-conflict", not "cannot-judge".
      expect(w.review()).toMatchObject({ state: "not-passed", why: "check-conflict", autoFixRounds: 0,
        rounds: [expect.objectContaining({ result: "not-met", summary: expect.stringContaining("check conflict"), checkConflict: expect.objectContaining({ criterionId: "AC1" }) })] });
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all()).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("leaves out of the fix task's checks the full suite the acceptance found red at the group's base (#322)", async () => {
    // The tester's review-fix-1: its goal was to revert a repair of a test already red at the base, while its contract still
    // required `npm test` -- red before the group began -- so it could only fail and was retried from scratch.
    const suite = "test -n suite";
    const w = await reviewWorld({ tasks: [{ taskId: "a", requiredChecks: ["true", suite] }, { taskId: "b" }] });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      const store = w.t.h.store;
      const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      body.acceptance = { ...body.acceptance, result: "passed-relative", fullSuite: { command: suite, suggestion: null, exits: ["1", "1"], flaky: false, baseline: { tip: "c".repeat(40), exits: ["1", "1"] } } };
      store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      const round = { roundNo: 1, tip: "d".repeat(40), runId: null, at: 0, result: "not-met" as const, summary: "s",
        criteria: [{ id: "AC1", verdict: "not-met" as const, evidence: [{ path: "a", line: 1 }], missing: "revert the repair" }] };
      const contract = fixTaskContract(store, "g", round, CRITERIA, "review-fix-1", "a");
      // mutation: keep the base-red suite in the fix task's checks -> [true, suite], red
      expect(contract.verification.requiredChecks).toEqual(["true"]);
      expect(contract.objective.goal).toContain(`\`${suite}\` already failed at the group's base`);
      // Without a relative acceptance the union stays whole (the case below and every other one).
      body.acceptance = { ...body.acceptance, result: "passed", fullSuite: { command: suite, suggestion: null, exits: ["0"], flaky: false } };
      store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      expect(fixTaskContract(store, "g", round, CRITERIA, "review-fix-1", "a").verification.requiredChecks).toEqual(["true", suite]);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("inherits the traced task's agent, grant and policy when its id sorts after an integration task", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a-integration", dependsOn: ["z-core"], targetPaths: ["integration"], perAttemptTimeoutMs: 60_000,
        safetyPolicy: { allowlistPaths: ["integration-only"], denylistPaths: ["a-denied"] }, requiredChecks: ["true"] },
      { taskId: "z-core", targetPaths: ["core"], agent: { agent: "claude" }, perAttemptTimeoutMs: 45_000, tokenBudget: 50_000,
        safetyPolicy: { allowlistPaths: ["core-only"], denylistPaths: ["z-denied"] }, requiredChecks: ["true"] },
    ], harness: { files: (id) => ({ [id === "a-integration" ? "integration" : "core"]: `${id}\n` }) },
    answer: () => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete", fixableBy: "work" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null, fixableBy: "work" }], summary: "core needs work",
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
      // Ruling: human 2026-11-17 (tester #343) -- this asserted the automatic fix took z-core's work grant whole (3M tokens);
      // an automatic fix's tokens are now capped at twice what its source used, at least 1M (z-core used 10): every other
      // dimension is still z-core's. mutation: inherit a-integration's grant -> red only if they differ (kept from before).
      const source = readWork(w.t.h.store, "g", "z-core").grant.work;
      expect(fix.grant.work).toEqual({ ...source, tokens: autoFixTokenCeiling(10, source.tokens) });
      expect(fix.grant.work.tokens).toBe(1_000_000);
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
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete", fixableBy: "work" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null, fixableBy: "work" }], summary: "core needs work",
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
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete", fixableBy: "work" },
        { id: "AC2", verdict: "not-met", evidence: [{ path: "core", line: 2 }], missing: "core lacks tests", fixableBy: "work" }], summary: "core needs work",
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
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "core", line: 1 }], missing: "core is incomplete", fixableBy: "work" },
        { id: "AC2", verdict: "met", evidence: [{ path: "integration", line: 1 }], missing: null, fixableBy: "work" }], summary: "core needs work",
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
    // Task a (the fix's source) used 700,000 tokens: the automatic fix's ceiling is twice that.
    const w = await reviewWorld({ tasks: [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }] as never,
      harness: { files: fixFiles, tokenPolicy: "optional-v1", workTokens: (id) => (id === "a" ? 700_000 : 10) }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    try {
      const grantTokens = (id: string) => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).grant.work.tokens;
      expect(grantTokens("a")).toBeNull();
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1 });
      // Ruling: human 2026-11-17 (tester #343) -- this asserted the fix task's grant had no token number, like its siblings;
      // an uncapped automatic fix burned 48M tokens on a criterion no file change could meet. It now carries a ceiling of
      // twice its source's used tokens (at least 1M). mutation: drop the cap in openFixTask -> null, red
      expect(grantTokens("review-fix-1")).toBe(1_400_000);
      expect(readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract.executionPolicy.tokenBudget).toBe(1_400_000);
      await w.runAll();
      // The number ccloop stops a phase at (#225): the dispatched contract's executionPolicy.tokenBudget.
      const sent = w.t.fake.calls.accept.find((envelope) => envelope.claim.workItemId === "review-fix-1");
      expect((sent?.work as { contract?: { executionPolicy?: { tokenBudget?: unknown } } } | undefined)?.contract?.executionPolicy?.tokenBudget).toBe(1_400_000);
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(git(w.t.repo, "show", "refs/heads/orca/g:a")).toBe("fixed a by review-fix-1");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("an answer that does not say who can meet a criterion is invalid, like any schema miss (#343)", () => {
    const answer = verdicts({ AC1: "not-met", AC2: "met" });
    const { fixableBy: _dropped, ...without } = answer.criteria[0]!;
    // mutation: make fixableBy optional in the answer schema -> not-met, red
    expect(classifyReviewOutput({ ...answer, criteria: [without, answer.criteria[1]] }, CRITERIA.map((c) => c.id))).toEqual({ result: "invalid", reason: "schema:criteria.0.fixableBy" });
    expect(classifyReviewOutput({ ...answer, criteria: [{ ...without, fixableBy: "someone" }, answer.criteria[1]] }, CRITERIA.map((c) => c.id))).toMatchObject({ result: "invalid" });
    // The JSON schema the call is given requires it too.
    const items = (requirementReviewResponseSchema.properties as { criteria: { items: { required: string[] } } }).criteria.items;
    expect(items.required).toContain("fixableBy");
    expect(classifyReviewOutput(answer, CRITERIA.map((c) => c.id))).toMatchObject({ result: "not-met", criteria: [expect.objectContaining({ fixableBy: "work" }), expect.anything()] });
  });

  it("an automatic fix's token ceiling: twice the source's used tokens, at least 1M, never above the source's grant (#343)", () => {
    // mutation: drop the 1M floor -> 20, red; mutation: 1x for 2x -> 700,000, red; mutation: ignore the source grant -> 1M, red
    expect(autoFixTokenCeiling(10, null)).toBe(1_000_000);
    expect(autoFixTokenCeiling(700_000, null)).toBe(1_400_000);
    expect(autoFixTokenCeiling(10, 50_000)).toBe(50_000);
  });

  it("opens no fix task when every not-met criterion is one only the plan or the person can meet (#343)", async () => {
    // An expectation-model group (no token number on a task's grant), so a person's fix below shows it is not capped.
    const w = await reviewWorld({ tasks: [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }] as never, harness: { tokenPolicy: "optional-v1" },
      answer: () => ({ outcome: "complete", output: verdicts({ AC1: "not-met", AC2: "not-met" }, { AC1: "plan", AC2: "person" }) }) });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      // mutation: settleNotPassed ignores fixableBy -> fixing with review-fix-1, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "not-fixable-by-work", autoFixRounds: 0,
        rounds: [expect.objectContaining({ result: "not-met", leftToPerson: ["AC1", "AC2"] })] });
      expect(w.review()!.rounds[0]!.fixTaskId).toBeUndefined();
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all()).toEqual([]);
      // mutation: drop the fixableBy definitions from buildReviewPrompt -> red
      expect(w.calls[0]?.prompt).toContain("\"plan\" when it is about the accepted plan itself");
      expect(w.groupStatus()).not.toBe("done");
      // A person's review-fix is unchanged: every not-met criterion, and the source's grant as it is (no token number here).
      expect(w.t.service.reviewFix(w.t.h.command("review-fix", { goal: "do what the person decided" }))).toMatchObject({ result: { kind: "review-fix-opened", taskId: "review-fix-1" } });
      // mutation: cap a person's fix too (openFixTask without the `auto` test) -> 1,000,000, red
      expect(readWork(w.t.h.store, "g", "review-fix-1").grant.work.tokens).toBeNull();
      expect(readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract.objective.successCondition).toBe("the requirement review finds criteria AC1, AC2 met");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("an automatic fix covers only the criteria changing files can meet and records the rest as left to the person (#343)", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: verdicts({ AC1: "not-met", AC2: "not-met" }, { AC2: "plan" }) }) });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all().map((r) => String(r.id))).toEqual(["review-fix-1"]);
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract;
      // mutation: openFixTask keeps every not-met criterion for an automatic fix -> AC2 and b in it, red
      expect(contract.objective.goal).toContain("AC1");
      expect(contract.objective.goal).not.toContain("AC2");
      expect(contract.objective.successCondition).toBe("the requirement review finds criteria AC1 met");
      expect(contract.context.targetPaths).toEqual(["a"]);
      // mutation: drop the stop-and-report line from fixTaskContract -> red
      expect(contract.objective.goal).toContain("If a criterion cannot be met by changing files, stop and report it in `decisions` instead of trying.");
      // mutation: do not record leftToPerson -> red
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1,
        rounds: [expect.objectContaining({ fixTaskId: "review-fix-1", fixBy: "auto", leftToPerson: ["AC2"] })] });
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("reviews the fix on its new tip when group acceptance fails, without waiving the failure", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "met" }), verdicts({ AC1: "met", AC2: "met" })];
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    const group = () => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      // #314: review no longer waits for the acceptance pass to settle, so wait for the record itself here.
      await w.t.until(w.driver, () => group().acceptance !== undefined, 120);
      expect(group().acceptance.result).toBe("passed");
      const oldTip = git(w.t.repo, "rev-parse", "refs/heads/orca/g");
      // The configured full suite is red on the fix tip; task checks still pass.
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command: "test ! -f a" } } });
      await w.runAll();
      const newTip = git(w.t.repo, "rev-parse", "refs/heads/orca/g");
      expect(newTip).not.toBe(oldTip);
      await w.t.until(w.driver, () => group().acceptance?.tip === newTip && group().acceptance?.result === "failed", 120);
      expect(group().acceptance.waived).toBeUndefined();
      // Mutation #312: put acceptanceSatisfied ahead of the fixing/roundDue exception -> this never settles round 2.
      for (let i = 0; i < 40 && w.review()?.rounds.length !== 2; i += 1) await w.driver.round();
      expect(w.review()?.rounds).toHaveLength(2);
      expect(w.review()).toMatchObject({ state: "passed", rounds: [expect.objectContaining({ fixTaskId: "review-fix-1", tip: oldTip }),
        expect.objectContaining({ roundNo: 2, tip: newTip, result: "passed" })] });
      expect(w.calls).toHaveLength(2);
      expect(w.groupStatus()).not.toBe("done");
      expect(group().acceptance).toMatchObject({ result: "failed", tip: newTip });
    } finally { await w.t.h.dispose(); }
  }, 300000);

  // Ruling: #314 (human 2026-11-15 「开始吧，按这个顺序做」). This criterion used to encode the opposite: acceptance truly
  // failing meant no review call at all. Acceptance and review are two gates that both decide `done`, so the failing tip is
  // reviewed and the group still stays out of done -- the deadlock the tester reported (8/8 done, acceptance failed,
  // requirementReview absent, every command refused).
  it("starts an initial review even when group acceptance truly fails (#314)", async () => {
    const w = await reviewWorld();
    const group = () => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    try {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1,
        checks: { ...settings.checks, integrationCheck: { command: "test ! -f a" } } });
      await w.runAll();
      await w.t.until(w.driver, () => group().acceptance?.result === "failed", 120);
      await w.t.until(w.driver, () => w.review() !== null, 120);
      await w.t.until(w.driver, () => w.calls.some((call) => call.purpose === "requirement-review"), 120);
      expect(w.calls.some((call) => call.purpose === "requirement-review")).toBe(true);
      expect(w.groupStatus()).not.toBe("done");
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

/**
 * Tester #352 (session 2026-11-18, controller rulings): the review's evidence for "path X is absent" is the OLD file, so a
 * fix task whose write set came only from evidence could not write X and its correct work was discarded on an allowlist
 * miss; and the review's pseudo-evidence (`orca:acceptance`, ...) became writable paths. Paths named in a not-met
 * criterion's `missing` text now come first, then the evidence's; `orca:` evidence never enters the write set.
 */
describe("the fix task's write set takes the paths a finding says are missing (#352)", () => {
  const unmet = (missing: string | null, evidence: string[]) => ({ missing, evidence: evidence.map((path) => ({ path, line: null })) });

  it("reads backticked tokens and bare path-like tokens from missing, in text order, trailing punctuation stripped", () => {
    // mutation: drop the backtick branch -> README.md missing, red; drop the bare branch -> src/sla/clock.js missing, red
    // mutation: keep trailing punctuation -> "src/sla/clock.js," red
    expect(fixTaskPaths([unmet("The required module path `src/sla/breach.js` is absent; behaviour lives in src/sla-breach.js. Also src/sla/clock.js, and `README.md`.", ["src/sla-breach.js"])]))
      // The old flat file the text names is writable too: moving it away needs it.
      .toEqual(["src/sla/breach.js", "src/sla-breach.js", "src/sla/clock.js", "README.md"]);
  });

  it("takes a token ending in `/` as that directory's `/**`, and refuses tokens of an illegal shape", () => {
    // mutation: drop the trailing-slash branch -> src/sla/** missing, red
    expect(fixTaskPaths([unmet("Create src/sla/ for the modules.", [])])).toEqual(["src/sla/**"]);
    // mutation: drop the shape check (pathShapeOk) -> /abs/x.js, ../up/x.js, a//b.js, `**` and src/*.js taken, red
    // (`npm test` is refused before the shape check: it is not path-like -- see the next test)
    expect(fixTaskPaths([unmet("Not /abs/x.js nor ../up/x.js nor a//b.js nor `npm test` nor `**` nor src/*.js nor https://example.com/x.js; a ratio 1/2.5 is no path.", [])])).toEqual([]);
    // Bare words without a slash or an extension are prose, not paths.
    expect(fixTaskPaths([unmet("The module is missing entirely.", [])])).toEqual([]);
  });

  // Fix round 1 (review of #352, Important 1): a path glued to CJK text, or wrapped in full-width or curly punctuation,
  // was not found -- the tokens were whitespace-separated words.
  it("finds a path glued to CJK text or wrapped in full-width or curly punctuation", () => {
    // mutation: tokenise on whitespace again -> each red
    expect(fixTaskPaths([unmet("缺少 src/sla/model.js，行为在 src/sla-model.js。", [])])).toEqual(["src/sla/model.js", "src/sla-model.js"]);
    expect(fixTaskPaths([unmet("需要的模块路径src/sla/model.js不存在", [])])).toEqual(["src/sla/model.js"]);
    expect(fixTaskPaths([unmet("（src/sla/model.js）缺失", [])])).toEqual(["src/sla/model.js"]);
    expect(fixTaskPaths([unmet("“src/sla/model.js” is absent", [])])).toEqual(["src/sla/model.js"]);
  });

  // Fix round 1 (Important 2, controller ruling narrowing ruling 2): a backticked token is a path only when it looks like
  // one, as a bare token must; Minors 3 and 4: no `.git` segment and no segment starting with `-`.
  it("takes a backticked token only when it is path-like, and refuses `.git` and `-` segments", () => {
    // mutation: accept any backticked token of a legal shape -> breach(), parseConfig, test:sla, src/a.ts:12 taken, red
    // mutation: drop only the backtick character check -> src/a.ts:12 taken (it has a `/`), red
    expect(fixTaskPaths([unmet("Run `--json`, call `breach()`, see `parseConfig`, `test:sla` and `src/a.ts:12`; write `README.md`.", [])])).toEqual(["README.md"]);
    // `npm test` has neither a `/` nor an extension, so path-likeness refuses it (the character check would too).
    expect(fixTaskPaths([unmet("Run `npm test` again.", [])])).toEqual([]);
    // mutation: drop the .git refusal -> .git/hooks/pre-commit.sh and `.git/config.x` taken, red
    expect(fixTaskPaths([unmet("Do not touch .git/hooks/pre-commit.sh or `.git/config.x`.", [])])).toEqual([]);
    // mutation: drop the leading-dash refusal -> src/-x.js and `--out/x.js` taken, red
    expect(fixTaskPaths([unmet("Not src/-x.js nor `--out/x.js`.", [])])).toEqual([]);
  });

  it("never writes `orca:` pseudo-evidence, and orders missing paths before evidence paths across criteria, deduplicated", () => {
    // mutation: drop the orca: filter -> orca:acceptance / orca:delivery / orca:delivered-acceptance kept, red
    // mutation: evidence before missing -> order red
    expect(fixTaskPaths([
      unmet("`src/sla/model.js` is absent", ["orca:acceptance", "src/sla-model.js"]),
      unmet("`src/sla/clock.js` is absent; `orca:delivery` says so", ["orca:delivered-acceptance", "src/sla-clock.js", "src/sla-model.js"]),
      unmet(null, ["orca:delivery"]),
    ])).toEqual(["src/sla/model.js", "src/sla/clock.js", "src/sla-model.js", "src/sla-clock.js"]);
  });

  it("puts the missing paths into the contract's targetPaths and allowlist; a person's --path still wins", async () => {
    const w = await reviewWorld({ tasks: [
      { taskId: "a", safetyPolicy: { allowlistPaths: ["a"], denylistPaths: [] } },
      { taskId: "b", safetyPolicy: { allowlistPaths: ["b"], denylistPaths: [] } },
    ] });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      const round = { roundNo: 1, tip: "d".repeat(40), runId: null, at: 0, result: "not-met" as const, summary: "s",
        criteria: [{ id: "AC1", verdict: "not-met" as const, evidence: [{ path: "a", line: 1 }, { path: "orca:acceptance", line: null }],
          missing: "The required module path `src/sla/breach.js` is absent; the behaviour is in a." }] };
      const contract = fixTaskContract(w.t.h.store, "g", round, CRITERIA, "review-fix-1", "a");
      // The tester's loop-contract.json had ["a", "orca:acceptance"] here and an allowlist without src/sla/breach.js.
      expect(contract.context.targetPaths).toEqual(["src/sla/breach.js", "a"]);
      expect(contract.safetyPolicy.allowlistPaths).toEqual(["a", "b", "src/sla/breach.js"]);
      expect(fixTaskContract(w.t.h.store, "g", round, CRITERIA, "review-fix-1", "a", "g", ["notes/x.md"]).context.targetPaths).toEqual(["notes/x.md"]);
      // Fix round 1 (Important 2): with every evidence entry `orca:` and no path in missing, the write set falls back to
      // the tasks' targetPaths, as before #352 -- never to an empty one.
      // mutation: drop the fallback to the tasks' union -> [] (taskContractSchema refuses an empty targetPaths), red
      const recordsOnly = { ...round, criteria: [{ id: "AC1", verdict: "not-met" as const, evidence: [{ path: "orca:acceptance", line: null }, { path: "orca:delivery", line: null }],
        missing: "the acceptance command still fails" }] };
      const union = [...new Set(["a", "b"].flatMap((id) => readArchivedContract(w.t.h.store, "g", id).contract.context.targetPaths))];
      expect(union.length).toBeGreaterThan(0);
      expect(fixTaskContract(w.t.h.store, "g", recordsOnly, CRITERIA, "review-fix-1", "a").context.targetPaths).toEqual(union);
    } finally { await w.t.h.dispose(); }
  }, 180000);
});
