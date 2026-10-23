/**
 * Project switcher spec D2: which project this browser is working on. A per-viewer convenience, so it lives in this
 * browser only and every storage call is wrapped: a private window or blocked site data leaves the page working, on
 * the first project.
 */
export const PROJECT_KEY = "orca.project";

/** GET /api/projects -- src/panel/projects.ts. */
export interface ProjectV1 {
  projectKey: string;
  /** Project registry spec §6: display name; older answers omit it and use the key. */
  name?: string;
  path?: string;
  /** The control plane's repoId for this project, or null when the control plane does not hold it. */
  controlRepoId: string | null;
  /** Flow engine spec §5.1: present only on a plain folder worked on through a vault; absent is a repository. */
  kind?: "dir";
}

export interface ProjectsAnswerV1 {
  source?: "file" | "command-line";
  editable?: boolean;
  projects: ProjectV1[];
  pendingRestart?: string[];
  fileError?: string | null;
}

export const projectName = (project: ProjectV1): string => project.name ?? project.projectKey;

/** Flow engine spec §5.1: the kind of the project a control repository belongs to; a repository when none is listed. */
export const projectKindForRepo = (projects: readonly ProjectV1[], repoId: string | null): "repo" | "dir" =>
  projects.find((project) => project.controlRepoId !== null && project.controlRepoId === repoId)?.kind === "dir" ? "dir" : "repo";

/**
 * Plan decision P5 (moved here from App.tsx for gaps spec §11, G11): a control repository's name is its project's, else
 * the config's display name, else the repoId itself -- never the selected project's name. A `dir` project is listed
 * like a repository, so it resolves to its project name too.
 */
export function repoLabelOf(projects: readonly ProjectV1[] | null | undefined, repositories: ReadonlyArray<{ repoId: string; displayName: string }>, repoId: string): string {
  const owner = projects?.find((entry) => entry.controlRepoId === repoId);
  if (owner !== undefined) return projectName(owner);
  return repositories.find((entry) => entry.repoId === repoId)?.displayName ?? repoId;
}

/** Gaps spec §11: the path (repository or folder) of the project a control repository belongs to; null when unknown. */
export const repoPathOf = (projects: readonly ProjectV1[] | null | undefined, repoId: string | null): string | null =>
  (repoId === null ? undefined : projects?.find((entry) => entry.controlRepoId === repoId)?.path) ?? null;

export function readProject(storage: Pick<Storage, "getItem"> | undefined): string | null {
  try {
    return storage?.getItem(PROJECT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeProject(storage: Pick<Storage, "setItem"> | undefined, projectKey: string): void {
  try {
    storage?.setItem(PROJECT_KEY, projectKey);
  } catch {
    // A lost choice only costs one click next time.
  }
}

/** The stored project while it is still listed, else the first one, else none. */
export function pickProject(projects: readonly ProjectV1[], stored: string | null): string | null {
  if (stored !== null && projects.some((project) => project.projectKey === stored)) return stored;
  return projects[0]?.projectKey ?? null;
}
