# Panel project registry — design

Session `3d68f934` (2026-10-04). Status: design approved section by section by the person in conversation;
this file waits for the person's review before a plan is written. Every ruling in §9 was made by the person
(P-numbers), not by the agent.

Builds on `docs/superpowers/specs/2026-10-04-panel-project-switcher-design.md` (read its §8 first). This spec
**overrides** that spec's D3 / R3 (switcher hidden below two projects) and D6 / R6 (no runtime project add).

## 1. Problem

The person's panel is started by `~/.orca/panel.sh` with one `--repo orca=<path>`. With one project the switcher
is hidden (switcher R3), so there is no visible place that says which project the panel works on, and no place
at all to add one: projects exist only as command-line flags (switcher D6), and adding one means editing a shell
script and restarting the panel.

Success: the top of the panel always shows the current project and offers "add project" and "rename project";
both take effect without a restart; the project list lives in a config file under `~/.orca/`, not in `--repo`;
the person's existing control store and review rows carry over without a byte changed.

## 2. Project identity

A project has two fields (P4):

- `id` — fixed when the project is added, never changed. It is the panel's `projectKey`: control `repoId` is
  `controlRepoKey(id)` (`src/panel/controlOptions.ts`), review rows in `~/.orca/reviews.jsonl` carry it, and
  Decisions / Metrics / Chains / Memory look projects up by it.
- `name` — display only, renamable at any time from the panel.

`id` is derived once from the name given at add time: lowercased, every run of characters outside `[a-z0-9._-]`
replaced by `-`, leading/trailing `-` and `.` trimmed; if that is empty the same derivation is applied to the
path's last segment, and if that is empty too the id is `project`; on collision with an existing id
the suffix `-2`, `-3`, … is appended. Because `repoId` stays `controlRepoKey(id)`, the person's migrated project
`id: "orca"` keeps the existing store directory `orca-e0c92460`.

## 3. The config file

- Path: `~/.orca/projects.json`, relocated by `ORCA_PROJECTS_FILE` (Rule 17), read from the env the panel was
  given, never from `os.homedir()` at import time.
- New directories are created `0700`, new files `0600`; an existing file's mode is never changed (Rule 17).
- Shape (strict; unknown keys are an invalid file):

  ```json
  { "version": 1,
    "controlStateDir": "/abs/path",
    "projects": [ { "id": "orca", "name": "orca", "path": "/abs/path/to/repo" } ] }
  ```

  `controlStateDir` is optional; absent means `<controlRoot(env)>/panel` (P2). `projects` may be empty. `id`
  unique and matching the derivation alphabet; `name` non-empty and unique; `path` absolute and unique.
- Writes are atomic: temp file in the same directory, then `rename`. Writer of record: the panel process, on
  `POST`/`PATCH /api/projects` only. Residue on failure: at most one `projects.json.tmp-*` beside the file.
  (This registers the writer per Rule 17.)
- Concurrency limit, accepted: the write queue serialises writes inside one panel process. Two panel processes
  sharing the file, or a hand edit landing between the hash check and the `rename`, are last-writer-wins, as in
  hermes-agent. No lock file (openclaw's lock + CAS is not worth it for one small file).

## 4. Where projects come from at boot (P1)

- `--repo` or `--root` on the command line: exactly today's behaviour. The file is not read; the API answers
  `source: "command-line"`, `editable: false`; add and rename are refused.
- Neither flag: the file is the source.
  - File missing: an empty project list. The control plane still mounts (its state dir is known from §3), so
    the first project added can take work. This differs from today's "no repo ⇒ control off", which stays true
    in command-line mode.
  - File invalid (unparseable, schema, duplicate): the panel refuses to start, naming the file and the reason.
    It never rewrites or repairs the file.
- `--control-state-dir` on the command line still wins over the file's `controlStateDir`.

## 5. Making changes take effect without a restart (P5)

Studied for this choice: openclaw (atomic write + in-process notify + chokidar fallback + hash-matched echo +
per-path hot/restart classification) and hermes-agent (atomic write + `stat` signature check on every read, no
watcher, last-good on a broken file). Chosen: an in-process registry for writes made through the panel, plus a
hermes-style signature check on read so hand edits are picked up too. No file watcher.

`src/panel/projectRegistry.ts` (file mode only) holds: the file path, the last good parsed config with its
`(mtimeNs, size, ino, ctimeNs)` signature and content hash, the running project list, `pendingRestart`,
`fileError`, and a serial write queue.

- `list()` — `stat` the file; if the signature changed, re-read, validate and diff against the running list:
  - a new `id`, or a changed `name` on a known `id`: applied;
  - a removed `id`, a changed `path` on a known `id`, or a changed `controlStateDir`: **not** applied; the running
    value stays and the difference is reported in `pendingRestart` as `removed:<id>`, `path:<id>` or
    `controlStateDir` (sorted by code unit);
  - invalid file: the last good config stays, `fileError` is set to the reason; a later valid file clears it.
- `add(name, path)` / `rename(id, name)` — inside the write queue: re-read the file and compare its hash with the
  last one seen; if it moved, absorb it through the same diff first (a hand edit is never overwritten); validate;
  pre-check that the control plane would accept the entry; write atomically; then apply.
- One `apply` function is the only thing that changes running state. It updates the running list and tells the
  control plane through `TrustedControlConfig.addRepository(entry)` / `renameRepository(repoId, displayName)`,
  two new methods that run the same `checkedPath` witness validation the constructor runs.

Consumers that today read the frozen `opts.repos` read a `() => repos` function instead: `/api/projects`,
metrics / decisions discovery (`src/panel/api.ts`), Chains (`src/panel/chains.ts`), Memory
(`src/panel/memoryApi.ts`), control `knownRepository` (`src/panel/controlAssembly.ts`) and `controlRepos`
(`src/panel/api.ts`). In command-line mode that function returns `opts.repos`, so behaviour is byte-for-byte
today's.

Consequence of a restart after a hand removal or a `path` change: groups and runs in the store whose `repoId` is
no longer configured are refused by `resolveRepository` (`control-target-not-allowed`) and cannot continue. This
is the same as dropping a `--repo` today, but editing a file makes it easier to reach, so the web control shows a
warning next to every `removed:<id>` / `path:<id>` entry. Nothing is repaired automatically.

## 6. API

All behind the same token check as every `/api` route.

- `GET /api/projects` → `{ source: "file" | "command-line", editable, projects: [{ projectKey, name, path,
  controlRepoId }], pendingRestart: string[], fileError: string | null }`. `projectKey` is the `id`. In
  command-line mode `name` equals `projectKey`.
- `POST /api/projects` `{ name, path }` → `201 { project }`. Refusals, each its own code:
  `project-path-missing` (not an existing directory), `project-path-not-repository-root`
  (`git rev-parse --show-toplevel` ≠ realpath), `project-path-taken` (realpath already a project),
  `project-name-invalid` (empty after trim), `project-name-taken`, `projects-from-command-line`,
  `projects-file-invalid` (the file is currently invalid; fix it first).
- `PATCH /api/projects/:id` `{ name }` → `200 { project }`; refusals: `project-unknown`, `project-name-invalid`,
  `project-name-taken`, `projects-from-command-line`, `projects-file-invalid`.
- The control config view's `repositories[].displayName` is the project's `name`; `repoId` never changes.
- Plans stay command-line only (`--plan <planId>=<repoId>=<path>`, the import allow-list); a `--plan` may name a
  file-mode project's `repoId`. A project added at runtime has no plan, so its Task control import shows the
  existing "no repository / plan" note; work enters it through Requirements (create-requirement checks
  `knownRepository`, the split resolves through `resolveRepository`).
- Trust boundary: adding a project makes the panel run `git` in a directory named by a browser request, and later
  run work there. That is the same trust as the person typing `--repo`, guarded by the token and the loopback
  bind. It deliberately overrides the switcher spec's "no filesystem path built from the request" (D6) as a
  consequence of P3 / P4.

## 7. Web

- The sidebar `Project` select is removed. The project control moves to the top navigation area and is always
  shown (P3, overriding switcher R3): the current project's name; a menu listing every project, then "Add project"
  and "Rename current project". With zero projects it reads "No project yet" and offers Add. In command-line mode
  Add and Rename are disabled with a note saying the projects come from the command line.
- `pendingRestart` and `fileError` are shown at the control, the latter as an error.
- Add: a small form, path and name (name defaults to the path's last segment). On success the page re-reads
  `/api/projects` and the control config and selects the new project.
- Rename: re-reads the same two; the selection is unchanged (it stores the `id`).
- The page re-reads `/api/projects` when its window regains focus, so a project added in another tab shows up.
- Decisions and Metrics rows keep `projectKey` as their key and display the project's `name`.
- zh and en strings for everything new.

## 8. Criteria

Every new branch gets a mutation that deletes it, seen red. All file I/O goes through `ORCA_PROJECTS_FILE` /
`ORCA_CONTROL_DIR` in temp directories; no criterion reads or writes the real `~/.orca`.

| area | criterion |
|---|---|
| registry | add writes the file; new file `0600`, new dir `0700`, an existing file's mode kept; each refusal code; a hand-added project shows up on the next `list()`; a hand-removed one gives `pendingRestart` and stays running; a broken file gives `fileError` and keeps last good; a hand edit made before an add is not overwritten; two concurrent adds both land |
| control | after an add, with no restart: `readView` lists it, a requirement can be created in it, and `set-workspace-mode` accepts it; after a rename `displayName` changes and `repoId` does not |
| command-line mode | `--repo` ⇒ `source: "command-line"`, `POST` refused; every existing criterion unchanged and green |
| boot | no flags ⇒ file read; missing file ⇒ empty list with the control plane mounted; invalid file ⇒ refuses to start |
| web | one project ⇒ control shown; zero ⇒ "No project yet" + Add; add selects the new project; rename shows the new name; focus re-reads; Decisions rows show `name`; a `removed:<id>` entry shows the warning |

Existing criteria that contradict this design and are rewritten, by the person's authorisation (P6):
`web/tests/projectSwitcher.test.tsx` E ("one project: no select rendered"). The plan lists every other existing
criterion it touches, by name, before touching it.

## 9. Rulings (all by the person, 2026-10-04, this session)

- P1: `--repo` / `--root` given ⇒ today's behaviour, file not read, editing disabled; neither ⇒ the file.
- P2: the store directory is a `controlStateDir` field in the file; the migration writes the existing
  `~/.orca/control/orca-e0c92460`; a fresh file omits it and gets `<controlRoot>/panel`.
- P3: the project control sits in the top navigation and is shown with one project too.
- P4: identity split — fixed `id`, renamable `name`; add and rename this round, no delete.
- P5: in-process registry for panel writes plus a `stat`-signature check on read for hand edits; no watcher;
  remove / path change / `controlStateDir` change need a restart and are reported, not applied.
- P6: existing criteria that contradict this design may be rewritten; each one is named in the plan first.

## 10. Migration of the person's environment (last step, after the gate is green)

Shown to the person as a diff before writing:

- create `~/.orca/projects.json` with `controlStateDir: "/Users/biran/.orca/control/orca-e0c92460"` and one
  project `{ id: "orca", name: "orca", path: "/Users/biran/code/orca/orca-web" }`;
- remove the `--repo` argument from `~/.orca/panel.sh`, nothing else.

`repoId` stays `orca-e0c92460`, review rows keep `projectKey: "orca"`; no existing file under `~/.orca/control` or
`reviews.jsonl` is touched. The person restarts the panel.

## 11. Not done this round

- Deleting a project.
- Filtering the control group list by project (needs `repoId` in `GroupSummaryV1`) and filtering Decisions.
- A file watcher.
- Adding projects in `--root` mode.
- ccmem's local-path origin fix is a separate piece of work in the ccmem repository (its own rules); Orca's
  `src/corrections/projectKey.ts` port follows it afterwards.
