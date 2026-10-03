/**
 * Project switcher spec D2: which project this browser is working on. A per-viewer convenience, so it lives in this
 * browser only and every storage call is wrapped: a private window or blocked site data leaves the page working, on
 * the first project.
 */
export const PROJECT_KEY = "orca.project";

/** GET /api/projects -- src/panel/projects.ts. */
export interface ProjectV1 {
  projectKey: string;
  /** The control plane's repoId for this project, or null when the control plane does not hold it. */
  controlRepoId: string | null;
}

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
