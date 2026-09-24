/**
 * Task 9: one group, exactly as the server described it.
 *
 * The buttons here only name an intent and the revision this view was read at;
 * every answer -- accepted, refused, deferred, unknown -- comes back through the
 * reads. A run whose stop is still unresolved stays displayed as unresolved
 * rather than being painted green, because the ledger has not decided whether an
 * execution is still alive.
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import { BudgetEditor } from "./BudgetEditor.js";
import { EvidenceLink } from "./EvidenceLink.js";
import type { ControlConfigV1, ContinuationSelectionV1, GroupViewV1, RunViewV1 } from "./controlTypes.js";
import type { UncertainCommand } from "./controlState.js";

const short = (hash: string): string => hash.slice(0, 12);

/** A held run the person may continue: settled with a checkpoint to continue from. */
export function continuableRuns(view: GroupViewV1): Array<{ run: RunViewV1; checkpointId: string }> {
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.state !== "settled-recoverable") return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ run, checkpointId: checkpoint.checkpointId }] : [];
  });
}

export interface ControlGroupViewProps {
  view: GroupViewV1;
  config: ControlConfigV1;
  uncertain: UncertainCommand[];
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
}

export function ControlGroupView(props: ControlGroupViewProps): JSX.Element {
  const { view, config, uncertain, drafts, onDraft, onCommand } = props;
  const groupId = view.summary.groupId;
  const revision = view.summary.commandRevision;
  const handoffActive = view.summary.stopMode === "handoff";
  const continuable = continuableRuns(view);
  const selections = (): ContinuationSelectionV1[] =>
    continuable.map(({ run, checkpointId }) => ({ taskId: String(run.taskId), predecessorRunId: run.runId, checkpointId }));

  return (
    <section aria-label={`Control group ${groupId}`}>
      <h2>
        {groupId} · {view.summary.state} · revision {revision} · projection {view.summary.projectionSeq}
      </h2>
      {view.summary.claimBlocked && <p role="alert">claim blocked · new runs are not being started</p>}
      <p>
        {view.plan.goal} · plan {short(view.plan.planHash)} · graph v{view.graphVersion}
      </p>
      {view.stop !== null && (
        <p role="status">
          stop {view.stop.mode} {view.stop.state} · accepted {view.stop.acceptedAt ?? "n/a"} · deadline {view.stop.deadlineAt ?? "none"} ·{" "}
          {view.stop.frozenRunIds.length} frozen run(s): {view.stop.frozenRunIds.join(", ") || "none"}
        </p>
      )}
      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} />

      <h3>Work items</h3>
      <table>
        <thead>
          <tr><th>task</th><th>status</th><th>run</th><th>pending</th><th>depends on</th></tr>
        </thead>
        <tbody>
          {view.workItems.map((item) => (
            <tr key={item.taskId}>
              <td>{item.taskId}</td>
              <td>{item.status}</td>
              <td>{item.currentRunId ?? "none"}</td>
              <td>{item.pendingRunId ?? "none"}</td>
              <td>{item.dependencyTaskIds.join(", ") || "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Runs</h3>
      <table>
        <thead>
          <tr><th>run</th><th>phase</th><th>state</th><th>profile</th><th>used</th><th>remaining</th><th>evidence</th></tr>
        </thead>
        <tbody>
          {view.runs.map((run) => (
            <tr key={run.runId}>
              <td>{run.taskId ?? run.estimateId ?? run.runId}</td>
              <td>{run.phase}</td>
              <td>
                {run.state}
                {run.blockedReason ? ` — ${run.blockedReason}` : ""}
                {run.failureCode !== null ? ` (${run.failureCode})` : ""}
                {` · attempt ${run.providerAttemptOrdinal} of claim ${run.claimOrdinal ?? "n/a"}`}
              </td>
              <td>{run.profile.profileId} {short(run.profile.profileHash)}</td>
              <td>{run.used.tokens}</td>
              <td>{run.remaining.tokens}</td>
              <td>
                <EvidenceLink runId={run.runId} />
                {run.evidenceIds.length > 0 ? ` ${run.evidenceIds.join(", ")}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {view.handoffRequests.length > 0 && (
        <>
          <h3>Handoff requests</h3>
          <ul>
            {view.handoffRequests.map((request) => (
              <li key={request.requestId}>
                {request.requestId} · run {request.runId} · {request.state} · deadline {request.deadlineAt}
                {request.failureCode !== null ? ` · ${request.failureCode}` : ""} · evidence {request.evidenceIds.join(", ") || "none"}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.estimates.length > 0 && (
        <>
          <h3>Estimates</h3>
          <ul>
            {view.estimates.map((estimate) => (
              <li key={estimate.estimateId}>
                {estimate.estimateId} · v{estimate.estimateVersion} · {estimate.state} · {estimate.mode} profile{" "}
                {estimate.profile.profileId} {short(estimate.profile.profileHash)}
                {estimate.reasonCode !== null ? ` · ${estimate.reasonCode}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {uncertain.length > 0 && (
        <p role="status">Waiting for the ledger to answer: {uncertain.map((command) => command.commandId).join(", ")}</p>
      )}

      <h3>Dispatch</h3>
      {view.summary.state === "ready" && !handoffActive && (
        <button type="button" onClick={() => onCommand({ verb: "start", groupId, expectedRevision: revision, payload: {} })}>Start</button>
      )}
      {!handoffActive && view.summary.stopMode !== "pause" && (
        <>
          <button type="button" onClick={() => onCommand({ verb: "pause-dispatch", groupId, expectedRevision: revision, payload: {} })}>Pause dispatch</button>
          <button type="button" onClick={() => onCommand({ verb: "handoff-stop", groupId, expectedRevision: revision, payload: {} })}>Handoff stop</button>
        </>
      )}
      {view.summary.stopMode === "pause" && (
        <button type="button" onClick={() => onCommand({ verb: "resume-dispatch", groupId, expectedRevision: revision, payload: {} })}>Resume dispatch</button>
      )}
      {handoffActive && view.summary.stopState === "handoff-complete" && continuable.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: selections() } })}
          >
            Continue selected tasks ({continuable.length})
          </button>
          {continuable.map(({ run, checkpointId }) => (
            <button
              key={run.runId}
              type="button"
              onClick={() => onCommand({
                verb: "continue-task",
                groupId,
                taskId: String(run.taskId),
                expectedRevision: revision,
                payload: { predecessorRunId: run.runId, checkpointId },
              })}
            >
              Continue task {run.taskId}
            </button>
          ))}
        </>
      )}
      {view.recoveryBlockers.length > 0 && (
        <button
          type="button"
          onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "group", groupId } })}
        >
          Retry recovery for {groupId}
        </button>
      )}
      <p>Recent commands: {view.recentCommandIds.join(", ") || "none"}</p>
    </section>
  );
}
