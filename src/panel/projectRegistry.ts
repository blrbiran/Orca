/**
 * Project registry spec §5 (session 3d68f934), with §12 C2–C4. The one writer of the projects file inside the panel
 * and the one thing that changes the running project list.
 *
 * - Hand edits are seen by a stat-signature check on every list()/add()/rename() (the hermes-agent design): a new
 *   project or a new name applies; a removal, a path change or a controlStateDir change waits for a restart and is
 *   named in `pendingRestart`; a broken file keeps the last good list and is named in `fileError`.
 * - Every step is synchronous, so two requests never interleave inside one process (C3). Across processes the
 *   base-hash check right before the rename refuses a write whose base moved (C4) -- last-writer-wins is accepted
 *   only inside that narrow window (spec §3).
 * - New projects are appended to `repos` -- the very `opts.repos` array every consumer reads per request (C2) --
 *   and nothing is ever removed from it at runtime.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join as joinPath, posix, relative, sep } from "node:path";
import { compareText } from "../control/webProtocol.js";
import type { TrustedPlanConfig, TrustedRepositoryConfig } from "./controlConfig.js";
import { controlRepoKey } from "./controlOptions.js";
import {
  deriveProjectId, isFiledPlanPath, projectKindOf, readProjectsFile, sameSignature, writeProjectsFile,
  type FileSignature, type MultiDirMember, type MultiDirProjectEntryV1, type ProjectEntryV1, type ProjectPlanV1,
  type ProjectsFileRead, type ProjectsFileV1,
} from "./projectsFile.js";

export interface RegistryControl {
  check(entry: TrustedRepositoryConfig): void;
  add(entry: TrustedRepositoryConfig): void;
  rename(repoId: string, displayName: string): void;
  /** Multi-directory projects spec §4.3: the runtime's multi map, when the control plane has one. */
  addMulti?(entry: { repoId: string; displayName: string; dirs: MultiDirMember[] }): void;
  setMultiDirs?(repoId: string, dirs: MultiDirMember[]): void;
  /** Spec §4.3: rename a multi entry in the runtime's multi map (it is never a single repository). */
  renameMulti?(repoId: string, displayName: string): void;
  /** Spec §4.3: forget a multi entry the loader dropped, so a later assembly map does not keep a stale id. */
  removeMulti?(repoId: string): void;
  /** In-repo plan path spec 2026-10-21: absent on a control plane that cannot hold runtime plans (criteria fakes). */
  checkPlan?(entry: TrustedPlanConfig): void;
  addPlan?(entry: TrustedPlanConfig): void;
}

export interface ProjectsListV1 {
  source: "file";
  editable: true;
  projects: ProjectEntryV1[];
  /** Multi-directory projects spec §4.1: present only when one is registered, like `kind` on a single row. */
  multiDirProjects?: MultiDirProjectEntryV1[];
  pendingRestart: string[];
  fileError: string | null;
}

export class ProjectRegistryError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ProjectRegistryError";
  }
}

export interface ProjectRegistry {
  list(): ProjectsListV1;
  add(name: string, path: string): ProjectEntryV1;
  rename(id: string, name: string): ProjectEntryV1 | MultiDirProjectEntryV1;
  /** Multi-directory projects spec §4.2: create one, under the same member checks as an edit. */
  addMulti(name: string, dirs: string[]): MultiDirProjectEntryV1;
  /** Spec §4.2: replace a multi project's ordered member list. */
  setDirs(id: string, dirs: string[]): MultiDirProjectEntryV1;
  /** In-repo plan path spec 2026-10-21 §2.2: register (or re-trust) a plan file of a project. */
  addPlan(projectId: string, path: string): ProjectPlanV1;
}

/** Spec 2026-10-21 §2.2: whether `rel` (relative to `repo`) is in git's index. */
function gitTracked(repo: string, rel: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: repo, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

const planSlug = (rel: string): string => rel.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "plan";

function gitTopLevel(dir: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function createProjectRegistry(input: {
  file: string;
  boot: ProjectsFileRead;
  repos: Array<{ projectKey: string; path: string }>;
  control: RegistryControl | null;
  /** Injected only by criteria; the real one asks `git rev-parse --show-toplevel`. */
  topLevel?: (dir: string) => string | null;
}): ProjectRegistry {
  if (input.boot.kind === "invalid") throw new Error("createProjectRegistry: an invalid file must have been refused at boot");
  const { file, repos, control } = input;
  const topLevel = input.topLevel ?? gitTopLevel;
  const empty = (): ProjectsFileV1 => ({ version: 1, projects: [] });

  const bootConfig = input.boot.kind === "valid" ? input.boot.config : empty();
  const bootStateDir = bootConfig.controlStateDir ?? null;
  const running: ProjectEntryV1[] = bootConfig.projects.map((p) => ({ ...p }));
  const runningMulti: MultiDirProjectEntryV1[] = [];
  /** Each running multi's members by real path, so a hand edit is compared rather than silently re-resolved. */
  const multiPaths = new Map<string, string[]>();
  let lastGood: ProjectsFileV1 = bootConfig;
  let lastHash: string | null = input.boot.hash;
  let seen: FileSignature | null = input.boot.signature;
  let pendingRestart: string[] = [];
  let fileError: string | null = null;

  const fail = (code: string, status: number, message: string): never => { throw new ProjectRegistryError(code, status, message); };

  /** The canonical directory a new project names, or a refusal; the same checks for the API and for a hand edit. */
  const checkedPath = (path: string): string => {
    if (!isAbsolute(path)) fail("project-path-missing", 422, `${JSON.stringify(path)} is not an absolute path`);
    let real: string;
    try {
      real = realpathSync(path);
      if (!statSync(real).isDirectory()) throw new Error("not a directory");
    } catch {
      return fail("project-path-missing", 422, `${path} is not an existing directory`);
    }
    const top = topLevel(real);
    let topReal: string | null = null;
    try { topReal = top === null ? null : realpathSync(top); } catch { topReal = null; }
    if (topReal !== real) fail("project-path-not-repository-root", 422, `${path} is not the top level of a git repository`);
    return real;
  };

  const realOf = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
  /** The project already running or filed under this directory, by canonical path, or undefined. */
  const holderOf = (real: string): string | undefined =>
    [...running, ...lastGood.projects].find((p) => realOf(p.path) === real)?.id;

  /** Two names of one directory: the same spelling, or the same inode (a case-insensitive filesystem). */
  const sameDir = (a: string, b: string): boolean => {
    if (a === b) return true;
    try { const left = statSync(a); const right = statSync(b); return left.dev === right.dev && left.ino === right.ino; }
    catch { return false; }
  };

  /**
   * Whether `child` is `parent` or below it. Walked by inode at every step: two spellings of one tree (a
   * case-insensitive filesystem) share no path string but every ancestor of the child still matches the parent.
   * A sibling is never an ancestor, so a name like `..cache` stays a plain component.
   */
  const inside = (child: string, parent: string): boolean => {
    let at = child;
    for (;;) {
      if (sameDir(at, parent)) return true;
      const up = dirname(at);
      if (up === at) return false;
      at = up;
    }
  };
  /**
   * Multi-directory projects spec §4.1/§4.2: the ordered members, checked by name. Two writers on one tree are
   * refused: equal real paths, or one inside the other in either direction.
   */
  const checkedDirs = (dirs: readonly string[], projects: readonly ProjectEntryV1[], multis: readonly MultiDirProjectEntryV1[]): MultiDirMember[] => {
    if (dirs.length < 2) fail("multi-dir-too-few", 422, "a multi-directory project needs between 2 and 8 projects");
    if (dirs.length > 8) fail("multi-dir-too-many", 422, "a multi-directory project needs between 2 and 8 projects");
    const seen = new Set<string>();
    for (const id of dirs) {
      if (seen.has(id)) fail(`multi-dir-member-duplicate:${id}`, 422, `${id} is listed twice`);
      seen.add(id);
    }
    for (const id of dirs) {
      if (multis.some((m) => m.id === id)) fail(`multi-dir-member-not-single:${id}`, 422, `${id} is itself a multi-directory project`);
      if (!projects.some((p) => p.id === id)) fail(`multi-dir-member-unknown:${id}`, 422, `${id} is not a registered single project`);
    }
    const members = dirs.map((id): MultiDirMember => {
      const p = projects.find((entry) => entry.id === id)!;
      return { key: id, name: p.name, repoId: controlRepoKey(id), kind: projectKindOf(p), path: p.path };
    });
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = realOf(members[i]!.path);
        const b = realOf(members[j]!.path);
        if (sameDir(a, b) || inside(a, b) || inside(b, a)) fail(`multi-dir-member-nested:${dirs[i]}:${dirs[j]}`, 422, `${dirs[i]} and ${dirs[j]} are the same directory or one is inside the other`);
      }
    }
    return members;
  };
  /** The loader's form of the same checks: one named message for an entry, or null. */
  const multiIssue = (entry: MultiDirProjectEntryV1, projects: readonly ProjectEntryV1[], multis: readonly MultiDirProjectEntryV1[]): string | null => {
    try { checkedDirs(entry.dirs, projects, multis); return null; }
    catch (error) { return error instanceof ProjectRegistryError ? error.code : (error as Error).message; }
  };
  const multiRuntime = (entry: MultiDirProjectEntryV1, projects: readonly ProjectEntryV1[]): { repoId: string; displayName: string; dirs: MultiDirMember[] } => ({
    repoId: controlRepoKey(entry.id), displayName: entry.name,
    dirs: entry.dirs.map((id) => { const p = projects.find((x) => x.id === id)!; return { key: id, name: p.name, repoId: controlRepoKey(id), kind: projectKindOf(p), path: p.path }; }),
  });
  const realPathsOf = (entry: MultiDirProjectEntryV1, projects: readonly ProjectEntryV1[]): string[] =>
    entry.dirs.map((id) => realOf(projects.find((p) => p.id === id)!.path));

  const controlEntry = (p: ProjectEntryV1): TrustedRepositoryConfig => ({ repoId: controlRepoKey(p.id), displayName: p.name, path: p.path });

  /**
   * Spec 2026-10-21 §2.2: a plan path of project `p` checked the way registration and boot both need it -- relative,
   * its real path a regular file inside the project's real path, tracked by git. Returns the filed relative path and
   * the real path; refuses by name.
   */
  const checkedPlan = (p: ProjectEntryV1, path: string): { rel: string; real: string } => {
    if (path.length === 0 || isAbsolute(path) || path.includes("\\")) fail("plan-path-invalid", 422, `${JSON.stringify(path)} is not a path relative to the project`);
    const projectReal = realOf(p.path);
    let real: string;
    try {
      real = realpathSync(joinPath(projectReal, path));
      if (!statSync(real).isFile()) throw new Error("not a file");
    } catch {
      return fail("plan-path-missing", 422, `${path} is not an existing file in ${p.id}`);
    }
    const rel = relative(projectReal, real);
    if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("plan-path-outside-project", 422, `${path} leads outside ${p.id}`);
    const filed = rel.split(sep).join(posix.sep);
    if (!isFiledPlanPath(filed)) fail("plan-path-invalid", 422, `${path} cannot be filed`);
    if (!gitTracked(projectReal, filed)) fail("plan-not-tracked", 422, `${filed} is not tracked by git in ${p.id}`);
    return { rel: filed, real };
  };
  const planEntry = (p: ProjectEntryV1, plan: ProjectPlanV1, real: string): TrustedPlanConfig =>
    ({ planId: plan.id, repoId: controlRepoKey(p.id), displayName: plan.path, path: real, sha256: plan.sha256 });
  /** Boot and hand-added projects (spec §2.4): each filed plan re-checked and joined; one that fails is skipped and named. */
  const joinPlans = (p: ProjectEntryV1): string[] => {
    const errors: string[] = [];
    for (const plan of p.plans ?? []) {
      try {
        if (!control?.addPlan) fail("plans-need-control", 409, "the task control plane is off");
        const { real } = checkedPlan(p, plan.path);
        control!.addPlan!(planEntry(p, plan, real));
      } catch (error) {
        errors.push(`plan ${plan.id}: ${(error as Error).message}`);
      }
    }
    return errors;
  };

  const precheck = (p: ProjectEntryV1): void => {
    try { control?.check(controlEntry(p)); }
    catch (error) { fail("project-path-refused", 422, `the task control plane refuses ${p.path}: ${(error as Error).message}`); }
  };

  const join = (p: ProjectEntryV1): void => {
    control?.add(controlEntry(p));
    running.push({ ...p });
    repos.push({ projectKey: p.id, path: p.path });
  };

  /** Diff a valid file against the running list and apply what may apply (spec §5). */
  const applyFrom = (config: ProjectsFileV1): void => {
    const pending: string[] = [];
    const errors: string[] = [];
    if ((config.controlStateDir ?? null) !== bootStateDir) pending.push("controlStateDir");
    for (const r of running) {
      const f = config.projects.find((p) => p.id === r.id);
      if (f === undefined) { pending.push(`removed:${r.id}`); continue; }
      if (realOf(f.path) !== realOf(r.path)) pending.push(`path:${r.id}`);
      // Spec 2026-10-21 §2.4: a hand edit of a running project's plans applies at the next start.
      if (JSON.stringify(f.plans ?? []) !== JSON.stringify(r.plans ?? [])) pending.push(`plans:${r.id}`);
      if (f.name !== r.name) { r.name = f.name; control?.rename(controlRepoKey(r.id), f.name); }
    }
    for (const f of config.projects) {
      if (running.some((r) => r.id === f.id)) continue;
      try {
        const real = checkedPath(f.path);
        const holder = running.find((r) => realOf(r.path) === real);
        if (holder !== undefined) fail("project-path-taken", 409, `${real} is already project ${holder.id}`);
        const entry: ProjectEntryV1 = { id: f.id, name: f.name, path: real, ...(f.plans === undefined ? {} : { plans: f.plans.map((plan) => ({ ...plan })) }) };
        precheck(entry);
        join(entry);
        errors.push(...joinPlans(entry));
      } catch (error) {
        errors.push(`project ${f.id}: ${(error as Error).message}`);
      }
    }
    // Multi-directory projects spec §4.1: a bad member reference skips that entry alone, and is named; the entry stays
    // in lastGood, so an edit cannot silently drop it. A removal or member move of a running one waits for a restart.
    const multis = config.multiDirProjects ?? [];
    const skipped = new Set<string>();
    for (const r of [...runningMulti]) {
      const f = multis.find((m) => m.id === r.id);
      if (f === undefined) { pending.push(`removed:${r.id}`); continue; }
      if (f.name !== r.name) {
        try { control?.renameMulti?.(controlRepoKey(r.id), f.name); r.name = f.name; }
        catch (error) { errors.push(`multi ${f.id}: ${(error as Error).message}`); }
      }
      const sameDirs = f.dirs.length === r.dirs.length && f.dirs.every((id, i) => id === r.dirs[i]);
      if (!sameDirs) {
        const issue = multiIssue(f, config.projects, multis);
        if (issue !== null) {
          errors.push(`multi ${f.id}: ${issue}`);
          const index = runningMulti.indexOf(r);
          if (index !== -1) runningMulti.splice(index, 1);
          multiPaths.delete(r.id);
          try { control?.removeMulti?.(controlRepoKey(r.id)); }
          catch (error) { errors.push(`multi ${f.id}: ${(error as Error).message}`); }
          skipped.add(r.id);
          continue;
        }
        try {
          control?.setMultiDirs?.(controlRepoKey(r.id), multiRuntime(f, config.projects).dirs);
          r.dirs = [...f.dirs];
          multiPaths.set(r.id, realPathsOf(f, config.projects));
        } catch (error) { errors.push(`multi ${f.id}: ${(error as Error).message}`); }
      } else {
        const recorded = multiPaths.get(r.id) ?? [];
        const missing = r.dirs.find((id) => !config.projects.some((p) => p.id === id));
        if (missing !== undefined) {
          // The member's removal reaches the runtime at the next start, as a single project's does: the multi keeps
          // its last-known members and stays named in pendingRestart.
          errors.push(`multi ${f.id}: multi-dir-member-unknown:${missing}`);
          pending.push(`multi:${f.id}`);
          continue;
        }
        if (r.dirs.some((id, i) => realOf(config.projects.find((p) => p.id === id)!.path) !== recorded[i])) pending.push(`multi:${f.id}`);
      }
    }
    for (const f of multis) {
      if (runningMulti.some((r) => r.id === f.id) || skipped.has(f.id)) continue;
      const issue = multiIssue(f, config.projects, multis);
      if (issue !== null) { errors.push(`multi ${f.id}: ${issue}`); continue; }
      try { control?.addMulti?.(multiRuntime(f, config.projects)); }
      catch (error) { errors.push(`multi ${f.id}: ${(error as Error).message}`); continue; }
      runningMulti.push({ id: f.id, name: f.name, dirs: [...f.dirs] });
      multiPaths.set(f.id, realPathsOf(f, config.projects));
    }
    pendingRestart = pending.sort(compareText);
    fileError = errors.length > 0 ? errors.join("; ") : null;
  };

  /** The hermes-style check: re-read only when the file's signature moved. */
  const refresh = (): void => {
    const read = readProjectsFile(file);
    if (sameSignature(read.signature, seen)) return;
    seen = read.signature;
    if (read.kind === "invalid") { fileError = read.reason; return; }
    const config = read.kind === "valid" ? read.config : empty();
    lastGood = config;
    lastHash = read.hash;
    applyFrom(config);
  };

  /** Write `next` unless the file moved since `lastHash` (§12 C4), then remember what was written. */
  const write = (next: ProjectsFileV1): void => {
    const now = readProjectsFile(file);
    if (now.hash !== lastHash) fail("projects-file-changed", 409, `${file} changed while this change was being made; re-read and retry`);
    const written = writeProjectsFile(file, next);
    lastGood = next;
    lastHash = written.hash;
    seen = written.signature;
  };

  const writable = (): void => {
    if (fileError !== null && readProjectsFile(file).kind === "invalid") fail("projects-file-invalid", 409, `${file} is invalid (${fileError}); fix it first`);
  };

  // The trusted config was built with display name = id; give it the file's names (spec §6).
  for (const p of running) if (p.name !== p.id) control?.rename(controlRepoKey(p.id), p.name);
  // In-repo plan path spec 2026-10-21 §2.4: the filed plans join at boot; one that no longer checks out is named.
  const bootPlanErrors = running.flatMap(joinPlans);
  // Multi-directory projects spec §4.1: boot validates member references the same way a hand edit does.
  const bootMultiErrors: string[] = [];
  for (const entry of bootConfig.multiDirProjects ?? []) {
    const issue = multiIssue(entry, bootConfig.projects, bootConfig.multiDirProjects ?? []);
    if (issue !== null) { bootMultiErrors.push(`multi ${entry.id}: ${issue}`); continue; }
    try { control?.addMulti?.(multiRuntime(entry, bootConfig.projects)); }
    catch (error) { bootMultiErrors.push(`multi ${entry.id}: ${(error as Error).message}`); continue; }
    runningMulti.push({ id: entry.id, name: entry.name, dirs: [...entry.dirs] });
    multiPaths.set(entry.id, realPathsOf(entry, bootConfig.projects));
  }
  const bootErrors = [...bootPlanErrors, ...bootMultiErrors];
  if (bootErrors.length > 0) fileError = bootErrors.join("; ");

  const view = (): ProjectsListV1 => ({
    source: "file", editable: true,
    projects: running.map((p) => ({ ...p })).sort((a, b) => compareText(a.id, b.id)),
    ...(runningMulti.length === 0 ? {} : {
      multiDirProjects: runningMulti.map((m) => ({ id: m.id, name: m.name, dirs: [...m.dirs] })).sort((a, b) => compareText(a.id, b.id)),
    }),
    pendingRestart: [...pendingRestart],
    fileError,
  });

  const containingName = (id: string | null, name: string): boolean =>
    [...lastGood.projects, ...(lastGood.multiDirProjects ?? [])].some((p) => p.id !== id && p.name === name);

  return {
    list() { refresh(); return view(); },
    add(name: string, path: string) {
      refresh();
      writable();
      const trimmed = name.trim();
      if (trimmed.length === 0) fail("project-name-invalid", 422, "a project needs a name");
      if (containingName(null, trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
      const real = checkedPath(path);
      if (holderOf(real) !== undefined) fail("project-path-taken", 409, `${real} is already a project`);
      // A multi project's id is taken too, so a single derived from the same name suffixes rather than clashing.
      const taken = new Set([...lastGood.projects, ...(lastGood.multiDirProjects ?? []), ...running, ...runningMulti].map((p) => p.id));
      const entry: ProjectEntryV1 = { id: deriveProjectId(trimmed, real, taken), name: trimmed, path: real };
      precheck(entry);
      write({ ...lastGood, projects: [...lastGood.projects, entry] });
      join(entry);
      return { ...entry };
    },
    addMulti(name: string, dirs: string[]) {
      refresh();
      writable();
      const trimmed = name.trim();
      if (trimmed.length === 0) fail("project-name-invalid", 422, "a project needs a name");
      if (containingName(null, trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
      const multis = lastGood.multiDirProjects ?? [];
      const members = checkedDirs(dirs, lastGood.projects, multis);
      const taken = new Set([...lastGood.projects, ...multis, ...running, ...runningMulti].map((p) => p.id));
      const entry: MultiDirProjectEntryV1 = { id: deriveProjectId(trimmed, members[0]!.path, taken), name: trimmed, dirs: [...dirs] };
      write({ ...lastGood, multiDirProjects: [...multis, entry] });
      runningMulti.push({ ...entry, dirs: [...entry.dirs] });
      multiPaths.set(entry.id, realPathsOf(entry, lastGood.projects));
      control?.addMulti?.(multiRuntime(entry, lastGood.projects));
      return { ...entry, dirs: [...entry.dirs] };
    },
    setDirs(id: string, dirs: string[]) {
      refresh();
      writable();
      const r = runningMulti.find((m) => m.id === id);
      const f = lastGood.multiDirProjects?.find((m) => m.id === id);
      if (r === undefined || f === undefined) return fail("project-unknown", 404, `no multi-directory project ${JSON.stringify(id)}`);
      const multis = lastGood.multiDirProjects ?? [];
      const members = checkedDirs(dirs, lastGood.projects, multis);
      const entry: MultiDirProjectEntryV1 = { ...f, dirs: [...dirs] };
      write({ ...lastGood, multiDirProjects: multis.map((m) => (m.id === id ? entry : m)) });
      r.dirs = [...dirs];
      multiPaths.set(id, realPathsOf(entry, lastGood.projects));
      control?.setMultiDirs?.(controlRepoKey(id), members);
      return { ...entry, dirs: [...entry.dirs] };
    },
    rename(id: string, name: string) {
      refresh();
      writable();
      const trimmed = name.trim();
      if (trimmed.length === 0) fail("project-name-invalid", 422, "a project needs a name");
      const m = runningMulti.find((p) => p.id === id);
      const fm = lastGood.multiDirProjects?.find((p) => p.id === id);
      if (m !== undefined && fm !== undefined) {
        if (containingName(id, trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
        write({ ...lastGood, multiDirProjects: lastGood.multiDirProjects!.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
        m.name = trimmed;
        control?.renameMulti?.(controlRepoKey(id), trimmed);
        return { ...m, dirs: [...m.dirs] };
      }
      const r = running.find((p) => p.id === id);
      const f = lastGood.projects.find((p) => p.id === id);
      if (r === undefined || f === undefined) return fail("project-unknown", 404, `no project ${JSON.stringify(id)}`);
      if (containingName(id, trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
      write({ ...lastGood, projects: lastGood.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
      r.name = trimmed;
      control?.rename(controlRepoKey(id), trimmed);
      return { ...r };
    },
    addPlan(projectId: string, path: string) {
      refresh();
      writable();
      const r = running.find((p) => p.id === projectId);
      const f = lastGood.projects.find((p) => p.id === projectId);
      if (r === undefined || f === undefined) return fail("project-unknown", 404, `no project ${JSON.stringify(projectId)}`);
      if (!control?.checkPlan || !control.addPlan) return fail("plans-need-control", 409, "plans can be registered only while the task control plane is on");
      const { rel, real } = checkedPlan(r, path);
      const sha256 = createHash("sha256").update(readFileSync(real)).digest("hex");
      const held = (f.plans ?? []).find((plan) => plan.path === rel);
      let id = held?.id;
      if (id === undefined) {
        const taken = new Set([...lastGood.projects, ...running].flatMap((p) => (p.plans ?? []).map((plan) => plan.id)));
        const base = `${projectId}.${planSlug(rel)}`;
        id = base;
        for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      }
      const plan: ProjectPlanV1 = { id, path: rel, sha256 };
      const entry = planEntry(r, plan, real);
      try { control.checkPlan(entry); }
      catch (error) { fail("plan-path-refused", 422, `the task control plane refuses ${rel}: ${(error as Error).message}`); }
      const nextPlans = (list: ProjectPlanV1[] | undefined): ProjectPlanV1[] =>
        held === undefined ? [...(list ?? []), plan] : (list ?? []).map((p) => (p.path === rel ? plan : p));
      write({ ...lastGood, projects: lastGood.projects.map((p) => (p.id === projectId ? { ...p, plans: nextPlans(p.plans) } : p)) });
      r.plans = nextPlans(r.plans);
      control.addPlan(entry);
      return { ...plan };
    },
  };
}
