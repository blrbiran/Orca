/**
 * Task 9: recovery. A blocker is the ledger saying "this cannot go on until
 * something is proved" -- the page lists what, where and with which evidence, and
 * only offers the one command that re-observes it. Nothing here clears a blocker
 * locally, and an unknown outcome stays unknown until the server says otherwise.
 *
 * Project filtering spec §11 R1: a Retry is bound to its blocker's own target, and its command is built from that
 * target's own current summary when pressed (recoveryRetryAction) -- never from the open group's revision. A blocker
 * that cannot be retried now stays listed with its Retry disabled and a Re-read, which only reads.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import { initialControlState } from "./controlState.js";
import type { ControlClientState } from "./controlState.js";
import { EvidenceLink } from "./EvidenceLink.js";
import type { GroupViewV1, RecoveryViewV1 } from "./controlTypes.js";
import { enumText } from "./i18n.js";
import { recoveryRetryAction } from "./recoveryTarget.js";
import type { RecoveryTarget } from "./recoveryTarget.js";

export interface RecoveryViewProps {
  recovery: RecoveryViewV1;
  group: GroupViewV1 | null;
  /**
   * The control state Retry is judged against. Absent (a component rendered on its own), it is assembled from
   * `recovery` and `group` alone: a blocker of any other group then has no summary, so it cannot be retried.
   */
  state?: ControlClientState;
  /** App: build and send the command at click time from the latest state. Absent: build it here and call onCommand. */
  onRetry?: (target: RecoveryTarget) => void;
  /** Read the summary and recovery again. Absent: no Re-read is offered, since nothing could read. */
  onReread?: () => void;
  onCommand?: (action: ControlAction) => void;
  /** Plan decision P5: the target group's repository name, when its summary is known. */
  repoLabel?: (repoId: string) => string;
}

function assembled(recovery: RecoveryViewV1, group: GroupViewV1 | null): ControlClientState {
  return {
    ...initialControlState(),
    epoch: recovery.epoch,
    groups: group === null ? {} : { [group.summary.groupId]: group.summary },
    canonical: group === null ? {} : { [group.summary.groupId]: group },
    recovery,
  };
}

export function RecoveryView(props: RecoveryViewProps): JSX.Element {
  const { t } = useTranslation();
  const { recovery, group } = props;
  const state = props.state ?? assembled(recovery, group);
  if (!recovery.dispatchBlocked && recovery.blockers.length === 0 && (group?.recoveryBlockers.length ?? 0) === 0) {
    return <section aria-label={t("recovery.title")}><p>{t("recovery.none")}</p></section>;
  }
  const retry = (target: RecoveryTarget): JSX.Element => {
    const enabled = recoveryRetryAction(state, target) !== null;
    const press = (): void => {
      if (props.onRetry !== undefined) {
        props.onRetry(target);
        return;
      }
      const action = recoveryRetryAction(state, target);
      if (action !== null) props.onCommand?.(action);
    };
    return (
      <>
        <button type="button" disabled={!enabled} onClick={press}>{t("recovery.retry")}</button>
        {!enabled && props.onReread !== undefined && <button type="button" onClick={props.onReread}>{t("recovery.reread")}</button>}
      </>
    );
  };
  // Unknown or unlisted repositories keep the explicit group id alone as the label (spec §11 R1).
  const repo = (groupId: string): string => {
    const repoId = state.groups[groupId]?.repoId;
    return repoId === undefined || props.repoLabel === undefined ? "" : ` · ${props.repoLabel(repoId)}`;
  };

  return (
    <section aria-label={t("recovery.title")}>
      <h3>{t("recovery.title")}</h3>
      {recovery.dispatchBlocked && <p role="alert">{t("recovery.dispatchBlocked")}</p>}
      <ul>
        {recovery.blockers.map((blocker, index) => (
          <li key={`${blocker.scope}:${blocker.groupId}:${blocker.runId ?? "-"}:${blocker.code}:${index}`}>
            {enumText("blockerScope", blocker.scope)} · {blocker.groupId === "" ? t("recovery.allGroups") : `${blocker.groupId}${repo(blocker.groupId)}`}
            {blocker.runId !== null ? t("recovery.run", { runId: blocker.runId }) : ""} · {blocker.code}
            {blocker.evidenceIds.length > 0 ? t("recovery.evidence", { ids: blocker.evidenceIds.join(", ") }) : ""}
            {retry({ source: "recovery", epoch: recovery.epoch, groupId: blocker.groupId, runId: blocker.runId, code: blocker.code })}
          </li>
        ))}
        {group !== null && group.recoveryBlockers.map((blocker, index) => (
          <li key={`group-view:${blocker.scope}:${blocker.runId ?? "-"}:${blocker.code}:${index}`}>
            {enumText("blockerScope", blocker.scope)} · {group.summary.groupId}
            {blocker.runId !== null ? t("recovery.run", { runId: blocker.runId }) : ""} · {blocker.code}
            {blocker.evidenceIds.length > 0 ? t("recovery.evidence", { ids: blocker.evidenceIds.join(", ") }) : ""}
            {blocker.runId !== null && (
              <>
                <EvidenceLink runId={String(blocker.runId)} label={t("recovery.runEvidence")} />
                {retry({ source: "group-view", epoch: group.epoch, groupId: group.summary.groupId, runId: blocker.runId, code: blocker.code })}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
