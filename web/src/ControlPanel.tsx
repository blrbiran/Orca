/**
 * Task 9: the control panel's shell.
 *
 * Every number and state on this page is the server's: the panel polls the
 * summary, re-reads whichever group is open, and shows the ledger's own answer
 * to a command it is still waiting on. The one thing a browser is allowed to
 * originate is an intent -- which button was pressed and under which revision --
 * so nothing here decides whether a group may start, how much budget is free, or
 * whether an unknown run is finished.
 */
import type { JSX } from "react";
import { nextCommandId, type ControlAction } from "./controlApi.js";
import { ControlGroupView } from "./ControlGroupView.js";
import { RecoveryView } from "./RecoveryView.js";
import { WorkspaceModeSelector } from "./WorkspaceModeSelector.js";
import type { ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1, RepositoryWorkspaceV1 } from "./controlTypes.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";

export interface ControlPanelProps {
  config: ControlConfigV1;
  summary: ControlSummaryV1;
  recovery: RecoveryViewV1;
  groups: Record<string, GroupViewV1>;
  selected: string | null;
  drafts: Record<string, string>;
  uncertain: UncertainCommand[];
  refusal: ControlRefusal | null;
  refetchRequired: boolean;
  onSelect: (groupId: string) => void;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /** Execution driver spec §3.2: the first trusted repository's workspace mode, once read. */
  workspace?: RepositoryWorkspaceV1 | null;
  onWorkspaceMode?: (mode: "worktree" | "clone", expectedRevision: number) => void;
}

function ImportForm(props: { config: ControlConfigV1; onCommand: (action: ControlAction) => void }): JSX.Element {
  const repository = props.config.repositories[0];
  const plan = props.config.plans[0];
  return (
    <section aria-label="Import plan">
      <h3>Import a plan</h3>
      {props.config.defaults === null ? (
        <p role="note">
          No estimator profile is configured for this panel, so a plan cannot be imported. Restart it
          with --estimator-profile and --estimate-mode.
        </p>
      ) : repository === undefined || plan === undefined ? (
        <p role="note">No trusted repository and plan are configured for this panel.</p>
      ) : (
        <>
          <p>
            {repository.displayName} · {plan.displayName} · estimate mode {props.config.defaults?.estimateMode ?? "not configured"}
          </p>
          <button
            type="button"
            onClick={() => {
              const groupId = `group-${nextCommandId()}`;
              props.onCommand({
                verb: "import-plan",
                groupId,
                expectedRevision: 0,
                payload: {
                  groupId,
                  repoId: repository.repoId,
                  planId: plan.planId,
                  estimatorProfileId: props.config.defaults!.estimatorProfileId,
                  estimatorProfileHash: props.config.defaults!.estimatorProfileHash,
                  estimateMode: props.config.defaults!.estimateMode,
                },
              });
            }}
          >
            Import plan
          </button>
        </>
      )}
    </section>
  );
}

export function ControlPanel(props: ControlPanelProps): JSX.Element {
  const { config, summary, recovery, groups, selected, drafts, uncertain, refusal, refetchRequired } = props;
  const view = selected === null ? undefined : groups[selected];
  const waiting = uncertain.filter((command) => command.groupId === (selected ?? command.groupId));
  return (
    <section aria-label="Task control">
      <h2>Task control</h2>
      <p>
        epoch {summary.epoch} · projection {summary.changeSeq} ·{" "}
        {summary.dispatchBlocked ? "dispatch blocked" : "dispatch live"}
      </p>
      {/*
        * Ruling R6. Read from the config's own field, never inferred from profiles[].probeFailureCode:
        * that answers a per-profile, per-probe question, and this one is per process for the life of
        * the epoch. A panel with no port still serves every read -- which is the point, because the
        * reads are what a person needs after a crash -- so this says why the commands will refuse.
        */}
      {config.executionPort === "unconfigured" && (
        <p role="alert">
          no execution port configured · this panel serves recovery and evidence, and refuses to start
          work · set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it
        </p>
      )}
      {summary.resetRequired && <p role="alert">server reset required · this page must re-read before it trusts any cached view</p>}
      {refetchRequired && <p role="alert">projection refetch required · re-reading the open groups</p>}
      {recovery.dispatchBlocked && <p role="alert">dispatch blocked · recovery must be observed</p>}
      <ImportForm config={config} onCommand={props.onCommand} />
      {props.workspace && props.onWorkspaceMode && <WorkspaceModeSelector workspace={props.workspace} onChange={props.onWorkspaceMode} />}
      <nav aria-label="Control groups">
        {summary.groups.length === 0 && <p>No control groups yet.</p>}
        {summary.groups.map((group) => (
          <button key={group.groupId} type="button" aria-current={group.groupId === selected} onClick={() => props.onSelect(group.groupId)}>
            {group.groupId} · {group.state}
            {group.stopState !== null ? ` · ${group.stopState}` : ""}
            {group.recoveryBlockerCount > 0 ? ` · ${group.recoveryBlockerCount} blocker(s)` : ""}
          </button>
        ))}
      </nav>
      {view !== undefined && (
        <ControlGroupView
          view={view}
          config={config}
          uncertain={waiting}
          drafts={drafts}
          onDraft={props.onDraft}
          onCommand={props.onCommand}
        />
      )}
      {view === undefined && selected !== null && <p role="status">Reading {selected}…</p>}
      <RecoveryView recovery={recovery} group={view ?? null} onCommand={props.onCommand} />
      {waiting.length > 0 && (
        <p role="status">
          Command outcome unknown, being looked up: {waiting.map((command) => `${command.commandId} (${command.groupId})`).join(", ")}
        </p>
      )}
      {refusal !== null && (
        <p role="alert" data-status={refusal.status ?? ""}>
          {refusal.code}
          {refusal.status !== null ? ` · HTTP ${refusal.status}` : ""}
          {refusal.commandRevision !== null ? ` · server revision ${refusal.commandRevision}` : ""} · {refusal.message}
        </p>
      )}
    </section>
  );
}
