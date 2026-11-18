/**
 * Pre-existing failures spec 2026-11-18 L2 (#341): every loop plan v4 contract asks the agent to report a required check
 * that already fails before its change as a major decision whose question starts with `Pre-existing failure:` followed by
 * the command. Orca reads only that marker (Rule 5: a string Orca defines, never a reading of free text), records one
 * `preexisting-failure` activity row per command when the run's terminal is collected -- whether it lands or not -- and
 * shows one problem row per command on the group, with every reporting task and L3's red-at-base answer as a second
 * source. A person's answer (allow the fix / judge it relative to the base / edit the requirement) is recorded and told to
 * the requirement review in "What Orca recorded beyond the diff".
 *
 * Named mutations (each seen red in a `git clone --local` copy, Rule 9) are written beside the assertion they turn red.
 */
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { expandLoopPlan, expandRecipe, PREEXISTING_FAILURE_CONSTRAINT, OFF_PLAN_TARGETS_CONSTRAINT, type LoopInputs } from "../../src/control/loopPlans.js";
import { preexistingFailureRows, preexistingFailuresOf, readPreexistingFailures, recordPreexistingFailures, PREEXISTING_PER_RUN_MAX } from "../../src/control/preexistingFailure.js";
import { reviewFacts } from "../../src/control/requirementReview.js";
import { write } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { FIXTURE_SLOT } from "./fixtures/requirement.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const LANDED = ["landed", "settled"];
const decision = (question: string, chose: string, importance?: "major" | "minor") => ({
  question, chose, alternatives: [{ option: "leave it red", why_not: "the check must pass" }], because: "it was red at the base",
  undo: { how: "revert it", cost: "low", blast_radius: "one file" }, scope: "file", kind: "implementation", ...(importance === undefined ? {} : { importance }),
});
const marker = (command: string, chose: string, importance?: "major" | "minor") => decision(`Pre-existing failure: ${command}`, chose, importance);
const reports = (t: Harness) => t.h.store.db.prepare("SELECT task_id, run_id, body FROM activity WHERE group_id='g' AND kind='preexisting-failure' ORDER BY seq").all()
  .map((row) => ({ taskId: row.task_id, runId: row.run_id, body: JSON.parse(String(row.body)) as Record<string, unknown> }));
const view = (t: Harness) => readControlGroup(t.h.store, "epoch-test", "g");
const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const asOwner = <T>(commandId: string, action: () => T): T => withCommandContext(commandId, { client: "web", principal: "user:owner" }, action);
/** Makes the harness group one created from a requirement (as reviewWorld does): its requirement review runs, so it is answerable. */
const REQUIREMENT = {
  requirementId: "0123456789abcdef0123456789abcdef", repoId: "repo", slug: null, contentLanguage: "en", createdOn: "2026-11-12",
  idea: "Write a.txt", profile: { profileId: "all", profileHash: "b".repeat(64) }, agentSlot: FIXTURE_SLOT, maxOutputTokens: 64_000,
  consensus: { roundNo: 1, at: "2026-11-12T00:00:00.000Z", openBranches: [], openQuestions: [] }, acceptedDraftNo: 1, document: null,
  export: { state: "done", path: "docs/requirements/x.md", commit: "c".repeat(40), parent: "d".repeat(40), detail: null },
};
const withRequirement = (t: Harness): void => {
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...groupBody(t), requirement: REQUIREMENT }));
};
const INPUTS: LoopInputs = { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null };

describe("the v4 contract asks for the report; older contracts keep their bytes (spec L2, acceptance 6)", () => {
  it("v4 carries the constraint line verbatim, after the off-plan line; v3 has neither", () => {
    expect(PREEXISTING_FAILURE_CONSTRAINT).toBe("If a required check already fails before you change anything, report it as a major decision whose question starts with \"Pre-existing failure:\" followed by the command, and say in \"chose\" what you did about it.");
    const v4 = expandLoopPlan("t1", "/repo", "standard", INPUTS);
    if (!v4.ok) throw new Error(v4.reason);
    expect(v4.recipe.planVersion).toBe(4);
    // mutation: leave the line out of expandRecipe -> red
    expect((v4.contract.context as { constraints: string[] }).constraints.slice(-2)).toEqual([OFF_PLAN_TARGETS_CONSTRAINT, PREEXISTING_FAILURE_CONSTRAINT]);
    const v3 = expandRecipe("t1", "/repo", { ...v4.recipe, planVersion: 3 });
    if (!v3.ok) throw new Error(v3.reason);
    // Focus 5: an old recipe re-expands to what it always did (no line; the v3 hash pins in loopPlans.test.ts do not move).
    // mutation: gate the line on every version -> red
    expect((v3.contract.context as { constraints: string[] }).constraints).toEqual([]);
  });
});

describe("preexistingFailuresOf: only the marker, only major decisions (Review Focus 1)", () => {
  it("a major decision whose question starts with the marker gives its command and what the agent chose", () => {
    expect(preexistingFailuresOf([marker("npm test", "fixed README", "major")])).toEqual([{ command: "npm test", chose: "fixed README" }]);
    // An absent grade reads as major, as every line written before grades did (reported-decisions spec §6).
    expect(preexistingFailuresOf([marker("npm test", "left it")])).toEqual([{ command: "npm test", chose: "left it" }]);
  });

  it("a minor decision with the marker records nothing", () => {
    // mutation: drop the major filter -> one entry, red
    expect(preexistingFailuresOf([marker("npm test", "fixed README", "minor")])).toEqual([]);
  });

  it("a question that mentions a pre-existing failure anywhere but at its start records nothing", () => {
    // mutation: drop the prefix check (includes instead of startsWith) -> one entry, red
    expect(preexistingFailuresOf([decision("Should I fix it? Pre-existing failure: npm test", "fixed it")])).toEqual([]);
    expect(preexistingFailuresOf([decision("pre-existing failure: npm test", "fixed it")])).toEqual([]);
    expect(preexistingFailuresOf([decision("Which file to edit for the README example?", "README.md")])).toEqual([]);
    expect(preexistingFailuresOf(["Pre-existing failure: npm test", null, 7, []])).toEqual([]);
  });

  it("one command per run: enclosing backticks dropped, an empty command skipped, the first report of a command kept, at most 16", () => {
    // mutation: drop the backtick strip -> "`npm test`", red
    expect(preexistingFailuresOf([marker("`npm test`", "a")])).toEqual([{ command: "npm test", chose: "a" }]);
    // mutation: drop the empty-command skip -> { command: "" }, red
    expect(preexistingFailuresOf([decision("Pre-existing failure:   ", "a")])).toEqual([]);
    expect(preexistingFailuresOf([marker("npm test", "first"), marker("npm test", "second")])).toEqual([{ command: "npm test", chose: "first" }]);
    // mutation: drop the per-run cap -> 20 entries, red
    expect(preexistingFailuresOf(Array.from({ length: 20 }, (_, n) => marker(`check-${n}`, "x")))).toHaveLength(PREEXISTING_PER_RUN_MAX);
    expect(preexistingFailuresOf([{ question: "Pre-existing failure: npm test" }])).toEqual([{ command: "npm test", chose: "" }]);
  });
});

describe("a run's report becomes activity and one problem row per command (acceptance 2, Focus 2)", () => {
  it("three tasks report the same command -- two land, one ends without landing: three activity rows, one row listing all three", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }], {
      behaviour: (id) => (id === "c" ? "failed" : "succeed"),
      decisions: (id) => [marker(id === "b" ? "`npm test`" : "npm test", `chose-${id}`), decision("Which name for the helper?", "helper"), marker("npm run lint", `minor-${id}`, "minor")],
    }); try {
      const runs = [await t.claim(), await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => runs.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)), 120);
      expect(runs.map((id) => t.body(id).state).filter((state) => state === "blocked")).toHaveLength(1);
      const byTask = Object.fromEntries(runs.map((id) => [t.body(id).taskId as string, id]));
      // The run that ended without landing reported too: the row is written at collect, whatever the outcome.
      // mutation: record only for a succeeded outcome -> c's row missing, red
      expect(reports(t).map((row) => row.body).sort((x, y) => String(x.taskId).localeCompare(String(y.taskId)))).toEqual(["a", "b", "c"].map((id) => (
        { taskId: id, runId: byTask[id], command: "npm test", chose: `chose-${id}` })));
      const rows = view(t).preexistingFailures;
      // mutation: drop the de-dup by command (one row per report) -> three rows, red
      expect(rows).toHaveLength(1);
      // Fix round 1 (Task 2 review I-1): every row says whether the group can be answered (a plan-file harness group cannot).
      expect(rows![0]).toEqual({ command: "npm test", sources: ["agent"], answer: null, answerable: false,
        reportedBy: reports(t).map((row) => ({ taskId: row.body.taskId, runId: row.body.runId, chose: row.body.chose })) });
      expect(rows![0]!.reportedBy.map((by) => by.taskId).sort()).toEqual(["a", "b", "c"]);
      // A collect that happens again (a crash replayed) records nothing twice.
      // mutation: drop the already-recorded guard -> 2 rows for a, red
      write(t.deps, () => recordPreexistingFailures(t.h.store, { groupId: "g", taskId: "a", runId: byTask.a! }, { decisions: [marker("npm test", "again")] }));
      expect(reports(t).filter((row) => row.taskId === "a")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  }, 120_000);

  it("a group whose runs reported nothing has no rows, and its view has no preexistingFailures key (Focus 5)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [decision("Which name for the helper?", "helper")] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      expect(reports(t)).toEqual([]);
      // mutation: always set the key (an empty list) -> the schema refuses it / the key is there, red
      expect(view(t)).not.toHaveProperty("preexistingFailures");
      const facts = await reviewFacts(t.repo, groupBody(t), git(t.repo, "rev-parse", "refs/heads/orca/g"), t.h.store, "g");
      expect(facts.some((line) => line.startsWith("Pre-existing failure"))).toBe(false);
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("the base-check source (L3's red answer) feeds the same row", () => {
  it("a red base check for a command this group's run failed is a row (source base-check), merged with the agent's report", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const scope = { repoId: "repo", base: "b".repeat(40) };
      const insert = (command: string, result: string, groupId: string) => t.h.store.db.prepare(
        "INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at,attempts) VALUES (?,?,?,?,NULL,NULL,?,'x','run-x',1,5,1)",
      ).run(scope.repoId, scope.base, command, result, groupId);
      // Asked by another group first (the cache answered this group's failure without a second run): still this group's row.
      insert("npm test", "red", "other");
      insert("npm run lint", "green", "g");
      insert("npm run build", "red", "other");
      const failed = [{ taskId: "a", runId: "run-a1", command: "npm test" }, { taskId: "a", runId: "run-a2", command: "npm run lint" }];
      // mutation: drop the red filter -> a lint row, red; mutation: drop the failed-command match -> a build row, red
      expect(preexistingFailureRows(t.h.store, "g", {}, scope, failed)).toEqual([
        { command: "npm test", reportedBy: [], sources: ["base-check"], baseCheck: { taskId: "a", runId: "run-a1", at: 5 }, answer: null, answerable: false },
      ]);
      // With no base (no work run yet, or a multi-directory / dir group) there is no base-check source.
      expect(preexistingFailureRows(t.h.store, "g", {}, null, failed)).toEqual([]);
      write(t.deps, () => recordPreexistingFailures(t.h.store, { groupId: "g", taskId: "a", runId: "run-a1" }, { decisions: [marker("npm test", "edited README")] }));
      expect(preexistingFailureRows(t.h.store, "g", {}, scope, failed)).toEqual([
        { command: "npm test", reportedBy: [{ taskId: "a", runId: "run-a1", chose: "edited README" }], sources: ["agent", "base-check"], baseCheck: { taskId: "a", runId: "run-a1", at: 5 }, answer: null, answerable: false },
      ]);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("end to end: a task run fails its check, the base run answers red, and the group view shows the row", async () => {
    // Red at the base and on the attempt: the check needs a file no commit has.
    const check = "test -e never-there.txt";
    const lastFailure = { rejectCategory: "required-check-failed", failingCommand: check, primaryTargetPaths: ["a"] };
    const t = await driverHarness([{ taskId: "a", requiredChecks: [check] }], {
      behaviour: () => "failed", failure: () => ({ failureCause: { cause: "required-check-failed", phase: "verify", retries: 0, detail: null }, lastFailure }),
    }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked", 120);
      for (let i = 0; i < 150 && t.h.store.db.prepare("SELECT result FROM base_check_results").get()?.result !== "red"; i += 1) { await driver.round(); await new Promise((resolve) => setTimeout(resolve, 20)); }
      // mutation: leave the base-check source out of the view -> undefined, red
      expect(view(t).preexistingFailures).toEqual([{ command: check, reportedBy: [], sources: ["base-check"], baseCheck: { taskId: "a", runId, at: expect.any(Number) }, answer: null, answerable: false }]);
    } finally { await t.h.dispose(); }
  }, 180_000);
});

describe("the person's three answers (acceptance 3)", () => {
  const world = async (reviewed = true) => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [marker("npm test", "edited README to the v3 example")] });
    if (reviewed) withRequirement(t);
    const runId = await t.claim();
    await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
    const answer = (command: string, chosen: "allow-fix" | "relative" | "edit-requirement", person = true) => {
      const sent = t.h.command("answer-preexisting-failure", { command, answer: chosen });
      return person ? asOwner(sent.commandId, () => t.service.answerPreexistingFailure(sent)) : t.service.answerPreexistingFailure(sent);
    };
    const facts = async () => reviewFacts(t.repo, groupBody(t), git(t.repo, "rev-parse", "refs/heads/orca/g"), t.h.store, "g");
    return { t, runId, answer, facts };
  };

  it("unanswered, the review is told the report and that the person has not answered", async () => {
    const { t, facts } = await world(); try {
      // mutation: drop the pre-existing failure lines from reviewFacts -> no such line, red
      expect(await facts()).toContain("Pre-existing failure `npm test` (already failing before a task changed anything): reported by a (chose: edited README to the v3 example). not answered by the person.");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it.each([
    ["allow-fix", "the person allows the change that repaired it -- it is an allowed change, not a breach of the requirement"],
    ["relative", "the person judges this check relative to the group's base -- failures already present at the base do not count against the work"],
    // Fix round 1 (Task 2 review I-3): Orca cannot change an accepted requirement, and the review is told so.
    ["edit-requirement", "the person wants the requirement itself changed, which Orca cannot do to an accepted requirement yet -- judge the work against the requirement as it is written here"],
  ] as const)("%s is recorded on the group, shown on the row, and in the review's facts", async (chosen, means) => {
    const { t, answer, facts } = await world(); try {
      expect(answer("npm test", chosen)).toMatchObject({ result: { kind: "preexisting-failure-answered", groupId: "g", command: "npm test", answer: chosen } });
      expect(groupBody(t).preexistingFailureAnswers).toEqual({ "npm test": { answer: chosen, by: "user:owner", at: expect.any(Number) } });
      expect(view(t).preexistingFailures![0]).toMatchObject({ answer: chosen, answered: { by: "user:owner" }, answerable: true });
      expect((await facts()).find((line) => line.startsWith("Pre-existing failure"))).toBe(
        `Pre-existing failure \`npm test\` (already failing before a task changed anything): reported by a (chose: edited README to the v3 example). answered "${chosen}": ${means}.`);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a later answer replaces an earlier one", async () => {
    const { t, answer } = await world(); try {
      answer("npm test", "allow-fix");
      answer("npm test", "relative");
      expect(view(t).preexistingFailures![0]!.answer).toBe("relative");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("an answer for a command the group has no row for, or with no person behind it, is refused and records nothing", async () => {
    const { t, answer } = await world(); try {
      // mutation: drop the row check -> recorded, red
      expect(answer("npm run lint", "relative")).toMatchObject({ error: { code: "preexisting-failure-not-reported" } });
      // mutation: drop the person check -> recorded with no person, red
      expect(answer("npm test", "relative", false)).toMatchObject({ error: { code: "preexisting-failure-person-required" } });
      expect(groupBody(t)).not.toHaveProperty("preexistingFailureAnswers");
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("fix round 1: who can answer, and an answer outlives its pruned report (Task 2 review I-1, I-2, minor 2)", () => {
  const answerAs = (t: Harness, command: string, chosen: "allow-fix" | "relative" | "edit-requirement") => {
    const sent = t.h.command("answer-preexisting-failure", { command, answer: chosen });
    return asOwner(sent.commandId, () => t.service.answerPreexistingFailure(sent));
  };
  const landed = async (reviewed: boolean) => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [marker("npm test", "edited README")] });
    if (reviewed) withRequirement(t);
    const runId = await t.claim();
    await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
    return { t, runId };
  };

  it("a group with no requirement review shows the row for information only and refuses an answer", async () => {
    const { t } = await landed(false); try {
      // mutation: answerable always true -> red
      expect(view(t).preexistingFailures![0]!.answerable).toBe(false);
      // mutation: drop the answerable check in the command -> recorded, red
      expect(answerAs(t, "npm test", "relative")).toMatchObject({ error: { code: "preexisting-failure-not-answerable" } });
      expect(groupBody(t)).not.toHaveProperty("preexistingFailureAnswers");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a requirement group is answerable unless it is multi-directory or dir (whose review does not run), or predates follow-up G", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      write(t.deps, () => recordPreexistingFailures(t.h.store, { groupId: "g", taskId: "a", runId: "run-a1" }, { decisions: [marker("npm test", "x")] }));
      const answerable = (body: Record<string, unknown>) => preexistingFailureRows(t.h.store, "g", body, null, [])[0]!.answerable;
      const reviewed = { modelVersion: "followup-g", requirement: REQUIREMENT };
      expect(answerable(reviewed)).toBe(true);
      // mutation: drop the multi-directory clause -> true, red
      expect(answerable({ ...reviewed, multiDir: { project: "p", dirs: [{ key: "a", repoId: "repo", kind: "repo" }, { key: "b", repoId: "r2", kind: "repo" }], landing: null } })).toBe(false);
      // mutation: drop the dir clause -> true, red
      expect(answerable({ ...reviewed, dirWorkspace: { dir: "/nowhere", vaultId: "e".repeat(64) } })).toBe(false);
      expect(answerable({ requirement: REQUIREMENT })).toBe(false);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("an answer whose report was pruned (activity retention) still yields its row and its review line", async () => {
    const { t } = await landed(true); try {
      answerAs(t, "npm test", "allow-fix");
      t.h.store.db.prepare("DELETE FROM activity WHERE kind='preexisting-failure'").run();
      // mutation: drop the rows for answers with no surviving source -> no row, red
      expect(view(t).preexistingFailures).toEqual([{ command: "npm test", reportedBy: [], sources: [], answer: "allow-fix", answered: { by: "user:owner", at: expect.any(Number) }, answerable: true }]);
      const facts = await reviewFacts(t.repo, groupBody(t), git(t.repo, "rev-parse", "refs/heads/orca/g"), t.h.store, "g");
      expect(facts).toContain("Pre-existing failure `npm test` (already failing before a task changed anything): its reports are no longer kept. answered \"allow-fix\": the person allows the change that repaired it -- it is an allowed change, not a breach of the requirement.");
      // The person may still change the answer.
      expect(answerAs(t, "npm test", "relative")).toMatchObject({ result: { kind: "preexisting-failure-answered" } });
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a run body that does not decode is skipped when the rows are read outside the view", async () => {
    const { t, runId } = await landed(true); try {
      t.h.store.db.prepare("UPDATE runs SET body='broken run' WHERE id=?").run(runId);
      // mutation: parse every run body -> SyntaxError, red
      expect(readPreexistingFailures(t.h.store, "g", groupBody(t)).map((row) => row.command)).toEqual(["npm test"]);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
