# Panel project switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sidebar control picks the project; Task control, Requirements, Chains and Memory act on it.

**Architecture:** A new read `GET /api/projects` joins each discovered `projectKey` to its control `repoId`
(asked of the trusted config, never derived in the browser). `App` holds the selection (persisted in
`localStorage`), renders a select in the sidebar when there are two or more projects, and passes it down; each
section's own repository select becomes a two-way view of it.

**Tech Stack:** Express + zod (server), React 19 + react-i18next + vitest/jsdom (web).

**Spec:** `docs/superpowers/specs/2026-10-04-panel-project-switcher-design.md`

**Execution:** native, in session 08011394 (the person asked for the round to run to the end without stopping).

## Global Constraints

- With fewer than two projects nothing new is rendered (spec D3).
- Storage key `orca.project`; every storage access wrapped in `try`/`catch` (spec D2).
- `/api/projects` rows sorted with `compareText` from `src/control/webProtocol.ts` (code unit order).
- Every user-visible string goes through i18n with both `en` and `zh` (`scripts/scan-panel-text.mjs` checks).
- No existing criterion is rewritten. A red existing criterion is reported, not edited.
- Verification only in a `git clone --local` copy, HOME and the four XDG roots redirected.

## Review Focus

1. A stored project that is no longer listed (repo removed from the command line) → falls back to the first. Pinned in Task 2 test D.
2. Storage that throws (private window) → page renders, first project. Pinned in Task 2 test D.
3. A project with no control repository (discovered under `--root` only) → Task control says so instead of importing into another repo. Pinned in Task 2 test A2.
4. `/api/projects` failing → sections behave as today. Pinned in Task 2 test F.
5. Switching project while a plan is selected in the import form → the plan resets to the new repo's first plan. Pinned in Task 2 test A.

---

### Task 1: `GET /api/projects`

**Files:**
- Create: `src/panel/projects.ts`
- Modify: `src/panel/api.ts` (register after the token gate)
- Test: `tests/panel/projectsApi.test.ts`

**Interfaces:**
- Produces: `registerProjectRoutes(app: Express, deps: { opts: Pick<PanelOptions, "root" | "repos">; controlRepoId: (projectKey: string) => string | null }): void`;
  response `{ projects: Array<{ projectKey: string; controlRepoId: string | null }> }`.
- In `buildApi`: `controlRepoId = deps.control ? (key) => { const id = controlRepoKey(key); try { deps.control.config.resolveRepository(id); return id; } catch { return null; } } : () => null`.

- [ ] Step 1: write `tests/panel/projectsApi.test.ts`: (a) via `registerProjectRoutes` with two temp dirs as `repos` (`zeta`, `Alpha`) and a resolver that knows only `zeta` → rows `[Alpha:null, zeta:<id>]` (code unit order: `A` < `z`); (b) via `buildApi` without control → every `controlRepoId` null and a request without the token answers 401.
- [ ] Step 2: run, see it fail (module missing).
- [ ] Step 3: implement `projects.ts`: `discoverRepos({ root: opts.root, repos: opts.repos })`, map, sort by `compareText`.
- [ ] Step 4: register in `api.ts`; run, see green.
- [ ] Step 5: mutations in a clone: resolver always null; localeCompare; route before the token gate. Each red.
- [ ] Step 6: commit.

### Task 2: the selection, the sidebar select, Task control

**Files:**
- Create: `web/src/project.ts` (`PROJECT_KEY`, `readProject`, `writeProject`, `pickProject`)
- Modify: `web/src/api.ts` (`fetchProjects`), `web/src/App.tsx`, `web/src/Shell.tsx`, `web/src/ControlPanel.tsx`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `web/tests/projectSwitcher.test.tsx`

**Interfaces:**
- `export interface ProjectV1 { projectKey: string; controlRepoId: string | null }`; `fetchProjects(): Promise<{ projects: ProjectV1[] }>`.
- `pickProject(projects: readonly ProjectV1[], stored: string | null): string | null` → stored if listed, else first, else null.
- `Shell` new optional props `projects?: readonly ProjectV1[]; project?: string | null; onProject?: (key: string) => void`; renders `<select name="project">` only when `projects.length >= 2`.
- `ControlPanel` new optional prop `repoId?: string | null` (undefined = today's `repositories[0]`; null = selected project not under control). `ImportForm` gets `repoId` and keeps a plan select over `config.plans.filter(p => p.repoId === repoId)` keyed by `repoId` so it resets on switch.
- i18n: `shell.project`, `control.import.plan`, `control.import.notUnderControl`.

- [ ] Step 1: write tests A (choose B → import carries B's repoId and B's first plan; plan select switches plan), A2 (project without control → note, no import button), B (workspace read path uses B's repoId after switching), D (reload keeps B; stored unknown → first; throwing storage → renders), E (one project → no select), F (`/api/projects` 500 → import uses `repositories[0]` as today).
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement.
- [ ] Step 4: run the file and `--ws check`; green.
- [ ] Step 5: mutations: ImportForm back to `repositories[0]`; workspace read back to `repositories[0]`; drop `readProject`; drop the try/catch; render the select always. Each red.
- [ ] Step 6: commit.

### Task 3: Requirements, Chains, Memory follow the selection

**Files:**
- Modify: `web/src/RequirementsPanel.tsx`, `web/src/ChainPanel.tsx`, `web/src/MemoryView.tsx`, `web/src/App.tsx`
- Test: `web/tests/projectSwitcher.test.tsx` (test C)

**Interfaces:**
- `RequirementsPanel`: optional `repoId?: string | null; onRepo?: (repoId: string) => void` passed to `NewRequirement`; its select shows `repoId ?? local` and calls both.
- `ChainPanel`: optional `repoKey?: string | null; onRepoKey?: (key: string) => void`.
- `MemoryView`: optional `project?: string | null; onProject?: (key: string) => void`; on open uses `project` when listed; when `project` changes after open and is listed, switches and loads.
- App maps: Requirements `repoId` = selected `controlRepoId`, `onRepo` = project whose `controlRepoId` is it; Chains and Memory use `projectKey` directly.

- [ ] Step 1: write test C: choose in the Chains select → the sidebar select shows it and the Requirements select shows its repoId; choose in Requirements → sidebar follows; open Memory → it reads the selected project; choose in Memory → sidebar follows.
- [ ] Step 2: run, see it fail.
- [ ] Step 3: implement.
- [ ] Step 4: run; green; existing web suite green.
- [ ] Step 5: mutation: Chains keeps local state only → red.
- [ ] Step 6: commit.
