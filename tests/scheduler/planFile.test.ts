import { describe, expect, it } from "vitest";
import { loadPlan, type PlanRejection, type PlanTask } from "../../src/scheduler/planFile.js";

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
});
