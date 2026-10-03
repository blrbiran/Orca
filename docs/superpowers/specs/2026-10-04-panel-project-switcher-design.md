# Panel project switcher — design

Session `08011394` (2026-10-04). Status: implemented in the same session; **every ruling below was made by the
agent on the person's behalf** (the person asked for this round to run to the end without stopping) and is waiting
for the person's review — §7.

## 1. Problem

The person runs one `orca panel` over several repositories (`--repo <key>=<path>` given more than once, or
`--root`). The panel has no notion of "the project I am working on":

- Task control imports only into `config.repositories[0]` with `config.plans[0]` (`web/src/ControlPanel.tsx`
  `ImportForm`), and reads the workspace mode of `repositories[0]` only (`web/src/App.tsx`).
- Requirements, Chains and Memory each keep their own repository dropdown, each starting at its first entry, so
  picking a repository in one section does nothing in the next.

Success: one control in the sidebar picks the project; every section that acts on one repository acts on that
project; a panel with one repository looks and behaves exactly as before.

## 2. What a project is

A project is a `projectKey` from the panel's own discovery, `discoverRepos({ root, repos })`
(`src/metrics/discover.ts`), the same list `/api/metrics` and `/api/memory/*` use. Every section already derives its
repository identity from it:

| section | identity | derived from `projectKey` by |
|---|---|---|
| Chains | `repoKey` | identity (`src/panel/chains.ts` `chainRepoView(r.projectKey, …)`) |
| Memory | `projectKey` | identity (`src/panel/memoryApi.ts`) |
| Task control, Requirements | `repoId` | `controlRepoKey(projectKey)` (`src/panel/controlAssembly.ts`), only for `--repo` entries |

So the switcher needs no new identity, only the join, which the server already knows.

## 3. Design

**D1 — `GET /api/projects`.** Answers `{ projects: [{ projectKey, controlRepoId }] }`, one row per discovered
repository, sorted by code unit on `projectKey`. `controlRepoId` is `controlRepoKey(projectKey)` when the control
plane is mounted and the project is one of its repositories, else `null`. Behind the same token check as every
other `/api/*` read. It re-runs discovery on each request, like `/api/memory/status`. The browser never computes
`controlRepoKey` itself and never relies on `displayName` equalling `projectKey`.

**D2 — The selection lives in the browser.** `App` holds `project: string | null`. Default: the stored choice if it
is still listed, else the first project. The choice is a per-viewer convenience, so it is kept in `localStorage`
(key `orca.project`), every access wrapped in `try`/`catch` the way the theme and language already are; a page that
cannot store it still works and starts at the first project. Nothing on the server records it.

**D3 — The sidebar control.** A `Project` select in the sidebar foot, beside Theme and Language, shown only when
there are two or more projects. With one project (or none) nothing is rendered, so single-repository panels are
unchanged byte for byte in the DOM.

**D4 — What follows the selection.**

- Task control: the import form imports into the selected project's control repository, and offers a plan select
  over that repository's plans (first by default); with no plan for it, the existing `noRepository` note. A
  project with `controlRepoId: null` shows a new note, "this project is not under task control". The workspace
  mode is read for the selected project's control repository and re-read when the project changes.
- Requirements: the new-requirement form's repository select shows the selected project and changing it changes
  the selection (one selection, two controls).
- Chains: the start form's repository select, likewise.
- Memory: the repository select, likewise; the section reads the selected project when it is listed in its
  status.

Each component keeps working without the new props (it falls back to its own state), so a component rendered alone
behaves as before.

**D5 — What does not follow it (this round).** The control group list, Decisions and Metrics still show every
project. Filtering the group list needs a `repoId` on `GroupSummaryV1`, a wire-schema change with many fixtures;
Decisions and Metrics already show the project per row. Registered in §6.

**D6 — Adding a project at runtime: not done.** The repositories a panel may touch are given by the person on its
command line; the panel has never accepted a filesystem path from the browser (`src/panel/api.ts`, "never a
filesystem path built from the request"), and the control plane's trusted config is fixed at start. Adding a project
means restarting the panel with another `--repo` (and, with more than one, `--control-state-dir`). Registered in §6.

## 4. Criteria

| criterion | what it pins | mutation that must turn it red |
|---|---|---|
| `tests/panel/projectsApi.test.ts` | rows, order, `controlRepoId` join and `null`, token required | drop the join (`controlRepoId` always null); sort with localeCompare; skip the token check |
| `web/tests/projectSwitcher.test.tsx` A | two projects: the select appears; choosing B makes the import command carry B's `repoId` and B's plan | ImportForm back to `repositories[0]` |
| B | the workspace mode is read for the selected project | App back to `repositories[0]` for the workspace read |
| C | choosing in Requirements / Chains / Memory moves the sidebar select and the other sections | one section keeps local state only |
| D | the choice survives a reload; a stored project no longer listed falls back to the first; storage that throws still renders | drop the read of the stored choice; drop the try/catch |
| E | one project: no select rendered | always render |

Existing criteria are not rewritten; any that turns red is a finding for the person, not an edit (Rule 9, handoff
§4.0 rule on existing criteria).

## 5. Error handling

`/api/projects` failing (network or non-2xx) leaves `project` at `null`: every section behaves as it does today
(first repository), and no error page is shown for it — the sections that need a repository already show their own
errors. A selected project that disappears from a later answer falls back to the first listed.

## 6. Registered, not done

- Filter the control group list by project (needs `repoId` in `GroupSummaryV1`).
- Filter Decisions by project.
- Add or remove a project at runtime (D6).

## 7. Rulings made on the person's behalf (for review)

- R1: project = discovered `projectKey`; the join to `repoId` comes from a new server read (D1), not from
  `displayName`.
- R2: selection in `localStorage`, not on the server and not in the URL (D2).
- R3: switcher hidden with fewer than two projects (D3).
- R4: per-section selects stay and become two-way views of the one selection, rather than being removed (D4).
- R5: group list / Decisions / Metrics not filtered this round (D5).
- R6: no runtime project add (D6).

## 8. Implementation corrections (same session; the sections above are kept as written)

- D1: the join is not asked of the trusted config. The control read deps (`ControlReadApiDeps.config`) expose
  `readView` only, so `src/panel/api.ts` joins a project to `controlRepoKey(projectKey)` when the control plane is
  mounted and the project is one of the `--repo` entries -- the exact expression `src/panel/controlAssembly.ts`
  builds the trusted config's repositories with. The browser still never derives a `repoId`.
- §4 criterion D's "drop the try/catch" mutation shows red only as an unhandled rejection: without the catch the
  page still lands on the first project, which is the fallback anyway.
- Memory follows the selection only once its section has been opened (it reads nothing before, plan D8 of the
  memory tab), and a project Memory does not list leaves it where it was.
