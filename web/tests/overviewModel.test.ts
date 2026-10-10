import { expect, it } from "vitest";
import { deriveOverview, recoveryIdentity, loadingSource, sourceFailure } from "../src/overviewModel.js";
import type { OverviewInputs, OverviewSource } from "../src/overviewModel.js";
import type { OverviewStepV1 } from "../src/controlTypes.js";
import { ALPHA, BETA, TWO_PROJECTS, groupSummary, decisionRow } from "./fixtures/twoProjects.js";
const available = <T>(data: T): OverviewSource<T> => ({ status: "available", data, error: null });
const input = (): OverviewInputs => ({ projection: available({ schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 1, groups: [groupSummary("ga", ALPHA), groupSummary("gb", BETA)], steps: [], issues: [] }), todo: available([]), recovery: available({ schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] }), uncertain: [], scope: { kind: "all" }, projectKey: "alpha", projects: TWO_PROJECTS, roles: ["member"] });
const recoveryStep = (scope: string, groupId: string, runId: string | null, code: string, ownerRequired = false): OverviewStepV1 => ({ key: JSON.stringify(["recovery-review", groupId, recoveryIdentity(scope, groupId, runId, code)]), groupId, repoId: ALPHA, taskId: null, runId, kind: "recovery-review", reason: code, ownerRequired, destination: scope === "global" ? { kind: "recovery" } : { kind: "group", groupId, region: "problem", taskId: null, runId } });
it("preserves same-name decisions across projects and scopes by composite identity rather than ordinary list filters", () => {
 const value = input(); value.todo = available([decisionRow("alpha", "same"), decisionRow("beta", "same")]);
 const all = deriveOverview(value); expect(all.queue.map((r) => r.target)).toEqual([{ kind: "decision", projectKey: "alpha", id: "same" }, { kind: "decision", projectKey: "beta", id: "same" }]);
 expect(new Set(all.queue.map((r) => r.key)).size).toBe(2);
 value.scope = { kind: "project", repoId: BETA }; value.projectKey = "beta";
 expect(deriveOverview(value).queue.map((r) => r.target)).toEqual([{ kind: "decision", projectKey: "beta", id: "same" }]);
});
it("deduplicates exactly the same cross-source recovery identity, preserves distinct scopes/codes/runs/owners and OR ownerRequired", () => {
 const value = input(); const blockers = [
  { scope: "group" as const, groupId: "ga", runId: null, code: "one", evidenceIds: [] },
  { scope: "run" as const, groupId: "ga", runId: "r1", code: "one", evidenceIds: [] },
  { scope: "run" as const, groupId: "ga", runId: "r2", code: "one", evidenceIds: [] },
  { scope: "group" as const, groupId: "ga", runId: null, code: "two", evidenceIds: [] },
  { scope: "group" as const, groupId: "gb", runId: null, code: "one", evidenceIds: [] },
  { scope: "global" as const, groupId: "ga", runId: null, code: "one", evidenceIds: [] },
 ]; value.recovery.data!.blockers = blockers;
 value.projection.data!.steps = [recoveryStep("group", "ga", null, "one", true), recoveryStep("group", "ga", null, "one", false)];
 const rows = deriveOverview(value).queue; expect(rows).toHaveLength(6);
 expect(rows.find((r) => r.key === recoveryIdentity("group", "ga", null, "one"))?.ownerRequired).toBe(true);
 expect(rows.find((r) => r.key === recoveryIdentity("group", "gb", null, "one"))?.owner).toBe("Beta");
 expect(rows.find((r) => r.key === recoveryIdentity("global", "ga", null, "one"))?.target).toEqual({ kind: "global-control", region: "recovery" });
});
it("retains unknown imports, global safety blockers and unknown ownership even in a concrete scope", () => {
 const value = input(); value.scope = { kind: "project", repoId: BETA };
 value.uncertain = [{ groupId: "not-created", commandId: "pending-import", importPlan: true }, { groupId: "ga", commandId: "outside" }, { groupId: "missing", commandId: "unresolved" }];
 value.recovery.data!.blockers = [{ scope: "global", groupId: "ga", runId: null, code: "global-block", evidenceIds: [] }];
 value.projection.data!.groups.push(groupSummary("unknown", "removed-project"));
 value.projection.data!.issues = [{ groupId: null, repoId: null, reason: "store-broken" }, { groupId: "unknown", repoId: "removed-project", reason: "unknown-source" }];
 value.todo = available([decisionRow("removed-project", "unknown-decision")]);
 const model = deriveOverview(value);
 expect(model.queue.map((r) => r.reason).sort()).toEqual(["pending-import", "unresolved", "global-block", "unknown-decision"].sort());
 expect(model.queue.find((r) => r.reason === "unknown-decision")?.ownerUnknown).toBe(true);
 expect(model.progress.map((r) => r.group.groupId)).toEqual(["gb", "unknown"]);
 expect(model.issues.map((r) => r.reason)).toEqual(["store-broken", "unknown-source"]);
 expect(model.complete).toBe(false);
});
it("does not manufacture queue work from summary running/ready/review/counts and keeps plan completion distinct from group acceptance", () => {
 const value = input(); value.projection.data!.groups = [groupSummary("ga", ALPHA, { state: "review", completion: { done: 4, total: 4 } }), groupSummary("gb", BETA, { state: "ready" }), groupSummary("archive", BETA, { archived: true })];
 const model = deriveOverview(value); expect(model.queue).toHaveLength(0); expect(model.progress).toHaveLength(2);
 expect(model.progress[0]?.group.state).toBe("review"); expect(model.progress[0]?.group.completion).toEqual({ done: 4, total: 4 });
});
it("retains authoritative exceptions before preparation, stable identities and requested task/run destinations", () => {
 const value = input(); value.projection.data!.steps = [
  { key: "prep", groupId: "ga", repoId: ALPHA, taskId: null, runId: null, kind: "budget-review", reason: "editable", ownerRequired: false, destination: { kind: "group", groupId: "ga", region: "preparation", taskId: null, runId: null } },
  { key: "task", groupId: "gb", repoId: BETA, taskId: "task-b", runId: "run-b", kind: "task-attention", reason: "failed", ownerRequired: true, destination: { kind: "group", groupId: "gb", region: "problem", taskId: "task-b", runId: "run-b" } } ];
 const rows = deriveOverview(value).queue; expect(rows.map((r) => r.kind)).toEqual(["task-attention", "budget-review"]);
 expect(rows[0]?.target).toEqual({ kind: "group", groupId: "gb", region: "problem", taskId: "task-b", runId: "run-b" }); expect(rows[0]?.ownerRequired).toBe(true);
});
it("unavailable, stale and loading sources never report the human queue as known empty", () => {
 const value = input(); value.todo = loadingSource(); expect(deriveOverview(value).complete).toBe(false);
 value.todo = sourceFailure(value.todo, "failed"); expect(deriveOverview(value).sources[1]?.status).toBe("unavailable");
 value.todo = sourceFailure(available([decisionRow("alpha", "retained")]), "failed");
 expect(deriveOverview(value).queue[0]?.reason).toBe("retained"); expect(deriveOverview(value).sources[1]?.status).toBe("stale");
 value.scope = { kind: "unresolved" }; expect(deriveOverview(value).scopeUnavailable).toBe(true);
});
