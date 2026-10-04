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
import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { compareText } from "../control/webProtocol.js";
import type { TrustedRepositoryConfig } from "./controlConfig.js";
import { controlRepoKey } from "./controlOptions.js";
import {
  deriveProjectId, readProjectsFile, sameSignature, writeProjectsFile,
  type FileSignature, type ProjectEntryV1, type ProjectsFileRead, type ProjectsFileV1,
} from "./projectsFile.js";

export interface RegistryControl {
  check(entry: TrustedRepositoryConfig): void;
  add(entry: TrustedRepositoryConfig): void;
  rename(repoId: string, displayName: string): void;
}

export interface ProjectsListV1 {
  source: "file";
  editable: true;
  projects: ProjectEntryV1[];
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
  rename(id: string, name: string): ProjectEntryV1;
}

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

  const controlEntry = (p: ProjectEntryV1): TrustedRepositoryConfig => ({ repoId: controlRepoKey(p.id), displayName: p.name, path: p.path });

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
      if (f.name !== r.name) { r.name = f.name; control?.rename(controlRepoKey(r.id), f.name); }
    }
    for (const f of config.projects) {
      if (running.some((r) => r.id === f.id)) continue;
      try {
        const real = checkedPath(f.path);
        const holder = running.find((r) => realOf(r.path) === real);
        if (holder !== undefined) fail("project-path-taken", 409, `${real} is already project ${holder.id}`);
        const entry = { id: f.id, name: f.name, path: real };
        precheck(entry);
        join(entry);
      } catch (error) {
        errors.push(`project ${f.id}: ${(error as Error).message}`);
      }
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

  const view = (): ProjectsListV1 => ({
    source: "file", editable: true,
    projects: running.map((p) => ({ ...p })).sort((a, b) => compareText(a.id, b.id)),
    pendingRestart: [...pendingRestart],
    fileError,
  });

  return {
    list() { refresh(); return view(); },
    add(name: string, path: string) {
      refresh();
      writable();
      const trimmed = name.trim();
      if (trimmed.length === 0) fail("project-name-invalid", 422, "a project needs a name");
      if (lastGood.projects.some((p) => p.name === trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
      const real = checkedPath(path);
      if (holderOf(real) !== undefined) fail("project-path-taken", 409, `${real} is already a project`);
      const entry: ProjectEntryV1 = { id: deriveProjectId(trimmed, real, new Set([...lastGood.projects, ...running].map((p) => p.id))), name: trimmed, path: real };
      precheck(entry);
      write({ ...lastGood, projects: [...lastGood.projects, entry] });
      join(entry);
      return { ...entry };
    },
    rename(id: string, name: string) {
      refresh();
      writable();
      const r = running.find((p) => p.id === id);
      const f = lastGood.projects.find((p) => p.id === id);
      if (r === undefined || f === undefined) return fail("project-unknown", 404, `no project ${JSON.stringify(id)}`);
      const trimmed = name.trim();
      if (trimmed.length === 0) fail("project-name-invalid", 422, "a project needs a name");
      if (lastGood.projects.some((p) => p.id !== id && p.name === trimmed)) fail("project-name-taken", 409, `a project is already called ${JSON.stringify(trimmed)}`);
      write({ ...lastGood, projects: lastGood.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
      r.name = trimmed;
      control?.rename(controlRepoKey(id), trimmed);
      return { ...r };
    },
  };
}
