import type { JSX } from "react";
import type { RepositoryWorkspaceV1 } from "./controlTypes.js";

/**
 * Execution driver spec §3.2: how a repository's runs get their workspace. The server holds the value
 * and its revision; this only names the choice and the revision it was read at, and the change reaches
 * only runs that start afterwards.
 */
export function WorkspaceModeSelector(props: { workspace: RepositoryWorkspaceV1; onChange: (mode: "worktree" | "clone", expectedRevision: number) => void }): JSX.Element {
  const { workspace } = props;
  return (
    <section aria-label="Workspace mode">
      <h3>Workspace mode</h3>
      <p>
        New runs in {workspace.repoId} use {workspace.workspaceMode === "worktree" ? "a git worktree" : "a private clone"} (setting revision {workspace.revision}). Runs already started keep theirs.
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
          {mode === "worktree" ? "git worktree (default)" : "private clone"}
        </label>
      ))}
    </section>
  );
}
