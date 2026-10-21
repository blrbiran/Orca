/** One canned panel state for the write criteria (CLI v2 plan Tasks 4-6): every pin a write fills has a known value. */
import { fakePanel, type Recorded, type Route } from "./fakePanel.js";

export const H = { plan: "a".repeat(64), est: "e".repeat(64), work: "f".repeat(64), sel: "5".repeat(64), draft: "d".repeat(64), capsule: "c".repeat(64), scheme: "9".repeat(64), table: "7".repeat(64) };

export function groupView(over: { revision?: number; currentRunId?: string; loopVersion?: number; labelsVersion?: number; proposalVersion?: number; integration?: unknown } = {}) {
  return {
    schema: "orca-control-group-v1", epoch: "e", changeSeq: 9,
    summary: { groupId: "g-alpha", repoId: "repo-1", state: "draft", commandRevision: over.revision ?? 5 },
    plan: { repoId: "repo-1", planId: "plan-a", planHash: H.plan, goal: "ship", successConditions: [] },
    proposal: { state: "editable", proposalVersion: over.proposalVersion ?? 3, planHash: H.plan, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: { tokens: 1000, activeMs: 10, attempts: 2, sessions: 2 } },
    allocations: [
      { ownerKind: "task", ownerId: "t1", bucket: "work", state: "draft-encumbered", amount: { tokens: 500, activeMs: 5, attempts: 1, sessions: 1 },
        fieldProvenance: { tokens: { provenance: "human", estimateId: null }, activeMs: { provenance: "human", estimateId: null }, attempts: { provenance: "human", estimateId: null }, sessions: { provenance: "system", estimateId: null } } },
    ],
    workItems: [
      { taskId: "t1", status: "blocked", currentRunId: over.currentRunId ?? "run-1", labels: ["area:cli"], labelsVersion: over.labelsVersion ?? 2, loopPlan: { planId: "standard", loopVersion: over.loopVersion ?? 4 } },
      { taskId: "t2", status: "ready", currentRunId: null, labelsVersion: 0, loopPlan: null },
    ],
    runs: [{ runId: over.currentRunId ?? "run-1", taskId: "t1", state: "blocked", unknownUsageSettlement: { generation: 3 } }],
    checkpoints: [{ checkpointId: "cp-old", runId: "run-0", taskId: "t1", state: "complete" }, { checkpointId: "cp-1", runId: over.currentRunId ?? "run-1", taskId: "t1", state: "complete" }],
    ...(over.integration === undefined ? {} : { integration: over.integration }),
  };
}

export const READS: Record<string, unknown> = {
  "groups/g-alpha/agent-preview": { schema: "orca-agent-selection-preview-v1", groupId: "g-alpha", proposalVersion: 3, selectionsHash: H.sel },
  "groups/g-alpha/requirement": {
    schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5, requirement: { roundNo: 2, draftNo: 1 } },
    rounds: [{ roundNo: 1 }, { roundNo: 2 }], drafts: [{ draftNo: 1, state: "awaiting-review", draftHash: H.draft }],
  },
  "config": {
    schema: "orca-control-config-v1", repositories: [{ repoId: "repo-1", displayName: "proj" }], plans: [{ planId: "plan-a", repoId: "repo-1", displayName: "plan.json" }],
    profiles: [{ profileId: "est-1", profileHash: H.est, allowedWorkKinds: ["estimate"] }, { profileId: "work-1", profileHash: H.work, allowedWorkKinds: ["goal-review", "handoff", "task"] }],
    defaults: { estimatorProfileId: "est-1", estimatorProfileHash: H.est, estimateMode: "soft" },
  },
  "projects": { source: "command-line", projects: [{ projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" }] },
  "repositories/repo-1/workspace": { schema: "orca-repository-workspace-v1", repoId: "repo-1", workspaceMode: "worktree", revision: 7 },
  "operator/agent-preferences": { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 2, preferences: { perAgent: {} } },
  "operator/agent-update-preview": { schema: "orca-agent-update-state-v1", preview: { previewId: "pv-1", baseTableHash: H.table } },
  "usage?scope=all": { schema: "orca-usage-view-v1", spendRevision: 8 },
  "orchestration": { schema: "orca-orchestration-v1", revision: 4, maxRunningGroups: 3, runningGroups: 1 },
  "runs/run-1/saved-result-eligibility": { status: "eligible", recoveryOf: { sourceRunId: "run-0", sourceAttempt: 1, capsuleHash: H.capsule } },
  "recovery": { schema: "orca-control-recovery-v1", blockers: [{ scope: "run", groupId: "g-alpha", runId: "run-1", code: "x" }] },
};

/** The panel's ledger, as far as these criteria need it: a stale expectedRevision is refused like commandLedger.ts does. */
export function accept(current: () => number): Route {
  return (request: Recorded) => {
    const sent = JSON.parse(request.text) as { commandId: string; expectedRevision: number };
    if (sent.expectedRevision !== current()) {
      return { status: 409, body: { error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision: current(), evidenceIds: [], retryable: false } } };
    }
    return { status: 200, body: { commandId: sent.commandId, commandRevision: current() + 1, result: { kind: "ok" } } };
  };
}

export async function world(over: Parameters<typeof groupView>[0] = {}, routes: Record<string, Route> = {}) {
  const state = { view: groupView(over) };
  const reads: Record<string, Route> = Object.fromEntries(Object.entries(READS).map(([path, body]) => [`GET ${path}`, { status: 200, body }]));
  const panel = await fakePanel({
    ...reads,
    "GET groups/g-alpha": () => ({ status: 200, body: state.view }),
    "GET summary": () => ({ status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", commandRevision: state.view.summary.commandRevision }, { groupId: "g-beta", commandRevision: 1 }] } }),
    "POST *": accept(() => state.view.summary.commandRevision),
    // A new group's scope starts at 0.
    "POST groups/import-plan": accept(() => 0),
    "POST requirements": accept(() => 0),
    ...routes,
  });
  const posts = () => panel.requests.filter((r) => r.method === "POST").map((r) => ({ path: r.path, ...(JSON.parse(r.text) as { commandId: string; expectedRevision: number; payload: unknown }) }));
  return { ...panel, state, posts };
}
