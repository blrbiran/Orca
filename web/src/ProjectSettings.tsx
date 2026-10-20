/** Progress spec §4: only a resolved concrete target can expose repository default changes. App owns commands. */
import { RefusalNotice } from "./RefusalNotice.js";
import type { ControlRefusal } from "./controlState.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceModeSelector } from "./WorkspaceModeSelector.js";
import { RepositoryIntegration } from "./IntegrationScheme.js";
import { IntegrationCheck } from "./IntegrationCheck.js";
import type { IntegrationCheckSettingV1, IntegrationSchemeV1, RepositoryIntegrationV1, RepositoryWorkspaceV1 } from "./controlTypes.js";

export function ProjectSettings(props: {
  refusal?: ControlRefusal | null;
  repoId: string | null;
  repoLabel: string | null;
  workspace: RepositoryWorkspaceV1 | null;
  integration: RepositoryIntegrationV1 | null;
  onWorkspaceMode: (mode: "worktree" | "clone", revision: number) => void;
  onIntegrationScheme: (scheme: IntegrationSchemeV1, revision: number) => void;
  /** Kanban spec §7 layer 1; absent, the check's section is not shown. */
  onIntegrationCheck?: (setting: IntegrationCheckSettingV1, revision: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="settings" aria-label={t("nav.projectSettings")}>
      <h2>{t("nav.projectSettings")}</h2>
      {props.refusal && <RefusalNotice refusal={props.refusal} testId="project-settings-refusal" />}
      {props.repoId === null ? <p role="note">{t("settings.chooseProject")}</p> : (
        <>
          <p>{t("settings.projectScope", { project: props.repoLabel ?? props.repoId })}</p>
          {props.workspace === null ? <p role="status">{t("settings.workspaceUnavailable")}</p> : <WorkspaceModeSelector workspace={props.workspace} onChange={props.onWorkspaceMode} />}
          {props.integration === null ? <p role="status">{t("settings.integrationUnavailable")}</p> : <RepositoryIntegration integration={props.integration} onSave={props.onIntegrationScheme} />}
          {props.integration?.integrationCheck !== undefined && props.onIntegrationCheck !== undefined && (
            // Keyed by the revision, so the form starts again from what the server holds after every change.
            <IntegrationCheck key={`${props.integration.repoId}:${props.integration.revision}`} check={props.integration.integrationCheck} revision={props.integration.revision} onSave={props.onIntegrationCheck} />
          )}
        </>
      )}
    </section>
  );
}
