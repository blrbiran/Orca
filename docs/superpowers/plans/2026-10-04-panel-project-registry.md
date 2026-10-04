# Panel project registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel keeps its projects in `~/.orca/projects.json`, always shows the current project at the top of the sidebar, and adds or renames a project from the page without a restart.

**Architecture:** A pure file module (`projectsFile.ts`: path, schema, id derivation, atomic write) and a synchronous registry (`projectRegistry.ts`) own the file. The registry appends new projects to the live `opts.repos` array every consumer already reads per request and tells the trusted control config (new `checkRepository` / `addRepository` / `renameRepository` / `hasRepository`). The real `orca panel` enters file mode at the process boundary; `parsePanelArgs` only learns an explicit `--projects-file`. The web gets one project control in the sidebar and a names context.

**Tech Stack:** TypeScript, Node 22, express, zod, vitest (+ jsdom, @testing-library/react for `web/`), React 18, i18next.

**Spec:** `docs/superpowers/specs/2026-10-04-panel-project-registry-design.md` — read §12 (plan-time corrections) first; it overrides §4–§7 where they differ.

## Global Constraints

- Session attribution in every commit body: `Orca session 3d68f934.` plus the two trailer lines
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011R9aYJnHfJXDpdJ3YM1YW9`.
- Code, comments, commit messages in English. Commit on the current branch (`main`); never push.
- Rule 17: no criterion reads or writes the real `~/.orca`. All file I/O goes through `ORCA_PROJECTS_FILE` / `ORCA_CONTROL_DIR` in temp directories. New dir `0700`, new file `0600`, an existing file's mode is kept.
- Command-line mode (`--repo` / `--root` given) is byte-for-byte today's behaviour.
- Existing criteria are not edited except those this plan names (spec P6): `web/tests/projectSwitcher.test.tsx` E; the four in `tests/panel/projectsApi.test.ts`; the `BY_HAND` list in `tests/panel/refusalCoverage.test.ts` (append only). Any other existing criterion that goes red: fix the implementation, or stop and report.
- Sort sets on the wire with `compareText` from `src/control/webProtocol.ts`, never `localeCompare`.
- Run single test files with `./node_modules/.bin/vitest run <file>` (root) or `./node_modules/.bin/vitest run --root web <file>` (web), output redirected to a file and read back whole (Rule 14). `rm` and `cp` are aliased with `-i` on this machine: use `/bin/rm`, and `cat a > b` instead of `cp`.
- Every new branch gets a mutation that deletes it, run in a `git clone --local` copy (never in the main tree), seen red; list the mutations and their red test names in the commit body.

## Review Focus

1. A hand-edited `projects.json` that is valid JSON but names a path that is not a repository root — the panel must keep serving and name the project in `fileError` (Task 3 criterion R7).
2. Adding the same directory twice through two spellings (a symlink and its target) — refused as `project-path-taken` (Task 3 criterion R4).
3. A name that derives an empty id (all non-ASCII, e.g. `订单`) — the id falls back to the path's last segment, then to `project` (Task 2 criterion F3).
4. The file deleted by hand while the panel runs — every running project becomes `removed:<id>` in `pendingRestart`, nothing is dropped from the running list (Task 3 criterion R6).
5. Two panels (or a hand edit) writing between the registry's read and its rename — refused as `projects-file-changed`, never a silent overwrite (Task 3 criterion R9).

---

### Task 1: ERRATUM on Orca's projectKey port

**Files:**
- Modify: `src/corrections/projectKey.ts` (append to the comment block above `TARGET_REMOTE_NOT_KEYABLE`)

**Interfaces:** none (comment only).

- [ ] **Step 1: Append the erratum** at the end of the doc comment that ends with `would be a different and misleading diagnosis for "your remote is not URL-shaped".`, keeping every existing line verbatim:

```ts
 *
 * *** ERRATUM (2026-10-04, Orca session 3d68f934, spec 2026-10-04-panel-project-registry-design.md §12 C7) ***
 * "ccmem has no normalisation for these shapes either (it throws the same way)" is no longer true: ccmem
 * (fix(project-key): follow a local-path origin instead of crashing on it) now follows a local-path origin to
 * that repository's own origin. This port deliberately still refuses: it also keys --root discovery, where a
 * `git clone --local` copy under the root would otherwise take its upstream's key and refuse the whole panel
 * with key-matches-multiple-paths. A refusal never splits a key silently. Text above kept verbatim.
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p . > /tmp/…/t1-tsc.txt 2>&1; echo RC=$?` (use the session scratchpad, not /tmp). Expected: `RC=0`.

- [ ] **Step 3: Commit** — `docs(corrections): ERRATUM -- ccmem now follows a local-path origin; this port still refuses it`

---

### Task 2: The projects file module

**Files:**
- Create: `src/panel/projectsFile.ts`
- Test: `tests/panel/projectsFile.test.ts`

**Interfaces:**
- Produces:
  - `projectsFilePath(env: NodeJS.ProcessEnv): string`
  - `PROJECT_ID_PATTERN: RegExp`
  - `deriveProjectId(name: string, path: string, taken: ReadonlySet<string>): string`
  - `interface ProjectEntryV1 { id: string; name: string; path: string }`
  - `interface ProjectsFileV1 { version: 1; controlStateDir?: string; projects: ProjectEntryV1[] }`
  - `interface FileSignature { mtimeNs: bigint; size: bigint; ino: bigint; ctimeNs: bigint }`
  - `type ProjectsFileRead = { kind: "missing"; signature: null; hash: null } | { kind: "valid"; config: ProjectsFileV1; signature: FileSignature; hash: string } | { kind: "invalid"; reason: string; signature: FileSignature | null; hash: string | null }`
  - `readProjectsFile(file: string): ProjectsFileRead`
  - `sameSignature(a: FileSignature | null, b: FileSignature | null): boolean`
  - `writeProjectsFile(file: string, config: ProjectsFileV1): { signature: FileSignature; hash: string }`
  - `hashText(text: string): string`

- [ ] **Step 1: Write the failing tests** (`tests/panel/projectsFile.test.ts`)

```ts
/**
 * Project registry spec §2/§3: the file is the person's project list, so its shape is strict (a typo is an invalid
 * file, never silently ignored), its writes are atomic and never widen its mode, and an id, once derived, is what
 * the control store and the review rows are keyed by -- so the derivation is pinned here.
 */
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveProjectId, projectsFilePath, readProjectsFile, sameSignature, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "projects-file-"));
const config = (over: Partial<ProjectsFileV1> = {}): ProjectsFileV1 => ({ version: 1, projects: [{ id: "orca", name: "orca", path: "/abs/orca" }], ...over });

describe("projectsFilePath", () => {
  it("P1: is ORCA_PROJECTS_FILE when set, else ~/.orca/projects.json", () => {
    expect(projectsFilePath({ ORCA_PROJECTS_FILE: "/x/p.json" })).toBe("/x/p.json");
    expect(projectsFilePath({ ORCA_PROJECTS_FILE: "" }).endsWith(join(".orca", "projects.json"))).toBe(true);
  });
});

describe("deriveProjectId", () => {
  it("F1: lowercases and replaces every run outside [a-z0-9._-] with one dash, trimming dashes and dots", () => {
    expect(deriveProjectId("My Web App!", "/r/x", new Set())).toBe("my-web-app");
    expect(deriveProjectId("..Orca..", "/r/x", new Set())).toBe("orca");
  });
  it("F2: appends -2, -3 on collision", () => {
    expect(deriveProjectId("orca", "/r/x", new Set(["orca", "orca-2"]))).toBe("orca-3");
  });
  it("F3: falls back to the path's last segment, then to project", () => {
    expect(deriveProjectId("订单", "/repos/order-svc", new Set())).toBe("order-svc");
    expect(deriveProjectId("订单", "/repos/订单", new Set())).toBe("project");
  });
});

describe("readProjectsFile", () => {
  it("R1: a missing file is missing, not invalid", () => {
    expect(readProjectsFile(join(dir(), "projects.json"))).toEqual({ kind: "missing", signature: null, hash: null });
  });
  it("R2: reads a valid file with its signature and hash", () => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, JSON.stringify(config({ controlStateDir: "/abs/state" })));
    const read = readProjectsFile(file);
    expect(read.kind).toBe("valid");
    if (read.kind !== "valid") return;
    expect(read.config.controlStateDir).toBe("/abs/state");
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    ["not json", "{"],
    ["unknown top-level key", JSON.stringify({ ...config(), extra: 1 })],
    ["unknown project key", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a", x: 1 }] })],
    ["wrong version", JSON.stringify({ ...config(), version: 2 })],
    ["relative path", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "a" }] })],
    ["bad id", JSON.stringify({ version: 1, projects: [{ id: "A b", name: "a", path: "/a" }] })],
    ["blank name", JSON.stringify({ version: 1, projects: [{ id: "a", name: "  ", path: "/a" }] })],
    ["duplicate id", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a" }, { id: "a", name: "b", path: "/b" }] })],
    ["duplicate name", JSON.stringify({ version: 1, projects: [{ id: "a", name: "x", path: "/a" }, { id: "b", name: "x", path: "/b" }] })],
    ["duplicate path", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a" }, { id: "b", name: "b", path: "/a" }] })],
    ["relative controlStateDir", JSON.stringify({ ...config(), controlStateDir: "state" })],
  ])("R3: %s is invalid, with a reason", (_label, text) => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, text);
    const read = readProjectsFile(file);
    expect(read.kind).toBe("invalid");
    if (read.kind === "invalid") expect(read.reason.length).toBeGreaterThan(0);
  });
});

describe("writeProjectsFile", () => {
  it("W1: creates the directory 0700 and the file 0600, and reads back what it wrote", () => {
    const file = join(dir(), "nested", "projects.json");
    const written = writeProjectsFile(file, config());
    expect(statSync(join(file, "..")).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const read = readProjectsFile(file);
    expect(read.kind === "valid" && read.config).toEqual(config());
    expect(read.kind === "valid" && read.hash).toBe(written.hash);
    expect(sameSignature(read.signature, written.signature)).toBe(true);
  });
  it("W2: keeps an existing file's mode and an existing directory's mode", () => {
    const root = dir();
    chmodSync(root, 0o755);
    const file = join(root, "projects.json");
    writeFileSync(file, JSON.stringify(config()));
    chmodSync(file, 0o644);
    writeProjectsFile(file, config({ projects: [] }));
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(statSync(root).mode & 0o777).toBe(0o755);
  });
  it("W3: leaves no temp file beside it", () => {
    const root = dir();
    writeProjectsFile(join(root, "projects.json"), config());
    expect(readdirSync(root)).toEqual(["projects.json"]);
  });
  it("W4: replaces the file atomically (a new inode), so a reader never sees half a file", () => {
    const file = join(dir(), "projects.json");
    writeProjectsFile(file, config());
    const before = statSync(file).ino;
    writeProjectsFile(file, config({ projects: [] }));
    expect(statSync(file).ino).not.toBe(before);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(config({ projects: [] }));
  });
});

it("S1: sameSignature compares all four fields", () => {
  const s = { mtimeNs: 1n, size: 2n, ino: 3n, ctimeNs: 4n };
  expect(sameSignature(s, { ...s })).toBe(true);
  for (const key of ["mtimeNs", "size", "ino", "ctimeNs"] as const) expect(sameSignature(s, { ...s, [key]: 9n })).toBe(false);
  expect(sameSignature(null, null)).toBe(true);
  expect(sameSignature(s, null)).toBe(false);
});
// keep mkdirSync referenced for editors that flag unused imports
void mkdirSync;
```

(Drop the `void mkdirSync` line and the import if your editor does not need it.)

- [ ] **Step 2: Run, expect red** — `./node_modules/.bin/vitest run tests/panel/projectsFile.test.ts > $S/t2-red.txt 2>&1; echo RC=$?` → non-zero, "Cannot find module … projectsFile".

- [ ] **Step 3: Implement** `src/panel/projectsFile.ts`

```ts
/**
 * Project registry spec §2/§3 (session 3d68f934): the person's project list, `~/.orca/projects.json`.
 *
 * Strict on purpose: an unknown key is a typo the person would otherwise never learn about. The path is read from
 * the env this process was given (Rule 17); the default is computed per call, never frozen at import.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

export const PROJECT_ID_PATTERN = /^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_])?$/;

export interface ProjectEntryV1 { id: string; name: string; path: string }
export interface ProjectsFileV1 { version: 1; controlStateDir?: string; projects: ProjectEntryV1[] }
export interface FileSignature { mtimeNs: bigint; size: bigint; ino: bigint; ctimeNs: bigint }
export type ProjectsFileRead =
  | { kind: "missing"; signature: null; hash: null }
  | { kind: "valid"; config: ProjectsFileV1; signature: FileSignature; hash: string }
  | { kind: "invalid"; reason: string; signature: FileSignature | null; hash: string | null };

export function projectsFilePath(env: NodeJS.ProcessEnv): string {
  const override = env.ORCA_PROJECTS_FILE;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca", "projects.json");
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/** Derived once, at add time; never recomputed (spec §2). */
export function deriveProjectId(name: string, path: string, taken: ReadonlySet<string>): string {
  let base = slug(name);
  if (base === "") base = slug(basename(path));
  if (base === "") base = "project";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

const absolute = z.string().min(1).refine((value) => isAbsolute(value), "must be an absolute path");
const projectSchema = z.object({
  id: z.string().regex(PROJECT_ID_PATTERN, "id must match [a-z0-9._-] and start and end with [a-z0-9_]"),
  name: z.string().refine((value) => value.trim().length > 0, "name must not be blank"),
  path: absolute,
}).strict();
const fileSchema = z.object({ version: z.literal(1), controlStateDir: absolute.optional(), projects: z.array(projectSchema) }).strict()
  .superRefine((value, ctx) => {
    for (const field of ["id", "name", "path"] as const) {
      const seen = new Set<string>();
      for (const project of value.projects) {
        if (seen.has(project[field])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${field} ${JSON.stringify(project[field])}` });
        seen.add(project[field]);
      }
    }
  });

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

function signatureOf(file: string): FileSignature | null {
  try {
    const stat = statSync(file, { bigint: true });
    return { mtimeNs: stat.mtimeNs, size: stat.size, ino: stat.ino, ctimeNs: stat.ctimeNs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function sameSignature(a: FileSignature | null, b: FileSignature | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeNs === b.mtimeNs && a.size === b.size && a.ino === b.ino && a.ctimeNs === b.ctimeNs;
}

export function readProjectsFile(file: string): ProjectsFileRead {
  const signature = signatureOf(file);
  if (signature === null) return { kind: "missing", signature: null, hash: null };
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { return { kind: "invalid", reason: `cannot read: ${(error as Error).message}`, signature, hash: null }; }
  const hash = hashText(text);
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (error) { return { kind: "invalid", reason: `not JSON: ${(error as Error).message}`, signature, hash }; }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: "invalid", reason: `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`, signature, hash };
  }
  return { kind: "valid", config: parsed.data as ProjectsFileV1, signature, hash };
}

/**
 * Atomic: a temp file beside the target, fsync'd, then renamed over it. A new file is 0600 in a 0700 directory;
 * an existing file keeps its mode (the temp file is created with it), an existing directory is not touched.
 */
export function writeProjectsFile(file: string, config: ProjectsFileV1): { signature: FileSignature; hash: string } {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let mode = 0o600;
  try { mode = statSync(file).mode & 0o777; } catch { /* new file */ }
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const temp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const fd = openSync(temp, "wx", mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  closeSync(fd);
  try { renameSync(temp, file); }
  catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
  return { signature: signatureOf(file)!, hash: hashText(text) };
}
```

Note: `openSync(temp, "wx", mode)` is still subject to the umask; with the usual `022` both `0600` and `0644` survive. If W2 goes red on a machine with a stricter umask, add `fchmodSync(fd, mode)` after `openSync`.

- [ ] **Step 4: Run, expect green** (same command). All of P1, F1–F3, R1–R3 (11 cases), W1–W4, S1 pass.

- [ ] **Step 5: Mutations in a clone** (each must turn at least one named test red): drop the `.strict()` on `fileSchema` (R3 unknown top-level key); drop the `superRefine` (R3 duplicates); drop the basename fallback (F3); replace `renameSync` with `writeFileSync(file, text)` and no temp (W4); keep `mode = 0o600` always (W2); compare only `mtimeNs` in `sameSignature` (S1).

- [ ] **Step 6: Commit** — `feat(panel): read and atomically write the projects file (~/.orca/projects.json)`

---

### Task 3: Trusted config growth and the project registry

**Files:**
- Modify: `src/panel/controlConfig.ts` (interface `TrustedControlConfig`, the object returned by `createTrustedControlConfig`)
- Modify: `src/panel/controlAssembly.ts` (`knownRepository`)
- Create: `src/panel/projectRegistry.ts`
- Test: `tests/panel/controlConfigRepositories.test.ts`, `tests/panel/projectRegistry.test.ts`

**Interfaces:**
- Consumes (Task 2): `readProjectsFile`, `writeProjectsFile`, `sameSignature`, `deriveProjectId`, `ProjectsFileRead`, `ProjectsFileV1`, `ProjectEntryV1`.
- Produces:
  - On `TrustedControlConfig`: `hasRepository(repoId: string): boolean`; `checkRepository(entry: TrustedRepositoryConfig): void`; `addRepository(entry: TrustedRepositoryConfig): void`; `renameRepository(repoId: string, displayName: string): void`.
  - `interface RegistryControl { check(entry: TrustedRepositoryConfig): void; add(entry: TrustedRepositoryConfig): void; rename(repoId: string, displayName: string): void }`
  - `interface ProjectsListV1 { source: "file"; editable: true; projects: ProjectEntryV1[]; pendingRestart: string[]; fileError: string | null }`
  - `class ProjectRegistryError extends Error { code: string; status: number }`
  - `interface ProjectRegistry { list(): ProjectsListV1; add(name: string, path: string): ProjectEntryV1; rename(id: string, name: string): ProjectEntryV1 }`
  - `createProjectRegistry(input: { file: string; boot: ProjectsFileRead; repos: Array<{ projectKey: string; path: string }>; control: RegistryControl | null; topLevel?: (dir: string) => string | null }): ProjectRegistry`

- [ ] **Step 1: Failing test for the trusted config** (`tests/panel/controlConfigRepositories.test.ts`). Copy the `setup()` harness from `tests/panel/controlConfigPort.test.ts` (its `snapshot`, `setup`, `roots`/`afterEach`) verbatim, then:

```ts
describe("repositories added and renamed at runtime (project registry spec §5)", () => {
  it("T1: an added repository resolves, is known, and is listed by readView with its display name", async () => {
    const h = await setup();
    const extra = join(h.root, "extra");
    await mkdir(extra);
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    expect(config.hasRepository("extra-1")).toBe(false);
    config.addRepository({ repoId: "extra-1", displayName: "Extra", path: extra });
    expect(config.hasRepository("extra-1")).toBe(true);
    expect(config.resolveRepository("extra-1")).toBe(extra);
    const view = await config.readView({ agent: "codex" });
    expect(view.repositories).toEqual([{ repoId: "extra-1", displayName: "Extra" }, { repoId: "repo", displayName: "Repo" }]);
  });
  it("T2: refuses a duplicate id, a missing path and a symlinked path, adding nothing", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    const code = (f: () => void): string => { try { f(); return "none"; } catch (error) { return (error as ControlError).code; } };
    expect(code(() => config.checkRepository({ repoId: "repo", displayName: "Again", path: h.repo }))).toBe("control-trusted-config-invalid");
    expect(code(() => config.addRepository({ repoId: "gone", displayName: "Gone", path: join(h.root, "nope") }))).toBe("control-trusted-config-invalid");
    await symlink(h.repo, join(h.root, "link"));
    expect(code(() => config.addRepository({ repoId: "link", displayName: "Link", path: join(h.root, "link") }))).toBe("control-path-symlink");
    expect(config.hasRepository("gone")).toBe(false);
    expect(config.hasRepository("link")).toBe(false);
  });
  it("T3: a rename changes the display name only", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    config.renameRepository("repo", "Renamed");
    expect((await config.readView({ agent: "codex" })).repositories).toEqual([{ repoId: "repo", displayName: "Renamed" }]);
    expect(config.resolveRepository("repo")).toBe(h.repo);
    expect(() => config.renameRepository("absent", "X")).toThrowError(ControlError);
  });
});
```

(Imports to add on top of the copied harness: `symlink` from `node:fs/promises`.)

- [ ] **Step 2: Failing test for the assembly's known repository** — append to the same file:

```ts
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

it("T4: a repository added to the trusted config at runtime is known to set-workspace-mode, with no restart", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-known-")));
  roots.push(root);
  const repo = join(root, "repo"); await mkdir(repo);
  const later = join(root, "later"); await mkdir(later);
  const binary = join(root, "ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json"); await writeFile(table, "{}", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table };
  const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-known", env });
  if (runtime === null) throw new Error("no runtime");
  try {
    const repoId = controlRepoKey("later");
    expect(runtime.service.repositoryKnown(repoId)).toBe(false);
    runtime.config.addRepository({ repoId, displayName: "Later", path: later });
    expect(runtime.service.repositoryKnown(repoId)).toBe(true);
    const set = await runtime.service.setWorkspaceMode({
      schema: "orca-raw-command-v1", commandId: "mode", actorId: "human", verb: "set-workspace-mode",
      target: { kind: "repository", repoId }, expectedRevision: 0, payload: { workspaceMode: "clone" },
    } as never);
    expect(set).toMatchObject({ result: { kind: "workspace-mode-set", repoId, workspaceMode: "clone" } });
  } finally { runtime.close(); }
});
```

- [ ] **Step 3: Run, expect red** (methods do not exist).

- [ ] **Step 4: Implement in `src/panel/controlConfig.ts`.** Add to the interface:

```ts
  /** Project registry spec §5: whether `repoId` is held (the panel's `knownRepository`). */
  hasRepository(repoId: string): boolean;
  /** The validation `addRepository` runs, without adding: the registry's pre-check before it writes its file. */
  checkRepository(entry: TrustedRepositoryConfig): void;
  /** A repository added at runtime, through the same `checkedPath` witness the constructor uses. */
  addRepository(entry: TrustedRepositoryConfig): void;
  /** The display name only; `repoId` and the path witness never change. */
  renameRepository(repoId: string, displayName: string): void;
```

Inside `createTrustedControlConfig`, after the `repositories` map is built, add:

```ts
  const checkNewRepository = (entry: TrustedRepositoryConfig): PathWitness => {
    if (!idSchema.safeParse(entry.repoId).success || !entry.displayName) invalid("repository");
    if (repositories.has(entry.repoId)) invalid("duplicate-id");
    return checkedPath(entry.path, "directory");
  };
```

and to the frozen object:

```ts
    hasRepository: (repoId: string) => repositories.has(repoId),
    checkRepository(entry: TrustedRepositoryConfig) { checkNewRepository(entry); },
    addRepository(entry: TrustedRepositoryConfig) {
      const witness = checkNewRepository(entry);
      repositories.set(entry.repoId, { ...entry, witness });
    },
    renameRepository(repoId: string, displayName: string) {
      const repository = repositories.get(repoId);
      if (!repository) throw new ControlError("control-target-not-allowed");
      if (!displayName) invalid("repository");
      repositories.set(repoId, { ...repository, displayName });
    },
```

In `src/panel/controlAssembly.ts` replace the `knownRepository` closure body with the trusted config (same answer at boot, and it now sees runtime additions):

```ts
    knownRepository: control.executionPort === "configured"
      ? (repoId: string) => config.hasRepository(repoId)
      : undefined,
```

- [ ] **Step 5: Run T1–T4 green**, plus `tests/panel/controlConfigPort.test.ts` and `tests/panel/controlAssemblyDriver.test.ts` unchanged and green.

- [ ] **Step 6: Failing tests for the registry** (`tests/panel/projectRegistry.test.ts`)

```ts
/**
 * Project registry spec §5 / §12 C2–C4: the registry is the one writer of the projects file inside the panel, and
 * the one thing that changes the running project list. Hand edits are picked up by a signature check on read;
 * additions and renames apply, removals and path changes wait for a restart and say so.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectRegistry, ProjectRegistryError, type RegistryControl } from "../../src/panel/projectRegistry.js";
import { readProjectsFile, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "registry-")));
  const gitRepo = (name: string): string => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return dir;
  };
  const file = join(root, "home", "projects.json");
  const calls: string[] = [];
  const control: RegistryControl = {
    check: (e) => { if (e.path.includes("refused")) throw new Error("control-path-escape"); },
    add: (e) => { calls.push(`add:${e.repoId}:${e.displayName}`); },
    rename: (id, name) => { calls.push(`rename:${id}:${name}`); },
  };
  const repos: Array<{ projectKey: string; path: string }> = [];
  const boot = (config: ProjectsFileV1 | null) => {
    if (config !== null) writeProjectsFile(file, config);
    for (const p of config?.projects ?? []) repos.push({ projectKey: p.id, path: p.path });
    return createProjectRegistry({ file, boot: readProjectsFile(file), repos, control });
  };
  const code = (f: () => unknown): string => { try { f(); return "none"; } catch (e) { return e instanceof ProjectRegistryError ? `${e.status}:${e.code}` : `other:${(e as Error).message}`; } };
  return { root, gitRepo, file, calls, repos, boot, code };
}
const handEdit = (file: string, config: ProjectsFileV1): void => { writeFileSync(file, JSON.stringify(config)); };

describe("the project registry", () => {
  it("R1: add writes the file, joins the running list and the live repos array, and tells the control plane", () => {
    const w = world();
    const reg = w.boot(null);
    const path = w.gitRepo("web-app");
    const added = reg.add("Web App", path);
    expect(added).toEqual({ id: "web-app", name: "Web App", path });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config).toEqual({ version: 1, projects: [{ id: "web-app", name: "Web App", path }] });
    expect(reg.list()).toEqual({ source: "file", editable: true, projects: [added], pendingRestart: [], fileError: null });
    expect(w.repos).toEqual([{ projectKey: "web-app", path }]);
    expect(w.calls).toEqual([`add:${controlRepoKey("web-app")}:Web App`]);
  });

  it("R2: rename writes the file and changes only the name, everywhere", () => {
    const w = world();
    const path = w.gitRepo("orca");
    const reg = w.boot({ version: 1, projects: [{ id: "orca", name: "orca", path }] });
    expect(reg.rename("orca", "Orca Web")).toEqual({ id: "orca", name: "Orca Web", path });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "orca", name: "Orca Web", path }]);
    expect(reg.list().projects).toEqual([{ id: "orca", name: "Orca Web", path }]);
    expect(w.repos).toEqual([{ projectKey: "orca", path }]);
    expect(w.calls).toEqual([`rename:${controlRepoKey("orca")}:Orca Web`]);
  });

  it("R3: tells the control plane the file's names at construction", () => {
    const w = world();
    const path = w.gitRepo("orca");
    w.boot({ version: 1, projects: [{ id: "orca", name: "Orca Web", path }] });
    expect(w.calls).toEqual([`rename:${controlRepoKey("orca")}:Orca Web`]);
  });

  it("R4: refuses each bad add by name, writing nothing", () => {
    const w = world();
    const repo = w.gitRepo("repo");
    const reg = w.boot({ version: 1, projects: [{ id: "repo", name: "Repo", path: repo }] });
    mkdirSync(join(w.root, "plain"));
    mkdirSync(join(repo, "sub"));
    symlinkSync(repo, join(w.root, "alias"));
    const refused = w.gitRepo("refused-one");
    expect(w.code(() => reg.add("x", join(w.root, "absent")))).toBe("422:project-path-missing");
    expect(w.code(() => reg.add("x", "relative/path"))).toBe("422:project-path-missing");
    expect(w.code(() => reg.add("x", join(w.root, "plain")))).toBe("422:project-path-not-repository-root");
    expect(w.code(() => reg.add("x", join(repo, "sub")))).toBe("422:project-path-not-repository-root");
    expect(w.code(() => reg.add("x", join(w.root, "alias")))).toBe("409:project-path-taken");
    expect(w.code(() => reg.add("   ", w.gitRepo("other")))).toBe("422:project-name-invalid");
    expect(w.code(() => reg.add("Repo", w.gitRepo("third")))).toBe("409:project-name-taken");
    expect(w.code(() => reg.add("ok", refused))).toBe("422:project-path-refused");
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id)).toEqual(["repo"]);
    // Only the construction-time rename (the file names "repo" "Repo"); no refused add reached the control plane.
    expect(w.calls).toEqual([`rename:${controlRepoKey("repo")}:Repo`]);
  });

  it("R5: a project added by hand shows up on the next list(), with no restart", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    const b = w.gitRepo("b");
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    expect(reg.list().projects.map((p) => p.id)).toEqual(["a", "b"]);
    expect(w.repos.map((r) => r.projectKey)).toEqual(["a", "b"]);
    expect(w.calls).toEqual([`rename:${controlRepoKey("a")}:A`, `add:${controlRepoKey("b")}:B`]);
  });

  it("R6: removals, path changes and a controlStateDir change wait for a restart and are named", () => {
    const w = world();
    const a = w.gitRepo("a"); const b = w.gitRepo("b"); const moved = w.gitRepo("moved");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    handEdit(w.file, { version: 1, controlStateDir: "/elsewhere", projects: [{ id: "b", name: "B", path: moved }] });
    const view = reg.list();
    expect(view.pendingRestart).toEqual(["controlStateDir", "path:b", "removed:a"]);
    expect(view.projects).toEqual([{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }]);
    unlinkSync(w.file);
    expect(reg.list().pendingRestart).toEqual(["removed:a", "removed:b"]);
  });

  it("R7: a broken file keeps the last good list and says why; a hand-added bad project is named, not added", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    writeFileSync(w.file, "{ not json");
    expect(reg.list().fileError).toMatch(/not JSON/);
    expect(reg.list().projects.map((p) => p.id)).toEqual(["a"]);
    expect(w.code(() => reg.add("x", w.gitRepo("x")))).toBe("409:projects-file-invalid");
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "bad", name: "Bad", path: join(w.root, "nowhere") }] });
    const view = reg.list();
    expect(view.fileError).toMatch(/^project bad: /);
    expect(view.projects.map((p) => p.id)).toEqual(["a"]);
  });

  it("R8: an add after a hand edit keeps the hand edit", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "Hand", path: a }] });
    reg.add("C", w.gitRepo("c"));
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => `${p.id}:${p.name}`)).toEqual(["a:Hand", "c:C"]);
  });

  it("R9: a write whose base moved under it is refused, never a silent overwrite", () => {
    const w = world();
    const a = w.gitRepo("a");
    let reg: ReturnType<typeof w.boot>;
    // topLevel runs after the registry's read and before its write: a hand edit lands in between.
    const c = w.gitRepo("c");
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }] });
    w.repos.push({ projectKey: "a", path: a });
    reg = createProjectRegistry({
      file: w.file, boot: readProjectsFile(w.file), repos: w.repos, control: null,
      topLevel: (dir) => { handEdit(w.file, { version: 1, projects: [{ id: "a", name: "Raced", path: a }] }); return dir; },
    });
    expect(w.code(() => reg.add("C", c))).toBe("409:projects-file-changed");
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "a", name: "Raced", path: a }]);
  });

  it("R10: two adds in a row both land", () => {
    const w = world();
    const reg = w.boot(null);
    reg.add("One", w.gitRepo("one"));
    reg.add("Two", w.gitRepo("two"));
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id)).toEqual(["one", "two"]);
  });

  it("R11: rename refusals", () => {
    const w = world();
    const a = w.gitRepo("a"); const b = w.gitRepo("b");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    expect(w.code(() => reg.rename("zzz", "X"))).toBe("404:project-unknown");
    expect(w.code(() => reg.rename("a", " "))).toBe("422:project-name-invalid");
    expect(w.code(() => reg.rename("a", "B"))).toBe("409:project-name-taken");
    expect(reg.rename("a", "A")).toEqual({ id: "a", name: "A", path: a });
  });
});
```

- [ ] **Step 7: Run, expect red** (module missing).

- [ ] **Step 8: Implement `src/panel/projectRegistry.ts`**

```ts
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
  deriveProjectId, hashText, readProjectsFile, sameSignature, writeProjectsFile,
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

  const controlEntry = (p: ProjectEntryV1): TrustedRepositoryConfig => ({ repoId: controlRepoKey(p.id), displayName: p.name, path: p.path });

  const precheck = (p: ProjectEntryV1): void => {
    try { control?.check(controlEntry(p)); }
    catch (error) { fail("project-path-refused", 422, `the task control plane refuses ${p.path}: ${(error as Error).message}`); }
  };

  const join = (p: ProjectEntryV1): void => {
    running.push({ ...p });
    repos.push({ projectKey: p.id, path: p.path });
    control?.add(controlEntry(p));
  };

  /** Diff a valid file against the running list and apply what may apply (spec §5). */
  const applyFrom = (config: ProjectsFileV1): void => {
    const pending: string[] = [];
    const errors: string[] = [];
    if ((config.controlStateDir ?? null) !== bootStateDir) pending.push("controlStateDir");
    for (const r of running) {
      const f = config.projects.find((p) => p.id === r.id);
      if (f === undefined) { pending.push(`removed:${r.id}`); continue; }
      if (f.path !== r.path) pending.push(`path:${r.id}`);
      if (f.name !== r.name) { r.name = f.name; control?.rename(controlRepoKey(r.id), f.name); }
    }
    for (const f of config.projects) {
      if (running.some((r) => r.id === f.id)) continue;
      try {
        const real = checkedPath(f.path);
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
      const realOf = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
      if (lastGood.projects.some((p) => realOf(p.path) === real)) fail("project-path-taken", 409, `${real} is already a project`);
      const entry: ProjectEntryV1 = { id: deriveProjectId(trimmed, real, new Set(lastGood.projects.map((p) => p.id))), name: trimmed, path: real };
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

// Kept for the criteria that compute hashes the same way.
export { hashText };
```

Notes for the implementer:
- R2 expects `w.calls` to be exactly the rename made by `rename()`: the boot file has `name === id`, so construction calls nothing.
- `writable()` re-reads before refusing so a file fixed by hand since the last `list()` is not refused on stale state (the `refresh()` just before already re-read it; the second read is cheap and keeps the rule readable).
- If R9 shows the race window cannot be produced through `topLevel` because `checkedPath` runs before `refresh()`'s read, move the `topLevel` call or adjust the criterion — the criterion's intent (a hand edit between the diffed read and the write is refused, not overwritten) is what must hold.

- [ ] **Step 9: Run R1–R11 green.**

- [ ] **Step 10: Mutations in a clone**, each named red: drop `repos.push` in `join` (R1); drop `control?.rename` in `rename()` (R2); drop the construction-time rename loop (R3); drop the realpath comparison in the path-taken check (R4 alias); skip `refresh()` in `list()` (R5); apply removals (splice running) instead of naming them (R6); clear `fileError` on an invalid read (R7); drop the hash check in `write` (R9); `hasRepository` always true (T4 first assertion); `addRepository` without `checkNewRepository` (T2).

- [ ] **Step 11: Commit** — `feat(panel): a project registry over the projects file; the trusted config learns repositories at runtime`

---

### Task 4: Boot wiring and the HTTP API

**Files:**
- Modify: `src/panel/server.ts` (`PanelOptions`, `parsePanelArgs`, `createPanelServer`, `startPanelFromArgs`)
- Modify: `src/panel/controlOptions.ts` (`resolveControlOptions` 4th parameter)
- Modify: `src/panel/projects.ts` (GET shape, POST, PATCH)
- Modify: `src/panel/api.ts` (`ApiDeps.projects`, per-request control join)
- Modify: `tests/setup/relocateUserData.ts` (also relocate `ORCA_PROJECTS_FILE`)
- Modify: `web/src/locales/zh.ts` (`zhErrors` entries), `tests/panel/refusalCoverage.test.ts` (`BY_HAND`, append)
- Modify (P6 rewrite): `tests/panel/projectsApi.test.ts` — the four existing criteria
- Test: `tests/panel/projectsFileMode.test.ts`

**Interfaces:**
- Consumes (Tasks 2–3): `projectsFilePath`, `readProjectsFile`, `ProjectsFileRead`, `createProjectRegistry`, `ProjectRegistry`, `ProjectRegistryError`, `TrustedControlConfig.{checkRepository,addRepository,renameRepository}`.
- Produces:
  - `PanelOptions.projectsFile?: { file: string; boot: ProjectsFileRead }` (absent ⇒ command-line mode)
  - `resolveControlOptions(args, env, repos, fileMode?: { controlStateDir: string | null })`
  - `GET /api/projects` → `{ source, editable, projects: [{ projectKey, name, path, controlRepoId }], pendingRestart, fileError }`
  - `POST /api/projects {name, path}` → `201 { project }`; `PATCH /api/projects/:id {name}` → `200 { project }`; refusals `{ code, message }` with the statuses of Task 3, plus `409 projects-from-command-line` and `400 panel-bad-request` for a body that is not `{name: string, path: string}` / `{name: string}`.
  - New panel rejections at parse: `projects-file-invalid`, `projects-file-with-repo`, `malformed-projects-file-argument`.

- [ ] **Step 1: Relocate the file for every criterion.** In `tests/setup/relocateUserData.ts`, right after `process.env.ORCA_CONTROL_DIR = relocated;` add:

```ts
// Project registry spec §12 C1: the real `orca panel` reads ~/.orca/projects.json unless told otherwise. A criterion
// that boots the CLI with no --repo gets a file inside the relocated root instead (which does not exist: no projects).
process.env.ORCA_PROJECTS_FILE = join(relocated, "projects.json");
```

- [ ] **Step 2: Failing tests** (`tests/panel/projectsFileMode.test.ts`)

```ts
/**
 * Project registry spec §4 with §12 C1: file mode is entered by --projects-file (the real `orca panel` adds it when
 * no --repo/--root is given); command-line mode is unchanged; the API reads and writes through the registry.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { readProjectsFile } from "../../src/panel/projectsFile.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "file-mode-")));
  const gitRepo = (name: string): string => {
    const dir = join(root, name); mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return dir;
  };
  const file = join(root, "home", "projects.json");
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE;
  return { root, gitRepo, file, env };
}
async function boot(args: string[], env: NodeJS.ProcessEnv) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", ...args], env), env);
  started.push(panel);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${panel.url}${path}`, { method, headers: { "x-orca-token": panel.token, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { panel, call };
}

describe("file mode", () => {
  it("B1: a missing file is an empty project list with the control plane mounted under <controlRoot>/panel", async () => {
    const w = world();
    const opts = parsePanelArgs(["--by", "tester", "--projects-file", w.file], w.env);
    expect(opts.repos).toEqual([]);
    expect(opts.control.enabled).toBe(true);
    expect(opts.control.stateDir).toBe(join(w.root, "control", "panel"));
  });

  it("B2: the file's controlStateDir and projects are used; --control-state-dir still wins", async () => {
    const w = world();
    const a = w.gitRepo("a");
    mkdirSync(join(w.root, "home"));
    writeFileSync(w.file, JSON.stringify({ version: 1, controlStateDir: join(w.root, "state"), projects: [{ id: "a", name: "A", path: a }] }));
    const opts = parsePanelArgs(["--by", "tester", "--projects-file", w.file], w.env);
    expect(opts.repos).toEqual([{ projectKey: "a", path: a }]);
    expect(opts.control.stateDir).toBe(join(w.root, "state"));
    expect(parsePanelArgs(["--by", "tester", "--projects-file", w.file, "--control-state-dir", join(w.root, "x")], w.env).control.stateDir).toBe(join(w.root, "x"));
  });

  it("B3: an invalid file refuses to start; --projects-file with --repo or --root is refused", () => {
    const w = world();
    mkdirSync(join(w.root, "home"));
    writeFileSync(w.file, "{");
    const code = (args: string[]): string => { try { parsePanelArgs(["--by", "t", ...args], w.env); return "none"; } catch (e) { return (e as { code: string }).code; } };
    expect(code(["--projects-file", w.file])).toBe("projects-file-invalid");
    expect(code(["--projects-file", w.file, "--repo", `a=${w.root}`])).toBe("projects-file-with-repo");
    expect(code(["--projects-file", w.file, "--root", w.root])).toBe("projects-file-with-repo");
    expect(code(["--projects-file", ""])).toBe("malformed-projects-file-argument");
  });

  it("B4: add and rename over HTTP take effect with no restart, in the API and in the control config", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    expect((await call("GET", "/api/projects")).body).toEqual({ source: "file", editable: true, projects: [], pendingRestart: [], fileError: null });
    const repo = w.gitRepo("web");
    const added = await call("POST", "/api/projects", { name: "Web", path: repo });
    expect(added).toEqual({ status: 201, body: { project: { projectKey: "web", name: "Web", path: repo, controlRepoId: controlRepoKey("web") } } });
    const config = await call("GET", "/api/control/config");
    expect((config.body.repositories as unknown[])).toEqual([{ repoId: controlRepoKey("web"), displayName: "Web" }]);
    const renamed = await call("PATCH", "/api/projects/web", { name: "Web App" });
    expect(renamed.status).toBe(200);
    expect(((await call("GET", "/api/control/config")).body.repositories as unknown[])).toEqual([{ repoId: controlRepoKey("web"), displayName: "Web App" }]);
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "web", name: "Web App", path: repo }]);
  });

  it("B5: refusals come back with their status and code", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    expect(await call("POST", "/api/projects", { name: "X", path: join(w.root, "absent") })).toMatchObject({ status: 422, body: { code: "project-path-missing" } });
    expect(await call("POST", "/api/projects", { name: 1, path: "/x" })).toMatchObject({ status: 400, body: { code: "panel-bad-request" } });
    expect(await call("PATCH", "/api/projects/none", { name: "X" })).toMatchObject({ status: 404, body: { code: "project-unknown" } });
  });

  it("B6: two concurrent adds both land", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    const [one, two] = await Promise.all([call("POST", "/api/projects", { name: "One", path: w.gitRepo("one") }), call("POST", "/api/projects", { name: "Two", path: w.gitRepo("two") })]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id).sort()).toEqual(["one", "two"]);
  });
});

describe("command-line mode", () => {
  it("C1: --repo answers source command-line, editable false, and refuses add and rename", async () => {
    const w = world();
    const repo = w.gitRepo("proj");
    const { call } = await boot(["--repo", `proj=${repo}`], w.env);
    expect((await call("GET", "/api/projects")).body).toEqual({
      source: "command-line", editable: false, pendingRestart: [], fileError: null,
      projects: [{ projectKey: "proj", name: "proj", path: repo, controlRepoId: controlRepoKey("proj") }],
    });
    expect(await call("POST", "/api/projects", { name: "X", path: repo })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
    expect(await call("PATCH", "/api/projects/proj", { name: "X" })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
  });
});
```

Also add a criterion for the process-boundary default in the same file (it must not boot the real panel):

```ts
import { panelArgsWithDefaultProjects } from "../../src/panel/server.js";
it("D1: the real orca panel adds --projects-file only when none of --repo, --root, --projects-file is given", () => {
  const env = { ORCA_PROJECTS_FILE: "/x/p.json" };
  expect(panelArgsWithDefaultProjects(["--by", "a"], env)).toEqual(["--by", "a", "--projects-file", "/x/p.json"]);
  for (const flag of ["--repo", "--root", "--projects-file"]) expect(panelArgsWithDefaultProjects(["--by", "a", flag, "v"], env)).toEqual(["--by", "a", flag, "v"]);
});
```

- [ ] **Step 3: Rewrite the four existing criteria in `tests/panel/projectsApi.test.ts`** (P6, named): in each `toEqual`, the answer gains `source: "command-line", editable: false, pendingRestart: [], fileError: null` and each row gains `name` (= `projectKey`) and `path` (the repo path given). The first two call `registerProjectRoutes` directly: keep that, their expected bodies change the same way. Add a comment line above the first `describe`: `// Rewritten for the project registry (spec 2026-10-04-panel-project-registry-design.md §12 C6, human ruling P6): the answer gained source/editable/pendingRestart/fileError and each row name/path; what each criterion encodes (order, join, token) is unchanged.`

- [ ] **Step 4: Run, expect red** (`--projects-file` unknown, new API fields missing).

- [ ] **Step 5: Implement.**

`src/panel/controlOptions.ts` — signature and the two branches:

```ts
export function resolveControlOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
  repos: Array<{ projectKey: string; path: string }>,
  /** Project registry spec §4/§12 C1: present in file mode. The plane mounts with no repository, under the file's dir. */
  fileMode?: { controlStateDir: string | null },
): ControlOptionsResolution {
```

replace

```ts
  if (args.includes("--no-control") || repos.length === 0) return off();
```

with

```ts
  if (args.includes("--no-control") || (repos.length === 0 && fileMode === undefined)) return off();
```

and the `stateDir` block with

```ts
  if (nonEmpty(explicitStateDir)) {
    stateDir = explicitStateDir;
  } else if (fileMode !== undefined) {
    stateDir = fileMode.controlStateDir ?? join(controlRoot(env), "panel");
  } else if (repos.length === 1) {
```

`src/panel/server.ts`:
- `PanelOptions` gains `/** Project registry spec §4: present in file mode only. */ projectsFile?: { file: string; boot: ProjectsFileRead };`
- In `parsePanelArgs`, after the `--repo` loop and before `--port`:

```ts
  // Project registry spec §4 / §12 C1: file mode is asked for by name. The real `orca panel` asks for it by
  // default (panelArgsWithDefaultProjects); a criterion calling this with no --repo stays in command-line mode.
  let projectsFile: PanelOptions["projectsFile"];
  const projectsFlag = args.indexOf("--projects-file");
  if (projectsFlag !== -1) {
    const file = args[projectsFlag + 1] ?? "";
    if (file.length === 0 || file.startsWith("--")) throw new PanelRejection("malformed-projects-file-argument", "--projects-file wants a path");
    if (args.includes("--repo") || args.includes("--root")) {
      throw new PanelRejection("projects-file-with-repo", "--projects-file and --repo/--root are two sources of projects; give one");
    }
    const boot = readProjectsFile(file);
    if (boot.kind === "invalid") throw new PanelRejection("projects-file-invalid", `${file}: ${boot.reason}. Fix the file; the panel never rewrites it.`);
    for (const project of boot.kind === "valid" ? boot.config.projects : []) repos.push({ projectKey: project.id, path: project.path });
    projectsFile = { file, boot };
  }
```

- change the `resolveControlOptions` call to pass `projectsFile === undefined ? undefined : { controlStateDir: projectsFile.boot.kind === "valid" ? projectsFile.boot.config.controlStateDir ?? null : null }`, and add `projectsFile` to the returned object.
- In `createPanelServer`, after `control` is assembled and before `buildApi`:

```ts
  // Project registry spec §5: built after the control plane, which it tells about every project it adds or renames.
  const projects = opts.projectsFile === undefined ? null : createProjectRegistry({
    file: opts.projectsFile.file,
    boot: opts.projectsFile.boot,
    repos: opts.repos,
    control: control === null ? null : {
      check: (entry) => control!.config.checkRepository(entry),
      add: (entry) => control!.config.addRepository(entry),
      rename: (repoId, name) => control!.config.renameRepository(repoId, name),
    },
  });
```

and pass `projects` in the `buildApi` deps.
- Export and use the process-boundary default:

```ts
/** Project registry spec §12 C1: the real `orca panel` reads the projects file unless told where its projects are. */
export function panelArgsWithDefaultProjects(args: string[], env: NodeJS.ProcessEnv): string[] {
  if (args.includes("--repo") || args.includes("--root") || args.includes("--projects-file")) return args;
  return [...args, "--projects-file", projectsFilePath(env)];
}
```

and in `startPanelFromArgs`: `return createPanelServer(parsePanelArgs(panelArgsWithDefaultProjects(args, env), env), env);`

`src/panel/api.ts`:
- `ApiDeps` gains `/** Project registry spec §5: null in command-line mode. */ projects?: ProjectRegistry | null;`
- replace the `controlRepos` set and its `registerProjectRoutes` call with a per-request join:

```ts
  // Project switcher spec D1 (§8), project registry §12 C2: the control plane holds exactly the projects in
  // opts.repos (given with --repo, or added to the registry since boot), so the join is computed per request.
  registerProjectRoutes(app, {
    opts: deps.opts,
    registry: deps.projects ?? null,
    controlRepoId: (key) => (deps.control && deps.opts.repos.some((repo) => repo.projectKey === key) ? controlRepoKey(key) : null),
  });
```

`src/panel/projects.ts` — replace the file body with:

```ts
import type { Express } from "express";
import { compareText } from "../control/webProtocol.js";
import { discoverRepos } from "../metrics/discover.js";
import { PANEL_BAD_REQUEST } from "./rejection.js";
import { ProjectRegistryError, type ProjectRegistry } from "./projectRegistry.js";
import type { PanelOptions } from "./server.js";

export interface ProjectsDeps {
  opts: Pick<PanelOptions, "root" | "repos">;
  /** The control `repoId` of a project, or null when the control plane is off or does not hold that repository. */
  controlRepoId: (projectKey: string) => string | null;
  /** Project registry spec §5: present in file mode; absent or null means command-line mode. */
  registry?: ProjectRegistry | null;
}

const FROM_COMMAND_LINE = { code: "projects-from-command-line", message: "this panel's projects come from the command line (--repo/--root); restart it without them to manage projects here" };

export function registerProjectRoutes(app: Express, deps: ProjectsDeps): void {
  const row = (p: { id: string; name: string; path: string }) => ({ projectKey: p.id, name: p.name, path: p.path, controlRepoId: deps.controlRepoId(p.id) });
  const refused = (res: import("express").Response, error: unknown): void => {
    if (!(error instanceof ProjectRegistryError)) throw error;
    res.status(error.status).json({ code: error.code, message: error.message });
  };

  app.get("/api/projects", (_req, res, next) => {
    void (async () => {
      if (deps.registry) {
        const view = deps.registry.list();
        res.json({ ...view, projects: view.projects.map(row) });
        return;
      }
      const { repos } = await discoverRepos({ root: deps.opts.root, repos: deps.opts.repos });
      const projects = repos
        .map((repo) => ({ projectKey: repo.projectKey, name: repo.projectKey, path: repo.path, controlRepoId: deps.controlRepoId(repo.projectKey) }))
        .sort((left, right) => compareText(left.projectKey, right.projectKey));
      res.json({ source: "command-line", editable: false, projects, pendingRestart: [], fileError: null });
    })().catch(next);
  });

  app.post("/api/projects", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown; path?: unknown } | undefined;
    if (typeof body?.name !== "string" || typeof body.path !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "POST /api/projects wants { name: string, path: string }" });
      return;
    }
    try { res.status(201).json({ project: row(deps.registry.add(body.name, body.path)) }); }
    catch (error) { refused(res, error); }
  });

  app.patch("/api/projects/:id", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown } | undefined;
    if (typeof body?.name !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id wants { name: string }" });
      return;
    }
    try { res.json({ project: row(deps.registry.rename(String(req.params.id), body.name)) }); }
    catch (error) { refused(res, error); }
  });
}
```

Check before relying on it: that the token middleware in `api.ts` covers `PATCH` (it is a `/api` prefix check — confirm by reading `buildApi`), and that `express.json` parses `PATCH` bodies (it does by content-type).

- [ ] **Step 6: Chinese refusal text.** Append to `zhErrors` in `web/src/locales/zh.ts` (each may use `{{message}}`):

```ts
  "projects-from-command-line": "这个面板的项目由命令行（--repo／--root）给定，不能在这里管理：{{message}}",
  "project-path-missing": "路径不存在或不是目录：{{message}}",
  "project-path-not-repository-root": "这个路径不是 git 仓库的顶层目录：{{message}}",
  "project-path-taken": "这个目录已经是一个项目了：{{message}}",
  "project-path-refused": "任务控制面拒绝了这个路径：{{message}}",
  "project-name-invalid": "项目名不能为空：{{message}}",
  "project-name-taken": "已经有同名项目：{{message}}",
  "project-unknown": "没有这个项目：{{message}}",
  "projects-file-invalid": "项目配置文件无效，请先修好它：{{message}}",
  "projects-file-changed": "项目配置文件刚被改过，请重新读取后再试：{{message}}",
```

and append the same ten codes to `BY_HAND` in `tests/panel/refusalCoverage.test.ts` under a new comment line `// src/panel/projects.ts, src/panel/projectRegistry.ts (project registry spec §6)`.

- [ ] **Step 7: Run green**: `tests/panel/projectsFileMode.test.ts`, `tests/panel/projectsApi.test.ts`, `tests/panel/refusalCoverage.test.ts`, `tests/panel/controlMount.test.ts`, `tests/panel/security.test.ts`, `tests/panel/controlStartup.test.ts`, `tests/memory/memoryApi.test.ts`, `web/tests/i18nKeys.test.ts` (web root). Then `./node_modules/.bin/tsc --noEmit -p .` RC 0.

- [ ] **Step 8: Mutations in a clone**, each named red: `fileMode` ignored in `resolveControlOptions` (B1); `controlStateDir` ignored (B2); drop the `projects-file-with-repo` check (B3); registry `control: null` always (B4 control config); `panelArgsWithDefaultProjects` always appends (D1); command-line GET returns `editable: true` (C1).

- [ ] **Step 9: Commit** — `feat(panel): projects from ~/.orca/projects.json by default; add and rename over /api/projects without a restart`

---

### Task 5: The web project control

**Files:**
- Modify: `web/src/project.ts` (types), `web/src/api.ts` (fetch/add/rename)
- Create: `web/src/ProjectControl.tsx`, `web/src/projectNames.ts`
- Modify: `web/src/Shell.tsx` (control at the top of the sidebar; remove it from the foot), `web/src/App.tsx` (state, re-reads, focus, names provider)
- Modify: `web/src/DecisionList.tsx`, `web/src/DecisionsView.tsx`, `web/src/ChainPanel.tsx`, `web/src/MemoryView.tsx` (show names)
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`project.*` keys), `web/src/styles.css` (`.project-control`)
- Modify (P6 rewrite): `web/tests/projectSwitcher.test.tsx` E
- Test: `web/tests/projectRegistry.test.tsx`

**Interfaces:**
- Consumes (Task 4): the `/api/projects` GET/POST/PATCH shapes.
- Produces:
  - `interface ProjectV1 { projectKey: string; name?: string; path?: string; controlRepoId: string | null }`
  - `interface ProjectsAnswerV1 { source?: "file" | "command-line"; editable?: boolean; projects: ProjectV1[]; pendingRestart?: string[]; fileError?: string | null }`
  - `projectName(p: ProjectV1): string` (name ?? projectKey)
  - `fetchProjects(): Promise<ProjectsAnswerV1>`, `addProject(input: { name: string; path: string }): Promise<PostResult<{ project: ProjectV1 }>>`, `renameProject(id: string, name: string): Promise<PostResult<{ project: ProjectV1 }>>`
  - `ProjectNames` React context `(key: string) => string`, default identity; hook `useProjectName()`.

- [ ] **Step 1: Failing tests** (`web/tests/projectRegistry.test.tsx`). Start from the fetch-mock skeleton of `web/tests/projectSwitcher.test.tsx` (copy its `config`, `summary`, `recovery`, `METRICS`, `jsonResponse` and the `beforeEach` fetch router), with these differences: the `/api/projects` answer is a mutable `projectsAnswer` in the new shape; `POST /api/projects` and `PATCH /api/projects/:id` are recorded and answered from variables; `/api/todo` answers one row with `projectKey: "alpha"`.

```tsx
const FILE = (projects: Array<{ projectKey: string; name: string }>, extra: Record<string, unknown> = {}) => ({
  source: "file", editable: true, pendingRestart: [], fileError: null,
  projects: projects.map((p) => ({ ...p, path: `/r/${p.projectKey}`, controlRepoId: `${p.projectKey}-11111111` })), ...extra,
});

it("P1: one project shows the control with its name; Add and Rename are offered", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha App" }]);
  render(<App />);
  const select = await screen.findByRole("combobox", { name: "Project" }) as HTMLSelectElement;
  expect(select.value).toBe("alpha");
  expect(within(select).getByRole("option", { name: "Alpha App" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rename project" })).toBeTruthy();
});

it("P2: zero projects says so and offers Add", async () => {
  projectsAnswer = FILE([]);
  render(<App />);
  expect(await screen.findByText("No project yet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
});

it("P3: adding posts path and name, re-reads the list and the control config, and selects the new project", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha" }]);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
  const form = screen.getByRole("form", { name: "Add project" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Path" }), { target: { value: "/r/beta-svc" } });
  addAnswer = { status: 201, body: { project: { projectKey: "beta-svc", name: "beta-svc", path: "/r/beta-svc", controlRepoId: "beta-svc-22222222" } } };
  projectsAfterAdd = FILE([{ projectKey: "alpha", name: "Alpha" }, { projectKey: "beta-svc", name: "beta-svc" }]);
  const configReadsBefore = configReads;
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(posts).toEqual([{ name: "beta-svc", path: "/r/beta-svc" }]));   // name defaulted from the path
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("beta-svc"));
  expect(configReads).toBeGreaterThan(configReadsBefore);
});

it("P4: a refused add shows the refusal and keeps the form", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha" }]);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
  const form = screen.getByRole("form", { name: "Add project" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Path" }), { target: { value: "/nope" } });
  addAnswer = { status: 422, body: { code: "project-path-missing", message: "/nope is not an existing directory" } };
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect(await within(form).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("/nope is not an existing directory"));
});

it("P5: rename patches the current project and the new name shows, the selection unchanged", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha" }]);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Rename project" }));
  const form = screen.getByRole("form", { name: "Rename project" });
  const input = within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
  expect(input.value).toBe("Alpha");
  fireEvent.change(input, { target: { value: "Alpha Web" } });
  renameAnswer = { status: 200, body: { project: { projectKey: "alpha", name: "Alpha Web", path: "/r/alpha", controlRepoId: "alpha-11111111" } } };
  projectsAfterRename = FILE([{ projectKey: "alpha", name: "Alpha Web" }]);
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(patches).toEqual([{ id: "alpha", name: "Alpha Web" }]));
  const select = await screen.findByRole("combobox", { name: "Project" }) as HTMLSelectElement;
  await waitFor(() => expect(within(select).getByRole("option", { name: "Alpha Web" })).toBeTruthy());
  expect(select.value).toBe("alpha");
});

it("P6: command-line projects disable Add and Rename and say why", async () => {
  projectsAnswer = { ...FILE([{ projectKey: "alpha", name: "alpha" }]), source: "command-line", editable: false };
  render(<App />);
  const add = await screen.findByRole("button", { name: "Add project" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Rename project" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/come from the command line/)).toBeTruthy();
});

it("P7: the window regaining focus re-reads the project list", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha" }]);
  render(<App />);
  await screen.findByRole("combobox", { name: "Project" });
  const before = projectReads;
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(projectReads).toBe(before + 1));
});

it("P8: a file error is an alert; a pending removal warns that its groups cannot continue", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha" }], { fileError: "not JSON: x", pendingRestart: ["removed:alpha"] });
  render(<App />);
  expect(await screen.findByText(/not JSON: x/)).toBeTruthy();
  expect(screen.getByText(/removed:alpha/)).toBeTruthy();
  expect(screen.getByText(/cannot continue/)).toBeTruthy();
});

it("P9: Decisions rows show the project's name", async () => {
  projectsAnswer = FILE([{ projectKey: "alpha", name: "Alpha App" }]);
  window.location.hash = "#decisions";
  render(<App />);
  await waitFor(() => expect(document.querySelector(".field-projectKey")?.textContent).toBe("Alpha App"));
  window.location.hash = "";
});
```

The fetch router additions (inside `beforeEach`): count `projectReads` and `configReads`; for `POST /api/projects` push the parsed body to `posts`, swap `projectsAnswer = projectsAfterAdd ?? projectsAnswer` when the answer is 2xx, and answer `addAnswer`; for `PATCH /api/projects/<id>` push `{ id, name }` to `patches`, swap to `projectsAfterRename`, answer `renameAnswer`. `/api/todo` answers one row shaped like the rows in `web/tests/decisionList.test.tsx` with `projectKey: "alpha"`.

- [ ] **Step 2: Rewrite `projectSwitcher` E** (P6, named):

```tsx
  // Rewritten for the project registry (spec 2026-10-04-panel-project-registry-design.md P3, human ruling P6): with
  // one project the control is shown -- it is where the person sees which project the panel works on.
  it("E: shows the project select with its one project when the panel has one project", async () => {
    projectsAnswer = { status: 200, body: { projects: [PROJECTS.projects[0]] } };
    render(<App />);
    await importRegion();
    await waitFor(() => expect(workspaceReads).toContain("alpha-11111111"));
    expect(projectSelect().value).toBe("alpha");
    expect(projectSelect().options).toHaveLength(1);
  });
```

- [ ] **Step 3: Run, expect red.**

- [ ] **Step 4: Implement.**

`web/src/project.ts` — extend:

```ts
export interface ProjectV1 {
  projectKey: string;
  /** Project registry spec §6: the display name; absent from an answer of the older shape, which means the key. */
  name?: string;
  path?: string;
  controlRepoId: string | null;
}
export interface ProjectsAnswerV1 {
  source?: "file" | "command-line";
  editable?: boolean;
  projects: ProjectV1[];
  pendingRestart?: string[];
  fileError?: string | null;
}
export const projectName = (project: ProjectV1): string => project.name ?? project.projectKey;
```

`web/src/projectNames.ts`:

```ts
/** Project registry spec §7: one place every section asks how to show a project key. Identity unless App provides names. */
import { createContext, useContext } from "react";
export const ProjectNames = createContext<(key: string) => string>((key) => key);
export const useProjectName = (): ((key: string) => string) => useContext(ProjectNames);
```

`web/src/api.ts` — replace `fetchProjects` and add two calls (add a `method` parameter to `postJson`, default `"POST"`):

```ts
async function postJson<T>(path: string, payload: unknown, method: "POST" | "PATCH" = "POST"): Promise<PostResult<T>> {
  const res = await fetch(path, {
    method,
    headers: { "x-orca-token": token(), "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok) return { ok: false, ...refusalFrom(`${method} ${path}`, res.status, body) };
  return { ok: true, body: body as T };
}
/** GET /api/projects -- src/panel/projects.ts (project switcher spec D1, project registry spec §6). */
export const fetchProjects = (): Promise<ProjectsAnswerV1> => getJson<ProjectsAnswerV1>("/api/projects");
/** POST /api/projects -- project registry spec §6. */
export const addProject = (input: { name: string; path: string }): Promise<PostResult<{ project: ProjectV1 }>> => postJson("/api/projects", input);
/** PATCH /api/projects/:id -- project registry spec §6. */
export const renameProject = (id: string, name: string): Promise<PostResult<{ project: ProjectV1 }>> =>
  postJson(`/api/projects/${encodeURIComponent(id)}`, { name }, "PATCH");
```

`web/src/ProjectControl.tsx`:

```tsx
/**
 * Project registry spec §7 (§12 C5): the one project control, at the top of the sidebar. Always shown once the list
 * is read; Add and Rename only when the panel's projects come from its file.
 */
import { useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal, PostResult } from "./api.js";
import { refusalText } from "./i18n.js";
import { projectName, type ProjectsAnswerV1 } from "./project.js";

export interface ProjectControlProps {
  answer: ProjectsAnswerV1;
  project: string | null;
  onProject: (projectKey: string) => void;
  onAdd: (input: { name: string; path: string }) => Promise<PostResult<unknown>>;
  onRename: (id: string, name: string) => Promise<PostResult<unknown>>;
}

const lastSegment = (path: string): string => path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";

export function ProjectControl(props: ProjectControlProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState<"add" | "rename" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const editable = props.answer.editable === true;
  const projects = props.answer.projects;
  const current = projects.find((p) => p.projectKey === props.project);

  const close = (): void => { setOpen(null); setRefusal(null); setPath(""); setName(""); };
  const settle = (result: PostResult<unknown>): void => {
    if (result.ok) close();
    else setRefusal({ status: result.status, code: result.code, message: result.message });
  };
  const submitAdd = (event: FormEvent): void => {
    event.preventDefault();
    void props.onAdd({ path: path.trim(), name: name.trim() === "" ? lastSegment(path.trim()) : name.trim() }).then(settle);
  };
  const submitRename = (event: FormEvent): void => {
    event.preventDefault();
    if (current !== undefined) void props.onRename(current.projectKey, name).then(settle);
  };

  return (
    <div className="project-control">
      {projects.length === 0 ? (
        <p className="project-none">{t("project.none")}</p>
      ) : (
        <label>
          {t("shell.project")}
          <select name="project" value={props.project ?? ""} onChange={(e) => props.onProject(e.currentTarget.value)}>
            {projects.map((p) => <option key={p.projectKey} value={p.projectKey}>{projectName(p)}</option>)}
          </select>
        </label>
      )}
      <div className="project-actions">
        <button type="button" disabled={!editable} title={editable ? undefined : t("project.fromCommandLine")} onClick={() => { setRefusal(null); setOpen("add"); }}>
          {t("project.add")}
        </button>
        <button type="button" disabled={!editable || current === undefined} title={editable ? undefined : t("project.fromCommandLine")}
          onClick={() => { setRefusal(null); setName(current ? projectName(current) : ""); setOpen("rename"); }}>
          {t("project.rename")}
        </button>
      </div>
      {!editable && <p className="caveat">{t("project.fromCommandLine")}</p>}
      {props.answer.fileError ? <p role="alert">{t("project.fileError", { message: props.answer.fileError })}</p> : null}
      {(props.answer.pendingRestart ?? []).length > 0 && (
        <p role="note">
          {t("project.pendingRestart", { items: props.answer.pendingRestart!.join(", ") })}
          {props.answer.pendingRestart!.some((item) => item.startsWith("removed:") || item.startsWith("path:")) && ` ${t("project.restartWarning")}`}
        </p>
      )}
      {open === "add" && (
        <form aria-label={t("project.add")} onSubmit={submitAdd}>
          <label>{t("project.path")}<input type="text" name="project-path" value={path} onChange={(e) => setPath(e.currentTarget.value)} /></label>
          <label>{t("project.name")}<input type="text" name="project-name" value={name} placeholder={lastSegment(path)} onChange={(e) => setName(e.currentTarget.value)} /></label>
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit">{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
      {open === "rename" && (
        <form aria-label={t("project.rename")} onSubmit={submitRename}>
          <label>{t("project.name")}<input type="text" name="project-name" value={name} onChange={(e) => setName(e.currentTarget.value)} /></label>
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit">{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
    </div>
  );
}
```

(Check `refusalText`'s import path: it is exported from `web/src/i18n.ts`.)

`web/src/Shell.tsx`: replace the `projects`/`project`/`onProject` props with one optional `projectControl?: ReactNode`, render it right after the brand div (`{props.projectControl}`), and delete the `(props.projects?.length ?? 0) >= 2 && …` block from the foot (and the now-unused `ProjectV1` import). Keep the comment trail: replace the prop doc with `/** Project registry spec §7 (§12 C5): the project control, at the top of the sidebar. */`.

`web/src/App.tsx`:
- `const [projectsAnswer, setProjectsAnswer] = useState<ProjectsAnswerV1 | null>(null);` and derive `const projects = projectsAnswer?.projects ?? null;` in place of the old `projects` state.
- Replace the projects effect with a re-readable function:

```tsx
  // Project switcher spec D2, project registry spec §7: the stored (or current) choice while it is still listed, else
  // the first project. Re-read after an add or rename and whenever the window regains focus (another tab may have
  // added one). A failed read leaves no choice: every section acts on the first repository as before.
  const readProjects = useCallback((): Promise<void> => fetchProjects().then(
    (answer) => {
      setProjectsAnswer(answer);
      setProject((current) => pickProject(answer.projects, current ?? readProject(browserStorage())));
    },
    () => { setProjectsAnswer(null); setProject(null); },
  ), []);
  useEffect(() => { void readProjects(); }, [readProjects]);
  useEffect(() => {
    const onFocus = (): void => { void readProjects(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readProjects]);
  const rereadAfterProjectChange = async (): Promise<void> => {
    await readProjects();
    try { setControlConfig(await fetchControlConfig()); } catch { /* keep the config already on screen */ }
  };
```

- Build the control and pass it to `Shell`:

```tsx
      projectControl={projectsAnswer === null ? null : (
        <ProjectControl
          answer={projectsAnswer}
          project={project}
          onProject={chooseProject}
          onAdd={async (input) => {
            const result = await addProject(input);
            if (result.ok) { await rereadAfterProjectChange(); chooseProject(result.body.project.projectKey); }
            return result;
          }}
          onRename={async (id, name) => {
            const result = await renameProject(id, name);
            if (result.ok) await rereadAfterProjectChange();
            return result;
          }}
        />
      )}
```

- Wrap the returned `<Shell …>` in `<ProjectNames.Provider value={nameOf}>` where
  `const nameOf = useCallback((key: string) => { const p = projects?.find((entry) => entry.projectKey === key); return p ? projectName(p) : key; }, [projects]);`
- `chosen`/`controlRepoId`/the Requirements `onRepo` keep reading `projects` (now derived) unchanged.

Name display:
- `web/src/DecisionList.tsx`: `const name = useProjectName();` inside the component; the project cell renders `{name(String(row.projectKey))}`.
- `web/src/DecisionsView.tsx`: the repository `FilterSelect` gets `optionText={name}` (with `const name = useProjectName();` in the component).
- `web/src/ChainPanel.tsx`: `const name = useProjectName();`; the `<h3>` and the repository `<option>` text render `name(r.repoKey)`.
- `web/src/MemoryView.tsx`: `const name = useProjectName();`; the `memory-repo` `<option>` text renders `name(r.projectKey)`.

Locales — `en.ts` new top-level block (and the same keys in `zh.ts`):

```ts
  project: {
    none: "No project yet",
    add: "Add project",
    rename: "Rename project",
    path: "Path",
    name: "Name",
    save: "Save",
    cancel: "Cancel",
    fromCommandLine: "This panel's projects come from the command line (--repo/--root); restart it without them to add or rename here.",
    fileError: "The projects file is invalid: {{message}}",
    pendingRestart: "Changes that need a restart: {{items}}.",
    restartWarning: "After the restart, groups of a removed or moved project cannot continue.",
  },
```

```ts
  project: {
    none: "还没有项目",
    add: "新增项目",
    rename: "改名",
    path: "路径",
    name: "名称",
    save: "保存",
    cancel: "取消",
    fromCommandLine: "这个面板的项目由命令行（--repo／--root）给定；去掉这两个参数重启后，才能在这里新增或改名。",
    fileError: "项目配置文件无效：{{message}}",
    pendingRestart: "需要重启才生效的改动：{{items}}。",
    restartWarning: "重启后，被删除或移动的项目下的组将无法继续。",
  },
```

`web/src/styles.css` — after `.theme-pick`:

```css
.project-control { display: flex; flex-direction: column; gap: 6px; padding: 8px; font-size: var(--text-xs); }
.project-control select { width: 100%; }
.project-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.project-control form { display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 5: Run green** — `web/tests/projectRegistry.test.tsx`, `web/tests/projectSwitcher.test.tsx` (all, with E rewritten), `web/tests/shell.test.tsx`, `web/tests/i18nKeys.test.ts`, `web/tests/i18nPseudo.test.tsx`, `web/tests/i18nWidth.test.ts`, `web/tests/decisionList.test.tsx`, `web/tests/decisionsView.test.tsx`, `web/tests/chainPanel.test.tsx`, `web/tests/memoryView.test.tsx`, `web/tests/styles.test.ts`, `web/tests/contrast.test.ts`; then the whole web suite `./node_modules/.bin/vitest run --root web` and `npm run build --workspace web` (or the web build script in `package.json`) RC 0. If `i18nPseudo` / `i18nWidth` enumerate rendered strings or widths, satisfy them by the implementation (shorter Chinese text, layout), not by editing them.

- [ ] **Step 6: Mutations in a clone**, each named red: always render the select only for ≥2 projects (P1 and the rewritten E); drop the "No project yet" branch (P2); do not choose the added project (P3); drop the refusal line (P4); `editable` ignored (P6); drop the focus listener (P7); drop the `restartWarning` line (P8); DecisionList renders the key, not `name(...)` (P9).

- [ ] **Step 7: Commit** — `feat(web): one project control at the top of the sidebar -- add and rename projects, names everywhere`

---

### Task 6 (controller, not a subagent): gate, real browser, migration

- [ ] Gate in a fresh `git clone --local` (HOME and the four XDG roots relocated, short real TMPDIR, `npm run build --workspace web`, `git config core.hooksPath scripts/githooks`, `ORCA_CCLOOP_BIN` → ccloop `2b380ea` clone build, `ORCA_AGENTS_TABLE` → fake codex `integration` table): web build, typecheck, ledger, claude-md, hooks-path, `verify:control`, `verify:scheduler`, `verify:ccloop-pin`, `verify:panel`, `--ws check`, full vitest, `check-tmp-leak` — each its own RC (handoff §4.0 item 6).
- [ ] Real browser against a real `orca panel --projects-file <tmp>` in the clone: zero projects → add one → it is selected and Task control/Requirements see it; rename → the sidebar and the Requirements repository select show the new name; reload keeps the selection.
- [ ] Migration of the person's environment (spec §10): back up `~/.orca/panel.sh` beside itself, write `~/.orca/projects.json` (0600) with `controlStateDir` `/Users/biran/.orca/control/orca-e0c92460` and project `{ id: "orca", name: "orca", path: "/Users/biran/code/orca/orca-web" }`, remove the `--repo` line from `panel.sh`; verify by `parsePanelArgs` in a scratch script reading that file with `--projects-file` (no server, no store opened) that `control.stateDir` and `repos` come out as before.
