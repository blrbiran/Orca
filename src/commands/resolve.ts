import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { EntryRejection } from "../entry/envelope.js";

/** A registered project as the panel lists it: its control repository id, its key and its root on disk. */
export interface ProjectRef { repoId: string; projectKey: string; path: string }

const real = (path: string): string => { try { return realpathSync(path); } catch { return resolvePath(path); } };
const holds = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && rel.split(sep)[0] !== "..");
};
const listed = (projects: readonly ProjectRef[]): string => projects.map((p) => `${p.repoId} (${p.path})`).join(", ");

/**
 * Spec §4 "Project": `--project` (repo id, project key, or a path inside one) wins; else the registered repository whose
 * root holds realpath(cwd) -- the deepest when they nest; else the only one; else project-ambiguous listing them.
 */
export function resolveProject(projects: readonly ProjectRef[], cwd: string, flag: string | undefined): ProjectRef {
  const byPath = (path: string): ProjectRef | null => {
    const at = real(path);
    const containing = projects.filter((p) => holds(real(p.path), at));
    containing.sort((a, b) => real(b.path).length - real(a.path).length);
    return containing[0] ?? null;
  };
  if (flag !== undefined) {
    const named = projects.find((p) => p.repoId === flag || p.projectKey === flag);
    if (named !== undefined) return named;
    const found = flag.includes("/") ? byPath(resolvePath(cwd, flag)) : null;
    if (found !== null) return found;
    throw new EntryRejection("project-not-found", `no registered project is ${JSON.stringify(flag)}; registered: ${listed(projects) || "none"}`);
  }
  const found = byPath(cwd);
  if (found !== null) return found;
  if (projects.length === 1) return projects[0]!;
  if (projects.length === 0) throw new EntryRejection("project-not-found", "the panel has no registered project");
  throw new EntryRejection("project-ambiguous", `cwd is in no registered project and there are several; pass --project <id|path>: ${listed(projects)}`);
}

/** Spec §4 "Ids": the full id, else a unique prefix (or slug); two matches is id-ambiguous listing them. */
export function resolveId(kind: string, given: string, candidates: readonly string[], slugs: ReadonlyMap<string, string> = new Map()): string {
  if (candidates.includes(given)) return given;
  const bySlug = slugs.get(given);
  if (bySlug !== undefined) return bySlug;
  const matches = candidates.filter((id) => id.startsWith(given));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new EntryRejection("id-ambiguous", `${kind} ${JSON.stringify(given)} matches ${matches.length}: ${matches.join(", ")}`);
  throw new EntryRejection("id-not-found", `no ${kind} ${JSON.stringify(given)}`);
}
