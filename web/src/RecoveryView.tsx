/**
 * Task 9: recovery. A blocker is the ledger saying "this cannot go on until
 * something is proved" -- the page lists what, where and with which evidence, and
 * only offers the one command that re-observes it. Nothing here clears a blocker
 * locally, and an unknown outcome stays unknown until the server says otherwise.
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import { EvidenceLink } from "./EvidenceLink.js";
import type { GroupViewV1, RecoveryViewV1 } from "./controlTypes.js";

export interface RecoveryViewProps {
  recovery: RecoveryViewV1;
  group: GroupViewV1 | null;
  onCommand: (action: ControlAction) => void;
}

export function RecoveryView(props: RecoveryViewProps): JSX.Element {
  const { recovery, group, onCommand } = props;
  const revision = group?.summary.commandRevision ?? null;
  if (!recovery.dispatchBlocked && recovery.blockers.length === 0 && (group?.recoveryBlockers.length ?? 0) === 0) {
    return <section aria-label="Recovery"><p>No recovery blockers.</p></section>;
  }
  const retry = (payload: { scope: "group"; groupId: string } | { scope: "run"; runId: string }, groupId: string): JSX.Element | null =>
    revision === null ? null : (
      <button type="button" onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload })}>Retry recovery</button>
    );

  return (
    <section aria-label="Recovery">
      <h3>Recovery</h3>
      {recovery.dispatchBlocked && <p role="alert">dispatch blocked · the panel will not start new runs until recovery is observed</p>}
      <ul>
        {recovery.blockers.map((blocker, index) => (
          <li key={`${blocker.scope}:${blocker.groupId}:${blocker.runId ?? "-"}:${blocker.code}:${index}`}>
            {blocker.scope} · {blocker.groupId === "" ? "all groups" : blocker.groupId}
            {blocker.runId !== null ? ` · run ${blocker.runId}` : ""} · {blocker.code}
            {blocker.evidenceIds.length > 0 ? ` · evidence ${blocker.evidenceIds.join(", ")}` : ""}
            {blocker.runId !== null && retry({ scope: "run", runId: blocker.runId }, blocker.groupId)}
            {blocker.runId === null && blocker.groupId !== "" && retry({ scope: "group", groupId: blocker.groupId }, blocker.groupId)}
          </li>
        ))}
        {(group?.recoveryBlockers ?? []).map((blocker, index) => (
          <li key={`group-view:${blocker.scope}:${blocker.runId ?? "-"}:${blocker.code}:${index}`}>
            {blocker.scope} · {group?.summary.groupId}
            {blocker.runId !== null ? ` · run ${blocker.runId}` : ""} · {blocker.code}
            {blocker.evidenceIds.length > 0 ? ` · evidence ${blocker.evidenceIds.join(", ")}` : ""}
            {blocker.runId !== null && (
              <>
                <EvidenceLink runId={String(blocker.runId)} label="run evidence" />
                {retry({ scope: "run", runId: blocker.runId }, String(group?.summary.groupId ?? ""))}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
