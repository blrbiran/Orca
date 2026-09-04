import { describe, expect, it } from "vitest";
import { PLAN_LEVEL_CHECKS, loadPlan, type PlanRejection, type PlanTask } from "../../src/scheduler/planFile.js";

function codes(r: { plan: unknown } | { rejections: PlanRejection[] }): string[] {
  return "rejections" in r ? r.rejections.map((x) => x.code) : [];
}

function t(id: string, deps: string[] = []): PlanTask {
  return { taskId: id, contract: `/abs/${id}.json`, dependsOn: deps };
}

const OK = {
  targetRepo: "/abs/repo",
  ccloopBin: "/abs/cli.js",
  runsDir: "/abs/runs",
  workBranch: "orca/w/x",
  policy: "local-merge",
  ledgerMode: "in-repo",
  tasks: [{ taskId: "T1", contract: "/abs/t1.json", dependsOn: [] }],
};

describe("loadPlan — the six up-front rejections (spec 2.3)", () => {
  it("rejects any relative path", () => {
    // A relative path resolves against whatever CWD the orchestrator happens
    // to be in: ambiguous, and a confused-deputy escape surface.
    const r = loadPlan({ ...OK, targetRepo: "./repo" }, "main");
    expect(codes(r)).toContain("relative-path");
  });

  it("rejects a duplicate taskId", () => {
    const r = loadPlan({ ...OK, tasks: [t("T1"), t("T1")] }, "main");
    expect(codes(r)).toContain("duplicate-task-id");
  });

  it("rejects a cycle", () => {
    const r = loadPlan({ ...OK, tasks: [t("T1", ["T2"]), t("T2", ["T1"])] }, "main");
    expect(codes(r)).toContain("cycle");
  });

  it("rejects a contract file that lives inside the target repo", () => {
    // This is the premise that lets the write set be computed once, at graph
    // construction time: a contract outside the repo cannot be rewritten by an
    // upstream task. Spec 2.4.1 leans its whole "no re-derivation at claim
    // time" argument on it, which is why it is a rejection and not a comment.
    const r = loadPlan({ ...OK, tasks: [{ ...t("T1"), contract: "/abs/repo/t1.json" }] }, "main");
    expect(codes(r)).toContain("contract-inside-target-repo");
  });

  it("rejects workBranch equal to the default branch", () => {
    // Merging into the default branch is tier 0 — mechanically forbidden, not
    // a matter of policy. Every tier argument in A' section 5.2 rests on this
    // being a check rather than a convention.
    const r = loadPlan({ ...OK, workBranch: "main" }, "main");
    expect(codes(r)).toContain("work-branch-is-default");
  });

  it("rejects a policy other than local-merge, instead of quietly downgrading", () => {
    // rebase and pull-request are configuration this version recognises and
    // does not implement. Accepting them and silently doing a local merge is
    // the failure mode borrowed backwards from hermes: a degradation nobody
    // sees.
    for (const policy of ["rebase", "pull-request", "squash-merge"]) {
      expect(codes(loadPlan({ ...OK, policy }, "main"))).toContain("unsupported-policy");
    }
  });

  it("reports every rejection at once, not just the first", () => {
    // A caller who fixes one problem and re-runs, six times, is a caller the
    // tool is wasting. Same discipline as the trie's conflict listing.
    const r = loadPlan({ ...OK, targetRepo: "./repo", workBranch: "main", policy: "rebase" }, "main");
    expect(codes(r).sort()).toEqual(["relative-path", "unsupported-policy", "work-branch-is-default"]);
  });

  it("accepts a well-formed plan", () => {
    const r = loadPlan(OK, "main");
    expect("plan" in r).toBe(true);
  });

  it("rejects a taskId that cannot become a run id, up front rather than mid-round", () => {
    // Final review, Important 2. `deriveRunId` already threw for this input,
    // but its first call sits deep inside the layer loop: "team/alpha" used to
    // cost a branch creation, a checkout of a real person's worktree and a
    // ledger commit before dying with a raw node stack and exit 3. It is
    // mechanically decidable from the plan file alone, which by §2.3's own
    // logic makes it an up-front rejection.
    const r = loadPlan({ ...OK, tasks: [{ ...t("T1"), taskId: "team/alpha" }] }, "main");
    expect(codes(r)).toContain("unusable-task-id");
    // And a taskId the ledger's RUN_ID does accept must NOT be rejected, or
    // the check would "pass" by refusing everything.
    expect(codes(loadPlan({ ...OK, tasks: [{ ...t("T1"), taskId: "t.1-a" }] }, "main"))).not.toContain(
      "unusable-task-id",
    );
  });

  it("treats a contract path that IS targetRepo as inside it", () => {
    // Deferred minor 11. `relative(x, x)` is the empty string, and the old
    // test read `rel !== "" && !rel.startsWith("..")` — so the one path that
    // is maximally inside the repository read as outside it. §2.4.1 leans its
    // whole "compute the write set once, at graph construction time" argument
    // on no contract being rewritable by an upstream task, so this is the
    // premise's own edge.
    const r = loadPlan({ ...OK, tasks: [{ ...t("T1"), contract: "/abs/repo" }] }, "main");
    expect(codes(r)).toContain("contract-inside-target-repo");
    // The sibling-prefix case the original `relative`-over-`startsWith`
    // choice exists for must still read as outside, so this is not simply
    // "everything is inside now".
    expect(codes(loadPlan({ ...OK, tasks: [{ ...t("T1"), contract: "/abs/repo-2/x.json" }] }, "main"))).not.toContain(
      "contract-inside-target-repo",
    );
  });
});

describe("PLAN_LEVEL_CHECKS is the list loadPlan actually emits (final review, Important 4)", () => {
  it("every code in the exported list is produced by a plan that violates it, and no other code is", () => {
    // 🔴 This criterion exists because the renderer used to hold a SECOND,
    // hand-typed copy of these strings. `renderPlanReport`'s `checkLine`
    // renders a code it cannot find among the rejections as `[pass] <code>`,
    // so a rename on one side printed a green line, in the report a human
    // approves a round from, for a check that no longer exists.
    //
    // It is deliberately NOT `expect(PLAN_LEVEL_CHECKS).toEqual([...])` —
    // that compares a constant to itself and cannot fail. The codes on the
    // right come out of a real `loadPlan` call on a plan that violates all
    // seven at once, so the two sides have genuinely different provenance.
    const everythingWrong = {
      targetRepo: "/abs/repo",
      ccloopBin: "/abs/cli.js",
      runsDir: "/abs/runs",
      // 5. work-branch-is-default
      workBranch: "main",
      // 6. unsupported-policy
      policy: "rebase",
      ledgerMode: "in-repo",
      tasks: [
        // 1. relative-path, and 3. cycle with T2
        { taskId: "T1", contract: "relative/t1.json", dependsOn: ["T2"] },
        // 4. contract-inside-target-repo, and the other half of the cycle
        { taskId: "T2", contract: "/abs/repo/t2.json", dependsOn: ["T1"] },
        // 2. duplicate-task-id
        { taskId: "T3", contract: "/abs/t3.json", dependsOn: [] },
        { taskId: "T3", contract: "/abs/t3.json", dependsOn: [] },
        // 7. unusable-task-id
        { taskId: "team/alpha", contract: "/abs/t4.json", dependsOn: [] },
      ],
    };
    const emitted = new Set(codes(loadPlan(everythingWrong, "main")));
    expect([...emitted].sort()).toEqual([...PLAN_LEVEL_CHECKS].sort());
  });
});
