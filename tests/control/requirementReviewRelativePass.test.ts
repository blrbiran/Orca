import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { relativePasses } from "../../src/control/requirementReview.js";
import type { CriterionVerdict } from "../../src/control/requirementReviewRecord.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { reviewLines } from "../../src/commands/domains/verbs.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";

/**
 * Tester #377 (human ruling, session 3ba26002: 「同意」 -- a not-met criterion that fails only because the repository was
 * already red at the group's base is a relative pass: the group carries a visible note and reaches done; it does not stop
 * for a person). Code decides from Orca's records, not the model (Rule 5); the rule is the follow-up G spec's Correction
 * of 2026-11-19. Every other not-met criterion keeps today's path.
 */
const TIP = "4".repeat(40), BASE = "b".repeat(40);
const acceptance = (over: Record<string, unknown> = {}, suite: Record<string, unknown> = {}) => ({
  tip: TIP, result: "passed-relative", at: 1, tail: "1 failing",
  commands: [{ command: "setup: npm ci", exit: "0", ms: 1 }, { command: "node --test test/login.test.js", exit: "0", ms: 1 },
    { command: "npm test", exit: "1", ms: 1 }, { command: "npm test", exit: "1", ms: 1 },
    { command: "baseline: npm test", exit: "1", ms: 1 }, { command: "baseline: npm test", exit: "1", ms: 1 }],
  fullSuite: { command: "npm test", suggestion: null, exits: ["1", "1"], flaky: false, baseline: { tip: BASE, exits: ["1", "1"], tail: "1 failing" }, ...suite },
  ...over,
});
const AC9: CriterionVerdict = { id: "AC9", verdict: "not-met", evidence: [{ path: "orca:acceptance", line: null }],
  missing: "npm test must exit 0 at the reviewed tip; Orca records it exiting 1 on the tip (and the base also exits 1)", fixableBy: "work" };
const AC1: CriterionVerdict = { id: "AC1", verdict: "met", evidence: [{ path: "src/login.js", line: 3 }], missing: null, fixableBy: "work" };
const TEXTS = [{ id: "AC1", text: "login works" }, { id: "AC9", text: "npm test exit 0" }];
const PASS = [{ criterionId: "AC9", command: "npm test", tipExits: ["1", "1"], baseExits: ["1", "1"] }];

/** The same red-at-base acceptance for another suite command (its tip and base runs named by it). */
const acceptanceFor = (command: string) => {
  const a = acceptance({}, { command });
  return { ...a, commands: a.commands.map((c) => ({ ...c, command: c.command.replace("npm test", command) })) };
};
const passesFor = (command: string, text: string) => relativePasses({ acceptance: acceptanceFor(command) }, TIP, [AC9], [{ id: "AC9", text }]);

describe("which not-met criterion is a relative pass (#377)", () => {
  // Review of #377 (I1): the criterion must name the suite's command as a whole -- not a longer command it is a part of,
  // and not the command with further arguments.
  it("the criterion names the suite command as a whole, not a longer command or the command with arguments", () => {
    // mutation: match the command by substring -> each of these four passes, red
    expect(passesFor("npm run test", "`npm run test:e2e` exits 0")).toEqual([]);
    expect(passesFor("pytest", "`pytest tests/test_login.py` passes")).toEqual([]);
    expect(passesFor("npm test", "`npm test -- test/login.test.js` exits 0")).toEqual([]);
    expect(passesFor("npm test", "pnpm test exits 0")).toEqual([]);
    // The whole command, bare, backticked, at the end of a sentence or in Chinese words, still qualifies.
    for (const text of ["npm test exit 0", "`npm test` exits 0", "The suite passes: npm test.", "`npm test` 退出码为 0", "npm test"]) {
      expect(passesFor("npm test", text)).toHaveLength(1);
    }
    expect(passesFor("npm run test", "`npm run test` exits 0")).toHaveLength(1);
  });

  it("the tester's AC9: its only evidence is the acceptance record, its text names the suite, the suite was red at the base too", () => {
    expect(relativePasses({ acceptance: acceptance() }, TIP, [AC1, AC9], TEXTS)).toEqual(PASS);
    // A person's `relative` answer to the pre-existing failure leaves the rule to apply.
    expect(relativePasses({ acceptance: acceptance(), preexistingFailureAnswers: { "npm test": { answer: "relative", by: "user:o", at: 1 } } }, TIP, [AC9], TEXTS)).toEqual(PASS);
  });

  it("not when the reviewer pointed at a delivered file, or at no evidence", () => {
    // mutation: drop the every-evidence-is-orca:acceptance test -> PASS, red
    expect(relativePasses({ acceptance: acceptance() }, TIP, [{ ...AC9, evidence: [{ path: "orca:acceptance", line: null }, { path: "README.md", line: null }] }], TEXTS)).toEqual([]);
    // mutation: drop the non-empty evidence test -> PASS, red
    expect(relativePasses({ acceptance: acceptance() }, TIP, [{ ...AC9, evidence: [] }], TEXTS)).toEqual([]);
  });

  it("not when the criterion's agreed text does not name the suite's command", () => {
    // mutation: drop the criterion-text test -> PASS, red
    expect(relativePasses({ acceptance: acceptance() }, TIP, [AC9], [{ id: "AC9", text: "the session tests pass" }])).toEqual([]);
  });

  it("only a not-met verdict", () => {
    expect(relativePasses({ acceptance: acceptance() }, TIP, [{ ...AC9, verdict: "cannot-judge" }], TEXTS)).toEqual([]);
  });

  it("not unless the acceptance is passed-relative on the reviewed tip, with a suite command and a base run", () => {
    // mutation: drop the tip test -> PASS, red
    expect(relativePasses({ acceptance: acceptance({ tip: "5".repeat(40) }) }, TIP, [AC9], TEXTS)).toEqual([]);
    // mutation: drop the passed-relative test -> PASS, red
    expect(relativePasses({ acceptance: acceptance({ result: "failed" }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({ acceptance: acceptance({}, { baseline: undefined }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({ acceptance: acceptance({}, { command: null }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({}, TIP, [AC9], TEXTS)).toEqual([]);
  });

  it("not when the tip's suite failed differently from the base (a timeout, another exit code) or the base passed once", () => {
    // mutation: compare only "non-zero" instead of "an exit the base also gave" -> PASS, red
    expect(relativePasses({ acceptance: acceptance({}, { exits: ["timeout 600000 ms", "timeout 600000 ms"] }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({ acceptance: acceptance({}, { exits: ["2", "2"] }) }, TIP, [AC9], TEXTS)).toEqual([]);
    // mutation: drop the every-base-exit-is-red test -> PASS, red
    expect(relativePasses({ acceptance: acceptance({}, { baseline: { tip: BASE, exits: ["1", "0"] } }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({ acceptance: acceptance({}, { exits: [] }) }, TIP, [AC9], TEXTS)).toEqual([]);
    // Review of #377 (M5): an exit that is not a number (a timeout) never qualifies, even when the base gave the same one.
    const timedOut = "timeout 600000 ms";
    // mutation: drop the numeric-exit test -> PASS for two timeouts, red
    expect(relativePasses({ acceptance: acceptance({}, { exits: [timedOut, timedOut], baseline: { tip: BASE, exits: [timedOut, timedOut] } }) }, TIP, [AC9], TEXTS)).toEqual([]);
    expect(relativePasses({ acceptance: acceptance({}, { exits: ["1", "1"], baseline: { tip: BASE, exits: ["1", timedOut] } }) }, TIP, [AC9], TEXTS)).toEqual([]);
  });

  it("not when anything other than the suite was red on the tip", () => {
    const commands = acceptance().commands.map((c) => (c.command === "node --test test/login.test.js" ? { ...c, exit: "1" } : c));
    // mutation: drop the other-commands-green test -> PASS, red
    expect(relativePasses({ acceptance: acceptance({ commands }) }, TIP, [AC9], TEXTS)).toEqual([]);
  });

  it("not when a person asked for the pre-existing failure to be repaired (allow-fix)", () => {
    // mutation: drop the allow-fix test -> PASS, red
    expect(relativePasses({ acceptance: acceptance(), preexistingFailureAnswers: { "npm test": { answer: "allow-fix", by: "user:o", at: 1 } } }, TIP, [AC9], TEXTS)).toEqual([]);
  });
});

describe("a relative pass in a review round (#377)", () => {
  // The fixture repository has base.txt at the group's base, so this suite is red at the base and on the tip.
  const SUITE = "test ! -f base.txt";
  const CRITERIA = [{ id: "AC1", text: "a.txt says hello" }, { id: "AC2", text: `\`${SUITE}\` exits 0` }];
  const ac2 = { id: "AC2", verdict: "not-met", evidence: [{ path: "orca:acceptance", line: null }], missing: "the suite exits 1 on the tip (and at the base)", fixableBy: "work" };
  const withSuite = (w: Awaited<ReturnType<typeof reviewWorld>>) => {
    const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
    writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1, checks: { ...settings.checks, integrationCheck: { command: SUITE } } });
  };
  const fixes = (w: Awaited<ReturnType<typeof reviewWorld>>) => w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all().map((r) => String(r.id));

  it("passes the review with a note and lets the group reach done, opening no fix (the tester's group)", async () => {
    const w = await reviewWorld({ criteria: CRITERIA, answer: () => ({ outcome: "complete", output: { summary: "AC2 is red",
      criteria: [{ id: "AC1", verdict: "met", evidence: [{ path: "a", line: 1 }], missing: null, fixableBy: "work" }, ac2] } }) });
    try {
      withSuite(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "not-passed" || w.review()?.state === "fixing", 120);
      // mutation: do not apply relativePasses in completeInTransaction -> fixing with review-fix-1, red
      expect(w.review()).toMatchObject({ state: "passed", autoFixRounds: 0, rounds: [expect.objectContaining({ result: "passed",
        relativePass: [{ criterionId: "AC2", command: SUITE, tipExits: ["1", "1"], baseExits: ["1", "1"] }] })] });
      // The reviewer's answer is kept as it was given.
      expect(w.review()!.rounds[0]!.criteria[1]).toMatchObject({ id: "AC2", verdict: "not-met" });
      expect(fixes(w)).toEqual([]);
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
      // The summary the views read carries it, through the strict read schema.
      const summary = readGroupSummary(w.t.h.store, "g");
      // mutation: drop relativePass from webProtocol's round schema -> false, red
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      expect(summary.requirementReview?.rounds[0]?.relativePass).toEqual([{ criterionId: "AC2", command: SUITE, tipExits: ["1", "1"], baseExits: ["1", "1"] }]);
      // mutation: drop the relative-pass lines from reviewLines -> red
      expect(reviewLines("g", w.review() as never)).toEqual([`review: passed on ${w.review()!.rounds[0]!.tip.slice(0, 12)} (round 1)`,
        `  AC2 relative pass: \`${SUITE}\` exited 1, 1 on this tip and 1, 1 at the group's base -- red before the group; not counted as not met`]);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("a round with another not-met criterion opens a fix for that one only, and still records the relative pass", async () => {
    const w = await reviewWorld({ criteria: CRITERIA, answer: () => ({ outcome: "complete", output: { summary: "two",
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a.txt does not say hello", fixableBy: "work" }, ac2] } }) });
    try {
      withSuite(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "not-passed" || w.review()?.state === "fixing", 120);
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1, rounds: [expect.objectContaining({ result: "not-met", fixTaskId: "review-fix-1",
        relativePass: [expect.objectContaining({ criterionId: "AC2" })] })] });
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract;
      // mutation: keep relative passes in the automatic fix's scope -> AC2 in the goal, red
      expect(contract.objective.goal).toContain("AC1");
      expect(contract.objective.goal).not.toContain("AC2");
      expect(contract.objective.successCondition).toBe("the requirement review finds criteria AC1 met");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("a relative pass is not left to the person, whatever the reviewer said could meet it", async () => {
    const w = await reviewWorld({ criteria: CRITERIA, answer: () => ({ outcome: "complete", output: { summary: "two",
      criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a.txt does not say hello", fixableBy: "work" }, { ...ac2, fixableBy: "person" }] } }) });
    try {
      withSuite(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "not-passed" || w.review()?.state === "fixing", 120);
      expect(w.review()).toMatchObject({ state: "fixing", rounds: [expect.objectContaining({ fixTaskId: "review-fix-1", relativePass: [expect.objectContaining({ criterionId: "AC2" })] })] });
      // mutation: count relative passes among settleNotPassed's not-met criteria -> leftToPerson ["AC2"], red
      expect(w.review()!.rounds[0]!.leftToPerson).toBeUndefined();
    } finally { await w.t.h.dispose(); }
  }, 300000);
});
