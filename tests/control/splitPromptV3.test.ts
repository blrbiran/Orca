import { describe, expect, it } from "vitest";
import { buildSplitPrompt, explainSplitReason } from "../../src/control/requirementSplit.js";
import { choosePlanByLabels, expandLoopTask } from "../../src/control/loopPlans.js";
import type { DraftBody } from "../../src/control/requirementSchemas.js";

// Issue #107 (tester, 2026-10-28; round ledger .superpowers/sdd/2026-10-28-tester-feedback-round/progress.md): a paid
// split spent two of its three drafts learning rules the instruction never stated -- an investigate task with a
// `<directory>/**` target (expand:<task>:investigate-target) and traces naming question ids such as R1.Q3
// (trace:<task>:R1.Q3). Version 3 states the rules the validator enforces, and every hand-back reason reaches the model
// with what it means beside its code.
const overview = { canonicalJson: "{}", hash: "b".repeat(64) };
const instructionOf = (multi: boolean): string => {
  const prompt = buildSplitPrompt({ document: "D.", overview, earlierDrafts: [], ...(multi ? { multi: true } : {}) });
  return prompt.slice(0, prompt.indexOf("\n\n<<<ORCA-DATA requirement-document "));
};

describe("split instruction version 3 states what the validator enforces (#107)", () => {
  for (const multi of [false, true]) {
    describe(multi ? "several directories" : "one repository", () => {
      const instruction = instructionOf(multi);
      it("is version 3", () => {
        expect(instruction.split("\n", 1)[0]).toBe(multi ? "Orca requirement split (several directories), instruction version 3." : "Orca requirement split, instruction version 3.");
      });

      it("states the investigate rule: exactly one target path, an exact path", () => {
        expect(instruction).toContain("An `investigate` task names exactly one target path, and it is an exact path (the report file the task writes): never `<directory>/**` or `**`.");
      });

      it("states the design rule: no `**` target", () => {
        expect(instruction).toContain("A `design` task's target paths do not include `**`; exact paths and `<directory>/**` are allowed.");
      });

      it("states that a plan's rules apply to the plan the labels choose when loopPlan is absent, in the order code chooses", () => {
        expect(instruction).toContain("A task's plan is its `loopPlan`; without one, the first of these its labels match chooses it: investigate -> investigate; design or doc -> design; bug -> bugfix; refactor -> refactor; feature, test, perf, security or chore -> standard; no match -> standard.");
      });

      it("states the trace ids: criteria and accepted decisions as the document gives them, never question or glossary ids", () => {
        expect(instruction).toContain("`traces` names the acceptance criteria (and decisions) each task serves, by the ids the requirement document gives them: an acceptance criterion's id as its list of acceptance criteria writes it (such as AC1), or an accepted decision's id as its heading under decisions starts (such as R1.ADR1). Nothing else can be traced: not a question's id (such as R1.Q1), a glossary entry's (such as R1.G1) or a round. Every acceptance criterion must be traced by at least one task.");
      });

      it("states that `<directory>/**` needs a directory the overview's commit has", () => {
        expect(instruction).toContain("`<directory>/**` for a directory that exists in the overview's commit");
      });
    });
  }

  it("names the multi rules on the first writes entry, the one expansion reads", () => {
    expect(instructionOf(true)).toContain("A task's plan rules below apply to its first `writes` entry (its primary directory).");
    expect(instructionOf(false)).not.toContain("first `writes` entry");
  });

  // The stated label table is the one choosePlanByLabels reads: each label in the sentence expands to the plan named.
  it("states a label table code agrees with", () => {
    for (const [label, planId] of [["investigate", "investigate"], ["design", "design"], ["doc", "design"], ["bug", "bugfix"], ["refactor", "refactor"], ["chore", "standard"], ["custom:x", "standard"]] as const) {
      expect(choosePlanByLabels([label]).planId).toBe(planId);
    }
  });

  // The rules stated are the rules the expansion refuses: an investigate task with a `<dir>/**` target, a design task with `**`.
  it("states rules the expansion enforces", () => {
    const input = (targetPaths: string[]) => ({ goal: "g", successCondition: "s", targetPaths, checks: ["true"] });
    expect([
      expandLoopTask("t", "/r", { ...input(["docs/**"]), plan: "investigate" }, []),
      expandLoopTask("t", "/r", input(["docs/report.md", "docs/b.md"]), ["investigate"]),
      expandLoopTask("t", "/r", input(["**"]), ["doc"]),
    ].map((e) => (e.ok ? "ok" : e.reason))).toEqual(["investigate-target", "investigate-target", "design-target"]);
    expect(expandLoopTask("t", "/r", input(["docs/**"]), ["design"]).ok).toBe(true);
  });
});

describe("a hand-back reason carries its meaning beside its code (#107)", () => {
  it.each([
    ["expand:t1:investigate-target", "an investigate task (loopPlan investigate, or no loopPlan and the label investigate) must name exactly one target path, an exact path with no `*`"],
    ["expand:t1:design-target", "a design task (loopPlan design, or no loopPlan and the label design or doc) must not name `**` as a target path"],
    ["expand:t1:path-shape", "a target path is not an exact relative path, `<directory>/**` or `**`"],
    ["expand:t1:unknown-plan", "the loopPlan is not one of standard, bugfix, refactor, design, investigate"],
    ["expand:t1:investigate-max-files", "an investigate task writes exactly one file"],
    ["expand:t1:skills-shape", "the task's skills are not a profile name or a list of skill names"],
    ["path:t1:.work/**", "this target path does not exist in the overview's commit: an exact path must be an existing file or a new file in an existing directory, and `<directory>/**` needs an existing directory"],
    ["path:t1:alpha:missing/x.ts", "this target path does not exist in the overview's commit: an exact path must be an existing file or a new file in an existing directory, and `<directory>/**` needs an existing directory"],
    ["trace:t1:R1.Q3", "this id is neither an acceptance criterion's id nor an accepted decision's id in the requirement document"],
    ["untraced:AC2", "no task traces this acceptance criterion; every one must be traced by at least one task"],
    ["dir:t1:gamma", "this is not a directory key the project overview lists"],
    ["checks-primary:t1", "the task's first writes entry (its primary directory) has no checks"],
    ["ledger-path:t1:beta", "only the task's first writes entry (its primary directory) may name `.decisions` as a target path"],
    ["import:duplicate-dependency:t1", "the task names the same dependency twice"],
    ["import:dangling-dependency:t1:ghost", "the task depends on a taskId no task in this split has"],
    ["import:duplicate-success-condition", "two acceptance criteria have the same text, so the plan's success conditions repeat"],
  ])("explains %s", (reason, meaning) => {
    expect(explainSplitReason(reason)).toBe(meaning);
  });

  // These carry the checker's own message after the code already; Orca adds nothing to them.
  it.each(["plan:cycle:a -> b -> a", "import:missing-goal", "graph:buildGraph: no schedulable task", "schema:tasks.0.title:Required"])("adds nothing to %s", (reason) => {
    expect(explainSplitReason(reason)).toBeNull();
  });

  it("sends each reason to the model with its meaning, and a reason without one as it is", () => {
    const draft: DraftBody = {
      draftNo: 1, state: "invalid", autoRetry: 0, waiting: null, output: null, plan: null, draftHash: null, feedback: null, reasonCode: null, calls: [],
      reasons: ["expand:t1:investigate-target", "import:missing-goal"], layers: null, implicitEdges: null,
    } as unknown as DraftBody;
    const prompt = buildSplitPrompt({ document: "D.", overview, earlierDrafts: [draft] });
    expect(prompt).toContain(JSON.stringify(["expand:t1:investigate-target -- an investigate task (loopPlan investigate, or no loopPlan and the label investigate) must name exactly one target path, an exact path with no `*`", "import:missing-goal"]));
  });
});
