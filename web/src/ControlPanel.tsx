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
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AgentSettings } from "./AgentSettings.js";
import { nextCommandId, type ControlAction } from "./controlApi.js";
import { ControlGroupView } from "./ControlGroupView.js";
import { RecoveryView } from "./RecoveryView.js";
import { WorkspaceModeSelector } from "./WorkspaceModeSelector.js";
import { enumText, refusalText } from "./i18n.js";
import { hashFor } from "./sections.js";
import { ALL_PROJECTS, inScope } from "./projectScope.js";
import type { GroupScope } from "./projectScope.js";
import type {
  AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, ControlConfigV1, ControlSummaryV1, GroupViewV1, OperatorPreferencesV1,
  RecoveryViewV1, RepositoryWorkspaceV1,
} from "./controlTypes.js";
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
  /**
   * Project switcher spec D4: the chosen project's control repository. Undefined when no project is chosen (the first
   * repository, as before); null when the control plane does not hold the chosen project.
   */
  repoId?: string | null;
  onSelect: (groupId: string) => void;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /** W5: commands one control sends in order (BudgetEditor's onCommands). */
  onCommands?: (actions: ControlAction[]) => void;
  /** Execution driver spec §3.2: the chosen project's repository workspace mode (project mode only), once read. */
  workspace?: RepositoryWorkspaceV1 | null;
  /** Project filtering spec §5: one repository's workspace, so an open group's detail uses its own, not the panel's. */
  workspaceFor?: (repoId: string) => RepositoryWorkspaceV1 | null;
  onWorkspaceMode?: (mode: "worktree" | "clone", expectedRevision: number) => void;
  /** Agent selection spec §6.8: the installation table and this operator's defaults, once read. */
  agents?: AgentsViewV1 | null;
  preferences?: AgentPreferencesViewV1 | null;
  /** The server's agent resolution per group, keyed by groupId. */
  previews?: Record<string, AgentSelectionPreviewV1>;
  onAgentPreferences?: (preferences: OperatorPreferencesV1, expectedRevision: number) => void;
  /** Drop a group's agent preview and read it again (the operator's Re-read). */
  onRereadPreview?: (groupId: string) => void;
  /** The server's code for why the installation table or the preferences could not be read. */
  agentsFailure?: string | null;
  /** Ruling review R17: what the page's retry of the agent reads is doing, if anything. */
  retryNotice?: string | null;
  /**
   * Project filtering spec §5: which groups the list shows. Undefined: every group, as before. `unresolved`: none,
   * with a note (plan decision P1); `all`: every group, each labelled with its repository.
   */
  scope?: GroupScope;
  /** Plan decision P5: a repository's name for a row or an uncertain command. */
  repoLabel?: (repoId: string) => string;
  /** Spec §6: the repositories an import may target in All projects -- the registered projects' control repositories. */
  targets?: readonly string[];
}

interface ImportFormProps {
  config: ControlConfigV1;
  repoId?: string | null;
  scope?: GroupScope;
  targets?: readonly string[];
  repoLabel?: (repoId: string) => string;
  onCommand: (action: ControlAction) => void;
}

function ImportForm(props: ImportFormProps): JSX.Element {
  const { t } = useTranslation();
  const scope = props.scope;
  const all = scope?.kind === "all";
  // Spec §6: in All projects the target is this form's own choice, empty until the person makes one -- never the first.
  const [target, setTarget] = useState("");
  const fixed = scope === undefined ? props.repoId : scope.kind === "project" ? scope.repoId : undefined;
  const repository = all
    ? props.config.repositories.find((entry) => entry.repoId === target)
    : fixed === undefined
      ? props.config.repositories[0]
      : props.config.repositories.find((entry) => entry.repoId === fixed);
  const plans = repository === undefined ? [] : props.config.plans.filter((entry) => entry.repoId === repository.repoId);
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = plans.find((entry) => entry.planId === planId) ?? plans[0];
  const choices = props.config.repositories.filter((entry) => (props.targets ?? []).includes(entry.repoId));
  return (
    <section aria-label={t("control.import.region")}>
      <h3>{t("control.import.title")}</h3>
      {props.config.defaults === null ? (
        <p role="note">{t("control.import.noEstimator")}</p>
      ) : scope?.kind === "unresolved" ? (
        <p role="note">{t("project.listUnavailable")}</p>
      ) : fixed === null ? (
        <p role="note">{t("control.import.notUnderControl")}</p>
      ) : all ? (
        <>
          <label>
            {t("control.import.repository")}
            <select value={target} onChange={(e) => { setTarget(e.currentTarget.value); setPlanId(null); }}>
              <option value="" disabled>{t("project.chooseTarget")}</option>
              {choices.map((entry) => <option key={entry.repoId} value={entry.repoId}>{props.repoLabel?.(entry.repoId) ?? entry.displayName}</option>)}
            </select>
          </label>
          {plans.length > 1 && plan !== undefined && (
            <label>
              {t("control.import.plan")}
              <select value={plan.planId} onChange={(e) => setPlanId(e.currentTarget.value)}>
                {plans.map((entry) => <option key={entry.planId} value={entry.planId}>{entry.displayName}</option>)}
              </select>
            </label>
          )}
          <button type="button" disabled={repository === undefined || plan === undefined} onClick={() => {
            if (repository !== undefined && plan !== undefined) importPlan(props, repository.repoId, plan.planId);
          }}>
            {t("control.import.button")}
          </button>
        </>
      ) : repository === undefined || plan === undefined ? (
        <p role="note">{t("control.import.noRepository")}</p>
      ) : (
        <>
          <p>
            {t("control.import.summary", {
              repository: repository.displayName,
              plan: plan.displayName,
              mode: props.config.defaults === null ? t("control.import.notConfigured") : enumText("budgetMode", props.config.defaults.estimateMode),
            })}
          </p>
          {plans.length > 1 && (
            <label>
              {t("control.import.plan")}
              <select value={plan.planId} onChange={(e) => setPlanId(e.currentTarget.value)}>
                {plans.map((entry) => <option key={entry.planId} value={entry.planId}>{entry.displayName}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => importPlan(props, repository.repoId, plan.planId)}>
            {t("control.import.button")}
          </button>
        </>
      )}
    </section>
  );
}

function importPlan(props: ImportFormProps, repoId: string, planId: string): void {
  const groupId = `group-${nextCommandId()}`;
  props.onCommand({
    verb: "import-plan",
    groupId,
    expectedRevision: 0,
    payload: {
      groupId,
      repoId,
      planId,
      estimatorProfileId: props.config.defaults!.estimatorProfileId,
      estimatorProfileHash: props.config.defaults!.estimatorProfileHash,
      estimateMode: props.config.defaults!.estimateMode,
    },
  });
}

export function ControlPanel(props: ControlPanelProps): JSX.Element {
  const { t } = useTranslation();
  const { config, summary, recovery, groups, selected, drafts, uncertain, refusal, refetchRequired } = props;
  const view = selected === null ? undefined : groups[selected];
  const scope = props.scope;
  const listed = scope === undefined ? summary.groups : summary.groups.filter((group) => inScope(scope, group.repoId));
  // In All projects a row names its repository, after today's text (spec §5).
  const label = (repoId: string): string => (scope?.kind === "all" ? ` · ${props.repoLabel?.(repoId) ?? repoId}` : "");
  // The open group's detail gets its own uncertain commands; the panel line lists every one, in every project (P4, spec §7).
  const waiting = uncertain.filter((command) => command.groupId === (selected ?? command.groupId));
  const ownerLabel = (groupId: string): string => {
    const repoId = summary.groups.find((group) => group.groupId === groupId)?.repoId;
    return repoId === undefined || props.repoLabel === undefined ? "" : ` · ${props.repoLabel(repoId)}`;
  };
  return (
    <section aria-label={t("control.title")}>
      <h2>{t("control.title")}</h2>
      <p>
        {t("control.summaryLine", { epoch: summary.epoch, seq: summary.changeSeq, dispatch: t(summary.dispatchBlocked ? "common.dispatchBlocked" : "common.dispatchLive") })}
      </p>
      {/*
        * Ruling R6. Read from the config's own field, never inferred from profiles[].probeFailureCode:
        * that answers a per-profile, per-probe question, and this one is per process for the life of
        * the epoch. A panel with no port still serves every read -- which is the point, because the
        * reads are what a person needs after a crash -- so this says why the commands will refuse.
        */}
      {config.executionPort === "unconfigured" && (
        <p role="alert">{t("control.noPort")}</p>
      )}
      {summary.resetRequired && <p role="alert">{t("control.resetRequired")}</p>}
      {refetchRequired && <p role="alert">{t("control.refetchRequired")}</p>}
      {recovery.dispatchBlocked && <p role="alert">{t("control.dispatchBlockedRecovery")}</p>}
      {/* Keyed by repository, so another project starts on its own first plan. */}
      <ImportForm
        key={scope?.kind === "all" ? ALL_PROJECTS : (scope?.kind === "project" ? scope.repoId : props.repoId) ?? ""}
        config={config} repoId={props.repoId} scope={scope} targets={props.targets} repoLabel={props.repoLabel} onCommand={props.onCommand}
      />
      {props.workspace && props.onWorkspaceMode && <WorkspaceModeSelector workspace={props.workspace} onChange={props.onWorkspaceMode} />}
      {props.agents && props.preferences && props.onAgentPreferences && (
        <AgentSettings agents={props.agents} preferences={props.preferences} drafts={drafts} onDraft={props.onDraft} onSave={props.onAgentPreferences} />
      )}
      <nav aria-label={t("control.groupsNav")}>
        {scope?.kind === "unresolved" ? (
          // Plan decision P1: with no project list a row could belong to any project, so none is shown.
          <p role="note">{t("project.listUnavailable")}</p>
        ) : listed.length === 0 && <p>{t("control.noGroups")}</p>}
        {listed.map((group) => group.state === "clarifying" ? (
          // N1 spec §11.2: a clarifying group has no group view (DR25); it is operated in Requirements until accept.
          <a key={group.groupId} href={hashFor("requirements")}>{group.groupId} · {enumText("groupState", group.state)} · {t("control.requirementBadge")}{label(group.repoId)}</a>
        ) : (
          <button key={group.groupId} type="button" aria-current={group.groupId === selected} onClick={() => props.onSelect(group.groupId)}>
            {group.groupId} · {enumText("groupState", group.state)}
            {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
            {group.stopState !== null ? ` · ${enumText("stopState", group.stopState)}` : ""}
            {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
            {label(group.repoId)}
          </button>
        ))}
      </nav>
      {view !== undefined && (
        <ControlGroupView
          key={view.summary.groupId}
          view={view}
          config={config}
          uncertain={waiting}
          drafts={drafts}
          onDraft={props.onDraft}
          onCommand={props.onCommand}
          onCommands={props.onCommands}
          agents={props.agents}
          preview={props.previews?.[view.summary.groupId] ?? null}
          agentPreferences={props.preferences?.preferences ?? null}
          onRereadPreview={props.onRereadPreview && (() => props.onRereadPreview?.(view.summary.groupId))}
          agentsFailure={props.agentsFailure}
          retryNotice={props.retryNotice}
          workspace={props.workspace}
          workspaceFor={props.workspaceFor}
        />
      )}
      {view === undefined && selected !== null && <p role="status">{t("control.reading", { groupId: selected })}</p>}
      <RecoveryView recovery={recovery} group={view ?? null} onCommand={props.onCommand} />
      {uncertain.length > 0 && (
        <p role="status">
          {t("control.outcomeUnknown", { commands: uncertain.map((command) => `${command.commandId} (${command.groupId}${ownerLabel(command.groupId)})`).join(", ") })}
        </p>
      )}
      {refusal !== null && (
        <p role="alert" data-status={refusal.status ?? ""}>
          {refusal.code}
          {refusal.status !== null ? t("panelErrors.httpStatus", { status: refusal.status }) : ""}
          {refusal.commandRevision !== null ? t("panelErrors.serverRevision", { revision: refusal.commandRevision }) : ""} · {refusalText(refusal)}
        </p>
      )}
    </section>
  );
}
