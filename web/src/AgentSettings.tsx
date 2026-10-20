/**
 * Agent selection spec §6.8 (T15): the "Agents" settings page. It lists the installation table exactly as the
 * server read it from ccloop and edits this operator's defaults -- the default agent, each agent's model and
 * context, and the estimator and reconcile slots -- as one set-agent-preferences under the revision it read.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { SelectionFields, contextLabel, draftOf, draftText, installationOf, partialFromFields, selectionFieldErrors, textOrUndefined } from "./AgentFields.js";
import type { AgentPreferencesViewV1, AgentInstallationStateV1, AgentsViewV1, ModelListState, OperatorPreferencesV1 } from "./controlTypes.js";
import { explainBesideCode } from "./ccloopCodes.js";

const DEFAULT_AGENT_KEY = "agents:default-agent";
export const AGENTS_OPEN_KEY = "orca.panel.agentsOpen";

/** Spec §9.2 item 4: folded unless this browser opened it; storage may be absent or throw, which leaves it folded. */
function readOpen(): boolean {
  try { return localStorage.getItem(AGENTS_OPEN_KEY) === "1"; } catch { return false; }
}
function writeOpen(open: boolean): void {
  try { localStorage.setItem(AGENTS_OPEN_KEY, open ? "1" : "0"); } catch { /* not remembered */ }
}

export function preferencesFromDrafts(agents: AgentsViewV1, view: AgentPreferencesViewV1, drafts: Record<string, string>): OperatorPreferencesV1 {
  const prefs = view.preferences;
  const defaultAgent = textOrUndefined(draftText(drafts, DEFAULT_AGENT_KEY, prefs.defaultAgent ?? ""));
  const perAgent: OperatorPreferencesV1["perAgent"] = {};
  // An agent the table no longer lists keeps what the operator set for it; this page cannot edit it.
  for (const [id, entry] of Object.entries(prefs.perAgent)) if (installationOf(agents, id) === undefined) perAgent[id] = entry;
  for (const row of agents.installations) {
    const { model, contextWindow } = partialFromFields(agents, `agents:per:${row.id}`, prefs.perAgent[row.id], drafts, row.id);
    const entry = { ...(model === undefined ? {} : { model }), ...(contextWindow === undefined ? {} : { contextWindow }) };
    if (Object.keys(entry).length > 0) perAgent[row.id] = entry;
  }
  const slot = (name: "estimator" | "reconcile") => {
    // A stored model/context-only role belonged to the old primary. Changing the primary must not quietly
    // attach that role's model or context to another installation; choosing the role Agent explicitly opts in.
    const agentEdited = Object.hasOwn(drafts, `agents:${name}:agent`);
    const oldAgent = !agentEdited && prefs[name]?.agent === undefined && prefs.defaultAgent && prefs.defaultAgent !== defaultAgent
      ? prefs.defaultAgent : undefined;
    const partial = partialFromFields(agents, `agents:${name}`, prefs[name], drafts, oldAgent ?? defaultAgent);
    if (Object.keys(partial).length === 0) return undefined;
    if (oldAgent && partial.agent === undefined) {
      return { agent: oldAgent, ...partial };
    }
    return partial;
  };
  const estimator = slot("estimator");
  const reconcile = slot("reconcile");
  return {
    ...(defaultAgent === undefined ? {} : { defaultAgent }),
    perAgent,
    ...(estimator === undefined ? {} : { estimator }),
    ...(reconcile === undefined ? {} : { reconcile }),
  };
}

export interface AgentSettingsProps {
  agents: AgentsViewV1;
  preferences: AgentPreferencesViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onSave: (preferences: OperatorPreferencesV1, expectedRevision: number) => void;
  installationState?: AgentInstallationStateV1 | null;
  updateNotice?: string | null;
  updateBusy?: boolean;
  onDetectUpdates?: () => void;
  /** Agent version auto-refresh spec 2026-10-20 §3.3: record the versions the installed CLIs answer now. */
  onRefreshVersions?: () => void;
  onApplyUpdates?: (ids: string[]) => void;
  onRetryPendingUpdate?: () => void;
  unansweredCommandId?: string | null;
  /** Spec 2026-10-15 §5 (R3): each installation's model list as last read, and (owner only) re-probing one. */
  models?: (installationId: string) => ModelListState | undefined;
  onRefreshModels?: (installationId: string) => void;
}

export function AgentSettings(props: AgentSettingsProps): JSX.Element {
  const { agents, preferences, drafts, onDraft } = props;
  const { t } = useTranslation();
  const defaultText = draftText(drafts, DEFAULT_AGENT_KEY, preferences.preferences.defaultAgent ?? "");
  const defaultAgent = textOrUndefined(defaultText);
  const roleInheritedAgent = (name: "estimator" | "reconcile"): string | undefined =>
    prefsRoleFromOldPrimary(name) ? preferences.preferences.defaultAgent : defaultAgent;
  const prefsRoleFromOldPrimary = (name: "estimator" | "reconcile"): boolean =>
    !Object.hasOwn(drafts, `agents:${name}:agent`) && preferences.preferences.defaultAgent !== defaultAgent
    && preferences.preferences[name]?.agent === undefined
    && (preferences.preferences[name]?.model !== undefined || preferences.preferences[name]?.contextWindow !== undefined);
  const invalid = agents.installations.some((row) => selectionFieldErrors(agents, `agents:per:${row.id}`, preferences.preferences.perAgent[row.id], undefined, drafts, row.id, row.id).length > 0)
    || (["estimator", "reconcile"] as const).some((name) => selectionFieldErrors(agents, `agents:${name}`, preferences.preferences[name], undefined, drafts, roleInheritedAgent(name)).some((error) => error.field === "contextWindow"));
  const [open, setOpen] = useState(readOpen);
  const [accepted, setAccepted] = useState<{ previewId: string; ids: string[] }>({ previewId: "", ids: [] });
  const installation = props.installationState;
  const pendingUpdate = !!installation?.pending || !!props.unansweredCommandId;
  const pendingId = installation?.pendingCommand?.commandId ?? props.unansweredCommandId;
  const updatePreview = installation?.preview;
  const selected = updatePreview && accepted.previewId === updatePreview.previewId ? accepted.ids : [];
  return (
    <details open={open} onToggle={(event) => { const next = event.currentTarget.open; setOpen(next); writeOpen(next); }}>
    <summary><h3 className="agents-summary">{t("agents.title")}</h3></summary>
    <section aria-label={t("agents.settings.region")}>
      <p>
        {t("agents.settings.operatorLine", { operatorId: preferences.operatorId, revision: preferences.revision })}
      </p>
      {agents.installations.length === 0 && (
        <p role="note">
          {t("agents.settings.noInstallations")}
        </p>
      )}
      <table>
        <thead>
          <tr><th>{t("agents.settings.th.installation")}</th><th>{t("agents.settings.th.kind")}</th><th>{t("agents.settings.th.version")}</th><th>{t("agents.settings.th.defaultModel")}</th><th>{t("agents.settings.th.defaultContext")}</th></tr>
        </thead>
        <tbody>
          {agents.installations.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td><td>{row.kind}</td><td>{row.version}</td><td>{row.defaults.model}</td><td>{contextLabel(row.defaults.contextWindow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.onRefreshVersions && <button type="button" disabled={props.updateBusy} onClick={props.onRefreshVersions}>{t("agents.settings.refreshVersions")}</button>}
      {/* The detection section below shows the notice when it is there; without it, a refused refresh still says why. */}
      {!installation && props.updateNotice && <p role="alert">{props.updateNotice}</p>}
      {installation && <section aria-label={t("agents.updates.title")}>
        <h4>{t("agents.updates.title")}</h4>
        {installation.failureCode && <p role="status">{t("agents.updates.unavailable", { code: installation.failureCode })}{explainBesideCode(installation.failureCode) !== null ? ` ${explainBesideCode(installation.failureCode)}` : ""}</p>}
        {pendingUpdate && <div role="status"><p>{t("agents.updates.pending")}</p>
          {pendingId && <><code>{pendingId}</code> <button type="button" disabled={props.updateBusy} onClick={props.onRetryPendingUpdate}>{t("agents.updates.checkPending")}</button></>}
        </div>}
        {/* Issue #72: a row carries no failure code, so its unavailable status is not the panel-level "unavailable · {{code}}". */}
        {installation.observation && <>
          <p>{t("agents.updates.observedAt", { time: installation.observation.observedAt })}</p>
          <ul>{installation.observation.installed.map((row) => <li key={row.id}>
            {row.id}: {row.recordedVersion} → {row.observedVersion ?? t("agents.updates.noObservation")} ({t(row.status === "unavailable" ? "agents.updates.notDetected" : `agents.updates.${row.status}`)})
          </li>)}</ul>
        </>}
        <button type="button" disabled={props.updateBusy || pendingUpdate || installation.failureCode === "control-agent-update-unsupported"} onClick={props.onDetectUpdates}>{t("agents.updates.detect")}</button>
        {updatePreview && <>
          <p>{t("agents.updates.review")}</p>
          {updatePreview.changes.length === 0 ? <p role="status">{t("agents.updates.noChanges")}</p> : <ul>{updatePreview.changes.map((change) => <li key={change.changeId}>
            <label><input type="checkbox" disabled={change.unavailableReason !== undefined || (change.kind === "addition" && change.installation === undefined)} checked={selected.includes(change.changeId)} onChange={(event) => {
              const ids = event.currentTarget.checked ? [...selected, change.changeId] : selected.filter((id) => id !== change.changeId);
              setAccepted({ previewId: updatePreview.previewId, ids });
            }} />
            {t(`agents.updates.${change.kind}`)}: {change.installationId} — {change.version} ({change.command.join(" ")})
            </label>
            <div>{t("agents.updates.resolvedPath")}: <code style={{ overflowWrap: "anywhere" }}>{change.realpath}</code></div>
            {change.unavailableReason && <p role="alert">{t("agents.updates.changeUnavailable")} <code>{change.unavailableReason}</code></p>}
            {change.kind === "addition" && !change.unavailableReason && (change.installation === undefined
              ? <p role="alert">{t("agents.updates.configurationUnavailable")}</p>
              : <details open><summary>{t("agents.updates.installationConfiguration")}</summary>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(change.installation, null, 2)}</pre>
                </details>)}
          </li>)}</ul>}
          <button type="button" disabled={props.updateBusy || pendingUpdate || selected.length === 0} onClick={() => props.onApplyUpdates?.(selected)}>{t("agents.updates.apply")}</button>
        </>}
        {props.updateNotice && <p role="alert">{props.updateNotice}</p>}
      </section>}
      <div aria-label={t("agents.settings.primary")}>
        <h4>{t("agents.settings.primary")}</h4>
        <label>
          {t("agents.settings.defaultAgent")}
          <select name={DEFAULT_AGENT_KEY} value={defaultText} onChange={(event) => onDraft(DEFAULT_AGENT_KEY, draftOf(event.target.value))}>
            <option value="">{t("agents.settings.noDefault")}</option>
            {defaultAgent && !installationOf(agents, defaultAgent) && <option value={defaultAgent}>{defaultAgent}</option>}
            {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
          </select>
        </label>
        {defaultAgent && installationOf(agents, defaultAgent) ? (
          <SelectionFields agents={agents} prefix={`agents:per:${defaultAgent}`} label={t("agents.settings.perAgent", { agentId: defaultAgent })} fixedAgent={defaultAgent}
            current={preferences.preferences.perAgent[defaultAgent]} inheritedAgent={defaultAgent} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
        ) : <p role="note">{t("agents.fieldError.missingAgent")}</p>}
      </div>
      <details>
        <summary>{t("agents.settings.otherDefaults")}</summary>
        {agents.installations.filter((row) => row.id !== defaultAgent).map((row) => (
          <SelectionFields key={row.id} agents={agents} prefix={`agents:per:${row.id}`} label={t("agents.settings.perAgent", { agentId: row.id })} fixedAgent={row.id}
            current={preferences.preferences.perAgent[row.id]} inheritedAgent={row.id} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
        ))}
      </details>
      <details data-role-overrides="">
        <summary>{t("agents.settings.roleOverrides")}</summary>
        <SelectionFields agents={agents} prefix="agents:estimator" label={t("agents.settings.estimatorSlot")} current={preferences.preferences.estimator} inheritedAgent={roleInheritedAgent("estimator")} showMissingAgent={false} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
        <SelectionFields agents={agents} prefix="agents:reconcile" label={t("agents.settings.reconcileSlot")} current={preferences.preferences.reconcile} inheritedAgent={roleInheritedAgent("reconcile")} showMissingAgent={false} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
      </details>
      <button type="button" disabled={invalid} onClick={() => props.onSave(preferencesFromDrafts(agents, preferences, drafts), preferences.revision)}>{t("agents.settings.save")}</button>
    </section>
    </details>
  );
}
