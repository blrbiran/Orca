/**
 * Project filtering spec §3: which projects the panel's lists show. A per-viewer convenience kept in this browser
 * only (like the chosen project, project.ts), so every storage call is wrapped. Pure: no React, no fetch.
 */
import type { ProjectsAnswerV1 } from "./project.js";

export const PROJECT_VIEW_KEY = "orca.projectView";
export type ProjectView = "project" | "all";
/** The scope lists are filtered by. `unresolved`: no project list yet, or it failed (plan decision P1). */
export type GroupScope = { kind: "unresolved" } | { kind: "all" } | { kind: "project"; repoId: string | null };
/** The sidebar <option> value of "All projects" only; never stored, never a projectKey (keys cannot hold NUL). */
export const ALL_PROJECTS = "\u0000all";

/** The stored view; anything else, or storage that throws, is "project". */
export function readProjectView(storage: Pick<Storage, "getItem"> | undefined): ProjectView {
  try {
    return storage?.getItem(PROJECT_VIEW_KEY) === "all" ? "all" : "project";
  } catch {
    return "project";
  }
}

export function writeProjectView(storage: Pick<Storage, "setItem"> | undefined, view: ProjectView): void {
  try {
    storage?.setItem(PROJECT_VIEW_KEY, view);
  } catch {
    // A lost choice only costs one click next time.
  }
}

/** "All projects" means something only with two or more projects. */
export const allowsAll = (projectCount: number): boolean => projectCount >= 2;

export function groupScope(answer: ProjectsAnswerV1 | null, project: string | null, view: ProjectView): GroupScope {
  if (answer === null) return { kind: "unresolved" };
  if (view === "all" && allowsAll(answer.projects.length)) return { kind: "all" };
  const chosen = answer.projects.find((entry) => entry.projectKey === project);
  return { kind: "project", repoId: chosen?.controlRepoId ?? null };
}

export function inScope(scope: GroupScope, repoId: string): boolean {
  if (scope.kind === "unresolved") return false;
  return scope.kind === "all" || repoId === scope.repoId;
}
