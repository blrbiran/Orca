import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RepositoryWorkspaceV1 } from "./controlTypes.js";

/**
 * Execution driver spec §3.2: how a repository's runs get their workspace. The server holds the value
 * and its revision; this only names the choice and the revision it was read at, and the change reaches
 * only runs that start afterwards.
 */
export function WorkspaceModeSelector(props: { workspace: RepositoryWorkspaceV1; onChange: (mode: "worktree" | "clone", expectedRevision: number) => void }): JSX.Element {
  const { t } = useTranslation();
  const { workspace } = props;
  return (
    <section aria-label={t("control.workspace.region")}>
      <h3>{t("control.workspace.region")}</h3>
      <p>
        {t("control.workspace.line", {
          repoId: workspace.repoId,
          mode: t(workspace.workspaceMode === "worktree" ? "control.workspace.aWorktree" : "control.workspace.aClone"),
          revision: workspace.revision,
        })}
      </p>
      {(["worktree", "clone"] as const).map((mode) => (
        <label key={mode}>
          <input
            type="radio"
            name={`workspace-mode-${workspace.repoId}`}
            value={mode}
            checked={workspace.workspaceMode === mode}
            onChange={() => props.onChange(mode, workspace.revision)}
          />
          {t(mode === "worktree" ? "control.workspace.worktreeOption" : "control.workspace.cloneOption")}
        </label>
      ))}
    </section>
  );
}
