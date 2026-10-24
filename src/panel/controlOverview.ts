import type { ControlStore } from "../control/store.js";
import { flowRoleSql } from "../flow/groups.js";
import { ControlError } from "../control/errors.js";
import { readProjectionState } from "../control/projectionJournal.js";
import { readGroupIntegration } from "../control/integrationScheme.js";
import { readSpendCapBlock } from "../control/spendCaps.js";
import { hasRequirementBlock } from "../control/requirementRecords.js";
import { compareText, overviewSchema, type OverviewV1, type OverviewStepV1, type OverviewDestinationV1 } from "../control/webProtocol.js";
import { BUSY_WORK, decodeRecoveryBlockerRow, readOverviewGroupSource } from "./controlViews.js";

type Source = NonNullable<ReturnType<typeof readOverviewGroupSource>>;
const UNKNOWN_RUN = new Set(["unknown", "attempt-unknown", "attempt-proof-invalid"]);
const PRIORITY: Record<OverviewStepV1["kind"], number> = {
  "requirement-attention": 0, "task-attention": 0, "stop-review": 0, "recovery-review": 0, "integration-review": 0,
  "requirement-answer": 1, "requirement-review": 1, "budget-review": 2, "start-review": 3,
};

/** Synchronous, request-local stored facts only. Navigation never asserts command eligibility. */
export function readControlOverview(store: ControlStore, epoch: string): OverviewV1 {
  const changeSeq = readProjectionState(store).changeSeq;
  const groups: OverviewV1["groups"] = [], issues: OverviewV1["issues"] = [];
  const steps = new Map<string, OverviewStepV1>();
  function add(kind: OverviewStepV1["kind"], groupId: string | null, repoId: string | null, reason: string,
    destination: OverviewDestinationV1, identity: string, taskId: string | null = null, runId: string | null = null, ownerRequired = false) {
    const key = JSON.stringify([kind, groupId, identity]);
    steps.set(key, { key, kind, groupId, repoId, taskId, runId, reason, ownerRequired: ownerRequired || (steps.get(key)?.ownerRequired ?? false), destination });
  }
  function groupSteps(source: Source) {
    const { summary, body, proposal, estimates, workItems, runs, blockers } = source;
    const { groupId, repoId } = summary;
    const workById = new Map(workItems.map(work => [work.workItemId, work]));
    const runById = new Map(runs.map(run => [run.runId, run]));
    const groupDestination = (region: Extract<OverviewDestinationV1, {kind:"group"}>["region"], taskId: string | null = null, runId: string | null = null): OverviewDestinationV1 =>
      ({ kind: "group", groupId, region, taskId, runId });
    const requirementDestination = (region: Extract<OverviewDestinationV1, {kind:"requirement"}>["region"]): OverviewDestinationV1 => ({kind:"requirement", groupId, region});
    const requirement = summary.requirement;
    const attendedRuns = new Set<string>();
    if (requirement !== undefined) {
      if (body.status === "clarifying" && requirement.roundState === "awaiting-answers") {
        add("requirement-answer", groupId, repoId, "awaiting-answers", requirementDestination("answers"), `round:${requirement.roundNo}`);
      }
      if (body.status === "clarifying" && requirement.draftState === "awaiting-review") {
        add("requirement-review", groupId, repoId, "awaiting-review", requirementDestination("draft"), `draft:${requirement.draftNo}`);
      }
      const reasons = new Set<string>();
      if (requirement.waiting !== null) reasons.add(requirement.waiting);
      if (requirement.reasonCode !== null) reasons.add(requirement.reasonCode);
      if (["failed", "interrupted"].includes(requirement.draftState ?? "")) reasons.add(`draft-${requirement.draftState}`);
      if (["failed", "interrupted"].includes(requirement.roundState ?? "") && body.status === "clarifying") reasons.add(`round-${requirement.roundState}`);
      if (requirement.usageUnknown && body.status === "clarifying") reasons.add("requirement-usage-unknown");
      if (requirement.exportState === "conflict") reasons.add("requirement-export-conflict");
      for (const reason of reasons) add("requirement-attention", groupId, repoId, reason, requirementDestination("problem"), `${requirement.draftNo ?? requirement.roundNo}:${reason}`, null, null, reason === "requirement-budget-exhausted");
      if (requirement.blockedRun !== null) {
        attendedRuns.add(requirement.blockedRun.runId);
        add("requirement-attention", groupId, repoId, requirement.blockedRun.reason ?? "requirement-run-blocked", requirementDestination("problem"), `run:${requirement.blockedRun.runId}`, null, requirement.blockedRun.runId);
      }
    }
    for (const blocker of blockers) {
      add("recovery-review", groupId, repoId, blocker.code,
        blocker.scope === "global" ? {kind:"recovery"} : groupDestination("problem", null, blocker.runId),
        JSON.stringify([blocker.scope, groupId, blocker.runId, blocker.code]), null, blocker.runId);
    }
    if (summary.stopState !== null) add("stop-review", groupId, repoId, summary.stopState, groupDestination("problem"), `stop:${summary.stopMode}`);
    if (body.ledger.usageUnknown && body.status !== "clarifying") add("recovery-review", groupId, repoId, "usage-unknown", groupDestination("problem"), JSON.stringify(["group", groupId, null, "usage-unknown"]), null, null, true);
    const capBlock = readSpendCapBlock(store, groupId);
    if (capBlock !== null) add(body.status === "clarifying" ? "requirement-attention" : "task-attention", groupId, repoId, "spend-cap-blocked", body.status === "clarifying" ? requirementDestination("problem") : groupDestination("problem"), "spend-cap-blocked", null, null, true);
    for (const work of workItems) {
      const run = work.currentRunId == null ? undefined : runById.get(work.currentRunId);
      if (work.status === "blocked" || work.status === "held" || run?.state === "blocked") {
        if (run !== undefined) attendedRuns.add(run.runId);
        const reason = run?.drive?.blockedReason ?? run?.failureCode ?? `task-${work.status === "held" ? "held" : "blocked"}`;
        add("task-attention", groupId, repoId, reason, groupDestination("problem", work.taskId, run?.runId ?? null), `task:${work.taskId}:${run?.runId ?? ""}`, work.taskId, run?.runId ?? null);
      }
      if (work.status === "start-unknown" && run === undefined) add("recovery-review", groupId, repoId, "start-unknown", groupDestination("problem", work.taskId), `task:${work.taskId}:start-unknown`, work.taskId);
    }
    for (const run of runs) {
      if (!run.active) continue;
      if (UNKNOWN_RUN.has(run.state) || run.unknown.work || run.unknown.handoff) {
        const reason = run.unknown.work || run.unknown.handoff ? "usage-unknown" : run.failureCode ?? run.state;
        add("recovery-review", groupId, repoId, reason, groupDestination("problem", run.taskId, run.runId), JSON.stringify(["run", groupId, run.runId, reason]), run.taskId, run.runId, run.unknown.work || run.unknown.handoff);
      }
      if (run.state === "blocked" && !attendedRuns.has(run.runId)) {
        const reason = run.drive?.blockedReason ?? run.failureCode ?? "run-blocked";
        add("recovery-review", groupId, repoId, reason, groupDestination("problem", run.taskId, run.runId), JSON.stringify(["run", groupId, run.runId, reason]), run.taskId, run.runId);
      }
    }
    const integration = readGroupIntegration(body);
    if (integration?.state === "conflict" || integration?.state === "blocked") add("integration-review", groupId, repoId, integration.reason ?? `integration-${integration.state}`, groupDestination("integration"), `integration:${integration.schemeHash}`, null, null, true);
    // Dir-requirements spec §9.3: a stopped (or missing, or failed) placement is a needs-you row on the group's
    // integration region, which shows the placement block instead of the scheme picker.
    const placement = summary.placement;
    if (placement !== undefined) {
      const reason = ({ "folder-changed": "dir-folder-changed", "folder-unwritable": "dir-folder-unwritable", "folder-missing": "dir-folder-missing", failed: "dir-placement-failed" } as Record<string, string | undefined>)[placement.state];
      if (reason !== undefined) add("integration-review", groupId, repoId, reason, groupDestination("integration"), `placement:${placement.state}:${placement.watch ?? placement.detail ?? ""}`, null, null, true);
    }
    for (const estimate of estimates) {
      if (estimate.state === "start-unknown") add("recovery-review", groupId, repoId, "estimate-start-unknown", groupDestination("problem"), `estimate:${estimate.estimateId}:start-unknown`);
    }
    const estimateLaunching = estimates.some(row => ["running", "start-unknown"].includes(String(row.state)));
    const estimateInFlight = estimates.some(row => ["queued", "running", "start-unknown"].includes(String(row.state)));
    if (proposal?.state === "editable" && !estimateInFlight) add("budget-review", groupId, repoId, "proposal-editable", groupDestination("preparation"), `proposal:${proposal.proposalVersion}`, null, null, integration !== null);
    const pendingWake = store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id=? AND delivered=0").all(groupId)
      .some(row => ["start", "no-start", "resume", "continuation"].includes(String(row.kind)));
    const claimable = workItems.some(work => work.status === "ready" && work.dependsOn.every(id => workById.get(id)?.status === "done"));
    const executionBusy = workItems.some(work => BUSY_WORK.has(work.status)) || runs.some(run => run.active);
    if (summary.state === "ready" && proposal?.state === "confirmed" && proposal.executionSnapshotHash !== null
      && claimable && !executionBusy && !estimateLaunching && !pendingWake && !store.dispatchBlocked && !body.ledger.usageUnknown
      && summary.stopState === null && !summary.claimBlocked && capBlock === null
      && (!hasRequirementBlock(body as {requirement?:unknown}) || requirement?.exportState === "done")) {
      add("start-review", groupId, repoId, "ready-to-start-review", groupDestination("dispatch"), `proposal:${proposal.proposalVersion}`);
    }
  }
  // Flow engine spec §6.2: a flow run's groups are shown by its run page (Task 16), not here.
  for (const row of store.db.prepare(`SELECT g.id AS id FROM groups g WHERE ${flowRoleSql("g")} IS NULL ORDER BY g.id`).all()) {
    const groupId = String(row.id);
    let repoId: string | null = null;
    try {
      const source = readOverviewGroupSource(store, groupId);
      if (source === null) continue;
      repoId = source.summary.repoId;
      if (source.summary.archived) continue;
      // Build into the request-local map, rolling back this group's rows if a later stored fact is corrupt.
      groupSteps(source);
      groups.push(source.summary);
    } catch (error) {
      for (const [key, step] of steps) if (step.groupId === groupId) steps.delete(key);
      issues.push({ groupId, repoId, reason: error instanceof ControlError ? error.detail ?? error.code : "stored-group-invalid" });
    }
  }
  // Ownerless global recovery stays ownerless. A service safety latch is observable even without a blocker row.
  for (const row of store.db.prepare("SELECT group_id,run_id,scope,code,body FROM recovery_blockers WHERE scope='global' AND group_id IS NULL ORDER BY id").all()) {
    try {
      const blocker = decodeRecoveryBlockerRow(row,"ownerless-global");
      add("recovery-review", null, null, blocker.code, {kind:"recovery"}, JSON.stringify(["global", null, blocker.runId, blocker.code]), null, blocker.runId);
    } catch {
      issues.push({groupId:null,repoId:null,reason:"recovery-blocker-invalid"});
    }
  }
  if (store.dispatchBlocked) add("recovery-review", null, null, "dispatch-blocked", {kind:"recovery"}, JSON.stringify(["global", null, null, "dispatch-blocked"]));
  return overviewSchema.parse({ schema:"orca-control-overview-v1", epoch, changeSeq, groups,
    steps:[...steps.values()].sort((a,b) => PRIORITY[a.kind] - PRIORITY[b.kind] || compareText(a.key,b.key)), issues });
}
