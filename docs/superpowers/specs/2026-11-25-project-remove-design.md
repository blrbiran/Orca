# `orca project remove`: unregistering a project, and what happens to its groups (#470 P1) — design

Status: **draft for the human's review; no code.** (Ruled and built in session `5d3d0c09`: see §6.) Author: Orca session `6add92a5` (Claude Opus 5.5), 2026-11-25, on main
after `chore(deps): repin ccloop to 276114a…`. Human, 2026-11-24: #470's `project remove` and its groups' ownership are
「以后单独设计」 (agreed). #470's P0 (a gone folder is a warning, `missingPaths`) already landed:
`fix(panel,cli): a registered project whose folder is gone is a warning, not a broken projects file (#470)`.

## 1. Problem

`~/.orca/projects.json` can only grow from Orca (`ProjectRegistry` has `list/add/rename/addMulti/setDirs/addPlan`; the
file header says "nothing is ever removed from it at runtime"). A stale entry (the tester's `git-merge-lab` →
`/private/tmp/gitmerge-lab.da8Dbl`, 13 groups under it) can only be removed by a hand edit, which the README says waits
for a restart and which leaves the 13 groups with no stated owner. The tester left the entry in place on purpose and
waits for a supported verb.

## 2. Design

### 2.1 The verb

- CLI `orca project remove <id> [--archive-groups]`; Web `DELETE /api/projects/:id` and a "Remove" action in project
  settings. A **person's** act (socket-tier person token, as `waive-acceptance`); an agent is refused
  `project-remove-person-required`.
- **Refused while the project has a group that is not archived**, naming the count by state:
  `project-has-groups: 10 done, 1 running (archive them first, or pass --archive-groups)`.
- `--archive-groups` archives every such group first through the existing `archive-group` command, one by one, and stops
  at the first refusal (a running group is refused by archive's own rule, so a project with a live run is never removed).
  Nothing new decides which groups may be archived.
- The entry is removed from `projects.json` through the registry's single writer (the base-hash check, C4). The runtime
  follows the registry's existing rule for removals: the project leaves `list()` at once, and is named in
  `pendingRestart` until the panel restarts when it was mounted (its repository stays in the running repo table until
  then; nothing is unmounted at runtime). An entry whose folder was gone at boot was never mounted, so nothing is pending.
- Multi-directory projects: the same verb and rules (their groups are archived the same way).

### 2.2 The groups afterwards

- Archived groups stay in the control store untouched (no data is deleted; `orca gc` keeps its own rules).
- Their views must still render: `group show` / `brief` of a group whose project is no longer registered answer
  normally with `project: { id, removed: true }` instead of failing on the repository lookup (criterion below).
- Re-adding a project at the same path gets the **same id** only if the name derives to the same slug
  (`deriveProjectId`); the groups then reattach. A different id leaves them archived under the removed key. This is
  stated in the output of `remove` ("re-add with the same name to reattach its N archived groups").

### 2.3 Next-step lines

`orca status` (warn line for a missing path) and `project list` name `orca project remove <id>` beside the gone path.

## 3. Not in scope

A `repath` verb (point an id at another folder) — a separate, smaller change if wanted; deleting groups or their run
data; un-registering from the Web while the panel serves that project's live run (refused above by archive's rule).

## 4. Criteria (each a command that exits 0 / non-0)

1. A project with a non-archived group: `remove` is refused by `project-has-groups` with the counts; the file is byte-for-
   byte unchanged.
2. `--archive-groups` on a project whose groups are all done: each is archived, the entry is gone from the file and from
   `project list`; `orca status` has no projects warn for it.
3. A project with a running group and `--archive-groups`: refused at that group; no group after it is archived; the file
   is unchanged.
4. An agent's `remove` is refused `project-remove-person-required`.
5. An archived group of a removed project: `group show` renders with `project.removed: true` (red today if the repository
   lookup throws — to be measured first).
6. Web: `DELETE /api/projects/:id` answers as the CLI does (same codes); the Remove button is only for the owner.

## 5. Open questions (recommended answers)

1. Default: refuse while groups remain (recommended) vs archive automatically. Refusing keeps a person's choice explicit;
   the flag makes it one command. **Answered (§6.1): refuse; `--archive-groups` archives then removes.**
2. Should `remove` of a never-mounted (gone-folder) project skip the group check? Recommended **no**: the 13 groups are
   exactly the ownership question the tester raised; `--archive-groups` handles them. **Answered (§6.1): no exemption.**
3. A `repath` verb now or later? Recommended later. **Not ruled; out of scope (§6.1).**

## 6. Human rulings and revisions (session 5d3d0c09, 2026-11-25)

Recorded by the implementing agent of session `5d3d0c09` (Claude Opus 5.5), on branch `fix/project-remove-470` from
main `fddffd41`. The text of §1–§5 above is kept as drafted; where this section differs, this section is what was built.

### 6.1 Rulings (the human, 2026-11-25, this session)

1. **Answers §5 Q1.** `project remove` **refuses** while the project has groups that are not archived; the refusal names
   the count (by state) and the next step. The tester's alternative (a `--force` that keeps the groups unarchived) is
   **not adopted**.
2. **Answers §5 Q1/Q2.** `--archive-groups` archives those groups first, through the existing `archive-group` command,
   then removes the project. A gone-folder project is not exempt (§5 Q2's recommended "no" stands).
3. §5 Q3 (`repath`) was not ruled on; it stays out of scope (§3).

### 6.2 Gaps a read-only review found in the draft, and how each is resolved

a. **(High) `remove` resolves against the registry, including unmounted entries.** The CLI's project context drops rows
   whose `controlRepoId` is null before `resolveProject`, so a verb resolved through it answers `project-not-found` on
   exactly the tester's case. Resolved: `orca project remove <id|name>` does **not** use the project context; it sends
   the name to the panel, and the registry resolves it against the projects file's own entries (`lastGood`), mounted or
   not: the exact id first, else the one entry whose name is exactly that. Neither ⇒ `project-unknown` (404) listing the
   registered ids.
b. **(Medium) `project show <name>` on a registered, unmounted entry.** Resolved: the CLI's project context tells a
   registered-but-unheld row apart from an unknown name. `project show` of such an entry exits 0 with
   `{ schema: "orca-project-show-v1", projectKey, path, repoId: null, mounted: false, reason, next }` and prints
   `<id>: registered, not mounted: folder not found: <path>` plus the next step (`orca project remove <id> --as-person`).
   `reason` is `folder not found` when the panel names the entry in `missingPaths`, else `not held by the control
   plane`. Every other verb resolved through the project context refuses such an entry `project-not-mounted` (exit 1)
   with the same facts, instead of `project-not-found`. `project list` writes `(not mounted)` instead of `(no control)`
   for such a row.
c. **(Medium) `--archive-groups` on a group whose repository is not mounted.** Measured, criterion
   `tests/panel/projectRemove.test.ts` ("a project whose folder is gone ..."): `archive-group` reads and writes the control
   store only (`applyArchiveGroup`, `refuseArchive`); nothing on that path looks the repository up, so a gone folder's
   groups archive like any other. No new refusal code was needed.
d. **(Low) the status fix text.** `orca status`'s missing-folder warning, `project list`'s warning line and the Web's
   missing-folder note now name `orca project remove <id> --as-person` (the Web: the Remove action).

### 6.3 Revisions to §2 as built

- **Authorization** follows the existing registry-mutating verbs (Rule 11): the gate is `projectAddRefusal`
  (`src/panel/permissions.ts`), as for `project add` and the Web's `PATCH /api/projects/:id`. So the codes are the
  existing ones -- a member `owner-required`, the socket without a token `control-person-token-required`, a run Orca
  dispatched `control-dispatched-run-refused` -- not a new `project-remove-person-required` (§2.1, §4 item 4). The CLI
  also refuses over MCP (`project-remove-not-over-mcp`) and under the dispatched-run marker before sending, as
  `project add` does.
- **Routes.** Web `DELETE /api/projects/:id` with an optional JSON body `{ "archiveGroups": true }`; socket
  `POST /api/control/projects/:id/remove` with the same body (the socket client sends GET/POST only). One handler
  (`removeProject`, `src/panel/projects.ts`) answers both.
- **Archived** means the group's terminal mark is there: a *closed* group counts as archived, as every reader that asks
  only whether the mark is there already treats it (`archivedMark.ts`).
- **Refusals, in order** (nothing is written before the last one passes): `projects-from-command-line` (409);
  `project-unknown` (404); `project-in-multi` (409: a single project that is a member of a multi project; remove or
  change the multi project first); `project-remove-needs-control` (409: the task control plane is off, so the groups
  cannot be counted); `project-has-groups` (409) with `groups: { notArchived, byStatus, groupIds }` and the message
  `<id> has <n> group(s) not archived (<k> <status>, ...): archive them first, or pass --archive-groups`;
  with `--archive-groups`, the first archive refusal stops the walk with `project-group-archive-refused` (409), naming the
  group, its own refusal code and message, and the groups archived before it -- those stay archived (archive deletes
  nothing; `orca group unarchive` takes one back) and the projects file is unchanged.
- **Answer (200)**: `{ removed: { projectKey, name, kind, path | dirs }, archivedGroups: [ids], archivedBefore: n,
  restartNeeded: boolean, next: [lines] }`. `restartNeeded` is true for a single project that was mounted: the registry
  names it `removed:<id>` in `pendingRestart` until the panel restarts (its repository stays in the running repo table;
  nothing is unmounted at runtime). A gone-folder entry was never mounted, so nothing is pending and its `missingPaths`
  line goes at once. A multi project is dropped from the runtime's multi map at once (`removeMulti`).
- **Re-adding before a restart.** A mounted project removed in this panel's life cannot be added again until the panel
  restarts (`project-removed-pending-restart`, 409): the control plane still holds its repository.
- **Web.** A "Remove" action in the project control (owner only, file mode only) opens a confirmation that says what
  happens: the entry leaves `projects.json`, nothing on disk is deleted, archived groups stay readable. Confirming sends
  the DELETE; a `project-has-groups` answer shows the counts by state and offers "Archive these N groups and remove",
  which resends with `archiveGroups: true`.
- **§2.2 `group show` of a removed project's group (§4 item 5)** was not built in this round: it was not in the human's
  task list for this session, and its "red today" premise was not measured. It stays open.

### 6.4 Writes outside the repository (Rule 17)

The one writer is unchanged: the panel's registry writes `$ORCA_PROJECTS_FILE` (default `~/.orca/projects.json`) through
its base-hash check. New trigger: `orca project remove` / the Web Remove action. A refused remove writes nothing; a remove
whose `--archive-groups` walk is refused leaves the file unchanged and the groups archived before the refusal archived
(control store, not a file outside the repository). Criteria use a temp `ORCA_PROJECTS_FILE` / `ORCA_CONTROL_DIR`.
