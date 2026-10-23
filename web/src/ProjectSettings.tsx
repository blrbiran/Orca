/** Progress spec §4: only a resolved concrete target can expose repository default changes. App owns commands. */
import { RefusalNotice } from "./RefusalNotice.js";
import type { ControlRefusal } from "./controlState.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceModeSelector } from "./WorkspaceModeSelector.js";
import { RepositoryIntegration } from "./IntegrationScheme.js";
import { ChecksSettings } from "./ChecksSettings.js";
import { FlowSettings } from "./FlowSettings.js";
import type { IntegrationSchemeV1, RepositoryIntegrationV1, RepositoryWorkspaceV1 } from "./controlTypes.js";

export function ProjectSettings(props: {
  refusal?: ControlRefusal | null;
  repoId: string | null;
  repoLabel: string | null;
  /** Gaps spec §11: the project's path (repository or folder), shown muted under the heading. */
  repoPath?: string | null;
  /** Flow engine spec §5.1 (IR-I7): a folder project's groups never integrate, so its integration settings are not shown. */
  dir?: boolean;
  workspace: RepositoryWorkspaceV1 | null;
  integration: RepositoryIntegrationV1 | null;
  onWorkspaceMode: (mode: "worktree" | "clone", revision: number) => void;
  onIntegrationScheme: (scheme: IntegrationSchemeV1, revision: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="settings" aria-label={t("nav.projectSettings")}>
      {/* Gaps spec §11: the heading names the project it sets; its path sits muted under it. */}
      <h2>{props.repoId === null ? t("nav.projectSettings") : t("settings.projectHeading", { project: props.repoLabel ?? props.repoId })}</h2>
      {props.repoId !== null && props.repoPath != null && <p className="section-meta" data-testid="project-settings-path">{props.repoPath}</p>}
      {props.refusal && <RefusalNotice refusal={props.refusal} testId="project-settings-refusal" />}
      {props.repoId === null ? <p role="note">{t("settings.chooseProject")}</p> : (
        <>
          <p>{t("settings.projectScope", { project: props.repoLabel ?? props.repoId })}</p>
          {props.workspace === null ? <p role="status">{t("settings.workspaceUnavailable")}</p> : <WorkspaceModeSelector workspace={props.workspace} onChange={props.onWorkspaceMode} />}
          {props.dir === true ? <p role="note">{t("settings.dirNoIntegration")}</p>
            : props.integration === null ? <p role="status">{t("settings.integrationUnavailable")}</p> : <RepositoryIntegration integration={props.integration} onSave={props.onIntegrationScheme} />}
          {/* Checks spec 2026-10-22 §7: the project's checks, each field with its source layer; it reads and writes them itself. */}
          {props.dir !== true && <ChecksSettings key={props.repoId} scope={{ repoId: props.repoId }} />}
          {/* Flow engine spec §11.2: the project's flow settings, each field with its source and lock. */}
          <FlowSettings key={`flows-${props.repoId}`} scope={{ repoId: props.repoId }} projectName={props.repoLabel ?? props.repoId} />
        </>
      )}
    </section>
  );
}
