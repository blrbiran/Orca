/**
 * Kanban spec 2026-10-20 §7 layer 1: an owner turns the repository's integration check on or off and may name the one
 * command it runs instead of the landed groups' own checks. The newest run's outcome is shown as the server read it.
 */
import { useContext, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { IntegrationCheckSettingV1, IntegrationCheckV1 } from "./controlTypes.js";

export function IntegrationCheck(props: { check: IntegrationCheckV1; revision: number; onSave: (setting: IntegrationCheckSettingV1, expectedRevision: number) => void }): JSX.Element {
  const { t } = useTranslation();
  const mayChange = mayHumanOnly(useContext(AccountContext));
  const [enabled, setEnabled] = useState(props.check.enabled);
  const [command, setCommand] = useState(props.check.command ?? "");
  const last = props.check.last;
  const changed = enabled !== props.check.enabled || (command.trim() === "" ? null : command.trim()) !== props.check.command;
  return (
    <section aria-label={t("settings.integrationCheck.region")}>
      <h3>{t("settings.integrationCheck.region")}</h3>
      <p>{t("settings.integrationCheck.explain")}</p>
      {last !== null && (
        <p role="status" data-testid="integration-check-last">
          {t(`settings.integrationCheck.last.${last.state}` as const, { groups: last.groups.join(", "), detail: last.detail ?? "", debugGroupId: last.debugGroupId ?? "" })}
        </p>
      )}
      {mayChange ? (
        <form onSubmit={(event) => { event.preventDefault(); if (changed) props.onSave({ enabled, command: command.trim() === "" ? null : command.trim() }, props.revision); }}>
          <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> {t("settings.integrationCheck.enabled")}</label>
          <label>{t("settings.integrationCheck.command")} <input type="text" value={command} placeholder={t("settings.integrationCheck.commandPlaceholder")} onChange={(event) => setCommand(event.target.value)} /></label>
          <button type="submit" disabled={!changed}>{t("settings.integrationCheck.save")}</button>
        </form>
      ) : <p role="note">{t("control.integration.ownerOnly")}</p>}
    </section>
  );
}
