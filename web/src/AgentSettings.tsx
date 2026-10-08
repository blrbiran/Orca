/**
 * Agent selection spec §6.8 (T15): the "Agents" settings page. It lists the installation table exactly as the
 * server read it from ccloop and edits this operator's defaults -- the default agent, each agent's model and
 * context, and the estimator and reconcile slots -- as one set-agent-preferences under the revision it read.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { SelectionFields, contextLabel, draftOf, draftText, installationOf, partialFromFields, textOrUndefined } from "./AgentFields.js";
import type { AgentPreferencesViewV1, AgentsViewV1, OperatorPreferencesV1 } from "./controlTypes.js";

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
    const partial = partialFromFields(agents, `agents:${name}`, prefs[name], drafts, defaultAgent);
    return Object.keys(partial).length === 0 ? undefined : partial;
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
}

export function AgentSettings(props: AgentSettingsProps): JSX.Element {
  const { agents, preferences, drafts, onDraft } = props;
  const { t } = useTranslation();
  const defaultText = draftText(drafts, DEFAULT_AGENT_KEY, preferences.preferences.defaultAgent ?? "");
  const defaultAgent = textOrUndefined(defaultText);
  const [open, setOpen] = useState(readOpen);
  return (
    <details open={open} onToggle={(event) => { const next = event.currentTarget.open; setOpen(next); writeOpen(next); }}>
    <summary><h3 style={{ display: "inline" }}>{t("agents.title")}</h3></summary>
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
      <label>
        {t("agents.settings.defaultAgent")}
        <select name={DEFAULT_AGENT_KEY} value={defaultText} onChange={(event) => onDraft(DEFAULT_AGENT_KEY, draftOf(event.target.value))}>
          <option value="">{t("agents.settings.noDefault")}</option>
          {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>
      {agents.installations.map((row) => (
        <SelectionFields
          key={row.id} agents={agents} prefix={`agents:per:${row.id}`} label={t("agents.settings.perAgent", { agentId: row.id })} fixedAgent={row.id}
          current={preferences.preferences.perAgent[row.id]} inheritedAgent={row.id} drafts={drafts} onDraft={onDraft}
        />
      ))}
      <SelectionFields agents={agents} prefix="agents:estimator" label={t("agents.settings.estimatorSlot")} current={preferences.preferences.estimator} inheritedAgent={defaultAgent} drafts={drafts} onDraft={onDraft} />
      <SelectionFields agents={agents} prefix="agents:reconcile" label={t("agents.settings.reconcileSlot")} current={preferences.preferences.reconcile} inheritedAgent={defaultAgent} drafts={drafts} onDraft={onDraft} />
      <button type="button" onClick={() => props.onSave(preferencesFromDrafts(agents, preferences, drafts), preferences.revision)}>{t("agents.settings.save")}</button>
    </section>
    </details>
  );
}
